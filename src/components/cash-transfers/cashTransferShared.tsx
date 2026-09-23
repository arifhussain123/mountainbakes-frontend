'use client';

import {
  CASH_TRANSFER_METHODS,
  CASH_TRANSFER_METHOD_LABELS,
  type CashTransfer,
  type CashTransferMethod,
  type CashTransferStatus,
} from '@mb/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { parseAmount, sanitizeAmount } from '@/components/production-orders/discountShared';

/**
 * The vocabulary and the rules a cash transfer is written and read by, in one
 * place — the same arrangement `discountShared.tsx` makes, and for the same
 * reason: the record is shown on four screens (the branch popup, the branch
 * list, Finance's board, the Daily Ledger) and none of them may own a rule.
 *
 * The amount helpers are IMPORTED from discountShared rather than restated. A
 * discount and a transfer are both money typed off a slip, and two copies of
 * "digits, one dot, two decimals, rounded to the paisa" would be two places for
 * the rounding to disagree with what the API accepts.
 */

export { parseAmount, sanitizeAmount };

export const CASH_TRANSFER_STATUS_STYLES: Record<CashTransferStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
};

/** Badge wording says whose move it is — the rule the discount screens follow. */
const STATUS_LABELS: Record<CashTransferStatus, string> = {
  pending: 'Awaiting Finance',
  approved: 'Approved',
  rejected: 'Rejected',
};

export const cashTransferStatusLabel = (s: CashTransferStatus | string) =>
  STATUS_LABELS[s as CashTransferStatus] ?? s;

export const methodLabel = (m: CashTransferMethod | string) =>
  CASH_TRANSFER_METHOD_LABELS[m as CashTransferMethod] ?? m;

/** Branch names read "Mountain Bakes X" in the table; the prefix is noise on a row. */
export const shortBranch = (name: string | null | undefined) => (name ?? '').replace('Mountain Bakes ', '') || '—';

export function CashTransferStatusBadge({ status, className }: { status: CashTransferStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        CASH_TRANSFER_STATUS_STYLES[status] ?? 'bg-muted',
        className,
      )}
    >
      {cashTransferStatusLabel(status)}
    </span>
  );
}

/** Why a row can no longer be touched — for a tooltip on the Final label. */
export function lockReason(t: CashTransfer): string {
  if (t.status === 'approved') return `Finance approved this transfer and booked receipt ${t.voucherNo ?? ''}. It can no longer be changed.`.trim();
  if (t.status === 'rejected') return 'Finance rejected this transfer. Record a new one if the handover still stands.';
  return 'Finance has not decided yet. A transfer cannot be edited once submitted — the photo is evidence of one specific handover.';
}

/** The client half of CreateCashTransferSchema: amount > 0, a method, a photo. */
export function isCashTransferInputValid(amount: string, method: CashTransferMethod | null, photoCount: number): boolean {
  return parseAmount(amount) > 0 && method !== null && photoCount >= 1;
}

/**
 * Total Amount · Payment Method · Note — the three typed fields.
 *
 * Payment method is a single choice rendered as three toggle buttons rather
 * than checkboxes: exactly one method moves the money, and a toggle group says
 * so where a row of checkboxes invites ticking two. Same `type="text"` /
 * `inputMode="decimal"` amount as the discount form, for the reasons given
 * there.
 */
export function CashTransferFormFields({
  idPrefix,
  amount,
  onAmountChange,
  method,
  onMethodChange,
  note,
  onNoteChange,
  disabled,
}: {
  idPrefix: string;
  amount: string;
  onAmountChange: (next: string) => void;
  method: CashTransferMethod | null;
  onMethodChange: (next: CashTransferMethod) => void;
  note: string;
  onNoteChange: (next: string) => void;
  disabled?: boolean;
}) {
  const amountId = `${idPrefix}-amount`;
  const noteId = `${idPrefix}-note`;
  const amountBad = amount !== '' && parseAmount(amount) <= 0;

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={amountId}>
          Total Amount <span className="text-destructive">*</span>
        </Label>
        <Input
          id={amountId}
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => onAmountChange(sanitizeAmount(e.target.value))}
          placeholder="0.00"
          disabled={disabled}
          className="text-base sm:text-sm"
        />
        {amountBad && <p className="text-xs text-destructive">Enter an amount greater than 0.</p>}
      </div>

      <div className="space-y-1.5">
        <Label>
          Payment Method <span className="text-destructive">*</span>
        </Label>
        <div role="radiogroup" aria-label="Payment method" className="grid grid-cols-3 gap-2">
          {CASH_TRANSFER_METHODS.map((m) => {
            const selected = method === m;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={disabled}
                onClick={() => onMethodChange(m)}
                className={cn(
                  'flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium transition-colors',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  selected
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-input bg-background hover:bg-muted',
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded-sm border',
                    selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50',
                  )}
                >
                  {selected && <span className="text-[10px] leading-none">✓</span>}
                </span>
                {CASH_TRANSFER_METHOD_LABELS[m]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={noteId}>Note</Label>
        <Textarea
          id={noteId}
          rows={2}
          maxLength={500}
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="e.g. Cash deposited for previous production order"
          disabled={disabled}
        />
      </div>
    </>
  );
}
