'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useFieldArray, type Resolver } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '@/hooks/useAuth';
import { apiCall, ApiError } from '@/utils/api';
import {
  CreatePosSaleSchema,
  LOW_STOCK_THRESHOLD,
  stockLevel,
  isLowStock,
  type StockLevel,
  type CreateProductionSaleInput,
  type Product,
  type AppSettings,
  type PaymentMethod,
} from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList } from '@/components/ui/combobox';
import { Separator } from '@/components/ui/separator';
import { usePrintCapability } from '@/hooks/usePrintCapability';
import { useKeepFocusedFieldVisible } from '@/hooks/useKeepFocusedFieldVisible';
import { Trash2, Plus, Printer, Download, Save } from 'lucide-react';
import { toast } from 'sonner';
import { RestrictionNotice } from '@/components/shared/RestrictionNotice';
import { restrictionFromError, useRestrictionCheck } from '@/lib/restrictions';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, UNPAID_PAYMENT_METHOD } from '@/utils/constants';
import { cn } from '@/lib/utils';
import type { InvoiceData } from './InvoiceView';
import type { Restriction } from '@mb/shared';

// Re-check stock while the sale dialog is open so approvals / other cashiers' sales
// are reflected without a manual reload. Stock is also refreshed on open and after
// each sale, so this backstop poll can be relaxed to keep API load down.
const STOCK_POLL_MS = 60_000;

// Column template shared by the desktop header row and each item row.
// Widths follow the spec: Product 40 / Qty 10 / Rate 15 / Discount 15 / Amount 20, + a 36px action.
const ROW_GRID = 'sm:grid-cols-[minmax(0,40fr)_minmax(0,10fr)_minmax(0,15fr)_minmax(0,15fr)_minmax(0,20fr)_36px]';

// Colour bands for the available balance (see stockLevel() in @mb/shared).
const LEVEL_CLASS: Record<StockLevel, string> = {
  healthy: 'text-emerald-600 dark:text-emerald-400',
  moderate: 'text-amber-600 dark:text-amber-400',
  critical: 'text-red-600 dark:text-red-400',
  out: 'text-red-800 dark:text-red-500',
};

interface StockShortfall {
  productName: string;
  requested: number;
  available: number;
}

/**
 * POST /api/orders/pos response. Everything past `grandTotal` is the server's own
 * snapshot of the saved order — the authoritative source for the printed receipt.
 * Optional so a web build stays compatible with an API that predates the snapshot.
 */
interface PosSaleResponse {
  orderNumber: string;
  grandTotal: number;
  items?: { productName: string; qty: number; unitPrice: number; discount: number; lineTotal: number }[];
  subtotal?: number;
  discountTotal?: number;
  taxAmount?: number;
  createdAt?: string;
  receivedCash?: number;
  cashReturned?: number;
}

// Discount accepts either a percentage ("10%") or a fixed rupee amount ("100").
// A "%" entry is resolved against the line's gross (rate × qty); the result is clamped
// to [0, gross] so a line can never go negative. This resolved rupee number is what we
// store — the shared schema and the server keep treating `discount` as a plain number.
// Product search matches on the product code (SKU) or the name, case-insensitively,
// so a cashier can still type a code even though only the name is displayed. This is
// passed to the Combobox's `filter` so search stays correct independent of how each
// row's display label is formatted.
function productMatchesQuery(p: Product | null, query: string): boolean {
  if (p == null) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  // `sku` is absent on a Special Order item — a temporary product with no code.
  // Reading it unguarded threw on the first keystroke and took the page down.
  return (p.sku ?? '').toLowerCase().includes(q) || p.name.toLowerCase().includes(q);
}

function resolveDiscount(raw: string, lineGross: number): number {
  const t = (raw || '').trim();
  if (!t) return 0;
  const isPct = t.endsWith('%');
  const n = parseFloat(isPct ? t.slice(0, -1) : t);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const value = isPct ? (n / 100) * lineGross : n;
  return Math.max(0, Math.min(Math.round(value * 100) / 100, lineGross));
}

