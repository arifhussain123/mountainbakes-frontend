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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ExpandableText } from '@/components/shared/ExpandableText';
import { formatDate } from '@/utils/date';
import { formatCurrency } from '@/utils/currency';
import { ApiError } from '@/utils/api';
import { cn } from '@/lib/utils';
import { Pencil, Send, Trash2, X } from 'lucide-react';

/**
 * Branch → raise and manage discount claims, from the New Orders page.
 *
 * ONE POPUP, TWO HALVES: the form that raises a claim, and the branch's own list
 * of the ones it has raised. They are together rather than on a page of their own
 * because a claim is only ever about a demand, and this is where the branch's
 * demands are — the form's first field is a demand picker fed by the very table
 * behind this dialog. Splitting them would mean a screen whose only content is a
 * dropdown pointing back at the one you left.
 *
 * WHY 'returned' IS AN EDIT, NOT A RESUBMIT. A sent-back return has its own
 * Resubmit button, because Production may have handed it back over something
 * outside the record and the units are unchanged. A sent-back CLAIM always
 * carries a note saying what to correct — the server refuses a send-back without
 * one — so resending it untouched would be answering a question by repeating the
 * answer. Correcting it is the only move, and saving the correction is what puts
 * it back in the queue.
 *
 * Amounts are held as STRINGS while being typed, for the reason NewOrderModal and
 * ReturnItemsModal hold their quantities as strings: an emptied input must stay
 * empty rather than snapping to 0. They are parsed at submit.
 */

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  returned: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400',
};

/**
 * The branch's words for the four states, which are NOT Production's.
 *
 * The board says "Awaiting Review" and "Sent Back to Branch" — accurate from the
 * side doing the reviewing. From this side the same rows read as "Waiting on
 * Production" and "Needs your correction", because what a branch needs from a
 * status is whose move it is, and on this screen the answer is sometimes theirs.
 */
const STATUS_LABELS: Record<string, string> = {
  pending: 'Waiting on Production',
  approved: 'Approved',
  rejected: 'Rejected',
  returned: 'Needs your correction',
};

/** Digits and at most one dot, at most two decimals — money, typed. */
function sanitizeAmount(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '').replace(/(\..*)\./g, '$1');
  const [whole = '', frac] = cleaned.split('.');
  const w = whole.replace(/^0+(?=\d)/, '');
  return frac === undefined ? w : `${w}.${frac.slice(0, 2)}`;
}

