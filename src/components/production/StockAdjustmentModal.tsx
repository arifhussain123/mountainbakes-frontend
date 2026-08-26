'use client';

import { useMemo, useState } from 'react';
import {
  PRODUCTION_ADJUSTMENT_TYPES,
  PRODUCTION_ADJUSTMENT_LABELS,
  type Product,
  type ProductionAdjustmentType,
} from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, SlidersHorizontal } from 'lucide-react';
import { sortProducts } from '@/utils/productSort';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/**
 * Book an authorised stock adjustment (§11).
 *
 * ── THIS IS NOT AN EDITOR ────────────────────────────────────────────────────
 * There is no box here containing the current balance for someone to type over.
 * The operator states a DIRECTION and an AMOUNT — "10 fewer, because they were
 * dropped" — and the server appends one movement of that size. That is §38's rule
 * and it is enforced by the shape of this form as much as by the API: a field that
 * accepted a target balance would invite treating stock as a number to correct
 * rather than a history of what happened.
 *
 * ── THE REASON IS NOT OPTIONAL ───────────────────────────────────────────────
 * Required here, in the Zod schema, and again inside the RPC. An adjustment with
 * no stated cause is indistinguishable from someone quietly making an
 * inconvenient figure go away, and the audit trail exists precisely so that
 * cannot happen. Three layers because this is the one write in the module that
 * destroys value with a single click.
 */

const DIRECTIONS = [
  {
    key: 'out' as const,
    label: 'Remove from stock',
    hint: 'Damage, expiry, a count that came up short',
    className: 'data-[on=true]:border-red-500 data-[on=true]:bg-red-50 dark:data-[on=true]:bg-red-950/40',
  },
  {
    key: 'in' as const,
    label: 'Add to stock',
    hint: 'A count that came up over, or a correction back',
    className: 'data-[on=true]:border-emerald-500 data-[on=true]:bg-emerald-50 dark:data-[on=true]:bg-emerald-950/40',
  },
];

export interface StockAdjustmentModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  /** Preselected when opened from a product row, so the operator does not re-pick it. */
  defaultProductId?: string | null;
  /** Current balance of the selected product, for the "will become" preview. */
  balanceOf: (productId: string) => number | undefined;
  submit: (body: {
    productId: string;
    adjustmentType: string;
    qty: number;
    reason: string;
    remarks?: string;
    approvedBy?: string;
  }) => Promise<{ before: number; after: number; delta: number }>;
  submitting: boolean;
}

export function StockAdjustmentModal({
  open,
  onOpenChange,
  products,
  defaultProductId,
  balanceOf,
  submit,
  submitting,
}: StockAdjustmentModalProps) {
  const [productId, setProductId] = useState(defaultProductId ?? '');
  const [direction, setDirection] = useState<'in' | 'out'>('out');
  const [type, setType] = useState<ProductionAdjustmentType>('damage');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [approvedBy, setApprovedBy] = useState('');

  const ordered = useMemo(() => sortProducts(products), [products]);
  const magnitude = parseInt(qty, 10) || 0;
  // The signed figure that will actually be sent. Direction and magnitude are
  // separate inputs because a minus sign typed into a number box is easy to miss
  // and impossible to undo once posted.
  const delta = direction === 'out' ? -magnitude : magnitude;

  const current = productId ? balanceOf(productId) : undefined;
  const projected = current === undefined ? undefined : current + delta;

  const valid = !!productId && magnitude > 0 && reason.trim().length > 0;

  function reset() {
    setProductId(defaultProductId ?? '');
    setDirection('out');
    setType('damage');
    setQty('');
    setReason('');
    setRemarks('');
    setApprovedBy('');
  }

  async function save() {
    if (!valid) return;
    try {
      const res = await submit({
        productId,
        adjustmentType: type,
        qty: delta,
        reason: reason.trim(),
        ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
        ...(approvedBy.trim() ? { approvedBy: approvedBy.trim() } : {}),
      });
      // Report the REAL before/after from the server, not the preview: a
      // concurrent sale may have moved the balance between opening this form and
      // saving, and the figure that matters is the one that was actually written.
      toast.success(`Adjustment posted — balance ${res.before} → ${res.after}`);
      reset();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to post the adjustment');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!submitting) { if (!o) reset(); onOpenChange(o); } }}>
      <DialogContent mobile="fullscreen" className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-5 w-5 text-primary" /> Stock adjustment
          </DialogTitle>
          <DialogDescription>
            Records one movement against the pool with a reason. It does not overwrite the
            balance — the original figures stay in the ledger.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-1.5">
            <Label>Product</Label>
            <Select value={productId} onValueChange={(v) => setProductId(v ?? '')}>
              <SelectTrigger><SelectValue placeholder="Choose a product" /></SelectTrigger>
              <SelectContent>
                {ordered.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>Direction</Label>
            <div className="grid grid-cols-2 gap-2">
              {DIRECTIONS.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  data-on={direction === d.key}
                  onClick={() => setDirection(d.key)}
                  className={cn(
                    'rounded-lg border p-3 text-left transition-colors hover:bg-muted/50',
                    d.className,
                  )}
                >
                  <p className="text-sm font-medium">{d.label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{d.hint}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Adjustment type</Label>
              <Select value={type} onValueChange={(v) => setType((v ?? 'damage') as ProductionAdjustmentType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRODUCTION_ADJUSTMENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{PRODUCTION_ADJUSTMENT_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Quantity</Label>
              {/* Unsigned: the sign comes from Direction above. Typing "-5" into a
                  box that is already set to Remove would otherwise add 5. */}
              <Input
                type="text"
                inputMode="numeric"
                placeholder="0"
                value={qty}
                onChange={(e) => setQty(e.target.value.replace(/\D/g, '').replace(/^0+(?=\d)/, ''))}
                className="text-center tabular-nums"
              />
            </div>
          </div>

          {/* The consequence, stated before it happens. A preview only — the toast
              after saving reports what the server actually wrote. */}
          {productId && magnitude > 0 && current !== undefined && (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <span className="text-muted-foreground">Balance </span>
              <span className="font-semibold tabular-nums">{current}</span>
              <span className="mx-1.5 text-muted-foreground">→</span>
              <span className={cn('font-semibold tabular-nums', (projected ?? 0) < 0 && 'text-red-600 dark:text-red-400')}>
                {projected}
              </span>
              {(projected ?? 0) < 0 && (
                <p className="mt-1 text-xs text-amber-600">
                  This leaves the pool negative. Allowed, and flagged in red on the sheet —
                  but check it is really what the shelf says.
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>
              Reason <span className="text-destructive">*</span>
            </Label>
            <Input
              placeholder="e.g. Dropped during transfer"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground">
              Required. This is what the audit trail shows next to the movement.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label>Remarks <span className="text-muted-foreground">(optional)</span></Label>
            <Textarea rows={2} value={remarks} onChange={(e) => setRemarks(e.target.value)} maxLength={1000} />
          </div>

          <div className="space-y-1.5">
            <Label>Approved by <span className="text-muted-foreground">(optional)</span></Label>
            <Input
              placeholder="Who authorised this"
              value={approvedBy}
              onChange={(e) => setApprovedBy(e.target.value)}
              maxLength={200}
            />
            {/* The signed-in user is recorded automatically and separately; this
                field is for the person who AUTHORISED it, who is often not the one
                at the keyboard. */}
            <p className="text-xs text-muted-foreground">
              Your own name is recorded on the movement either way.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={save} disabled={!valid || submitting}>
            {submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
            Post adjustment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
