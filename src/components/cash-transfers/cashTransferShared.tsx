'use client';

import type { ReactNode } from 'react';
import {
  CASH_TRANSFER_METHOD_LABELS,
  cashTransferChannelsLabel,
  cashTransferTotal,
  type CashTransfer,
  type CashTransferChannels,
  type CashTransferMethod,
  type CashTransferQueue,
  type CashTransferStatus,
} from '@mb/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/utils/currency';
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
  STATUS_LABELS[s as CashTransferStatus] ?? QUEUE_LABELS[s as CashTransferQueue] ?? s;

/**
 * The two halves of a pending deposit: with Accounts until the Accountant
 * submits it for approval, then with Finance Admin. Finance's board filters by
 * these too.
 */
const QUEUE_LABELS: Record<CashTransferQueue, string> = {
  with_accounts: 'With Accounts',
  awaiting_approval: 'Awaiting Approval',
};

const QUEUE_STYLES: Record<CashTransferQueue, string> = {
  with_accounts: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400',
  awaiting_approval: CASH_TRANSFER_STATUS_STYLES.pending,
};

/** Which half of pending a deposit is in; null once it is decided. */
export const cashTransferQueue = (t: Pick<CashTransfer, 'status' | 'forwardedAt'>): CashTransferQueue | null =>
  t.status !== 'pending' ? null : t.forwardedAt ? 'awaiting_approval' : 'with_accounts';

export const methodLabel = (m: CashTransferMethod | string) =>
  CASH_TRANSFER_METHOD_LABELS[m as CashTransferMethod] ?? m;

/** "Cash + Easypaisa", "Bank", "Fuel only" — how a deposit's channels read on a row. */
export const channelsLabel = (t: CashTransferChannels & { fuelCharges?: number }) => cashTransferChannelsLabel(t);

/** Branch names read "Mountain Bakes X" in the table; the prefix is noise on a row. */
export const shortBranch = (name: string | null | undefined) => (name ?? '').replace('Mountain Bakes ', '') || '—';

/**
 * The deposit's status; a pending one says whether it is with Accounts or
 * awaiting Finance Admin's approval.
 */
export function CashTransferStatusBadge({
  transfer,
  className,
}: {
  transfer: Pick<CashTransfer, 'status' | 'forwardedAt'>;
  className?: string;
}) {
  const queue = cashTransferQueue(transfer);
  return (
    <span
      className={cn(
        'inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
        (queue ? QUEUE_STYLES[queue] : CASH_TRANSFER_STATUS_STYLES[transfer.status]) ?? 'bg-muted',
        className,
      )}
    >
      {cashTransferStatusLabel(queue ?? transfer.status)}
    </span>
  );
}

/** Why a row can no longer be touched — for a tooltip on the Final label. */
export function lockReason(t: CashTransfer): string {
  if (t.status === 'approved') return `Finance approved this transfer and booked receipt ${t.voucherNo ?? ''}. It can no longer be changed.`.trim();
  if (t.status === 'rejected') return 'Finance rejected this transfer. Record a new one if the handover still stands.';
  return 'Finance has not decided yet. Accounts checks it first, then Finance Admin approves or rejects it. A branch cannot edit a transfer once submitted — the photo is evidence of one specific handover.';
}

/** The typed figures of a deposit, as strings straight off the inputs. */
export interface CashDepositDraft {
  cash: string;
  easypaisa: string;
  bank: string;
  fuel: string;
}

export const EMPTY_DEPOSIT_DRAFT: CashDepositDraft = { cash: '', easypaisa: '', bank: '', fuel: '' };

/**
 * The draft as numbers. An empty or unusable field is 0 — the owner's rule —
 * and `sanitizeAmount` has already made a negative or non-numeric figure
 * impossible to type. `total` is Cash + Easypaisa + Bank through the shared
 * `cashTransferTotal`, the same function the server's schema calls.
 */
export function depositFigures(d: CashDepositDraft) {
  const channels = {
    cashAmount: parseAmount(d.cash),
    easypaisaAmount: parseAmount(d.easypaisa),
    bankAmount: parseAmount(d.bank),
  };
  return { ...channels, fuelCharges: parseAmount(d.fuel), total: cashTransferTotal(channels) };
}