function parseAmount(raw: string): number {
  const n = parseFloat(raw);
  // Rounded to the paisa before it leaves: the schema refuses anything finer, and
  // a float that arrives as 250.49999 would be rejected for a figure the branch
  // never typed.
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

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
  /** The claim awaiting a withdrawal confirmation. */
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

  function reset() {
    setDemand(null);
    setAmount('');
    setReason('');
    setEditing(null);
  }

  function startEdit(d: BranchDiscount) {
    setEditing(d);
    setAmount(String(d.amount));
    setReason(d.reason);
    // The demand is fixed on a correction — the server ignores it and re-pointing
    // a claim at another delivery is a different claim. Shown as static text
    // below rather than as a picker that would not take.
    setDemand(orders.find((o) => o.id === d.productionOrderId) ?? null);
  }

  const parsed = parseAmount(amount);
  const canSubmit = parsed > 0 && reason.trim().length >= 3 && (editing !== null || demand !== null);

  async function submit() {
    if (!canSubmit) return;
    try {
      if (editing) {
        await reviseMut.mutateAsync({ id: editing.id, amount: parsed, reason: reason.trim() });
        toast.success(`Discount on ${editing.demandNumber} updated and sent back to Production`);
      } else {
        await createMut.mutateAsync({
          productionOrderId: demand!.id,
          amount: parsed,
          reason: reason.trim(),
        });
        toast.success(`${formatCurrency(parsed)} claimed on ${demand!.demandNumber}`);
      }
      reset();
    } catch (err) {
      // The API's message is the useful one — "already decided" when Production
      // got there first, which is the common failure on a correction.
      toast.error(err instanceof ApiError || err instanceof Error ? err.message : 'Failed to save the discount');
    }
  }

  async function confirmWithdraw() {
    if (!withdrawing) return;
    try {
      await withdrawMut.mutateAsync(withdrawing.id);
      toast.success(`Discount on ${withdrawing.demandNumber} withdrawn`);
      // If the row being withdrawn was the one open in the form, the form is now
      // editing a record that no longer exists.
      if (editing?.id === withdrawing.id) reset();
      setWithdrawing(null);
    } catch (err) {
      toast.error(err instanceof ApiError || err instanceof Error ? err.message : 'Failed to withdraw the discount');
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (busy) return;
          if (!o) reset();
          onOpenChange(o);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Correct Discount' : 'Request Discount'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1">
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

            <div className="space-y-1">
              <Label htmlFor="discount-amount">Amount</Label>
              <Input
                id="discount-amount"
                // `inputMode="decimal"` with a text type, not type="number": a
                // number input on Android accepts an 'e' and silently reports an
                // empty value for it, and its spinners are a hazard on a figure
                // that is being read off a delivery note.
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(sanitizeAmount(e.target.value))}
                placeholder="0.00"
                className="text-base sm:text-sm"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="discount-reason">Reason</Label>
              <Textarea
                id="discount-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="What is the discount for? Production reads this to decide."
              />
            </div>

            <div className="flex gap-2">
              {editing && (
                <Button variant="outline" className="flex-1" onClick={reset} disabled={busy}>
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

          {/* ── The branch's own claims ──────────────────────────────────────
              A list rather than a DataTable: it lives inside a popup at phone
              width, where a table's header, search box and pager cost more room
              than the rows they organise. */}
          <div className="space-y-2">
            <p className="text-sm font-medium">Your discount requests</p>

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
                      // The one state that is waiting on the branch is the one
                      // state the list makes look different.
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
                            STATUS_STYLES[d.status] ?? 'bg-muted',
                          )}
                        >
                          {STATUS_LABELS[d.status] ?? d.status}
                        </span>
                      </div>
                    </div>

                    <ExpandableText text={d.reason} className="mt-1.5 text-xs text-muted-foreground" />

                    {/* Production's note, and only when there is one. On a
                        sent-back claim it is the instruction the branch is acting
                        on, so it is styled to be read rather than skimmed past. */}
                    {d.reviewNote && (
                      <p className="mt-1.5 rounded-md bg-muted/60 p-2 text-xs">
                        <span className="font-medium">Production: </span>
                        {d.reviewNote}
                      </p>
                    )}

                    {isDiscountOpen(d.status) && (
                      <div className="mt-2 flex gap-1">
                        <Button variant="ghost" size="sm" onClick={() => startEdit(d)}>
                          <Pencil className="mr-1.5 h-3.5 w-3.5" />
                          {d.status === 'returned' ? 'Correct' : 'Change'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => setWithdrawing(d)}
                        >
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Withdraw
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Withdrawal is a real delete — nothing was booked, so there is nothing to
          reverse and nothing left behind. That is exactly why it is confirmed:
          the record simply goes, and no screen will show it again. */}
      <Dialog open={!!withdrawing} onOpenChange={(o) => !o && setWithdrawing(null)}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle>Withdraw Discount</DialogTitle>
          </DialogHeader>
          {withdrawing && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                {formatCurrency(withdrawing.amount)} on{' '}
                <span className="font-mono font-medium text-foreground">{withdrawing.demandNumber}</span> comes off
                Production&apos;s queue and is deleted. Nothing has been paid or booked against it, so nothing is
                reversed — but the request itself is gone and cannot be brought back.
              </p>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setWithdrawing(null)}>
                  Keep Request
                </Button>
                <Button
                  className="flex-1"
                  variant="destructive"
                  disabled={withdrawMut.isPending}
                  onClick={confirmWithdraw}
                >
                  {withdrawMut.isPending ? 'Withdrawing…' : 'Withdraw'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
