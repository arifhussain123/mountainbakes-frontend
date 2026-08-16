'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ElementType } from 'react';
import {
  type Attachment,
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
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { PhotoCapture } from '@/components/shared/PhotoCapture';
import { AlertTriangle, Calendar, ChevronDown, Clock, Eraser, Hash, Loader2, Package, PackageCheck, Plus, Save, Send, Sparkles, Store, Trash2, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { sortProducts } from '@/utils/productSort';
import { toast } from 'sonner';

const EMPTY_PRODUCT_MESSAGE = 'Please enter the quantity for at least one product.';
const MISSING_REQUIRED_DATE_MESSAGE = 'Please choose the date this demand is required by.';
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
    /**
     * One-off items typed by hand. The server turns each into a hidden product
     * so it can carry production and branch stock like any other line.
     */
    specialItems: { name: string; qty: number; description: string; attachmentIds: string[] }[];
    /** 'YYYY-MM-DD' the branch needs this delivered by. Never empty — see `canSubmit`. */
    requiredDate: string;
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

/**
 * One in-progress special-order row — something the branch needs that is not in
 * the catalogue. Name and quantity make it a request; description and photo are
 * optional extras.
 *
 * `photos` is deliberately NOT part of the saved draft (see `saveDraft`): an
 * attachment id points at an uploaded file, and a draft restored days later
 * would carry ids whose photos no longer describe today's demand.
 */
interface SpecialRow {
  name: string;
  qty: string;
  description: string;
  photos: Attachment[];
}

const EMPTY_SPECIAL_ROW: SpecialRow = { name: '', qty: '', description: '', photos: [] };

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

/** One headed group of lines in the confirmation dialog. */
function ConfirmSection({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
        <span className="text-xs text-muted-foreground">{count}</span>
      </div>
      <ul className="divide-y rounded-lg border">{children}</ul>
    </div>
  );
}

/** One `name … qty` line, with the optional description and photo count under it. */
function ConfirmLine({
  name,
  qty,
  note,
  badge,
}: {
  name: string;
  qty: number;
  note?: string;
  badge?: string;
}) {
  return (
    <li className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
      <div className="min-w-0">
        <p className="font-medium leading-tight">{name}</p>
        {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
        {badge && <p className="mt-0.5 text-[11px] text-muted-foreground">{badge}</p>}
      </div>
      <span className="shrink-0 font-semibold tabular-nums">{qty}</span>
    </li>
  );
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
  // Special order items — one-offs typed by hand. Same posture as packing
  // materials: optional, collapsed until asked for, and a demand with none
  // behaves exactly as it did before.
  const [specialOpen, setSpecialOpen] = useState(false);
  const [specialRows, setSpecialRows] = useState<SpecialRow[]>([]);
  /**
   * The day the branch needs this delivered by. Mandatory — unlike every other
   * field on this form, an empty value blocks the submit rather than simply
   * being omitted from the payload.
   *
   * Starts EMPTY rather than pre-filled with today. A default would be accepted
   * unread on most demands, which is the same as having no field: the point is
   * that somebody chose the date.
   */
  const [requiredDate, setRequiredDate] = useState('');

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
        const d = JSON.parse(raw) as {
          qtyById?: Record<string, string>;
          packingRows?: PackingRow[];
          specialRows?: Omit<SpecialRow, 'photos'>[];
          requiredDate?: string;
        };
        if (d && typeof d === 'object') {
          setQtyById(d.qtyById ?? {});
          // A draft saved before this field existed has none, and a draft
          // restored after its required date has passed must not silently keep
          // it — in both cases the branch picks the date again, which is the
          // one thing this field is not allowed to guess.
          const savedDate = typeof d.requiredDate === 'string' ? d.requiredDate : '';
          setRequiredDate(savedDate >= businessDateStr(new Date()) ? savedDate : '');
          // A draft saved before packing materials existed simply has no rows.
          const rows = Array.isArray(d.packingRows) ? d.packingRows : [];
          setPackingRows(rows);
          if (rows.length > 0) setPackingOpen(true);
          // Likewise for special items. `photos` is re-seeded empty because the
          // draft never stored ids — see saveDraft.
          const special = Array.isArray(d.specialRows) ? d.specialRows : [];
          setSpecialRows(special.map((r) => ({ ...EMPTY_SPECIAL_ROW, ...r, photos: [] })));
          if (special.length > 0) setSpecialOpen(true);
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

  // ── Packing materials ──────────────────────────────────────────────────────
  // Active only. The server re-checks this on submit (a material can be disabled
  // while the form is open), so this is the convenience half of the rule.
  const packingQ = usePackingMaterials(token, { enabled: open && !!token });
  const packingMaterials = useMemo(() => packingQ.data ?? [], [packingQ.data]);

  /** id → name, for rendering the Select trigger. See the SelectValue note below. */
  const packingNameById = useMemo(
    () => new Map(packingMaterials.map((m) => [m.id, m.materialName])),
    [packingMaterials],
  );

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

  // ── Special order items ────────────────────────────────────────────────────
  // A row counts as a request once it has BOTH a name and a quantity. A row with
  // only a name typed is still being filled in, exactly like a packing row with
  // no quantity yet.
  const selectedSpecial = useMemo(
    () => specialRows.filter((r) => r.name.trim() !== '' && parseQty(r.qty) > 0),
    [specialRows],
  );
  const specialCount = selectedSpecial.length;

  /**
   * Two special rows with the same name would resolve to one auto-created
   * product on the server and be rejected there. Caught here so it reads as a
   * field error rather than a failed submit.
   */
  const duplicateSpecialNames = useMemo(() => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const r of specialRows) {
      const key = r.name.trim().toLowerCase();
      if (!key) continue;
      if (seen.has(key)) dupes.add(key);
      seen.add(key);
    }
    return dupes;
  }, [specialRows]);

  const addSpecialRow = useCallback(() => {
    setSpecialOpen(true);
    setSpecialRows((rows) => [...rows, { ...EMPTY_SPECIAL_ROW }]);
  }, []);

  const removeSpecialRow = useCallback((index: number) => {
    setSpecialRows((rows) => rows.filter((_, i) => i !== index));
  }, []);

  const setSpecialField = useCallback(
    (index: number, patch: Partial<SpecialRow>) => {
      setSpecialRows((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
    },
    [],
  );

  /**
   * Earliest date the branch may ask for — today's BUSINESS date, not today's
   * calendar date. Between midnight and 2 AM those differ, and the calendar one
   * would refuse a demand for the day the branch is currently working.
   */
  const minRequiredDate = now ? businessDateStr(now) : '';
  const requiredDateInPast = requiredDate !== '' && minRequiredDate !== '' && requiredDate < minRequiredDate;

  // Declared after the packing and special tallies because it now depends on
  // them: a demand of packing materials or special items alone is a real demand.
  const canSubmit =
    (totalProducts > 0 || specialCount > 0 || packingCount > 0) &&
    duplicateSpecialNames.size === 0 &&
    // The whole point of the field: no date, no demand. `min` on the input is
    // advisory only — a typed date bypasses the picker — so the value is
    // re-checked here rather than trusted to the browser.
    requiredDate !== '' &&
    !requiredDateInPast &&
    withinWindow &&
    !submitting;

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
    setSpecialRows([]);
    setSpecialOpen(false);
    setRequiredDate('');
    try {
      localStorage.removeItem(draftKey);
    } catch {
      /* ignore */
    }
    qtyRefs.current[0]?.focus();
  }

  function saveDraft() {
    try {
      // Special rows are saved WITHOUT their photos — an attachment id in a
      // days-old draft points at a photo of a different day's request.
      const specialDraft = specialRows.map(({ name, qty, description }) => ({ name, qty, description }));
      localStorage.setItem(
        draftKey,
        JSON.stringify({ qtyById, packingRows, specialRows: specialDraft, requiredDate }),
      );
      toast.success('Draft saved');
    } catch {
      toast.error('Could not save draft');
    }
  }

  function handleSubmitClick() {
    if (!withinWindow) return;
    // A demand of special items only is valid — the branch may need one named
    // cake and nothing else. What is refused is a demand asking for nothing.
    if (totalProducts === 0 && specialCount === 0 && packingCount === 0) {
      toast.error(EMPTY_PRODUCT_MESSAGE);
      return;
    }
    if (duplicateSpecialNames.size > 0) {
      toast.error('Two special items have the same name. Rename one or remove it.');
      return;
    }
    // Reached only if the Submit button was somehow activated with the field
    // empty; the toast still matters, because the disabled button alone never
    // says WHICH field is missing on a form this long.
    if (requiredDate === '') {
      toast.error(MISSING_REQUIRED_DATE_MESSAGE);
      return;
    }
    if (requiredDateInPast) {
      toast.error('The required date cannot be in the past.');
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
      const specialItems = selectedSpecial.map((r) => ({
        name: r.name.trim(),
        qty: parseQty(r.qty),
        description: r.description.trim(),
        attachmentIds: r.photos.map((p) => p.id),
      }));
      await submit({ items, packingItems, specialItems, requiredDate });
      toast.success('Production Order Submitted Successfully');
      setQtyById({});
      setPackingRows([]);
      setPackingOpen(false);
      setSpecialRows([]);
      setSpecialOpen(false);
      setRequiredDate('');
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
                              {/* The children FUNCTION is load-bearing, not decoration.
                                  base-ui's Select.Value renders the raw VALUE unless it
                                  is given one (or `items`/`itemToStringLabel` on Root) —
                                  and the value here is the material's uuid, so a bare
                                  <SelectValue /> showed a 36-character id in the box
                                  after you picked something. Radix resolved the item's
                                  text automatically; this library does not. */}
                              <SelectValue placeholder={packingQ.isLoading ? 'Loading…' : 'Select a packing material'}>
                                {(value) =>
                                  packingNameById.get(String(value ?? '')) ??
                                  (packingQ.isLoading ? 'Loading…' : 'Select a packing material')
                                }
                              </SelectValue>
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

            {/* ---------- Special Order Items (optional) ---------- */}
            {/* Last on the form, after the catalogue and the packing materials:
                these are the things that are not in either list. Same collapsed,
                never-required shape as packing materials. */}
            <div className="mt-6 rounded-xl border bg-card">
              <button
                type="button"
                onClick={() => setSpecialOpen((o) => !o)}
                aria-expanded={specialOpen}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <span className="flex items-center gap-2 font-medium">
                  <Sparkles className="h-4 w-4 text-muted-foreground" />
                  Special Order Items
                  <span className="text-sm font-normal text-muted-foreground">(Optional)</span>
                  {specialCount > 0 && (
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                      {specialCount} added
                    </span>
                  )}
                </span>
                <ChevronDown className={cn('h-4 w-4 shrink-0 transition-transform', specialOpen && 'rotate-180')} />
              </button>

              {specialOpen && (
                <div className="space-y-3 border-t px-4 py-3">
                  {specialRows.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Anything you need that isn&apos;t in the product list — a named cake, a one-off box. Add a row to
                      request one.
                    </p>
                  ) : (
                    specialRows.map((row, i) => {
                      const isDuplicate =
                        row.name.trim() !== '' && duplicateSpecialNames.has(row.name.trim().toLowerCase());
                      return (
                        <div key={i} className="space-y-2 rounded-lg border bg-background p-3">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                            <div className="min-w-0 flex-1 space-y-1">
                              <label className="text-xs text-muted-foreground">Item name</label>
                              <Input
                                value={row.name}
                                onChange={(e) => setSpecialField(i, { name: e.target.value })}
                                placeholder="e.g. Name cake — blue writing"
                                aria-label="Special item name"
                                aria-invalid={isDuplicate}
                                className={cn('h-11 text-base sm:h-10 sm:text-sm', isDuplicate && 'border-destructive')}
                              />
                            </div>
                            <div className="flex items-center justify-between gap-3 sm:block sm:space-y-1">
                              <label className="text-xs text-muted-foreground">Qty</label>
                              <Input
                                type="text"
                                inputMode="numeric"
                                pattern="[0-9]*"
                                autoComplete="off"
                                placeholder="0"
                                aria-label="Special item quantity"
                                value={row.qty}
                                onChange={(e) => setSpecialField(i, { qty: sanitizeQty(e.target.value) })}
                                onFocus={(e) => e.currentTarget.select()}
                                className="h-11 w-28 text-center text-base tabular-nums sm:h-10"
                              />
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label="Remove special item row"
                              onClick={() => removeSpecialRow(i)}
                              className="h-11 w-11 shrink-0 self-end text-muted-foreground hover:text-destructive sm:h-10 sm:w-10"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>

                          {isDuplicate && (
                            <p className="text-xs text-destructive">
                              Another row already asks for this item. Rename one or remove it.
                            </p>
                          )}

                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">Description (optional)</label>
                            <Textarea
                              rows={2}
                              value={row.description}
                              onChange={(e) => setSpecialField(i, { description: e.target.value })}
                              placeholder="What should be done with it — writing, colour, packing"
                              aria-label="Special item description"
                            />
                          </div>

                          {/* Optional, unlike the verification photo. A branch
                              asking for "20 blue boxes" has nothing to show. */}
                          <PhotoCapture
                            entity="production_order_special_item"
                            value={row.photos}
                            onChange={(next) => setSpecialField(i, { photos: next })}
                            label="Photo (optional)"
                            disabled={submitting}
                            hint="Add a picture if it helps explain what you need."
                          />
                        </div>
                      );
                    })
                  )}

                  <Button type="button" variant="outline" size="sm" onClick={addSpecialRow}>
                    <Plus className="mr-1 h-4 w-4" /> Add Row
                  </Button>
                </div>
              )}

              {!specialOpen && (
                <div className="border-t px-4 py-3">
                  <Button type="button" variant="outline" size="sm" onClick={addSpecialRow}>
                    <Plus className="mr-1 h-4 w-4" /> Add Special Order Item
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* ---------- Sticky footer ---------- */}
          <div className="shrink-0 space-y-3 border-t bg-muted/40 px-5 py-3">
            {/* Required date sits in the sticky footer, next to Submit, rather
                than in the scrolling body — on a catalogue of a hundred products
                a field at the top of the form is off-screen by the time anyone
                reaches the button that it blocks. */}
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
              <label
                htmlFor="po-required-date"
                className="flex shrink-0 items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"
              >
                <Calendar className="h-3.5 w-3.5" />
                Required Date <span className="text-destructive">*</span>
              </label>
              <Input
                id="po-required-date"
                type="date"
                required
                value={requiredDate}
                min={minRequiredDate || undefined}
                onChange={(e) => setRequiredDate(e.target.value)}
                disabled={submitting}
                aria-invalid={requiredDate === '' || requiredDateInPast}
                className={cn(
                  'h-9 w-full sm:w-48',
                  (requiredDate === '' || requiredDateInPast) && 'border-destructive',
                )}
              />
              <span className="text-xs text-muted-foreground">
                {requiredDateInPast
                  ? 'The required date cannot be in the past.'
                  : requiredDate === ''
                    ? 'Choose when you need this delivered — the order cannot be submitted without it.'
                    : 'When you need this delivered by.'}
              </span>
            </div>

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
      {/* ---------- Confirmation dialog ----------
          Now an ITEMISED review rather than three totals. The totals told you
          how many lines you were about to send but not which — and the one
          mistake this dialog exists to catch (a quantity typed into the wrong
          row, on a form of a hundred products) is invisible in a count. The
          list scrolls; the totals stay pinned underneath it. */}
      <Dialog open={confirmOpen} onOpenChange={(o) => !submitting && setConfirmOpen(o)}>
        <DialogContent className="flex max-h-[85vh] flex-col md:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PackageCheck className="h-5 w-5 text-primary" /> Confirm Submission
            </DialogTitle>
            <DialogDescription>
              {branchName || '—'} · {dateStr} · check the quantities before submitting.
            </DialogDescription>
          </DialogHeader>

          <div className="-mx-1 min-h-0 flex-1 space-y-4 overflow-y-auto px-1">
            {totalProducts > 0 && (
              <ConfirmSection title="Products" count={totalProducts}>
                {selectedItems.map(({ product, qty }) => (
                  <ConfirmLine key={product.id} name={product.name} qty={qty} />
                ))}
              </ConfirmSection>
            )}

            {packingCount > 0 && (
              <ConfirmSection title="Packing Materials" count={packingCount}>
                {selectedPacking.map((r, i) => (
                  <ConfirmLine
                    key={`${r.packingMaterialId}-${i}`}
                    name={packingNameById.get(r.packingMaterialId) ?? 'Packing material'}
                    qty={parseQty(r.qty)}
                  />
                ))}
              </ConfirmSection>
            )}

            {specialCount > 0 && (
              <ConfirmSection title="Special Order Items" count={specialCount}>
                {selectedSpecial.map((r, i) => (
                  <ConfirmLine
                    key={`${r.name}-${i}`}
                    name={r.name.trim()}
                    qty={parseQty(r.qty)}
                    note={r.description.trim() || undefined}
                    badge={r.photos.length > 0 ? `${r.photos.length} photo` : undefined}
                  />
                ))}
              </ConfirmSection>
            )}
          </div>

          <dl className="shrink-0 divide-y rounded-lg border bg-muted/40 text-sm">
            {/* First row, and emphasised: it is the only line here the branch
                chose freely rather than derived from the quantities above, so it
                is the one worth a second look before sending. */}
            <div className="flex justify-between px-3 py-2">
              <dt className="text-muted-foreground">Required by</dt>
              <dd className="font-semibold tabular-nums text-primary">{requiredDate || '—'}</dd>
            </div>
            <div className="flex justify-between px-3 py-2">
              <dt className="text-muted-foreground">Lines</dt>
              <dd className="font-semibold tabular-nums">{totalProducts + packingCount + specialCount}</dd>
            </div>
            <div className="flex justify-between px-3 py-2">
              <dt className="text-muted-foreground">Total product quantity</dt>
              <dd className="font-semibold tabular-nums">{totalQty}</dd>
            </div>
          </dl>

          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button onClick={confirmSubmit} disabled={submitting || !withinWindow || !canSubmit}>
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
