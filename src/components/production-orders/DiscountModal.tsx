'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { BranchDiscount, BranchProductionOrder } from '@mb/shared';
import { isDiscountOpen } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import {
  useBranchDiscounts,
  useCreateBranchDiscount,
  useReviseBranchDiscount,
  useWithdrawBranchDiscount,
} from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ExpandableText } from '@/components/shared/ExpandableText';
import { formatDate } from '@/utils/date';
import { formatCurrency } from '@/utils/currency';
import { ApiError } from '@/utils/api';
import { cn } from '@/lib/utils';
import { Pencil, Send, Trash2, X } from 'lucide-react';
import {
  DISCOUNT_STATUS_STYLES,
  DiscountFormFields,
  discountStatusLabel,
  isDiscountInputValid,
  parseAmount,
} from './discountShared';

/**
 * Branch → raise a discount claim, and manage the claims already raised.
 *
 * Everything on this popup is ALSO on Branch → Discounts, which is the fuller
 * screen: a sortable table, search, a View dialog with the whole record. This is
 * the shortcut — the branch is already on New Orders looking at the demands a
 * claim is about, and having to leave for another page to fix a figure Production
 * queried is a trip nobody wants mid-shift.
 *
 * THE TWO MUST NOT DRIFT, which is the cost of having both. Every rule they share
 * — the status words, the amount sanitising and rounding, the validation, the two
 * input fields — lives in `discountShared.tsx` and is imported by both. Neither
 * screen owns a rule. What differs is only layout: a DataTable there, a compact
 * card list here, because a table's header, search box and pager cost more room
 * than the rows they organise inside a popup at phone width.
 *
 * ONE DIALOG, THREE FACES — never two stacked. Correct turns the form above the
 * list into an edit of that claim, and Withdraw turns the whole popup over into
 * its confirmation. Opening a second modal on top of this one to take a decision
 * is the pattern ProductionReturnsPage's header argues against, and a destructive
 * one reached from inside a popup is exactly where a mis-click is cheapest.
 */

/** Demand search matches the demand number or the date, like the table's own search. */
function demandMatchesQuery(o: BranchProductionOrder | null, query: string): boolean {
  if (o == null) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return o.demandNumber.toLowerCase().includes(q) || o.date.includes(q);
}

