'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ElementType } from 'react';
import {
  type Product,
  businessDateStr,
  karachiTimeStr,
  karachiMinutesOfDay,
  hhmmToMinutes,
  isWithinOrderWindow,
  ORDER_WINDOW_OPEN_MINUTES,
  ORDER_WINDOW_CLOSE_MINUTES,
} from '@mb/shared';
import { useSettings } from '@/hooks/useSettings';
import { useAuth } from '@/hooks/useAuth';
import { usePackingMaterials } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, Calendar, ChevronDown, Clock, Eraser, Hash, Loader2, Package, PackageCheck, Plus, Save, Send, Store, Trash2, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { sortProducts } from '@/utils/productSort';
import { toast } from 'sonner';

const EMPTY_PRODUCT_MESSAGE = 'Please enter the quantity for at least one product.';
const BLOCKED_QTY_KEYS = ['e', 'E', '+', '-', '.', ','];

/** 'HH:mm' (24-hour) → '8:00 AM' for display. */
function formatTime12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  const period = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${period}`;
}

export interface NewOrderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  stockById: Record<string, number>;
  stockLoaded: boolean;
  loadingProducts: boolean;
  branchId: string | null;
  branchName: string;
  branchCode: string;
  userName: string;
  /** Submits the order (a TanStack Query mutation); resolves on success, throws on failure. */
  submit: (payload: {
    items: { productId: string; qty: number }[];
    packingItems: { packingMaterialId: string; qty: number }[];
  }) => Promise<unknown>;
  submitting: boolean;
}

/**
 * One in-progress packing row. Quantity is held as a STRING, matching how product
 * quantities are held in `qtyById` — an empty input must stay empty rather than
 * snapping to 0, and it is parsed only at submit time.
 */
interface PackingRow {
  packingMaterialId: string;
  qty: string;
}

/** Parse a raw qty string into a positive whole number (0 = blank / not ordered). */
function parseQty(raw: string | undefined): number {
  const n = parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Keep only digits, strip leading zeros — enforces positive whole numbers. */
function sanitizeQty(raw: string): string {
  return raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
}

/** Human-readable reference number shown in the header (display only; the doc id is the real key). */
function makeOrderNumber(code: string, d: Date): string {
  return `PO-${code}-${businessDateStr(d).replace(/-/g, '')}-${karachiTimeStr(d).replace(':', '')}`;
}

function Meta({ icon: Icon, label, value }: { icon: ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0">
        <p className="text-[11px] font-medium uppercase leading-none tracking-wide text-muted-foreground">{label}</p>
        <p className="truncate font-medium leading-tight" title={value}>{value}</p>
      </div>
    </div>
  );
}

export function NewOrderModal({
  open,
  onOpenChange,
  products,
  stockById,
  stockLoaded,
  loadingProducts,
  branchId,
  branchName,
  branchCode,
  userName,
  submit,
  submitting,
}: NewOrderModalProps) {
  const [qtyById, setQtyById] = useState<Record<string, string>>({});
  const [now, setNow] = useState<Date | null>(null);
  const [orderNumber, setOrderNumber] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Packing materials are optional, so the section starts collapsed and its rows
  // start empty — a demand with none must behave exactly as it did before.
  const [packingOpen, setPackingOpen] = useState(false);
  const [packingRows, setPackingRows] = useState<PackingRow[]>([]);

  const qtyRefs = useRef<(HTMLInputElement | null)[]>([]);
  const draftKey = branchId ? `mb:po-draft:${branchId}` : 'mb:po-draft';
  const { token } = useAuth();

  // Order window comes from Admin → Business Hours (default 8:00 AM–2:00 AM, wraps midnight).
  const { settings } = useSettings();
  const openMin = hhmmToMinutes(settings?.orderStartTime ?? '') ?? ORDER_WINDOW_OPEN_MINUTES;
  const closeMin = hhmmToMinutes(settings?.orderEndTime ?? '') ?? ORDER_WINDOW_CLOSE_MINUTES;
  const orderStartLabel = formatTime12(settings?.orderStartTime ?? '08:00');

  // Live Karachi clock + order number + draft restore — only while the modal is open.
  useEffect(() => {
    if (!open) return;
    setNow(new Date());
    setOrderNumber(makeOrderNumber(branchCode, new Date()));
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        // Older drafts may still carry a `remarksById` key — ignored now that
        // Remarks has been removed from the form.
        const d = JSON.parse(raw) as { qtyById?: Record<string, string>; packingRows?: PackingRow[] };
        if (d && typeof d === 'object') {
          setQtyById(d.qtyById ?? {});
          // A draft saved before packing materials existed simply has no rows.
          const rows = Array.isArray(d.packingRows) ? d.packingRows : [];
          setPackingRows(rows);
          if (rows.length > 0) setPackingOpen(true);
        }
      }
    } catch {
      /* ignore malformed draft */
    }
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [open, branchCode, draftKey]);

  const withinWindow = now ? isWithinOrderWindow(karachiMinutesOfDay(now), openMin, closeMin) : true;

  // Size, then Category, then Name — the 1 Pound / 2 Pound cakes collect at the
  // bottom of the list instead of scattering through the plain cakes. Branch
  // users can't reorder or edit products; this is Admin-owned data.
  const orderedProducts = useMemo(() => sortProducts(products), [products]);

  const selectedItems = useMemo(
    () =>
      orderedProducts
        .map((p) => ({ product: p, qty: parseQty(qtyById[p.id]) }))
        .filter((x) => x.qty > 0),
    [orderedProducts, qtyById],
  );
  const totalProducts = selectedItems.length;
  const totalQty = selectedItems.reduce((s, x) => s + x.qty, 0);
  const canSubmit = totalProducts > 0 && withinWindow && !submitting;

  // ── Packing materials ──────────────────────────────────────────────────────
  // Active only. The server re-checks this on submit (a material can be disabled
  // while the form is open), so this is the convenience half of the rule.
  const packingQ = usePackingMaterials(token, { enabled: open && !!token });
  const packingMaterials = useMemo(() => packingQ.data ?? [], [packingQ.data]);

  // Only complete rows count: a row where the user picked a material but hasn't
  // typed a quantity yet is still being filled in, not a request.
  const selectedPacking = useMemo(
    () => packingRows.filter((r) => r.packingMaterialId && parseQty(r.qty) > 0),
    [packingRows],
  );
  const packingCount = selectedPacking.length;

  const addPackingRow = useCallback(() => {
    setPackingOpen(true);
    setPackingRows((rows) => [...rows, { packingMaterialId: '', qty: '' }]);
  }, []);

  const removePackingRow = useCallback((index: number) => {
    setPackingRows((rows) => rows.filter((_, i) => i !== index));
  }, []);

  const setPackingMaterial = useCallback((index: number, materialId: string) => {
    setPackingRows((rows) => rows.map((r, i) => (i === index ? { ...r, packingMaterialId: materialId } : r)));
  }, []);

  const setPackingQty = useCallback((index: number, raw: string) => {
    setPackingRows((rows) => rows.map((r, i) => (i === index ? { ...r, qty: sanitizeQty(raw) } : r)));
  }, []);

  /**
   * Options for one row: every active material except those already chosen in the
   * OTHER rows. Keeping the row's own selection in the list means it still renders
   * as the chosen value. This makes a duplicate unreachable in the UI; the schema
   * and a unique constraint reject it anyway if something posts directly.
   */
  const optionsForRow = useCallback(
    (index: number) => {
      const takenElsewhere = new Set(
        packingRows.filter((_, i) => i !== index).map((r) => r.packingMaterialId).filter(Boolean),
      );
      return packingMaterials.filter((m) => !takenElsewhere.has(m.id));
    },
    [packingRows, packingMaterials],
  );

  const setQty = useCallback((id: string, raw: string) => setQtyById((p) => ({ ...p, [id]: sanitizeQty(raw) })), []);

  const handleQtyKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>, flatIndex: number) => {
    if (BLOCKED_QTY_KEYS.includes(e.key)) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const next = qtyRefs.current[flatIndex + 1];
      if (next) next.focus();
      else e.currentTarget.blur();
    }
  }, []);

  function clearAll() {
    setQtyById({});
    setPackingRows([]);
    setPackingOpen(false);
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* ignore */
    }
    qtyRefs.current[0]?.focus();
  }

  function saveDraft() {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ qtyById, packingRows }));
      toast.success('Draft saved');
    } catch {
      toast.error('Could not save draft');
    }
  }

  function handleSubmitClick() {
    if (!withinWindow) return;
    if (totalProducts === 0) {
      toast.error(EMPTY_PRODUCT_MESSAGE);
      return;
    }
    setConfirmOpen(true);
  }

  async function confirmSubmit() {
    try {
      const items = selectedItems.map(({ product, qty }) => ({ productId: product.id, qty }));
      const packingItems = selectedPacking.map((r) => ({
        packingMaterialId: r.packingMaterialId,
        qty: parseQty(r.qty),
      }));
      await submit({ items, packingItems });
      toast.success('Production Order Submitted Successfully');
      setQtyById({});
      setPackingRows([]);
      setPackingOpen(false);
      try {
        localStorage.removeItem(draftKey);
      } catch {
        /* ignore */
      }
      setConfirmOpen(false);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit order');
      setConfirmOpen(false);
    }
  }

  const dateStr = now ? businessDateStr(now) : '—';
  const timeStr = now ? karachiTimeStr(now) : '—';
  const stockText = (id: string) => (stockLoaded ? String(stockById[id] ?? 0) : '…');

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
        <DialogContent
          showCloseButton
          mobile="fullscreen"
          className="flex flex-col gap-0 overflow-hidden p-0 md:w-[80vw] md:max-w-[80vw] md:rounded-2xl lg:w-[70vw] lg:max-w-[1200px]"
        >
          {/* ---------- Sticky header ---------- */}
          <div className="shrink-0 border-b bg-card px-5 py-4">
            <div className="pr-10">
              <h2 className="flex items-center gap-2 font-heading text-base font-semibold sm:text-lg">
                <PackageCheck className="h-5 w-5 text-primary" /> Create New Production Order
              </h2>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-2.5 text-sm sm:grid-cols-3">
              <Meta icon={Store} label="Branch" value={branchName || '—'} />
              <Meta icon={Hash} label="Branch Code" value={branchCode || '—'} />
              <Meta icon={Calendar} label="Date" value={dateStr} />
              <Meta icon={Clock} label="Time" value={timeStr} />
              <Meta icon={Hash} label="Order No." value={orderNumber || '—'} />
              <Meta icon={User} label="Ordered By" value={userName || '—'} />
            </div>
          </div>

          {/* ---------- Scrollable body ---------- */}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
            {loadingProducts ? (
              <div className="space-y-2">
                {Array.from({ length: 7 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-10 flex-1" />
                    <Skeleton className="hidden h-10 w-24 sm:block" />
                    <Skeleton className="h-10 w-20" />
                  </div>
                ))}
              </div>
            ) : orderedProducts.length === 0 ? (
              <div className="py-16 text-center text-sm text-muted-foreground">
                No active products available. Please contact Admin.
              </div>
            ) : (
              <>
                {/* Desktop / tablet table with sticky column header */}
                <div className="hidden overflow-hidden rounded-lg border md:block">
                  <Table>
                    <TableHeader>
                      <TableRow className="sticky top-0 z-10 bg-muted hover:bg-muted">
                        <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">Product</TableHead>
                        <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">Current Stock</TableHead>
                        <TableHead className="w-28 text-xs uppercase tracking-wide text-muted-foreground">Qty</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orderedProducts.map((p, flatIndex) => {
                        const active = parseQty(qtyById[p.id]) > 0;
                        return (
                          <TableRow key={p.id} className={active ? 'bg-primary/5' : undefined}>
                            <TableCell>
                              <div className="font-medium">{p.name}</div>
                              {p.categoryName && <div className="text-xs text-muted-foreground">{p.categoryName}</div>}
                            </TableCell>
                            <TableCell className="tabular-nums text-muted-foreground">{stockText(p.id)}</TableCell>
                            <TableCell>
                              <Input
                                ref={(el) => { qtyRefs.current[flatIndex] = el; }}
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                placeholder="0"
                                aria-label={`Quantity for ${p.name}`}
                                value={qtyById[p.id] ?? ''}
                                onChange={(e) => setQty(p.id, e.target.value)}
                                onKeyDown={(e) => handleQtyKeyDown(e, flatIndex)}
                                onFocus={(e) => e.currentTarget.select()}
                                className="h-9 w-20 text-center tabular-nums"
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile cards — name, current stock and the qty box all on one
                    row, so a card is a single line and the whole list scrolls in a
                    fraction of the screens it used to. The name truncates (full text
                    in `title`) rather than wrapping, which is what keeps the row to
                    one line; the category sub-line has no room and is dropped. */}
                <div className="space-y-2 md:hidden">
                  {orderedProducts.map((p) => {
                    const active = parseQty(qtyById[p.id]) > 0;
                    return (
                      <div
                        key={p.id}
                        className={`flex items-center gap-2 rounded-lg border bg-card p-2 ${active ? 'ring-2 ring-primary/40' : ''}`}
                      >
                        <p className="min-w-0 flex-1 truncate text-sm font-medium leading-tight" title={p.name}>
                          {p.name}
                        </p>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          Stock <span className="font-semibold tabular-nums text-foreground">{stockText(p.id)}</span>
                        </span>
                        {/* inputMode="numeric" + pattern="[0-9]*" makes phones open the
                            digits-only keypad (no letters). text-base (16px) stops iOS
                            from zooming the page in on focus. */}
                        <Input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          autoComplete="off"
                          placeholder="0"
                          aria-label={`Quantity for ${p.name}`}
                          value={qtyById[p.id] ?? ''}
                          onChange={(e) => setQty(p.id, e.target.value)}
                          onFocus={(e) => e.currentTarget.select()}
                          className="h-11 w-20 shrink-0 px-1 text-center text-base tabular-nums"
                        />
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* ---------- Packing Materials (optional) ---------- */}
            {/* Collapsed by default and never required: most demands are products
                only, and the section must not add a step to that path. */}
            <div className="mt-6 rounded-xl border bg-card">
              <button
                type="button"
                onClick={() => setPackingOpen((o) => !o)}
                aria-expanded={packingOpen}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <span className="flex items-center gap-2 font-medium">
                  <Package className="h-4 w-4 text-muted-foreground" />
                  Packing Materials
                  <span className="text-sm font-normal text-muted-foreground">(Optional)</span>
                  {packingCount > 0 && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                      {packingCount} selected
                    </span>
                  )}
                </span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', packingOpen && 'rotate-180')} />
              </button>

              {packingOpen && (
                <div className="space-y-3 border-t px-4 py-3">
                  {packingRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No packing materials requested. Add a row to request some with this demand.
                    </p>
                  ) : (
                    packingRows.map((row, i) => (
                      <div key={i} className="flex flex-col gap-2 sm:flex-row sm:items-end">
                        <div className="min-w-0 flex-1 space-y-1">
                          <label className="text-xs text-muted-foreground sm:hidden">Packing Material</label>
                          <Select
                            value={row.packingMaterialId}
                            onValueChange={(v) => v && setPackingMaterial(i, v)}
                          >
                            <SelectTrigger className="h-11 w-full sm:h-10">
                              <SelectValue placeholder={packingQ.isLoading ? 'Loading…' : 'Select a packing material'} />
                            </SelectTrigger>
                            <SelectContent>
                              {optionsForRow(i).map((m) => (
                                <SelectItem key={m.id} value={m.id}>
                                  {m.materialName}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {/* Mobile: label left, box pushed right — same row shape as the
                            product cards. From sm the label is hidden and the field
                            rejoins the horizontal row. */}
                        <div className="flex items-center justify-between gap-3 sm:block sm:space-y-1">
                          <label className="text-xs text-muted-foreground sm:hidden">Quantity</label>
                          <Input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            autoComplete="off"
                            placeholder="0"
                            aria-label="Packing material quantity"
                            value={row.qty}
                            onChange={(e) => setPackingQty(i, e.target.value)}
                            onFocus={(e) => e.currentTarget.select()}
                            className="h-11 w-28 text-center text-base tabular-nums sm:h-10"
                          />
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Remove packing material row"
                          onClick={() => removePackingRow(i)}
                          className="h-11 w-11 shrink-0 self-end text-muted-foreground hover:text-destructive sm:h-10 sm:w-10"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))
                  )}

                  <Button type="button" variant="outline" size="sm" onClick={addPackingRow}>
                    <Plus className="mr-1 h-4 w-4" /> Add Row
                  </Button>
                </div>
              )}

              {!packingOpen && (
                <div className="border-t px-4 py-3">
                  <Button type="button" variant="outline" size="sm" onClick={addPackingRow}>
                    <Plus className="mr-1 h-4 w-4" /> Add Packing Material
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* ---------- Sticky footer ---------- */}
          <div className="shrink-0 space-y-3 border-t bg-muted/40 px-5 py-3">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-1">
              <div className="flex items-baseline gap-2">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">Selected Products</span>
                <span className="text-lg font-bold tabular-nums text-primary">{totalProducts}</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-xs uppercase tracking-wide text-muted-foreground">Total Quantity</span>
                <span className="text-lg font-bold tabular-nums text-primary">{totalQty}</span>
              </div>
            </div>

            {!withinWindow && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  Ordering time has ended.<br />
                  New production orders will open again at {orderStartLabel}.
                </span>
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Button variant="outline" className="w-full sm:w-auto" onClick={clearAll} disabled={submitting}>
                <Eraser className="mr-1.5 h-4 w-4" /> Clear
              </Button>
              <Button variant="secondary" className="w-full sm:w-auto" onClick={saveDraft} disabled={submitting}>
                <Save className="mr-1.5 h-4 w-4" /> Save Draft
              </Button>
              <Button className="w-full sm:w-auto" onClick={handleSubmitClick} disabled={!canSubmit}>
                <Send className="mr-1.5 h-4 w-4" /> Submit Order
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ---------- Confirmation dialog ---------- */}
      <Dialog open={confirmOpen} onOpenChange={(o) => !submitting && setConfirmOpen(o)}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackageCheck className="h-5 w-5 text-primary" /> Confirm Submission
            </DialogTitle>
            <DialogDescription>Are you sure you want to submit this Production Order?</DialogDescription>
          </DialogHeader>

          <dl className="divide-y rounded-lg border text-sm">
            <div className="flex justify-between px-3 py-2">
              <dt className="text-muted-foreground">Branch</dt>
              <dd className="font-medium">{branchName || '—'}</dd>
            </div>
            <div className="flex justify-between px-3 py-2">
              <dt className="text-muted-foreground">Products ordered</dt>
              <dd className="font-semibold tabular-nums">{totalProducts}</dd>
            </div>
            <div className="flex justify-between px-3 py-2">
              <dt className="text-muted-foreground">Total quantity</dt>
              <dd className="font-semibold tabular-nums">{totalQty}</dd>
            </div>
            {/* Only when there are any — a products-only confirmation is unchanged. */}
            {packingCount > 0 && (
              <div className="flex justify-between px-3 py-2">
                <dt className="text-muted-foreground">Packing materials</dt>
                <dd className="font-semibold tabular-nums">{packingCount}</dd>
              </div>
            )}
          </dl>

          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={confirmSubmit} disabled={submitting || !withinWindow}>
              {submitting ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Submitting…
                </>
              ) : (
                'Confirm'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
