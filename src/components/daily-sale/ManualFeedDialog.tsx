'use client';

import { useMemo, useState } from 'react';
import { Lock, LockOpen, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import {
  DAILY_SALE_MANUAL_METHODS,
  type DailySaleManualMethod,
  type DailySaleRecord,
} from '@mb/shared';
import { useDailySaleLocks, useFeedDailySale } from '@/lib/queries';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PAYMENT_METHOD_LABELS } from '@/utils/constants';
import { cn } from '@/lib/utils';
import { DifferenceBadge, exactMoney, money } from './parts';

/**
 * Manual Daily Sale Feed (§7, §8).
 *
 * What somebody physically counted, entered beside what the system says was
 * taken. The auto figure is shown, never editable, and the difference updates as
 * the field is typed — because the reason a person is at this screen is to find
 * out whether the drawer agrees, and making them save first to learn that turns
 * one visit into two.
 *
 * ─── Three fields, not four ──────────────────────────────────────────────────
 * Cash, Easypaisa and Bank. Foodpanda is absent because the aggregator settles
 * it and there is nothing at the counter to count — the only figure anybody could
 * type is the system's own, which is not a verification. The list comes from
 * DAILY_SALE_MANUAL_METHODS so this form and the SQL that enforces it cannot
 * disagree about which three.
 *
 * ─── The locks are fetched here, for THIS record's branch ────────────────────
 * Not passed down from the list. The admin board can be showing every branch at
 * once, where there is no single lock configuration to hand over — and a dialog
 * that fell back to "nothing is locked" would show three open inputs for a
 * branch whose cash is locked, then fail on save. The read is gated on the
 * dialog being open, so nothing is requested until a row is actually opened.
 *
 * ─── A locked method is shown, not hidden ────────────────────────────────────
 * A locked row still appears, with its auto figure and a padlock. Hiding it would
 * leave a branch wondering whether Easypaisa was forgotten or forbidden, and the
 * §10 example shows the lock state as information the operator is meant to read.
 * The input is disabled, and that is courtesy only: `feed_daily_sale_record`
 * refuses a locked method in the same transaction as the write.
 *
 * ─── The admin override ──────────────────────────────────────────────────────
 * An admin's inputs stay enabled on a locked method, with a warning saying so.
 * The entry is recorded as `manual_feed_override` rather than `manual_feed`, so
 * the history never shows an override as routine data entry.
 */
