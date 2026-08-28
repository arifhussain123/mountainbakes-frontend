'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { BranchProductionOrder } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useCreateBranchDiscount } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatCurrency } from '@/utils/currency';
import { ApiError } from '@/utils/api';
import { Send } from 'lucide-react';

/**
 * Branch → raise a discount claim against a demand.
 *
 * RAISE ONLY. The claims themselves — with Change, Withdraw and Production's
 * note on a sent-back one — live on the Branch → Discounts page, exactly as
 * ReturnItemsModal raises a return and Branch → Return Stock owns the record.
 * This popup used to carry the list as well; two places offering Change on one
 * claim is how the two drift apart, and the modal grew a scrolling history on a
 * phone screen that was meant to hold a three-field form.
 *
 * The demand picker is fed by the table behind this dialog, which is why the
 * button lives on New Orders: a claim is only ever about a demand, and this is
 * where the branch's demands are.
 *
 * The amount is held as a STRING while being typed, for the reason NewOrderModal
 * and ReturnItemsModal hold their quantities as strings: an emptied input must
 * stay empty rather than snapping to 0. It is parsed at submit.
 */

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
  orders,
  loadingOrders,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The branch's recent demands — the same list the page behind this is showing. */
  orders: BranchProductionOrder[];
  loadingOrders: boolean;
}) {
  const { token } = useAuth();
  const createMut = useCreateBranchDiscount(token);

  const [demand, setDemand] = useState<BranchProductionOrder | null>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

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
  }

  const parsed = parseAmount(amount);
  const canSubmit = parsed > 0 && reason.trim().length >= 3 && demand !== null;

  async function submit() {
    if (!canSubmit || !demand) return;
    try {
      await createMut.mutateAsync({
        productionOrderId: demand.id,
        amount: parsed,
        reason: reason.trim(),
      });
      // Names where the claim went, because this popup no longer shows it — the
      // branch would otherwise have no idea the record is on another screen.
      toast.success(`${formatCurrency(parsed)} claimed on ${demand.demandNumber}`, {
        description: 'Track it on the Discounts page.',
      });
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError || err instanceof Error ? err.message : 'Failed to save the discount');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (createMut.isPending) return;
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>Request Discount</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Demand</Label>
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
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="discount-amount">Amount</Label>
            <Input
              id="discount-amount"
              // Text with inputMode="decimal", not type="number": a number input on
              // Android accepts an 'e' and silently reports an empty value for it,
              // and its spinners are a hazard on a figure being read off a
              // delivery note.
              type="text"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(sanitizeAmount(e.target.value))}
              placeholder="0.00"
              className="text-base sm:text-sm"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="discount-reason">Reason</Label>
            <Textarea
              id="discount-reason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What is the discount for? Production reads this to decide."
            />
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={createMut.isPending}
            >
              Cancel
            </Button>
            <Button className="flex-1" onClick={submit} disabled={!canSubmit || createMut.isPending}>
              <Send className="mr-1.5 h-4 w-4" />
              {createMut.isPending ? 'Saving…' : 'Send Request'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
