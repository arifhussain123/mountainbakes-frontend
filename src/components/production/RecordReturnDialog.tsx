'use client';

import { useRef, useState } from 'react';
import type { Branch, Product } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useCreateReturn } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ApiError } from '@/utils/api';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Production → Product Returns' own "+ Record Return": Production noting a
 * return it received directly, with no branch screen involved. The web twin of
 * the mobile app's NewProductionReturnScreen — same four fields, same
 * `POST /api/production-returns` through the same `useCreateReturn` hook the
 * order print preview uses, so the row lands `pending` in this queue and the
 * month summary above it refreshes with the list (both sit under the
 * ['productionReturns'] key the hook invalidates).
 *
 * Unlike the print preview's form, the branch and product are open choices:
 * this return is not against one delivery.
 *
 * The checks below are the API's own (CreateProductionReturnSchema) run early so
 * the operator sees which field is wrong; the server still decides.
 */

const MAX_REASON = 500;
const digits = (s: string) => s.replace(/\D/g, '');

export function RecordReturnDialog({
  open,
  onOpenChange,
  branches,
  products,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branches: Branch[];
  products: Product[];
}) {
  const { token } = useAuth();
  const createMut = useCreateReturn(token);
  // `isPending` only flips on the next render, so two clicks in the same frame
  // would both get through it. The ref closes that gap.
  const inFlight = useRef(false);

  const [branchId, setBranchId] = useState('');
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [attempted, setAttempted] = useState(false);

  const activeBranches = branches.filter((b) => b.isActive);
  const activeProducts = products.filter((p) => p.isActive);

  const qtyNum = Number(qty);
  const errors = {
    branch: branchId ? null : 'Pick the branch the goods came from.',
    product: productId ? null : 'Pick the product being returned.',
    qty: Number.isInteger(qtyNum) && qtyNum > 0 ? null : 'Enter a whole number of 1 or more.',
    reason: reason.trim() ? null : 'Say why it is coming back.',
  };
  const valid = !errors.branch && !errors.product && !errors.qty && !errors.reason;
  const show = (e: string | null) => (attempted && e ? <p className="text-xs text-destructive">{e}</p> : null);

  function reset() {
    setBranchId('');
    setProductId('');
    setQty('');
    setReason('');
    setAttempted(false);
  }

  function close(next: boolean) {
    if (next) return onOpenChange(true);
    if (createMut.isPending) return;
    reset();
    onOpenChange(false);
  }

  async function submit() {
    setAttempted(true);
    if (!valid || inFlight.current) return;
    inFlight.current = true;
    try {
      await createMut.mutateAsync({ branchId, productId, qty: qtyNum, reason: reason.trim() });
      const product = activeProducts.find((p) => p.id === productId)?.name ?? 'Return';
      toast.success(`Return recorded — ${qtyNum} × ${product} awaiting review`);
      reset();
      onOpenChange(false);
    } catch (err) {
      // Left open with what was typed: the API's message names the field it
      // refused, and the operator fixes that one rather than starting over.
      toast.error(err instanceof ApiError || err instanceof Error ? err.message : 'Failed to record return');
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>Record Return</DialogTitle>
          <DialogDescription>A return Production received directly. It joins the queue awaiting review.</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="record-return-branch">Branch</Label>
            <Select value={branchId || null} onValueChange={(v) => setBranchId((v as string) ?? '')}>
              <SelectTrigger id="record-return-branch" className="h-10 w-full" aria-invalid={attempted && !!errors.branch}>
                {/* Resolved here: the trigger otherwise shows the raw id until the list has been opened once. */}
                <SelectValue placeholder="Select branch…">
                  {(value: string) => activeBranches.find((b) => b.id === value)?.name ?? 'Select branch…'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {activeBranches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {show(errors.branch)}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="record-return-product">Product</Label>
            <Select value={productId || null} onValueChange={(v) => setProductId((v as string) ?? '')}>
              <SelectTrigger id="record-return-product" className="h-10 w-full" aria-invalid={attempted && !!errors.product}>
                <SelectValue placeholder="Select product…">
                  {(value: string) => activeProducts.find((p) => p.id === value)?.name ?? 'Select product…'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {activeProducts.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {show(errors.product)}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="record-return-qty">Quantity</Label>
            <Input
              id="record-return-qty"
              type="text"
              inputMode="numeric"
              value={qty}
              onChange={(e) => setQty(digits(e.target.value))}
              placeholder="0"
              className="h-10"
              aria-invalid={attempted && !!errors.qty}
            />
            {show(errors.qty)}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="record-return-reason">Reason</Label>
            <Textarea
              id="record-return-reason"
              rows={3}
              maxLength={MAX_REASON}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why was this returned?"
              aria-invalid={attempted && !!errors.reason}
            />
            {show(errors.reason)}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)} disabled={createMut.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMut.isPending}>
              {createMut.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              {createMut.isPending ? 'Saving…' : 'Record Return'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