export function ManualFeedDialog({
  open,
  onOpenChange,
  record,
  token,
  isAdmin,
  currencySymbol = 'Rs.',
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  record: DailySaleRecord | null;
  token: string;
  /** Drives the override affordance AND whether a branch id is sent at all. */
  isAdmin: boolean;
  currencySymbol?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manual Daily Sale Feed</DialogTitle>
        </DialogHeader>
        {record && (
          <FeedForm
            // Keyed so switching rows resets the fields rather than carrying one
            // day's half-typed count onto another.
            key={`${record.branchId}-${record.businessDate}`}
            record={record}
            token={token}
            isAdmin={isAdmin}
            currencySymbol={currencySymbol}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * What each counted figure is checked against.
 *
 * Cash reads `expectedCashInHand` — Cash on Table — and NOT `autoCash`. The
 * person at this form is counting physical notes, and the day's cash expenses
 * have already been paid out of the drawer; comparing against gross takings
 * would report a shortfall equal to those expenses on every record. The other
 * two are gross, because nothing is ever paid out of a bank settlement or an
 * Easypaisa balance. Mirrors the `cash_difference` generated column (migration
 * 102) — the database is what actually decides.
 */
const EXPECTED_BY_METHOD: Record<DailySaleManualMethod, keyof DailySaleRecord> = {
  cash: 'expectedCashInHand',
  easypaisa: 'autoEasypaisa',
  bank_account: 'autoBank',
};

/** The label above each expected figure — cash's is not the raw takings. */
const EXPECTED_LABEL: Record<DailySaleManualMethod, string> = {
  cash: 'Cash on table',
  easypaisa: 'System',
  bank_account: 'System',
};

/** 'DD-MM-YYYY' — string work, not Date work; these are already Karachi dates. */
function displayDate(iso: string): string {
  const [y, m, d] = (iso || '').split('-');
  return y && m && d ? `${d}-${m}-${y}` : iso || '—';
}

function FeedForm({
  record,
  token,
  isAdmin,
  currencySymbol,
  onDone,
}: {
  record: DailySaleRecord;
  token: string;
  isAdmin: boolean;
  currencySymbol: string;
  onDone: () => void;
}) {
  const feed = useFeedDailySale(token);
  // An admin names the branch; a branch role sends nothing and the API reads its
  // JWT. Passing a branch id as a branch role would be discarded server-side
  // anyway, but sending none keeps the request saying what it means.
  const branchId = isAdmin ? record.branchId : null;
  const { data: locks = [] } = useDailySaleLocks(token, branchId);

  // Seeded from what was already counted, so correcting one figure does not mean
  // re-keying the other two. An uncounted method starts EMPTY rather than at the
  // auto figure — pre-filling the system's own number is how a reconciliation
  // becomes a rubber stamp.
  const [values, setValues] = useState<Record<DailySaleManualMethod, string>>(() => ({
    cash: record.manualCash === null ? '' : String(record.manualCash),
    easypaisa: record.manualEasypaisa === null ? '' : String(record.manualEasypaisa),
    bank_account: record.manualBank === null ? '' : String(record.manualBank),
  }));

  const lockOf = useMemo(
    () => new Map(locks.map((l) => [l.paymentMethod, l])),
    [locks],
  );

  /** What this method's count should come to. Cash on Table for cash; gross otherwise. */
  function expectedOf(method: DailySaleManualMethod): number {
    return Number(record[EXPECTED_BY_METHOD[method]] ?? 0);
  }

  /** The live difference for a field, or null while it is empty or unparseable. */
  function liveDifference(method: DailySaleManualMethod): number | null {
    const raw = values[method].trim();
    if (raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.round((n - expectedOf(method)) * 100) / 100 : null;
  }

  async function submit() {
    const payload: { cash?: number; easypaisa?: number; bank?: number } = {};
    for (const method of DAILY_SALE_MANUAL_METHODS) {
      const raw = values[method].trim();
      if (raw === '') continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        toast.error(`${PAYMENT_METHOD_LABELS[method]}: enter a valid amount`);
        return;
      }
      // Two decimal places, matching the numeric(14,2) column and the Zod schema.
      // Rejecting a third here saves a round trip and points at the field.
      if (Math.round(n * 100) !== n * 100) {
        toast.error(`${PAYMENT_METHOD_LABELS[method]}: at most 2 decimal places`);
        return;
      }
      if (method === 'cash') payload.cash = n;
      else if (method === 'easypaisa') payload.easypaisa = n;
      else payload.bank = n;
    }

    if (Object.keys(payload).length === 0) {
      toast.error('Enter at least one counted amount');
      return;
    }

    try {
      await feed.mutateAsync({
        businessDate: record.businessDate,
        ...(branchId ? { branchId } : {}),
        ...payload,
      });
      toast.success('Counted amounts recorded');
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not record the count');
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/40 p-3 text-sm">
        <p className="font-medium">{record.branchName || 'Branch'}</p>
        <p className="text-muted-foreground">
          Business date <span className="font-semibold text-foreground">{displayDate(record.businessDate)}</span>
          {' · '}
          Total sale <span className="font-semibold text-foreground">{money(record.autoTotalSale, currencySymbol)}</span>
        </p>
      </div>

      <div className="space-y-3">
        {DAILY_SALE_MANUAL_METHODS.map((method) => {
          const lock = lockOf.get(method);
          const locked = lock?.isLocked ?? false;
          // A locked field is disabled for a branch and left open for an admin —
          // whose entry is then audited as an override.
          const disabled = locked && !isAdmin;
          const expected = expectedOf(method);
          const diff = liveDifference(method);

          return (
            <div
              key={method}
              className={cn('rounded-lg border p-3 space-y-2', disabled && 'bg-muted/40')}
            >
              <div className="flex items-center justify-between gap-2">
                <Label className="flex items-center gap-1.5">
                  {PAYMENT_METHOD_LABELS[method]}
                  {locked ? (
                    <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                  ) : (
                    <LockOpen className="h-3.5 w-3.5 text-emerald-600" />
                  )}
                </Label>
                <span className="text-xs text-muted-foreground">
                  {EXPECTED_LABEL[method]}:{' '}
                  <span className="font-semibold tabular-nums text-foreground">
                    {money(expected, currencySymbol)}
                  </span>
                </span>
              </div>

              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  disabled={disabled}
                  // Deliberately no placeholder showing the auto figure: a greyed
                  // suggestion of the number you are meant to be checking is the
                  // same nudge as pre-filling it.
                  placeholder="Counted amount"
                  value={values[method]}
                  onChange={(e) => setValues((v) => ({ ...v, [method]: e.target.value }))}
                  className="tabular-nums"
                />
                <div className="w-32 shrink-0 text-right">
                  <DifferenceBadge difference={diff} symbol={currencySymbol} />
                </div>
              </div>

              {disabled && (
                <p className="text-xs text-muted-foreground">
                  Locked for manual entry at this branch. Ask an admin to unlock it.
                  {lock?.reason ? ` Reason: ${lock.reason}` : ''}
                </p>
              )}
              {locked && isAdmin && (
                <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  This method is locked. Your entry will be recorded as an admin override.
                </p>
              )}
              {/* Where the Cash on Table figure came from. Without this the
                  operator sees a number that is not the day's cash takings and
                  has no way to tell whether it is wrong or simply net. */}
              {method === 'cash' && record.cashExpense > 0 && (
                <p className="text-xs text-muted-foreground">
                  {exactMoney(record.autoCash, currencySymbol)} taken, less{' '}
                  {exactMoney(record.cashExpense, currencySymbol)} paid out of the till. Count the notes
                  in the drawer.
                </p>
              )}
            </div>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground">
        Leave a field blank to leave that figure as it is. Foodpanda is settled by the
        aggregator and is not counted here.
      </p>

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onDone} disabled={feed.isPending}>
          Cancel
        </Button>
        <Button className="flex-1" onClick={submit} disabled={feed.isPending}>
          {feed.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
