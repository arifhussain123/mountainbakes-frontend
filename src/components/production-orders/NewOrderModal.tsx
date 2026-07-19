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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { AlertTriangle, Calendar, Clock, Eraser, Hash, Loader2, PackageCheck, Save, Send, Store, User } from 'lucide-react';
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
  submit: (items: { productId: string; qty: number; remarks: string }[]) => Promise<unknown>;
  submitting: boolean;
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
  const [remarksById, setRemarksById] = useState<Record<string, string>>({});
  const [now, setNow] = useState<Date | null>(null);
  const [orderNumber, setOrderNumber] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const qtyRefs = useRef<(HTMLInputElement | null)[]>([]);
  const draftKey = branchId ? `mb:po-draft:${branchId}` : 'mb:po-draft';

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
        const d = JSON.parse(raw) as { qtyById?: Record<string, string>; remarksById?: Record<string, string> };
        if (d && typeof d === 'object') {
          setQtyById(d.qtyById ?? {});
          setRemarksById(d.remarksById ?? {});
        }
      }
    } catch {
      /* ignore malformed draft */
    }
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, [open, branchCode, draftKey]);

  const withinWindow = now ? isWithinOrderWindow(karachiMinutesOfDay(now), openMin, closeMin) : true;

  // Products sorted by Category, then Name (branch users can't reorder/edit — Admin-owned).
  const orderedProducts = useMemo(
    () =>
      [...products].sort((a, b) => {
        const c = (a.categoryName || '').localeCompare(b.categoryName || '');
        return c !== 0 ? c : a.name.localeCompare(b.name);
      }),
    [products],
  );

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

  const setQty = useCallback((id: string, raw: string) => setQtyById((p) => ({ ...p, [id]: sanitizeQty(raw) })), []);
  const setRemarks = useCallback((id: string, value: string) => setRemarksById((p) => ({ ...p, [id]: value })), []);

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
    setRemarksById({});
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* ignore */
    }
    qtyRefs.current[0]?.focus();
  }

  function saveDraft() {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ qtyById, remarksById }));
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
      const items = selectedItems.map(({ product, qty }) => ({
        productId: product.id,
        qty,
        remarks: (remarksById[product.id] ?? '').trim(),
      }));
      await submit(items);
      toast.success('Production Order Submitted Successfully');
      setQtyById({});
      setRemarksById({});
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
          className="flex h-full w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 top-0 left-0 sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[90vh] sm:w-[80vw] sm:max-w-[80vw] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl lg:w-[70vw] lg:max-w-[1200px]"
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
                    <Skeleton className="hidden h-10 w-40 sm:block" />
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
                        <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">Remarks</TableHead>
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
                            <TableCell>
                              <Input
                                placeholder="Optional"
                                aria-label={`Remarks for ${p.name}`}
                                value={remarksById[p.id] ?? ''}
                                onChange={(e) => setRemarks(p.id, e.target.value)}
                                className="h-9"
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile cards */}
                <div className="space-y-3 md:hidden">
                  {orderedProducts.map((p) => {
                    const active = parseQty(qtyById[p.id]) > 0;
                    return (
                      <div key={p.id} className={`rounded-lg border bg-card p-3 ${active ? 'ring-2 ring-primary/40' : ''}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="font-medium leading-tight">{p.name}</p>
                            {p.categoryName && <p className="text-xs text-muted-foreground">{p.categoryName}</p>}
                          </div>
                          <div className="text-right">
                            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Current Stock</p>
                            <p className="font-semibold tabular-nums">{stockText(p.id)}</p>
                          </div>
                        </div>
                        <div className="mt-3 grid grid-cols-3 gap-2">
                          <div>
                            <label className="mb-1 block text-xs text-muted-foreground">Qty</label>
                            <Input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              placeholder="0"
                              aria-label={`Quantity for ${p.name}`}
                              value={qtyById[p.id] ?? ''}
                              onChange={(e) => setQty(p.id, e.target.value)}
                              onFocus={(e) => e.currentTarget.select()}
                              className="h-10 text-center tabular-nums"
                            />
                          </div>
                          <div className="col-span-2">
                            <label className="mb-1 block text-xs text-muted-foreground">Remarks</label>
                            <Input
                              placeholder="Optional"
                              aria-label={`Remarks for ${p.name}`}
                              value={remarksById[p.id] ?? ''}
                              onChange={(e) => setRemarks(p.id, e.target.value)}
                              className="h-10"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
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
        <DialogContent className="sm:max-w-md">
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
