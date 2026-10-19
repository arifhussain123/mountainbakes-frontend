'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { apiCall, ApiError } from '@/utils/api';
import { type StockRow, businessDateStr, karachiTimeStr } from '@mb/shared';
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
import { GeofenceGate } from '@/components/geofence/GeofenceGate';
import { Separator } from '@/components/ui/separator';
import { ReturnLinePhotoField } from './ReturnLinePhotoField';
import { useReturnLinePhotos } from './useReturnLinePhotos';
import { cn } from '@/lib/utils';
import { Plus, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * One in-progress return line. Quantity is held as a STRING so an emptied input
 * stays empty rather than snapping to 0 — the same reason NewOrderModal holds its
 * quantities as strings. It is parsed only at submit time.
 *
 * `id` is the row's own, for as long as the dialog is open. Each line now owns
 * a photo (and an upload in flight), and keying either by INDEX would hand
 * row 3's photo to row 2 the moment row 2 is deleted.
 */
interface ReturnRow {
  id: string;
  productId: string;
  qty: string;
}

/** A UUID where the platform offers one, a time-salted fallback where it does not (plain http). */
function newId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function emptyRow(): ReturnRow {
  return { id: newId('row'), productId: '', qty: '' };
}

/** The 409 the API answers when a cited photo can no longer be bound — see attachments.service. */
function unavailablePhotoIds(details: unknown): string[] | null {
  if (!details || typeof details !== 'object') return null;
  const d = details as { code?: unknown; attachmentIds?: unknown };
  if (d.code !== 'attachment_unavailable' || !Array.isArray(d.attachmentIds)) return null;
  return d.attachmentIds.filter((x): x is string => typeof x === 'string');
}

/** Keep only digits, strip leading zeros — enforces positive whole numbers. */
function sanitizeQty(raw: string): string {
  return raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
}

/** Parse a raw qty string into a positive whole number (0 = blank / not entered). */
function parseQty(raw: string): number {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Search matches the stock code or the product name, case-insensitively — the same
 * two fields the Stock table itself searches on, and the same shape as SaleForm's
 * `productMatchesQuery`. Passed to the Combobox's `filter` so search stays correct
 * independent of how the row renders its label.
 */
function stockMatchesQuery(r: StockRow | null, query: string): boolean {
  if (r == null) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (r.stockCode ?? '').toLowerCase().includes(q) || (r.productName ?? '').toLowerCase().includes(q);
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
  const [returnRows, setReturnRows] = useState<ReturnRow[]>(() => [emptyRow()]);
  const [reason, setReason] = useState('');
  const [stamp, setStamp] = useState({ date: '', time: '' });
  const [submitting, setSubmitting] = useState(false);
  /**
   * One photo per line, each uploaded the moment it is taken — see
   * useReturnLinePhotos for why, and for how the uploads that end up belonging
   * to nothing are discarded.
   */
  const linePhotos = useReturnLinePhotos(token);
  /** The line whose photo is open full size. */
  const [viewingRowId, setViewingRowId] = useState<string | null>(null);
  /** Save was pressed while a line still needed its photo — ring that line. */
  const [saveAttempted, setSaveAttempted] = useState(false);
  /** Each line's element, so Save can bring the first one missing a photo into view. */
  const rowEls = useRef(new Map<string, HTMLDivElement>());
  /**
   * The Idempotency-Key for the return about to be sent, with the exact body it
   * was minted for. A retry of the SAME body reuses it, so a save whose answer
   * was lost cannot return the stock twice; any change to the body (a fixed
   * quantity, a retaken photo) mints a new one, because the server refuses a
   * key reused for a different request. Dropped once the dialog closes.
   */
  const operation = useRef<{ body: string; key: string } | null>(null);

  // Only products with stock on hand can be returned.
  const returnable = useMemo(
    () => rows.filter((r) => r.balance > 0),
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
      setReturnRows([emptyRow()]);
      setReason('');
      setViewingRowId(null);
      setSaveAttempted(false);
    }
  }

  const addRow = useCallback(() => setReturnRows((r) => [...r, emptyRow()]), []);
  const { remove: removeLinePhoto } = linePhotos;
  const removeRow = useCallback(
    (rowId: string) => {
      // The line's photo goes with it: its upload is cancelled, or its staged
      // copy discarded on the server.
      removeLinePhoto(rowId);
      // Never drop to zero rows — an empty dialog has nothing to type into.
      setReturnRows((r) => (r.length === 1 ? [emptyRow()] : r.filter((row) => row.id !== rowId)));
    },
    [removeLinePhoto],
  );
  const setRowProduct = useCallback(
    (rowId: string, productId: string) =>
      setReturnRows((r) => r.map((row) => (row.id === rowId ? { ...row, productId } : row))),
    [],
  );
  const setRowQty = useCallback(
    (rowId: string, raw: string) =>
      setReturnRows((r) => r.map((row) => (row.id === rowId ? { ...row, qty: sanitizeQty(raw) } : row))),
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
    (rowId: string) => {
      const takenElsewhere = new Set(
        returnRows.filter((r) => r.id !== rowId).map((r) => r.productId).filter(Boolean),
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
  // Unreachable through the picker (see optionsForRow) and refused by the
  // schema; checked here too so Save never offers to send what will bounce.
  const anyDuplicate = new Set(selected.map((s) => s.row.productId)).size !== selected.length;
  const totalUnits = selected.reduce((sum, s) => sum + s.qty, 0);

  // Every line being returned needs its photo UPLOADED — not picked, not
  // uploading, not failed — because Save sends only the stored ids.
  const { photos } = linePhotos;
  const photosReady = selected.filter((s) => photos[s.row.id]?.status === 'uploaded').length;
  const needsPhoto = selected.filter((s) => photos[s.row.id]?.status !== 'uploaded');

  /** Wrong in a way Save cannot point at — nothing chosen, too many, a duplicate. */
  const blocked = selected.length === 0 || anyExceeds || anyDuplicate;
  const valid = !blocked && needsPhoto.length === 0;

  /** Close, letting go of every photo the dialog staged and never saved. */
  const { clear: clearLinePhotos } = linePhotos;
  const close = useCallback(() => {
    clearLinePhotos();
    operation.current = null;
    onOpenChange(false);
  }, [clearLinePhotos, onOpenChange]);

  /** Bring a line into view and put focus on its photo buttons. */
  const goToRow = useCallback((rowId: string) => {
    const el = rowEls.current.get(rowId);
    if (!el) return;
    el.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    el.querySelector<HTMLElement>('[data-photo-control] button:not([disabled])')?.focus({ preventScroll: true });
  }, []);

  /**
   * Submit the return: one line per product, each citing its own photo.
   *
   * The photos are already on the server (each uploaded as it was taken), so
   * this is one small request. A refusal leaves every photo in place — a
   * shortfall or a typo is fixed and resubmitted with the same pictures —
   * except the ones the server says it can no longer use, which go back to
   * "failed" on their own lines for a Retry.
   */
  async function onSave() {
    if (submitting || blocked) return;
    // Save LOOKS disabled while a photo is missing but still answers a press —
    // by taking the user to the line that needs one. A truly disabled button
    // cannot say what is missing, and on a phone that line can be a screen
    // away. See the button below.
    if (needsPhoto.length > 0) {
      const first = needsPhoto[0];
      const state = photos[first.row.id]?.status;
      setSaveAttempted(true);
      goToRow(first.row.id);
      toast.error(
        state === 'uploading'
          ? `The photo of ${first.stock!.productName} is still uploading.`
          : state === 'failed'
            ? `The photo of ${first.stock!.productName} did not upload. Retry it or take another.`
            : `Add a photo of ${first.stock!.productName} before saving.`,
      );
      return;
    }
    if (!token) {
      toast.error('Your session has expired. Sign in again.');
      return;
    }

    const items = selected.map((s) => ({
      productId: s.row.productId,
      qty: s.qty,
      attachmentId: photos[s.row.id]!.attachment!.id,
    }));
    const body = JSON.stringify({ items, reason: reason.trim() });
    if (operation.current?.body !== body) operation.current = { body, key: newId('ret') };

    setSubmitting(true);
    try {
      await apiCall(
        '/api/stock/return',
        { method: 'POST', headers: { 'Idempotency-Key': operation.current.key }, body },
        token,
      );
      // "sent … for approval", not "returned … to production". Since branch
      // returns stopped being auto-approved this is a request, not a completed
      // handover: the units come off the branch balance now but production has
      // to accept them, and the branch can still change or delete the return
      // from Return Stock until they do.
      toast.success(
        selected.length === 1
          ? `Sent ${selected[0].qty} × ${selected[0].stock!.productName} to production for approval`
          : `Sent ${selected.length} products (${totalUnits} units) to production for approval`,
      );
      // The cited photos are bound to the return now; only the ones on lines
      // that were not sent (a photo on a line left at 0) are discarded.
      clearLinePhotos(new Set(items.map((it) => it.attachmentId)));
      operation.current = null;
      onOpenChange(false);
      onSaved();
    } catch (err) {
      const gone = err instanceof ApiError && err.status === 409 ? unavailablePhotoIds(err.details) : null;
      if (gone) linePhotos.markUnavailable(gone);
      toast.error(err instanceof ApiError ? err.message : 'Failed to save return');
      // A mid-batch failure may have committed earlier rows, so refresh the
      // caller's stock either way rather than leaving stale balances on screen.
      onSaved();
    } finally {
      setSubmitting(false);
    }
  }

  const viewing = viewingRowId ? photos[viewingRowId] : undefined;
  const viewingName = viewingRowId
    ? (byId.get(returnRows.find((r) => r.id === viewingRowId)?.productId ?? '')?.productName ?? 'item')
    : '';

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && (o ? onOpenChange(o) : close())}>
      <DialogContent className="flex flex-col md:max-w-4xl">
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
            <span className="hidden w-72 shrink-0 md:block">
              Photo<span className="ml-0.5 text-destructive" aria-hidden>*</span>
            </span>
            <span className="w-8 shrink-0" aria-hidden />
          </div>

          {/* Product rows */}
          <div className="space-y-2">
            {returnRows.map((row, i) => {
              const stock = byId.get(row.productId) ?? null;
              const available = stock?.balance ?? 0;
              const qty = parseQty(row.qty);
              const exceeds = !!stock && qty > available;
              const counts = !!stock && qty > 0;
              const photo = photos[row.id];
              const missingPhoto = counts && photo?.status !== 'uploaded';
              const subject = stock?.productName ?? `item ${i + 1}`;

              return (
                <div
                  key={row.id}
                  ref={(el) => {
                    if (el) rowEls.current.set(row.id, el);
                    else rowEls.current.delete(row.id);
                  }}
                  data-row-id={row.id}
                  className={cn(
                    'scroll-mt-4 rounded-lg border bg-card p-2 sm:border-0 sm:bg-transparent sm:p-1',
                    // A ring rather than a tint, so the offending card is findable
                    // without scrolling to its message. Desktop keeps the message
                    // alone — there is no card there to ring.
                    exceeds && 'ring-2 ring-destructive/40 sm:ring-0',
                    // After a Save that stopped for photos, ring every line still
                    // without one — on every width, since this is what the press
                    // scrolled to. The "Photo required" text says why.
                    saveAttempted && missingPhoto && 'ring-2 ring-destructive/40 sm:ring-2',
                  )}
                >
                  {/* Phone: product picker on its own line, then available / qty /
                      remove on a second line. Three stacked full-width fields per
                      row put Save an entire screen away by the third product.
                      Desktop is unchanged — `sm:contents` dissolves the second-line
                      wrapper so its fields become columns under the headings. */}
                  {/* The photo is a THIRD line on a phone and below the row up to a
                      desktop-width dialog (`basis-full` wraps it), then a column of
                      its own; `md:order-last` keeps Remove at the far right. */}
                  <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2 md:flex-nowrap">
                    {/* A Combobox, not a Select — the same picker SaleForm uses for
                        the same job. The Select dropdown does not open at all inside
                        this bottom sheet on Android Chrome (reported from the shop
                        floor; not reproducible in headless Chrome at any viewport,
                        row position or scroll offset, so the mechanism is unproven).
                        Combobox is the picker this app already runs on a phone all
                        day in Sales, and it brings search, which a long product list
                        wants anyway. */}
                    <div className="min-w-0 flex-1">
                      <Combobox
                        items={optionsForRow(row.id)}
                        filter={stockMatchesQuery}
                        value={stock}
                        onValueChange={(r: StockRow | null) => setRowProduct(row.id, r?.productId ?? '')}
                        itemToStringLabel={(r: StockRow) => r.productName}
                        itemToStringValue={(r: StockRow) => r.productId}
                        isItemEqualToValue={(a: StockRow, b: StockRow) => a?.productId === b?.productId}
                      >
                        <ComboboxInput
                          aria-label="Product"
                          disabled={returnable.length === 0}
                          placeholder={returnable.length ? 'Search product…' : 'No products in stock'}
                          // 16px on the phone, or Chrome/Safari zoom the sheet on focus.
                          className="text-base sm:h-8 sm:text-sm"
                        />
                        <ComboboxContent>
                          <ComboboxEmpty>No products found.</ComboboxEmpty>
                          <ComboboxList>
                            {(r: StockRow) => (
                              <ComboboxItem key={r.productId} value={r}>
                                <div className="flex flex-1 flex-col">
                                  <span className="font-medium">{r.productName}</span>
                                  <span className="text-xs text-muted-foreground">
                                    {r.stockCode} · {r.balance} in stock
                                  </span>
                                </div>
                              </ComboboxItem>
                            )}
                          </ComboboxList>
                        </ComboboxContent>
                      </Combobox>
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
                        onChange={(e) => setRowQty(row.id, e.target.value)}
                        onFocus={(e) => e.currentTarget.select()}
                        disabled={!stock}
                        className="ml-auto h-10 w-20 shrink-0 text-center text-base tabular-nums sm:ml-0 sm:h-8 sm:w-24 sm:text-sm"
                      />

                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={stock ? `Remove ${stock.productName}` : 'Remove this product'}
                        onClick={() => removeRow(row.id)}
                        disabled={submitting}
                        className="size-10 shrink-0 text-muted-foreground hover:text-destructive sm:size-8 md:order-last"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>

                    <div className="min-w-0 sm:basis-full md:w-72 md:shrink-0 md:basis-auto">
                      <ReturnLinePhotoField
                        photo={photo}
                        preparing={Boolean(linePhotos.preparing[row.id])}
                        subject={subject}
                        required={counts}
                        disabled={submitting}
                        onPick={(source) => void linePhotos.pick(row.id, source)}
                        onRetry={() => linePhotos.retry(row.id)}
                        onRemove={() => linePhotos.remove(row.id)}
                        onView={() => setViewingRowId(row.id)}
                      />
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
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" data-testid="return-summary">
            <span className="text-muted-foreground">
              Products <span className="font-bold tabular-nums text-primary">{selected.length}</span>
            </span>
            <span className="text-muted-foreground" aria-hidden>·</span>
            <span className="text-muted-foreground">
              Total units <span className="font-bold tabular-nums text-primary">{totalUnits}</span>
            </span>
            <span className="text-muted-foreground" aria-hidden>·</span>
            {/* Over the lines being returned (a quantity above 0), the same set
                Save checks. Short of complete it turns red — and says so in
                the numbers, never by colour alone. */}
            <span className="text-muted-foreground">
              Photos{' '}
              <span
                className={cn(
                  'font-bold tabular-nums',
                  photosReady < selected.length ? 'text-destructive' : 'text-primary',
                )}
              >
                {photosReady} of {selected.length}
              </span>
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={close}
              disabled={submitting}
              className="h-10 sm:h-8"
            >
              Cancel
            </Button>
            {/* Truly disabled when nothing is ready to send or a quantity is
                wrong — the row says which. While only PHOTOS are missing it is
                `aria-disabled`: it looks and announces as unavailable, but a
                press scrolls to the first line still needing one (see onSave). */}
            <Button
              type="button"
              onClick={() => void onSave()}
              disabled={blocked || submitting}
              aria-disabled={!valid || undefined}
              className={cn('h-10 sm:h-8', !blocked && !valid && 'opacity-50')}
            >
              <RotateCcw className="mr-1.5 h-4 w-4" /> {submitting ? 'Saving…' : 'Save Return'}
            </Button>
          </div>
        </div>
        </GeofenceGate>
      </DialogContent>

      <Dialog open={viewing !== undefined} onOpenChange={(o) => !o && setViewingRowId(null)}>
        <DialogContent className="md:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Photo of returned {viewingName}</DialogTitle>
          </DialogHeader>
          {viewing && (
            /* eslint-disable-next-line @next/next/no-img-element -- an object URL
               over a blob in memory; next/image is unavailable in a static export. */
            <img
              src={viewing.local.previewUrl}
              alt={`Photo of returned ${viewingName}`}
              className="max-h-[70dvh] w-full rounded-lg object-contain"
            />
          )}
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
