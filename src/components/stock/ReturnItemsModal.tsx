'use client';

import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { apiCall, ApiError } from '@/utils/api';
import { type StockRow, businessDateStr, karachiTimeStr } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { GeofenceGate } from '@/components/geofence/GeofenceGate';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * One in-progress return line. Quantity is held as a STRING so an emptied input
 * stays empty rather than snapping to 0 — the same reason NewOrderModal holds its
 * quantities as strings. It is parsed only at submit time.
 */
interface ReturnRow {
  productId: string;
  qty: string;
}

const EMPTY_ROW: ReturnRow = { productId: '', qty: '' };

/** Keep only digits, strip leading zeros — enforces positive whole numbers. */
function sanitizeQty(raw: string): string {
  return raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
}

/** Parse a raw qty string into a positive whole number (0 = blank / not entered). */
function parseQty(raw: string): number {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function ReturnItemsModal({
  open,
  onOpenChange,
  rows,
  branchName,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: StockRow[];
  branchName: string;
  onSaved: () => void;
}) {
  const { token } = useAuth();
  const [returnRows, setReturnRows] = useState<ReturnRow[]>([EMPTY_ROW]);
  const [reason, setReason] = useState('');
  const [stamp, setStamp] = useState({ date: '', time: '' });
  const [submitting, setSubmitting] = useState(false);

  // Only products with stock on hand can be returned.
  const returnable = useMemo(
    () => rows.filter((r) => r.balance > 0).sort((a, b) => a.productName.localeCompare(b.productName)),
    [rows],
  );
  const byId = useMemo(() => new Map(returnable.map((r) => [r.productId, r])), [returnable]);

  // Reset the form and capture the auto date/time each time the dialog opens.
  //
  // Done as React's documented render-time adjustment rather than in an effect:
  // an effect would render the stale previous return for one frame and then
  // re-render, and react-hooks/set-state-in-effect rightly rejects it.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const now = new Date();
      setStamp({ date: businessDateStr(now), time: karachiTimeStr(now) });
      setReturnRows([{ ...EMPTY_ROW }]);
      setReason('');
    }
  }

  const addRow = useCallback(() => setReturnRows((r) => [...r, { ...EMPTY_ROW }]), []);
  const removeRow = useCallback(
    // Never drop to zero rows — an empty dialog has nothing to type into.
    (index: number) => setReturnRows((r) => (r.length === 1 ? [{ ...EMPTY_ROW }] : r.filter((_, i) => i !== index))),
    [],
  );
  const setRowProduct = useCallback(
    (index: number, productId: string) =>
      setReturnRows((r) => r.map((row, i) => (i === index ? { ...row, productId } : row))),
    [],
  );
  const setRowQty = useCallback(
    (index: number, raw: string) =>
      setReturnRows((r) => r.map((row, i) => (i === index ? { ...row, qty: sanitizeQty(raw) } : row))),
    [],
  );

  /**
   * Options for one row: every returnable product except those already chosen in
   * the OTHER rows. Keeping this row's own selection in the list means it still
   * renders as the chosen value.
   *
   * This makes a duplicate unreachable in the UI, which matters for more than
   * tidiness: the balance check is per row, so two rows for the same product each
   * pass on their own but overdraw together. The schema rejects it too, as the
   * backstop for anything posting directly.
   */
  const optionsForRow = useCallback(
    (index: number) => {
      const takenElsewhere = new Set(
        returnRows.filter((_, i) => i !== index).map((r) => r.productId).filter(Boolean),
      );
      return returnable.filter((r) => !takenElsewhere.has(r.productId));
    },
    [returnRows, returnable],
  );

  // Only complete rows count: a row with a product but no quantity yet is still
  // being filled in, not a request.
  const selected = useMemo(
    () =>
      returnRows
        .map((r) => ({ row: r, stock: byId.get(r.productId) ?? null, qty: parseQty(r.qty) }))
        .filter((x) => x.stock && x.qty > 0),
    [returnRows, byId],
  );

  const anyExceeds = selected.some((s) => s.qty > (s.stock?.balance ?? 0));
  const totalUnits = selected.reduce((sum, s) => sum + s.qty, 0);
  const valid = selected.length > 0 && !anyExceeds;

  async function onSave() {
    if (!valid) return;
    setSubmitting(true);
    try {
      await apiCall(
        '/api/stock/return',
        {
          method: 'POST',
          body: JSON.stringify({
            items: selected.map((s) => ({ productId: s.row.productId, qty: s.qty })),
            reason: reason.trim(),
          }),
        },
        token,
      );
      toast.success(
        selected.length === 1
          ? `Returned ${selected[0].qty} × ${selected[0].stock!.productName} to production`
          : `Returned ${selected.length} products (${totalUnits} units) to production`,
      );
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save return');
      // A mid-batch failure may have committed earlier rows, so refresh the
      // caller's stock either way rather than leaving stale balances on screen.
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent className="flex max-h-[90dvh] flex-col md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Return Items</DialogTitle>
        </DialogHeader>

        {/* A return moves stock, so it is a transaction and carries the same
            location rule as a sale (POST /api/stock/return is guarded server-side
            too). Viewing the stock table behind this modal stays unrestricted. */}
        <GeofenceGate action="Stock updates">
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {/* Auto fields. All three are read-only, so on a phone they are a compact
              label:value strip rather than three full-height disabled inputs — a
              bottom sheet has no vertical space to spend on fields nobody edits. */}
          <div className="rounded-lg border bg-muted/30 p-2.5 text-sm sm:hidden">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Date</dt>
              <dd className="text-right tabular-nums">{stamp.date}</dd>
              <dt className="text-muted-foreground">Time</dt>
              <dd className="text-right tabular-nums">{stamp.time}</dd>
              <dt className="text-muted-foreground">Branch</dt>
              <dd className="truncate text-right font-medium">{branchName || '—'}</dd>
            </dl>
          </div>

          <div className="hidden sm:block sm:space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Date</Label>
                <Input value={stamp.date} readOnly disabled />
              </div>
              <div className="space-y-1">
                <Label>Time</Label>
                <Input value={stamp.time} readOnly disabled />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Branch Name</Label>
              <Input value={branchName} readOnly disabled />
            </div>
          </div>

          <Separator />

          {/* Column headings, desktop only — on a phone each row labels itself, the
              same shape as the StockCheckModal counting list. Per-row <Label>s used
              to do this job, but hidden on mobile from the second row down (`sr-only
              sm:not-sr-only`), which is backwards: it is exactly when the fields
              stack that they need naming. */}
          <div className="hidden px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:flex sm:items-center sm:gap-2">
            <span className="min-w-0 flex-1">Product</span>
            <span className="w-24 text-center">Available</span>
            <span className="w-24 text-center">Return Qty</span>
            <span className="w-8 shrink-0" aria-hidden />
          </div>

          {/* Product rows */}
          <div className="space-y-2">
            {returnRows.map((row, i) => {
              const stock = byId.get(row.productId) ?? null;
              const available = stock?.balance ?? 0;
              const qty = parseQty(row.qty);
              const exceeds = !!stock && qty > available;

              return (
                <div
                  key={i}
                  className={cn(
                    'rounded-lg border bg-card p-2 sm:border-0 sm:bg-transparent sm:p-1',
                    // A ring rather than a tint, so the offending card is findable
                    // without scrolling to its message. Desktop keeps the message
                    // alone — there is no card there to ring.
                    exceeds && 'ring-2 ring-destructive/40 sm:ring-0',
                  )}
                >
                  {/* Phone: product picker on its own line, then available / qty /
                      remove on a second line. Three stacked full-width fields per
                      row put Save an entire screen away by the third product.
                      Desktop is unchanged — `sm:contents` dissolves the second-line
                      wrapper so its fields become columns under the headings. */}
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-2">
                    <div className="min-w-0 flex-1">
                      <Select
                        value={row.productId || null}
                        onValueChange={(v) => v && setRowProduct(i, v as string)}
                      >
                        {/* min-h, not h: the trigger's own `h-8` is variant-prefixed
                            (`data-[size=default]:h-8`), so a plain `h-10` lands in a
                            different tailwind-merge group and loses to it. */}
                        <SelectTrigger aria-label="Product" className="min-h-10 w-full sm:min-h-8">
                          <SelectValue placeholder={returnable.length ? 'Select a product…' : 'No products in stock'} />
                        </SelectTrigger>
                        <SelectContent>
                          {optionsForRow(i).map((r) => (
                            <SelectItem key={r.productId} value={r.productId}>
                              {r.productName} — {r.balance} in stock
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="flex items-center gap-2 sm:contents">
                      {/* Available reads as inline text on a phone and as the bordered
                          box on desktop, where it has a heading to sit under. */}
                      <span className="shrink-0 text-xs text-muted-foreground sm:hidden">
                        Available{' '}
                        <span className="font-semibold tabular-nums text-foreground">
                          {stock ? available : '—'}
                        </span>
                      </span>
                      <div className="hidden h-8 w-24 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-sm tabular-nums text-muted-foreground sm:flex">
                        {stock ? available : '—'}
                      </div>

                      {/* h-10 for a thumb-sized target; text-base (16px) stops iOS
                          zooming the sheet on focus. Desktop keeps the h-8 scale. */}
                      <Input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete="off"
                        placeholder="0"
                        aria-label={`Return quantity${stock ? ` for ${stock.productName}` : ''}`}
                        value={row.qty}
                        onChange={(e) => setRowQty(i, e.target.value)}
                        onFocus={(e) => e.currentTarget.select()}
                        disabled={!stock}
                        className="ml-auto h-10 w-20 shrink-0 text-center text-base tabular-nums sm:ml-0 sm:h-8 sm:w-24 sm:text-sm"
                      />

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label="Remove this product"
                        onClick={() => removeRow(i)}
                        disabled={submitting}
                        className="size-10 shrink-0 text-muted-foreground hover:text-destructive sm:size-8"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {exceeds && (
                    <p className="mt-1.5 text-xs font-medium text-red-700 sm:text-sm dark:text-red-400">
                      ❌ {stock!.productName}: cannot return more than {available} in stock.
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <Button
            type="button"
            variant="outline"
            onClick={addRow}
            disabled={submitting || returnRows.length >= returnable.length}
            className="h-10 w-full sm:h-7 sm:w-auto sm:px-2.5 sm:text-[0.8rem]"
          >
            <Plus className="mr-1 h-4 w-4" /> Add Item
          </Button>

          <div className="space-y-1">
            <Label>Return Reason (optional)</Label>
            <Textarea placeholder="Damaged / unsold / expired…" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>

        {/* Summary + actions stay put while the rows scroll. */}
        <div className="shrink-0 space-y-3 border-t pt-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className="text-muted-foreground">
              Products <span className="font-bold tabular-nums text-primary">{selected.length}</span>
            </span>
            <span className="text-muted-foreground">
              Total units <span className="font-bold tabular-nums text-primary">{totalUnits}</span>
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
              className="h-10 sm:h-8"
            >
              Cancel
            </Button>
            <Button type="button" onClick={onSave} disabled={!valid || submitting} className="h-10 sm:h-8">
              <RotateCcw className="mr-1.5 h-4 w-4" /> {submitting ? 'Saving…' : 'Save Return'}
            </Button>
          </div>
        </div>
        </GeofenceGate>
      </DialogContent>
    </Dialog>
  );
}
