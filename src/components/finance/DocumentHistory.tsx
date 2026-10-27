'use client';

import {
  FINANCE_DOCUMENT_EVENT_LABELS,
  FINANCE_ROLE_LABELS,
  type FinanceDocumentEvent,
  type FinanceDocumentType,
  type FinanceRole,
} from '@mb/shared';
import { useDocumentHistory } from '@/lib/finance';
import { formatDateTime } from '@/utils/date';
import { cn } from '@/lib/utils';

/**
 * An entry's or a deposit's life, oldest first: who created it, every edit and
 * what it changed, each submission, each rejection with its remarks, and the
 * approval with its voucher. Read from finance_document_events, which database
 * triggers write — so nothing here depends on the screen that made the change.
 */

const FIELD_LABELS: Record<string, string> = {
  businessDate: 'Date',
  txnType: 'Type',
  ledgerHeadName: 'Ledger head',
  branchName: 'Branch',
  description: 'Description',
  amount: 'Amount',
  paymentMethod: 'Method',
  account: 'Account',
  referenceNo: 'Reference',
  notes: 'Notes',
  note: 'Note',
  cashAmount: 'Cash',
  easypaisaAmount: 'Easypaisa',
  bankAmount: 'Bank',
  fuelCharges: 'Fuel charges',
};

const DOT: Partial<Record<FinanceDocumentEvent['event'], string>> = {
  rejected: 'bg-red-500',
  approved: 'bg-emerald-500',
  submitted: 'bg-amber-500',
  resubmitted: 'bg-amber-500',
  deleted: 'bg-red-500',
};

function show(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return v.toLocaleString('en-PK', { maximumFractionDigits: 2 });
  return String(v);
}

function roleLabel(role: string | null): string | null {
  if (!role) return null;
  if (role === 'super_admin') return 'Super Admin';
  if (role === 'branch_manager') return 'Branch';
  return FINANCE_ROLE_LABELS[role as FinanceRole] ?? role;
}

export function DocumentHistory({
  type,
  id,
  path,
  className,
}: {
  type: FinanceDocumentType;
  id: string;
  /** The document's own URL; `/history` is appended. */
  path: string;
  className?: string;
}) {
  const { data, isLoading, isError } = useDocumentHistory(type, id, path);

  return (
    <div className={cn('space-y-2', className)}>
      <p className="text-xs text-muted-foreground">History</p>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : isError ? (
        <p className="text-xs text-destructive">Could not load the history.</p>
      ) : !data?.length ? (
        <p className="text-xs text-muted-foreground">No history recorded yet.</p>
      ) : (
        <ol className="space-y-3 border-l pl-4">
          {data.map((e) => {
            // A blank saved over a blank (null → '') is not a change worth showing.
            const changes = Object.entries(e.changes ?? {}).filter(([, c]) => show(c.from) !== show(c.to));
            const role = roleLabel(e.actorRole);
            return (
              <li key={e.id} className="relative">
                <span
                  className={cn(
                    'absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-background',
                    DOT[e.event] ?? 'bg-muted-foreground/50',
                  )}
                />
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-sm font-medium">{FINANCE_DOCUMENT_EVENT_LABELS[e.event] ?? e.event}</span>
                  {e.revision > 1 && <span className="text-xs text-muted-foreground">rev. {e.revision}</span>}
                  {e.voucherNo && <span className="font-mono text-xs">{e.voucherNo}</span>}
                </div>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(e.createdAt)}
                  {e.actorName ? ` · ${e.actorName}` : ''}
                  {role ? ` (${role})` : ''}
                </p>
                {e.remarks && (
                  <p
                    className={cn(
                      'mt-1 whitespace-pre-wrap break-words rounded-md px-2 py-1 text-xs',
                      e.event === 'rejected'
                        ? 'bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200'
                        : 'bg-muted text-foreground',
                    )}
                  >
                    {e.remarks}
                  </p>
                )}
                {changes.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {changes.map(([field, c]) => (
                      <li key={field} className="break-words">
                        <span className="text-muted-foreground">{FIELD_LABELS[field] ?? field}:</span>{' '}
                        <span className="line-through opacity-70">{show(c.from)}</span> → <span>{show(c.to)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