/** Why a draft cannot be saved yet, or null — the client half of CreateCashTransferSchema. */
export function depositDraftError(d: CashDepositDraft, photoCount: number): string | null {
  const f = depositFigures(d);
  if (f.total <= 0 && f.fuelCharges <= 0) return 'Enter at least one amount greater than 0.';
  // Money beyond fuel needs the photo; Fuel Charges alone does not.
  if (f.total > 0 && photoCount < 1) return 'Payment proof photo is required.';
  return null;
}

/**
 * Cash · Easypaisa · Bank → Total Amount (read-only) · Fuel Charges · Note.
 *
 * There is no Payment Method: a deposit carries an amount per channel, and the
 * Total is computed as they are typed — the person never adds it up. Fuel
 * Charges sits BELOW the Total and outside it, visually and arithmetically.
 * There is no Foodpanda field: Foodpanda money is keyed into Easypaisa by hand.
 * Same `type="text"` / `inputMode="decimal"` amount inputs as the discount form.
 */
export function CashDepositFormFields({
  idPrefix,
  draft,
  onDraftChange,
  note,
  onNoteChange,
  disabled,
  autoSlot,
}: {
  idPrefix: string;
  draft: CashDepositDraft;
  onDraftChange: (next: CashDepositDraft) => void;
  note: string;
  onNoteChange: (next: string) => void;
  disabled?: boolean;
  /** Rendered under the three channels — the popup's Auto button. */
  autoSlot?: ReactNode;
}) {
  const figures = depositFigures(draft);
  const field = (key: keyof CashDepositDraft, label: string) => {
    const id = `${idPrefix}-${key}`;
    return (
      <div className="space-y-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          type="text"
          inputMode="decimal"
          value={draft[key]}
          onChange={(e) => onDraftChange({ ...draft, [key]: sanitizeAmount(e.target.value) })}
          placeholder="0"
          disabled={disabled}
          className="text-base tabular-nums sm:text-sm"
        />
      </div>
    );
  };

  return (
    <>
      <fieldset className="space-y-3">
        <legend className="mb-2 text-sm font-medium">Payment Details</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {field('cash', 'Cash')}
          {field('easypaisa', 'Easypaisa')}
          {field('bank', 'Bank')}
        </div>
        {autoSlot}
      </fieldset>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-total`}>Total Amount</Label>
        <Input
          id={`${idPrefix}-total`}
          readOnly
          tabIndex={-1}
          aria-readonly
          value={formatCurrency(figures.total)}
          className="cursor-default bg-muted/50 text-base font-semibold tabular-nums sm:text-sm"
        />
        <p className="text-xs text-muted-foreground">Cash + Easypaisa + Bank — calculated automatically.</p>
      </div>

      <div className="space-y-1.5">
        {field('fuel', 'Fuel Charges')}
        <p className="text-xs text-muted-foreground">
          Delivery charges collected. Booked separately as Fuel income — not part of the Total.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${idPrefix}-note`}>Note</Label>
        <Textarea
          id={`${idPrefix}-note`}
          rows={2}
          maxLength={500}
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="Enter note..."
          disabled={disabled}
        />
      </div>
    </>
  );
}

/** Cash / Easypaisa / Bank / Total / Fuel as read-back rows — the confirm face and the detail dialogs. */
export function CashDepositBreakdown({ transfer, className }: {
  transfer: CashTransferChannels & { amount: number; fuelCharges: number };
  className?: string;
}) {
  const row = (label: string, value: number, strong = false) => (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('text-right tabular-nums', strong ? 'font-semibold' : '')}>{formatCurrency(value)}</dd>
    </>
  );
  return (
    <dl className={cn('grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm', className)}>
      {row('Cash', transfer.cashAmount)}
      {row('Easypaisa', transfer.easypaisaAmount)}
      {row('Bank', transfer.bankAmount)}
      {row('Total Amount', transfer.amount, true)}
      {row('Fuel Charges', transfer.fuelCharges)}
    </dl>
  );
}
