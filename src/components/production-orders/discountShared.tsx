'use client';

import type { BranchDiscount } from '@mb/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/**
 * The vocabulary and the rules a branch discount is edited by, in one place.
 *
 * WHY THIS MODULE EXISTS. A claim can be corrected from two screens — the
 * Discounts page and the popup on New Orders — and that is a deliberate product
 * decision, not an accident. What it costs is the risk the two disagree: one
 * accepting an amount the other refuses, one calling a row "Sent Back to Fix" and
 * the other "Needs your correction", one rounding to the paisa and the other not.
 * Every one of those would be invisible until a branch hit it.
 *
 * So the two surfaces share everything except layout. The status words, the
 * amount sanitising, the validation rule and the two input fields all live here;
 * the page renders them in a DataTable and a dialog, the popup renders them
 * inline, and neither owns a rule of its own.
 *
 * The BRANCH's words, not Production's. The review board says "Awaiting Review"
 * and "Sent Back to Branch", which is accurate from the side doing the reviewing.
 * From this side the same rows read as below, because what a branch needs from a
 * status is whose move it is — and here the answer is sometimes theirs.
 * ProductionDiscountsPage keeps its own map for that reason and does not import
 * this one.
 */

export const DISCOUNT_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  returned: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400',
};

const DISCOUNT_STATUS_LABELS: Record<string, string> = {
  pending: 'Awaiting Production',
  approved: 'Approved',
  rejected: 'Rejected',
  returned: 'Sent Back to Fix',
};

export const discountStatusLabel = (s: string) => DISCOUNT_STATUS_LABELS[s] ?? s;

/** First uuid segment — a label to read out, not a key to type. */
export function shortRef(id: string): string {
  return id.split('-')[0]?.toUpperCase() ?? id.slice(0, 8).toUpperCase();
}

/** Why a row can no longer be touched, phrased for a tooltip. */
export function lockReason(d: BranchDiscount): string {
  if (d.status === 'approved') return 'Production approved this discount, so it can no longer be changed or withdrawn.';
  if (d.status === 'rejected') return 'Production rejected this discount. Raise a new one if the claim still stands.';
  return 'This discount can no longer be changed.';
}

/** Digits and at most one dot, at most two decimals — money, typed. */
export function sanitizeAmount(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
  const [whole = '', frac] = cleaned.split('.');
  const w = whole.replace(/^0+(?=\d)/, '');
  return frac === undefined ? w : `${w}.${frac.slice(0, 2)}`;
}

/**
 * Parse a typed amount into paisa-rounded money. 0 means "not a valid amount".
 *
 * The rounding is not cosmetic: the schema refuses anything finer than two
 * decimals, and a float arriving as 250.49999 would be rejected for a figure
 * nobody typed. Both call sites must round the same way or one of them submits
 * amounts the API bounces.
 */
export function parseAmount(raw: string): number {
  const n = parseFloat(raw);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

/** The client half of CreateBranchDiscountSchema / ReviseBranchDiscountSchema. */
export function isDiscountInputValid(amount: string, reason: string): boolean {
  return parseAmount(amount) > 0 && reason.trim().length >= 3;
}

/**
 * Amount + Reason, the two fields every discount write takes.
 *
 * Three call sites: the popup's raise form, the popup's correct form and the
 * page's Change dialog. `idPrefix` keeps the label/input association valid when
 * more than one instance is ever mounted at once.
 *
 * The amount is `type="text"` with `inputMode="decimal"`, NOT `type="number"`: a
 * number input on Android accepts an 'e' and silently reports an empty value for
 * it, and its spinners are a hazard on a figure being read off a delivery note.
 */
export function DiscountFormFields({
  idPrefix,
  amount,
  onAmountChange,
  reason,
  onReasonChange,
  disabled,
}: {
  idPrefix: string;
  amount: string;
  onAmountChange: (next: string) => void;
  reason: string;
  onReasonChange: (next: string) => void;
  disabled?: boolean;
}) {
  const amountId = `${idPrefix}-amount`;
  const reasonId = `${idPrefix}-reason`;
  // Errors only once something has been typed — a form that opens already
  // complaining reads as broken rather than as guidance.
  const amountBad = amount !== '' && parseAmount(amount) <= 0;
  const reasonBad = reason !== '' && reason.trim().length < 3;

  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor={amountId}>Amount</Label>
        <Input
          id={amountId}
          type="text"
          inputMode="decimal"
          value={amount}
          onChange={(e) => onAmountChange(sanitizeAmount(e.target.value))}
          placeholder="0.00"
          disabled={disabled}
          // 16px on the phone, or Chrome/Safari zoom the sheet on focus.
          className="text-base sm:text-sm"
        />
        {amountBad && <p className="text-xs text-destructive">Enter an amount greater than 0.</p>}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={reasonId}>Reason</Label>
        <Textarea
          id={reasonId}
          rows={3}
          maxLength={500}
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder="What is the discount for? Production reads this to decide."
          disabled={disabled}
        />
        {reasonBad && <p className="text-xs text-destructive">Say what the discount is for.</p>}
      </div>
    </>
  );
}
