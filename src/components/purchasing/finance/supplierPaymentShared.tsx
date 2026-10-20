'use client';

import type { SupplierCreditStatus, SupplierPaymentMethod, SupplierPaymentStatus } from '@mb/shared';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * Labels and badges for the Supplier Payments screen. Payment statuses reuse
 * the finance module's StatusBadge (its vocabulary already has pending,
 * posted, rejected and reversed); supplier credit has two states of its own —
 * an open liability and a settled one — so it gets its own badge in the same
 * colour language: amber waiting, blue open, slate settled, red refused.
 */

export const PAYMENT_STATUS_OPTIONS: Array<{ value: SupplierPaymentStatus; label: string }> = [
  { value: 'pending_approval', label: 'Pending approval' },
  { value: 'posted', label: 'Posted' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'reversed', label: 'Reversed' },
];

export const CREDIT_STATUS_OPTIONS: Array<{ value: SupplierCreditStatus; label: string }> = [
  { value: 'pending_approval', label: 'Pending approval' },
  { value: 'active', label: 'Active' },
  { value: 'settled', label: 'Settled' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'cancelled', label: 'Cancelled' },
];

const METHOD_LABEL: Record<SupplierPaymentMethod, string> = {
  cash: 'Cash',
  easypaisa: 'Easypaisa',
  bank: 'Bank',
};

export function paymentMethodLabel(method: SupplierPaymentMethod, account?: 'cash' | 'bank'): string {
  const m = METHOD_LABEL[method] ?? method;
  return account && account !== method ? `${m} · ${account === 'bank' ? 'Bank account' : 'Cash account'}` : m;
}

const CREDIT_STYLES: Record<SupplierCreditStatus, string> = {
  pending_approval: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  active: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  settled: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  cancelled: 'bg-muted text-muted-foreground',
};

export function CreditStatusBadge({ status }: { status: SupplierCreditStatus }) {
  const label = CREDIT_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
  return (
    <Badge variant="secondary" className={cn('whitespace-nowrap', CREDIT_STYLES[status] ?? 'bg-muted text-muted-foreground')}>
      {label}
    </Badge>
  );
}

/** A label / value pair for the summaries inside the dialogs. */
export function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium break-words">{children}</dd>
    </>
  );
}

/**
 * A filter dropdown whose empty choice means "no filter" — FilterSelect's
 * contract (finance-actions.tsx), plus the `items` map Base UI's Select needs
 * to print the chosen LABEL in the closed trigger. Without it the trigger
 * shows the raw value ("pending_approval", a supplier's uuid, "__all__")
 * until the list has been opened once.
 */
export function LabeledFilterSelect({
  value,
  onChange,
  options,
  allLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  allLabel: string;
}) {
  const ALL = '__all__';
  const items = [{ value: ALL, label: allLabel }, ...options];
  return (
    <Select items={items} value={value === '' ? ALL : value} onValueChange={(v) => onChange(v === ALL ? '' : ((v as string) ?? ''))}>
      <SelectTrigger className="h-11 w-full md:h-9">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {items.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