export function DiscountModal({
  open,
  onOpenChange,
  openedOnce,
  orders,
  loadingOrders,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Whether this popup has ever been opened.
   *
   * Owned by the parent because that is where the open handler is, and it gates
   * the claims fetch: this component is mounted on every visit to the New Orders
   * page and opened on few of them, so an ungated query would put a request on
   * the busiest branch screen for a popup nobody asked for. Same lazy pattern as
   * the order form's products and stock.
   */
  openedOnce: boolean;
  /** The branch's recent demands — the same list the page behind this is showing. */
  orders: BranchProductionOrder[];
  loadingOrders: boolean;
}) {
  const { token } = useAuth();
  const discountsQ = useBranchDiscounts(token, { enabled: openedOnce });
  const createMut = useCreateBranchDiscount(token);
  const reviseMut = useReviseBranchDiscount(token);
  const withdrawMut = useWithdrawBranchDiscount(token);

  const [demand, setDemand] = useState<BranchProductionOrder | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  /** The claim being corrected. Null means the form is raising a new one. */
  const [editing, setEditing] = useState<BranchDiscount | null>(null);
  /** Set while the popup is turned over to the withdrawal confirmation. */
  const [withdrawing, setWithdrawing] = useState<BranchDiscount | null>(null);

  const discounts = discountsQ.data ?? [];
  const busy = createMut.isPending || reviseMut.isPending;

  /**
   * Deleted demands are not offered.
   *
   * A claim against a demand the branch itself withdrew is not reviewable — there
   * is no delivery to check the amount against — and the row would sit in
   * Production's queue only to be sent back. Rejected ones ARE offered: a demand
   * Production refused can still be the subject of a claim about what went wrong.
   */
  const selectable = useMemo(() => orders.filter((o) => o.status !== 'cancelled'), [orders]);

  function resetForm() {
    setDemand(null);
    setAmount('');
    setReason('');
    setEditing(null);
  }

  function startEdit(d: BranchDiscount) {
    setEditing(d);
    setAmount(String(d.amount));
    setReason(d.reason ?? '');
    // The demand is fixed on a correction — the server ignores it, and re-pointing
    // a claim at another delivery is a different claim. Shown as static text.
    setDemand(orders.find((o) => o.id === d.productionOrderId) ?? null);
  }

  /** The API's own message is the useful one — "already decided" on a lost race. */
  function fail(err: unknown, fallback: string) {
    toast.error(err instanceof ApiError || err instanceof Error ? err.message : fallback);
  }

  const valid = isDiscountInputValid(amount, reason);
  const canSubmit = valid && (editing !== null || demand !== null);

  async function submit() {
    if (!canSubmit) return;
    const parsed = parseAmount(amount);
    try {
      if (editing) {
        await reviseMut.mutateAsync({ id: editing.id, amount: parsed, reason: reason.trim() });
        toast.success(`Discount on ${editing.demandNumber} updated — back with Production for review`);
        resetForm();
      } else {
        await createMut.mutateAsync({
          productionOrderId: demand!.id,
          amount: parsed,
          reason: reason.trim(),
        });
        toast.success(`${formatCurrency(parsed)} claimed on ${demand!.demandNumber}`);
        resetForm();
      }
    } catch (err) {
      fail(err, 'Could not save the discount');
    }
  }

  async function confirmWithdraw() {
    if (!withdrawing) return;
    try {
      await withdrawMut.mutateAsync(withdrawing.id);
      toast.success(`Discount on ${withdrawing.demandNumber} withdrawn`);
      // The row being withdrawn may be the one loaded in the form above, which
      // would leave it editing a record that no longer exists.
      if (editing?.id === withdrawing.id) resetForm();
      setWithdrawing(null);
    } catch (err) {
      fail(err, 'Could not withdraw the discount');
      // Back to the list rather than closing: "already decided" means the row
      // changed under the branch and the list is what shows them that.
      setWithdrawing(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy || withdrawMut.isPending) return;
        if (!o) {
          resetForm();
          setWithdrawing(null);
        }
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
        {/* ── Face 3: withdrawal confirmation ────────────────────────────────
            The whole popup turns over rather than stacking a second modal. */}
        {withdrawing ? (
          <>
            <DialogHeader>
              <DialogTitle>Withdraw this discount?</DialogTitle>
              <DialogDescription>
                {formatCurrency(withdrawing.amount)} on {withdrawing.demandNumber} comes off
                Production&apos;s queue and is deleted. Nothing has been paid or booked against it, so
                nothing is reversed — but the request itself is gone and cannot be brought back.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setWithdrawing(null)}
                disabled={withdrawMut.isPending}
              >
                Keep Request
              </Button>
              <Button
                className="flex-1"
                variant="destructive"
                onClick={confirmWithdraw}
                disabled={withdrawMut.isPending}
              >
                {withdrawMut.isPending ? 'Withdrawing…' : 'Withdraw'}
              </Button>
            </div>
          </>
        ) : (
          <>
            {/* ── Faces 1 & 2: raise, or correct ─────────────────────────── */}
            <DialogHeader>
              <DialogTitle>{editing ? 'Correct Discount' : 'Request Discount'}</DialogTitle>
              {editing && (
                <DialogDescription>
                  {editing.demandNumber} ·{' '}
                  {editing.status === 'returned'
                    ? 'sent back by production — saving resubmits it'
                    : 'awaiting production review'}
                </DialogDescription>
              )}
            </DialogHeader>

            <div className="space-y-4">
              {/* What Production asked for, repeated where the correction is
                  typed. It is on the row below too, but expecting someone to hold
                  it in their head while scrolling is how a claim bounces twice. */}
              {editing?.status === 'returned' && editing.reviewNote && (
                <p className="rounded-md bg-muted/60 p-2.5 text-xs">
                  <span className="font-medium">Production: </span>
                  {editing.reviewNote}
                </p>
              )}

              <div className="space-y-1.5">
                <Label>Demand</Label>
                {editing ? (
                  // Fixed on a correction. Rendered as the record rather than a
                  // disabled picker, which would invite a click that does nothing.
                  <p className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm">
                    {editing.demandNumber}
                  </p>
                ) : (
                  <Combobox
                    items={selectable}
                    filter={demandMatchesQuery}
                    value={demand}
                    onValueChange={(o: BranchProductionOrder | null) => setDemand(o)}
                    itemToStringLabel={(o: BranchProductionOrder) => o.demandNumber}
                    itemToStringValue={(o: BranchProductionOrder) => o.id}
                    isItemEqualToValue={(a: BranchProductionOrder, b: BranchProductionOrder) => a?.id === b?.id}
                  >
                    <ComboboxInput
                      aria-label="Demand"
                      disabled={loadingOrders || selectable.length === 0}
                      placeholder={
                        loadingOrders
                          ? 'Loading demands…'
                          : selectable.length
                            ? 'Search demand…'
                            : 'No demands to claim against'
                      }
                      // 16px on the phone, or Chrome/Safari zoom the sheet on focus.
                      className="text-base sm:h-9 sm:text-sm"
                    />
                    <ComboboxContent>
                      <ComboboxEmpty>No demands found.</ComboboxEmpty>
                      <ComboboxList>
                        {(o: BranchProductionOrder) => (
                          <ComboboxItem key={o.id} value={o}>
                            <div className="flex flex-1 flex-col">
                              <span className="font-mono font-medium">{o.demandNumber}</span>
                              <span className="text-xs text-muted-foreground">
                                {o.date} {o.time} · {o.status.replace(/_/g, ' ')}
                              </span>
                            </div>
                          </ComboboxItem>
                        )}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>
                )}
              </div>

              <DiscountFormFields
                idPrefix="discount-popup"
                amount={amount}
                onAmountChange={setAmount}
                reason={reason}
                onReasonChange={setReason}
                disabled={busy}
              />

              <div className="flex gap-2">
                {editing && (
                  <Button variant="outline" className="flex-1" onClick={resetForm} disabled={busy}>
                    <X className="mr-1.5 h-4 w-4" /> Cancel
                  </Button>
                )}
                <Button className="flex-1" onClick={submit} disabled={!canSubmit || busy}>
                  <Send className="mr-1.5 h-4 w-4" />
                  {busy ? 'Saving…' : editing ? 'Save & Resend' : 'Send Request'}
                </Button>
              </div>
            </div>

            <Separator />

            {/* ── The branch's own claims ─────────────────────────────────── */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium">Your discount requests</p>
                <p className="text-xs text-muted-foreground">Last 90 days</p>
              </div>

              {discountsQ.isLoading ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
              ) : discounts.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Nothing claimed in the last 90 days.
                </p>
              ) : (
                <ul className="space-y-2">
                  {discounts.map((d) => (
                    <li
                      key={d.id}
                      className={cn(
                        'rounded-lg border p-3',
                        // The one state waiting on the branch is the one state the
                        // list makes look different.
                        d.status === 'returned' && 'border-sky-300 dark:border-sky-800',
                        editing?.id === d.id && 'ring-2 ring-primary',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-mono text-sm font-medium">{d.demandNumber}</p>
                          <p className="text-xs text-muted-foreground">{formatDate(d.date)}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold tabular-nums">{formatCurrency(d.amount)}</p>
                          <span
                            className={cn(
                              'mt-0.5 inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium',
                              DISCOUNT_STATUS_STYLES[d.status] ?? 'bg-muted',
                            )}
                          >
                            {discountStatusLabel(d.status)}
                          </span>
                        </div>
                      </div>

                      <ExpandableText text={d.reason} className="mt-1.5 text-xs text-muted-foreground" />

                      {/* Production's note, and only when there is one. On a
                          sent-back claim it is the instruction being acted on. */}
                      {d.reviewNote && (
                        <p className="mt-1.5 rounded-md bg-muted/60 p-2 text-xs">
                          <span className="font-medium">Production: </span>
                          {d.reviewNote}
                        </p>
                      )}

                      {isDiscountOpen(d.status) && (
                        <div className="mt-2 flex gap-1">
                          <Button variant="ghost" size="sm" onClick={() => startEdit(d)} disabled={busy}>
                            <Pencil className="mr-1.5 h-3.5 w-3.5" />
                            {d.status === 'returned' ? 'Correct' : 'Change'}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setWithdrawing(d)}
                            disabled={busy}
                          >
                            <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Withdraw
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {/* The popup is the shortcut; the page is the record. Says so, so a
                  branch looking for search or the full detail knows where it is. */}
              <p className="pt-1 text-center text-xs text-muted-foreground">
                The Discounts page has the full record, with search and detail.
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