export function SaleForm({
  products,
  settings,
  branchId,
  stockById,
  stockLoaded,
  stockError,
  onRefreshStock,
  onSaved,
  endpoint = '/api/orders/pos',
  paymentMethods = PAYMENT_METHODS,
  schema = CreatePosSaleSchema as unknown as z.ZodType<CreateProductionSaleInput, z.ZodTypeDef, unknown>,
}: {
  products: Product[];
  settings: AppSettings | null;
  branchId: string;
  stockById: Record<string, number>;
  stockLoaded: boolean;
  stockError: boolean;
  onRefreshStock: () => void;
  onSaved: (invoice: InvoiceData, shouldPrint: boolean) => void;
  /**
   * Which endpoint commits the sale. The default deducts the *branch's* stock;
   * the Production dashboard passes '/api/orders/production-sale', which deducts
   * the central pool instead. Both take the same body and return the same shape,
   * so nothing else in this form changes.
   */
  endpoint?: string;
  /** Selectable payment methods. The production counter passes a list including 'staff'. */
  paymentMethods?: readonly string[];
  /** Validation schema. Must match `endpoint` — it is what enforces the staff comment. */
  schema?: z.ZodType<CreateProductionSaleInput, z.ZodTypeDef, unknown>;
}) {
  const { token } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  // `submitting` only disables the buttons on the NEXT render, and validation is
  // async — two fast taps both got through to the POST. The ref closes that gap.
  const submittingRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  useKeepFocusedFieldVisible(scrollRef);
  /**
   * Hourly sales activity (Restriction Rules, migration 136) — branch POS sales
   * only; the production counter's endpoint is not subject to it. The server
   * counts this hour's completed sales by its own clock and warns while the
   * branch is below the required number. It is a warning only: neither it nor a
   * failed check ever holds the till.
   */
  const salesCheck = useRestrictionCheck(token, 'sale', {}, endpoint === '/api/orders/pos');
  /** The restriction a save was refused with, when the preflight had not already shown it. */
  const [refused, setRefused] = useState<Restriction | null>(null);
  const saleRestriction = salesCheck.restriction ?? refused;
  const salesBlocked = salesCheck.check !== null && !salesCheck.check.allowed;
  const printRef = useRef(false);
  // Names the second submit after the device: no printer set up here means the
  // same click ends at "Save as PDF" in the browser dialog, so say so.
  const { canPrint } = usePrintCapability();
  // Raw discount text per line (keyed by the field id) so a "%" entry survives qty edits.
  const [discountRaw, setDiscountRaw] = useState<Record<string, string>>({});

  const cur = settings?.currencySymbol || 'Rs.';
  const taxRate = settings?.gstEnabled ? (settings.gstRate / 100) : 0;

  // Typed on the production input because it is the SUPERSET — its paymentMethod
  // union contains every branch method plus 'staff'. Which schema actually runs is
  // the caller's choice, so branch mode still rejects 'staff' at validation time.
  const form = useForm<CreateProductionSaleInput>({
    resolver: zodResolver(schema) as Resolver<CreateProductionSaleInput>,
    defaultValues: {
      branchId,
      customerName: '',
      customerPhone: '',
      items: [{ productId: '', qty: 1, discount: 0 }],
      paymentMethod: 'cash',
      notes: '',
    },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'items' });

  const items = form.watch('items');
  const paymentMethod = form.watch('paymentMethod');
  const isUnpaid = paymentMethod === UNPAID_PAYMENT_METHOD;

  // Refresh available stock on open and on a short poll while the dialog is mounted.
  useEffect(() => {
    onRefreshStock();
    const id = setInterval(onRefreshStock, STOCK_POLL_MS);
    return () => clearInterval(id);
  }, [onRefreshStock]);

  const qtyOf = (raw: number) => (Number.isFinite(raw) && raw > 0 ? raw : 0);

  // Total requested per product across all lines (duplicate lines of the same product
  // are summed) — this is what we validate against the available balance.
  const requestedByProduct = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of items) {
      if (!it.productId) continue;
      m[it.productId] = (m[it.productId] ?? 0) + qtyOf(it.qty);
    }
    return m;
  }, [items]);

  // Client-side gate. Falls back to server enforcement when stock couldn't be loaded.
  const stockReady = stockLoaded && !stockError;

  // Product search ordering: in-stock items on top, out-of-stock sink to the bottom.
  // Within the in-stock group we sort ascending by available balance so the
  // nearly-sold-out items surface first. Only reorder once stock has loaded —
  // before then every balance reads as 0 and the sort would be meaningless.
  const sortedProducts = useMemo(() => {
    if (!stockReady) return products;
    return [...products].sort((a, b) => {
      const sa = stockById[a.id] ?? 0;
      const sb = stockById[b.id] ?? 0;
      const aOut = sa <= 0;
      const bOut = sb <= 0;
      if (aOut !== bOut) return aOut ? 1 : -1; // available first, out-of-stock last
      return sa - sb; // ascending available balance
    });
  }, [products, stockById, stockReady]);
  const stockBlocked = stockReady && Object.entries(requestedByProduct).some(([pid, req]) => {
    const available = stockById[pid] ?? 0;
    return available <= 0 || req > available;
  });

  // Net line totals (qty×rate − discount). `subtotal` (net) is what the server stores;
  // the totals box below shows the gross subtotal so Subtotal − Discount + Tax reconciles.
  const subtotal = items.reduce((sum, item) => {
    const product = products.find((p) => p.id === item.productId);
    if (!product) return sum;
    return sum + product.price * (item.qty || 0) - (item.discount || 0);
  }, 0);
  const discountTotal = items.reduce((s, it) => s + (it.discount || 0), 0);
  const grossSubtotal = subtotal + discountTotal;
  const taxAmount = Math.round(subtotal * taxRate * 100) / 100;
  const grandTotal = subtotal + taxAmount;

  // Re-resolve discounts when a line's qty or product changes so the rupee amount
  // (and thus Amount / Grand Total) stays in sync: a "%" entry re-scales, and a fixed
  // amount re-clamps if the new gross drops below it. Writes only when the value
  // actually changes, which keeps this from looping.
  const qtySignature = items.map((it) => `${it.productId}:${it.qty}`).join('|');
  useEffect(() => {
    fields.forEach((f, i) => {
      const raw = discountRaw[f.id];
      if (!raw || !raw.trim()) return;
      const it = items[i];
      if (!it) return;
      const product = products.find((p) => p.id === it.productId);
      const gross = (product?.price ?? 0) * (it.qty || 0);
      const next = resolveDiscount(raw, gross);
      if (next !== (it.discount || 0)) {
        form.setValue(`items.${i}.discount`, next, { shouldValidate: true });
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qtySignature, discountRaw]);

  // Cash tendered → change to return, with a live validation gate.
  const isCash = paymentMethod === 'cash';
  const receivedCashRaw = form.watch('receivedCash');
  const receivedNum = typeof receivedCashRaw === 'number' && Number.isFinite(receivedCashRaw) ? receivedCashRaw : null;
  const cashShort = isCash && (receivedNum == null || receivedNum < grandTotal);

  // Surface client-side (Zod) validation failures instead of letting the Save
  // button silently do nothing. Walk into the (possibly nested) error tree and
  // show the first message we find.
  function onInvalid(errors: typeof form.formState.errors) {
    function firstMessage(node: unknown): string | undefined {
      if (!node || typeof node !== 'object') return undefined;
      if ('message' in node && typeof (node as { message?: unknown }).message === 'string') {
        return (node as { message: string }).message;
      }
      for (const value of Object.values(node as Record<string, unknown>)) {
        const found = firstMessage(value);
        if (found) return found;
      }
      return undefined;
    }
    printRef.current = false;
    toast.error(firstMessage(errors) || 'Please review the form and try again.');
  }

  async function onSubmit(data: CreateProductionSaleInput) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    const shouldPrint = printRef.current;
    printRef.current = false;
    setSubmitting(true);
    try {
      // Only send receivedCash on cash sales, and only when it is a valid number
      // (an empty field yields NaN → would fail server validation).
      const body: CreateProductionSaleInput = {
        branchId: data.branchId,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        items: data.items,
        paymentMethod: data.paymentMethod,
        notes: data.notes,
        ...(data.paymentMethod === 'cash' && receivedNum != null ? { receivedCash: receivedNum } : {}),
      };
      const result = await apiCall<PosSaleResponse>(
        endpoint,
        { method: 'POST', body: JSON.stringify(body) },
        token,
      );

      // Build the receipt from the SERVER's snapshot, never from the local product
      // list: the server re-reads each product and stamps its own unitPrice, so a
      // price change between opening this form and saving would otherwise print a
      // rate that disagrees with the stored order. Falls back to local values only
      // if an older API build omits the snapshot.
      const serverItems = result.items;
      const invoice: InvoiceData = {
        orderNumber: result.orderNumber,
        customerName: (data.customerName || '').trim() || 'Walking Customer',
        customerPhone: (data.customerPhone || '').trim(),
        items: serverItems
          ? serverItems.map((it) => ({
              productName: it.productName,
              qty: it.qty,
              unitPrice: it.unitPrice,
              discount: it.discount,
              lineTotal: it.lineTotal,
            }))
          : data.items.map((it) => {
              const p = products.find((pr) => pr.id === it.productId);
              return {
                productName: p?.name ?? '',
                qty: it.qty,
                unitPrice: p?.price ?? 0,
                discount: it.discount || 0,
                lineTotal: (p?.price ?? 0) * it.qty - (it.discount || 0),
              };
            }),
        // Invoice shows a gross subtotal then a discount line, so that
        // Subtotal − Discount + Tax reconciles to the Grand Total. The server
        // stores `subtotal` NET, hence the re-addition.
        subtotal:
          result.subtotal != null && result.discountTotal != null
            ? result.subtotal + result.discountTotal
            : grossSubtotal,
        discountTotal: result.discountTotal ?? discountTotal,
        taxAmount: result.taxAmount ?? taxAmount,
        grandTotal: result.grandTotal,
        paymentMethod: data.paymentMethod,
        createdAt: result.createdAt ?? new Date().toISOString(),
        ...(data.paymentMethod === 'cash' && receivedNum != null
          ? {
              receivedCash: result.receivedCash ?? receivedNum,
              cashReturned: result.cashReturned ?? Math.round((receivedNum - result.grandTotal) * 100) / 100,
            }
          : {}),
      };

      toast.success(`Sale ${result.orderNumber} saved — ${cur} ${result.grandTotal.toLocaleString()}`);
      form.reset({ branchId, customerName: '', customerPhone: '', items: [{ productId: '', qty: 1, discount: 0 }], paymentMethod: 'cash', notes: '' });
      setDiscountRaw({});
      setRefused(null);
      // This sale counts towards the hour; ask again before the next one.
      salesCheck.refetch();
      onSaved(invoice, shouldPrint);
    } catch (err) {
      const restriction = restrictionFromError(err);
      if (restriction) {
        // The hourly sales rule refused this entry. The notice above the Save
        // buttons explains it; a toast as well would say it twice.
        setRefused(restriction);
        salesCheck.refetch();
      }
      // Race condition: stock changed between load and save. Re-sync and surface the
      // server's per-product shortfall so the user can correct the quantities.
      else if (err instanceof ApiError && err.status === 409) {
        onRefreshStock();
        const details = Array.isArray(err.details) ? (err.details as StockShortfall[]) : [];
        const detail = details.map((d) => `${d.productName}: only ${d.available} left`).join(' · ');
        toast.error(detail ? `${err.message} — ${detail}` : err.message);
      } else {
        toast.error(err instanceof Error ? err.message : 'Failed to save sale');
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const cashReturned = receivedNum != null && receivedNum >= grandTotal ? receivedNum - grandTotal : null;

  // The full breakdown. Rendered in ONE of two places — see the footer comment.
  const totals = (
    <div className="rounded-lg border bg-muted p-3 space-y-1.5 text-sm">
      <div className="flex justify-between gap-3"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{cur} {grossSubtotal.toLocaleString()}</span></div>
      <div className="flex justify-between gap-3"><span className="text-muted-foreground">Discount</span><span className="tabular-nums">-{cur} {discountTotal.toLocaleString()}</span></div>
      <div className="flex justify-between gap-3"><span className="text-muted-foreground">Government Tax</span><span className="tabular-nums">{cur} {taxAmount.toLocaleString()}</span></div>
      <Separator />
      <div className="flex justify-between gap-3 font-bold text-base"><span>Grand Total</span><span className="text-primary tabular-nums">{cur} {grandTotal.toLocaleString()}</span></div>
      {isCash && (
        <>
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">Received Cash</span><span className="tabular-nums">{receivedNum != null ? `${cur} ${receivedNum.toLocaleString()}` : '—'}</span></div>
          <div className="flex justify-between gap-3"><span className="text-muted-foreground">Cash Returned</span><span className="tabular-nums">{cashReturned != null ? `${cur} ${cashReturned.toLocaleString()}` : '—'}</span></div>
        </>
      )}
    </div>
  );

  return (
    <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="flex min-h-0 flex-1 flex-col">
      {/* Scrollable body — only this region scrolls; header and footer stay put */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
        {/* Customer */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Customer (optional)</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="sale-customer-name">Customer Name</Label>
              <Input id="sale-customer-name" placeholder="Walking Customer" autoComplete="off" enterKeyHint="next" {...form.register('customerName')} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sale-customer-phone">Mobile Number</Label>
              <Input id="sale-customer-phone" type="tel" inputMode="tel" placeholder="Optional" autoComplete="off" enterKeyHint="next" {...form.register('customerPhone')} />
            </div>
          </div>
        </div>

        <Separator />

        {/* Items */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Items</h3>
            <Button
              type="button"
              size="sm"
              className="rounded-full shadow-sm"
              onClick={() => append({ productId: '', qty: 1, discount: 0 })}
            >
              <Plus className="mr-1 h-4 w-4" /> Add Item
            </Button>
          </div>

          {/* Column header (desktop only — mobile rows carry their own labels) */}
          <div className={cn('hidden gap-x-1.5 px-1 text-xs font-medium text-muted-foreground sm:grid', ROW_GRID)}>
            <span>Product</span>
            <span className="text-center">Qty</span>
            <span className="text-right">Rate</span>
            <span>Discount</span>
            <span className="text-right">Amount</span>
            <span />
          </div>

          <div className="space-y-3 sm:space-y-2">
            {fields.map((field, i) => {
              const productId = form.watch(`items.${i}.productId`);
              const selected = products.find((p) => p.id === productId);
              const lineAmount = selected ? selected.price * (form.watch(`items.${i}.qty`) || 0) - (form.watch(`items.${i}.discount`) || 0) : 0;

              const available = stockById[productId] ?? 0;
              const requested = requestedByProduct[productId] ?? 0;
              const known = stockReady && !!productId;
              const out = known && available <= 0;
              const insufficient = known && available > 0 && requested > available;
              const low = known && isLowStock(available);

              return (
                <div
                  key={field.id}
                  className="rounded-lg border p-2.5 sm:rounded-none sm:border-0 sm:border-b sm:border-border/60 sm:p-0 sm:pb-2 sm:last:border-b-0 sm:last:pb-0"
                >
                  <div className={cn('grid grid-cols-2 gap-x-2 gap-y-2 sm:items-center sm:gap-x-1.5 sm:gap-y-0', ROW_GRID)}>
                    {/* Product — searchable combobox */}
                    <div className="col-span-2 space-y-1 sm:col-span-1 sm:space-y-0">
                      <Label className="text-xs sm:hidden">Product</Label>
                      <Combobox
                        items={sortedProducts}
                        filter={productMatchesQuery}
                        value={selected ?? null}
                        onValueChange={(p: Product | null) => form.setValue(`items.${i}.productId`, p?.id ?? '', { shouldValidate: true })}
                        itemToStringLabel={(p: Product) => p.name}
                        itemToStringValue={(p: Product) => p.id}
                        isItemEqualToValue={(a: Product, b: Product) => a?.id === b?.id}
                      >
                        <ComboboxInput placeholder="Search product…" aria-label={`Product, item ${i + 1}`} />
                        <ComboboxContent>
                          <ComboboxEmpty>No products found.</ComboboxEmpty>
                          <ComboboxList>
                            {(p: Product) => {
                              const pOut = stockReady && (stockById[p.id] ?? 0) <= 0;
                              return (
                                <ComboboxItem key={p.id} value={p} disabled={pOut}>
                                  <div className="flex flex-1 flex-col">
                                    <span className="font-medium">{p.name}</span>
                                    <span className="text-xs text-muted-foreground">
                                      {p.categoryName || 'Special Order'} · {cur} {p.price.toLocaleString()}{pOut ? ' · Out of Stock' : ''}
                                    </span>
                                  </div>
                                </ComboboxItem>
                              );
                            }}
                          </ComboboxList>
                        </ComboboxContent>
                      </Combobox>
                    </div>

                    {/* Qty — whole positive numbers, centered */}
                    <div className="space-y-1 sm:space-y-0">
                      <Label className="text-xs sm:hidden">Qty</Label>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        inputMode="numeric"
                        className="h-10 text-center"
                        aria-label={`Quantity, item ${i + 1}`}
                        disabled={out}
                        onKeyDown={(e) => { if (['e', 'E', '+', '-', '.', ','].includes(e.key)) e.preventDefault(); }}
                        {...form.register(`items.${i}.qty`, { valueAsNumber: true })}
                      />
                    </div>

                    {/* Rate — read-only, right-aligned */}
                    <div className="space-y-1 sm:space-y-0">
                      <Label className="text-xs sm:hidden">Rate</Label>
                      <div className="flex h-10 items-center justify-end rounded-md border bg-muted/40 px-2 text-sm tabular-nums">
                        {selected ? `${cur} ${(selected.price ?? 0).toLocaleString()}` : '—'}
                      </div>
                    </div>

                    {/* Discount — accepts "10%" or a fixed rupee amount */}
                    <div className="space-y-1 sm:space-y-0">
                      <Label className="text-xs sm:hidden">Discount</Label>
                      <Input
                        type="text"
                        inputMode="decimal"
                        placeholder="0 or 10%"
                        className="h-10"
                        aria-label={`Discount, item ${i + 1}`}
                        disabled={out}
                        value={discountRaw[field.id] ?? ''}
                        onChange={(e) => {
                          const raw = e.target.value;
                          setDiscountRaw((m) => ({ ...m, [field.id]: raw }));
                          const gross = (selected?.price ?? 0) * (form.getValues(`items.${i}.qty`) || 0);
                          form.setValue(`items.${i}.discount`, resolveDiscount(raw, gross), { shouldValidate: true });
                        }}
                      />
                    </div>

                    {/* Amount — read-only, right-aligned, bold */}
                    <div className="space-y-1 sm:space-y-0">
                      <Label className="text-xs sm:hidden">Amount</Label>
                      <div className="flex h-10 items-center justify-end rounded-md border bg-muted/40 px-2 text-sm font-semibold tabular-nums">
                        {cur} {lineAmount.toLocaleString()}
                      </div>
                    </div>

                    {/* Remove row. Not rendered for a lone item: on a phone the empty
                        cell still cost a grid row of height it could not spare. */}
                    {fields.length > 1 && (
                      <div className="col-span-2 flex justify-end sm:col-span-1 sm:justify-center">
                        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-destructive" aria-label={`Remove item ${i + 1}`} onClick={() => remove(i)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Availability + real-time status (renders directly under the affected row,
                      including on mobile). */}
                  {productId && (
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      {known ? (
                        <>
                          <span className="text-muted-foreground">
                            Available:{' '}
                            <span className={cn('font-semibold tabular-nums', LEVEL_CLASS[stockLevel(available)])}>{available}</span>
                          </span>
                          {out ? (
                            <span className="font-medium text-red-800 dark:text-red-500">❌ This item is not in stock.</span>
                          ) : insufficient ? (
                            <span className="font-medium text-amber-600 dark:text-amber-400">
                              ⚠ Only {available} {available === 1 ? 'item is' : 'items are'} available. Please reduce the quantity.
                            </span>
                          ) : low ? (
                            <span className="font-medium text-amber-600 dark:text-amber-400">
                              ⚠ Low Stock (min {LOW_STOCK_THRESHOLD}) — please create a Production Order.
                            </span>
                          ) : (
                            <span className="font-medium text-emerald-600 dark:text-emerald-400">✅ Stock verified.</span>
                          )}
                        </>
                      ) : !stockLoaded ? (
                        <span className="text-muted-foreground">Checking stock…</span>
                      ) : stockError ? (
                        <span className="text-muted-foreground">Couldn&rsquo;t verify stock — it will be checked on save.</span>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <Separator />

        {/* Payment method — radio buttons */}
        <div className="space-y-2">
          <Label>Payment Method</Label>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {paymentMethods.map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={paymentMethod === m}
                onClick={() => form.setValue('paymentMethod', m as PaymentMethod)}
                className={cn(
                  'min-h-11 rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                  paymentMethod === m ? 'border-primary bg-primary/10 text-primary' : 'border-input hover:bg-accent',
                )}
              >
                {PAYMENT_METHOD_LABELS[m]}
              </button>
            ))}
          </div>
        </div>

        {/* Received Cash is cash-only — a staff sale collects nothing, and the other
            methods are settled elsewhere. The comment box sits below it rather than
            instead of it: it used to be the `else` of this branch, which left the
            default (cash) sale with no way to record one at all, so the Comment
            column on the sales table read '—' for nearly every branch row. */}
        {isCash && (
          <div className="space-y-1">
            <Label htmlFor="sale-received-cash">Received Cash</Label>
            <Input
              id="sale-received-cash"
              type="number"
              min={0}
              inputMode="decimal"
              enterKeyHint="done"
              placeholder="0"
              className="h-11 text-base"
              onKeyDown={(e) => { if (['e', 'E', '+', '-'].includes(e.key)) e.preventDefault(); }}
              {...form.register('receivedCash', {
                // NOT valueAsNumber: an empty/cleared number input yields NaN, and
                // z.number().optional() rejects NaN (it's a number, so .optional()
                // doesn't skip it) — which would silently block the submit. Coerce
                // empty → undefined so the field is truly optional.
                setValueAs: (v) => {
                  if (v === '' || v == null) return undefined;
                  const n = typeof v === 'number' ? v : parseFloat(v);
                  return Number.isFinite(n) ? n : undefined;
                },
              })}
            />
          </div>
        )}

        <div className="space-y-1">
          <Label htmlFor="sale-notes">{isUnpaid ? 'Comment *' : 'Notes (optional)'}</Label>
          <Textarea
            id="sale-notes"
            placeholder={isUnpaid ? 'Who is taking this, and why? (required)' : 'Any notes…'}
            aria-invalid={isUnpaid && !!form.formState.errors.notes}
            {...form.register('notes')}
          />
          {isUnpaid && (
            <p className={cn('text-xs', form.formState.errors.notes ? 'text-destructive' : 'text-muted-foreground')}>
              {form.formState.errors.notes?.message ?? 'No payment is collected for a staff sale, so a comment is required.'}
            </p>
          )}
        </div>

        {/* Phone / keyboard-open home of the breakdown: the last thing in the
            scrolling body, so it costs the screen nothing until it is scrolled to. */}
        <div className="md:hidden kb-open:block">{totals}</div>
      </div>

      {/* Sticky footer — total + actions stay in view while the body scrolls.

          The full breakdown lives here only when there is height to spare (md and
          up, no keyboard). It used to live here always, and on a phone that was
          the bug: header + six summary rows + buttons are ~340px that never
          scroll, and with the keyboard up a 720×1600 phone has ~480px in total —
          leaving the fields a strip too short to show the one being typed into.
          The phone footer is a single line carrying the two figures a cashier
          acts on (what to charge, what to hand back) above the Save buttons. */}
      <div className="shrink-0 space-y-3 border-t bg-background px-4 py-3 kb-open:space-y-2 kb-open:py-2 sm:px-5">
        <div className="hidden md:block kb-open:hidden">{totals}</div>

        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 md:hidden kb-open:flex" aria-live="polite">
          <span className="text-base font-bold">
            <span className="mr-1.5 text-sm font-medium text-muted-foreground">Grand Total</span>
            <span className="text-primary tabular-nums">{cur} {grandTotal.toLocaleString()}</span>
          </span>
          {isCash && (
            receivedNum == null ? (
              <span className="text-sm text-muted-foreground">Enter received cash</span>
            ) : cashReturned != null ? (
              <span className="text-sm font-semibold tabular-nums">
                <span className="mr-1.5 font-medium text-muted-foreground">Cash Returned</span>
                {cur} {cashReturned.toLocaleString()}
              </span>
            ) : (
              <span className="text-sm font-semibold text-red-700 tabular-nums dark:text-red-400">
                Short by {cur} {(grandTotal - receivedNum).toLocaleString()}
              </span>
            )
          )}
        </div>

        {/* The one-line footer already says "Short by …"; a second line here would
            grow and shrink the footer on every keystroke of the amount. */}
        {isCash && cashShort && receivedNum != null && (
          <p className="hidden text-center text-sm font-medium text-red-700 md:block kb-open:hidden dark:text-red-400">
            ❌ Received cash is less than the Grand Total.
          </p>
        )}

        {stockBlocked && (
          <p className="text-center text-sm font-medium text-red-700 dark:text-red-400">
            Some items exceed available stock. Adjust the quantities to continue.
          </p>
        )}

        {saleRestriction && <RestrictionNotice restriction={saleRestriction} />}

        <div className="grid grid-cols-2 gap-3">
          <Button type="submit" variant="outline" size="lg" disabled={submitting || stockBlocked || cashShort || salesBlocked} onClick={() => { printRef.current = false; }}>
            <Save className="h-4 w-4 mr-1.5" /> {submitting ? 'Saving…' : 'Save Sale'}
          </Button>
          <Button type="submit" size="lg" disabled={submitting || stockBlocked || cashShort || salesBlocked} onClick={() => { printRef.current = true; }}>
            {canPrint ? <Printer className="h-4 w-4 mr-1.5" /> : <Download className="h-4 w-4 mr-1.5" />}
            {canPrint ? 'Save & Print' : 'Save & PDF'}
          </Button>
        </div>
      </div>
    </form>
  );
}
