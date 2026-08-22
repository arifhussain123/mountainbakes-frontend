'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { apiCall } from '@/utils/api';
import { useProducts, useProductionStock } from '@/lib/queries';import {
  CreateProductionSaleSchema,
  type Order,
  type Branch,
  type StockRow,
  businessDateStr,
  businessDayBounds,
  karachiDateStr,
  karachiTimeStr,
} from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { DataTable } from '@/components/shared/DataTable';
import { Fab } from '@/components/shared/Fab';
import { PrintButton } from '@/components/shared/PrintButton';
import { cn } from '@/lib/utils';
import { SaleForm } from './SaleForm';
import { GeofenceGate } from '@/components/geofence/GeofenceGate';
import { InvoiceView, type InvoiceData } from './InvoiceView';
import { PrintPortal } from '@/components/shared/PrintPortal';
import { Eye, Plus } from 'lucide-react';
import { createColumnHelper } from '@tanstack/react-table';
import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  PRODUCTION_SALE_PAYMENT_METHODS,
  UNPAID_PAYMENT_METHOD,
} from '@/utils/constants';

const col = createColumnHelper<Order>();

/** Map a stored order to the invoice shape. `subtotal` is the gross (Σ qty×rate). */
function orderToInvoice(o: Order): InvoiceData {
  return {
    orderNumber: o.orderNumber,
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    items: o.items.map((it) => ({
      productName: it.productName,
      qty: it.qty,
      unitPrice: it.unitPrice,
      discount: it.discount,
      lineTotal: it.lineTotal,
    })),
    subtotal: o.subtotal + o.discountTotal,
    discountTotal: o.discountTotal,
    taxAmount: o.taxAmount,
    grandTotal: o.grandTotal,
    paymentMethod: o.paymentMethod,
    createdAt: o.createdAt,
    ...(o.paymentMethod === 'cash' && o.receivedCash != null
      ? { receivedCash: o.receivedCash, cashReturned: o.cashReturned ?? 0 }
      : {}),
  };
}

/**
 * The counter/POS screen, shared by two dashboards.
 *
 * - `mode="branch"` (default) — a branch manager sells their own branch's stock.
 *   `branchId` comes from their session claim.
 * - `mode="production"` — the production counter sells out of the **central pool**.
 *   There is no branch to choose: availability is read from Production Stock, the
 *   sale posts to /api/orders/production-sale (which moves the pool and leaves
 *   every branch's stock alone), and the server pins the order to the Production
 *   sentinel branch. This mode also offers the unpaid 'staff' payment method.
 */
export function SalesPage({ mode = 'branch' }: { mode?: 'branch' | 'production' }) {
  const { token, user } = useAuth();
  const { settings } = useSettings();
  const isProduction = mode === 'production';
  const [branch, setBranch] = useState<Branch | null>(null);
  const [sales, setSales] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [invoice, setInvoice] = useState<InvoiceData | null>(null);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [viewOrder, setViewOrder] = useState<Order | null>(null);
  const [stockById, setStockById] = useState<Record<string, number>>({});
  const [stockLoaded, setStockLoaded] = useState(false);
  const [stockError, setStockError] = useState(false);
  // Which business day the records below show. Defaults to the one in progress;
  // this is a *business* date, so a sale rung at 00:30 stays on the previous day
  // rather than jumping to the calendar date the clock says.
  const [date, setDate] = useState(businessDateStr());

  const today = businessDateStr();
  const isToday = date === today;

  const cur = settings?.currencySymbol || 'Rs.';

  // A price change — from this browser or another device — refreshes the product
  // list backing the New Sale form, so the cashier never quotes a stale rate.
  // isActive:true → qk.products(true). Must NOT be the unfiltered key, or inactive
  // products would appear in the POS picker. `?? []` preserves the previous
  // behaviour of rendering an empty combobox rather than crashing on a load failure.
  const productsQ = useProducts(token, { isActive: true });
  const products = productsQ.data ?? [];

  // Only the branch flavour has a branch. Production sales carry no branch the user
  // can see or choose — the server pins them to its own sentinel row.
  const branchId = user?.branchId ?? '';
  const canSell = isProduction || !!branchId;

  // Production availability comes from the central pool, which is what a
  // production sale actually deducts — reading /api/stock here would show branch
  // balances the sale never touches, and the two would disagree on every 409.
  // Keyed without a date so it shares a cache entry with the Production Stock page.
  const poolQ = useProductionStock(token, null, { enabled: isProduction });

  // Current available balance per product (derived stock). Refreshed on open, on a
  // short poll while the form is open, and after every sale — so validation stays live.
  const loadBranchStock = useCallback(() => {
    if (!token) return;
    apiCall<{ rows: StockRow[] }>('/api/stock', {}, token)
      .then((r) => {
        const m: Record<string, number> = {};
        for (const row of r.rows ?? []) m[row.productId] = row.balance;
        setStockById(m);
        setStockLoaded(true);
        setStockError(false);
      })
      .catch(() => {
        // Couldn't verify stock — fall back to server-side enforcement (don't block the UI).
        setStockLoaded(true);
        setStockError(true);
      });
  }, [token]);

  // refetch (not poolQ) is the dependency: React Query keeps it stable, whereas the
  // query object is a new identity every render and would make this callback churn.
  const refetchPool = poolQ.refetch;
  const loadStock = useCallback(() => {
    if (isProduction) void refetchPool();
    else loadBranchStock();
  }, [isProduction, refetchPool, loadBranchStock]);

  // One shape for SaleForm regardless of which ledger backs it.
  const poolStockById = useMemo(() => {
    const m: Record<string, number> = {};
    for (const row of poolQ.data ?? []) m[row.productId] = row.balance;
    return m;
  }, [poolQ.data]);

  const effectiveStock = isProduction
    ? { stockById: poolStockById, stockLoaded: !poolQ.isLoading, stockError: poolQ.isError }
    : { stockById, stockLoaded, stockError };

  // Branch mode only: the branch record supplies the invoice header. Production
  // receipts fall back to the company details in settings, since the sentinel
  // branch is an accounting device rather than a place with an address.
  useEffect(() => {
    if (!token || isProduction || !branchId) return;
    let cancelled = false;
    apiCall<{ branch: Branch }>(`/api/branches/${branchId}`, {}, token)
      .then((r) => { if (!cancelled) setBranch(r.branch); })
      .catch(() => { if (!cancelled) setBranch(null); });
    loadBranchStock();
    return () => { cancelled = true; };
  }, [token, branchId, isProduction, loadBranchStock]);

  function loadSales() {
    if (!token) return;
    setLoading(true);
    // Both ends of the window, not just `from` — a past date must not drag in
    // every sale since. The bounds run 02:00 → next-day 01:59:59.999 Karachi,
    // which is what makes a late-night sale count against the right day.
    const { fromISO, toISO } = businessDayBounds(date);
    const range = `from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`;
    // The production counter has its own list endpoint. The generic one is no use
    // here: it caps production users to active statuses (a delivered sale would
    // 403), and the scoping is a sentinel branch the client never learns.
    const url = isProduction
      ? `/api/orders/production-sales?${range}`
      : `/api/orders?status=delivered&${range}`;
    apiCall<{ orders: Order[] }>(url, {}, token)
      .then((r) => setSales(r.orders ?? []))
      .catch(() => setSales([]))
      .finally(() => setLoading(false));
  }
  useEffect(loadSales, [token, date, isProduction]);

  // Auto-open the browser print dialog when a sale is saved with "Save & Print"
  useEffect(() => {
    if (invoiceOpen) {
      const id = setTimeout(() => window.print(), 350);
      return () => clearTimeout(id);
    }
  }, [invoiceOpen]);

  function handleSaved(inv: InvoiceData, shouldPrint: boolean) {
    setShowForm(false);
    // A new sale always books against the business day in progress, so snap the
    // filter back to it — otherwise the cashier rings up a sale while browsing an
    // older date and the table appears not to have recorded it. Re-read the date
    // rather than using the render-time value: a page left open across 02:00 has
    // a stale one. Changing it reloads via the effect; only reload directly when
    // the view is already on today, or the fetch would fire twice.
    const current = businessDateStr();
    if (date === current) loadSales();
    else setDate(current);
    loadStock(); // reflect the just-deducted balances
    if (shouldPrint) {
      setInvoice(inv);
      setInvoiceOpen(true);
    }
  }

  // Re-open the original invoice for printing. Read-only — no new sale, no stock change.
  function handleReprint(o: Order) {
    setInvoice(orderToInvoice(o));
    setInvoiceOpen(true);
  }

  // Which methods this flavour of the page can produce. Production adds the unpaid
  // 'staff' method; the branch list is unchanged.
  const methods = isProduction ? PRODUCTION_SALE_PAYMENT_METHODS : PAYMENT_METHODS;

  // Daily summary by payment method.
  //
  // `total` is money actually taken, so staff sales are summed separately and left
  // out of it — they moved goods but collected nothing. Same rule the server applies
  // to reports and the daily closing, so the two never disagree.
  const summary = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const m of methods) totals[m] = 0;
    let total = 0;
    let staff = 0;
    for (const s of sales) {
      totals[s.paymentMethod] = (totals[s.paymentMethod] ?? 0) + s.grandTotal;
      if (s.paymentMethod === UNPAID_PAYMENT_METHOD) staff += s.grandTotal;
      else total += s.grandTotal;
    }
    return { totals, total, staff };
  }, [sales, methods]);

  const columns = [
    col.accessor('orderNumber', { header: 'ID', meta: { mobile: 'subtitle' }, cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue()}</span> }),
    col.accessor('createdAt', { header: 'Time', cell: (i) => <span className="text-sm">{i.getValue() ? karachiTimeStr(new Date(i.getValue())) : ''}</span> }),
    col.accessor('customerName', {
      header: 'Customer',
      meta: { mobile: 'title' },
      cell: (i) => (
        <div>
          <p className="font-medium">{i.getValue()}</p>
          {i.row.original.customerPhone && <p className="text-xs text-muted-foreground">{i.row.original.customerPhone}</p>}
        </div>
      ),
    }),
    col.accessor('items', {
      header: 'Products',
      meta: { mobileFull: true },
      cell: (i) => {
        const names = i.getValue().map((it) => it.productName).join(', ');
        return <span className="text-sm">{names.length > 40 ? names.slice(0, 40) + '…' : names}</span>;
      },
    }),
    col.display({ id: 'qty', header: 'Qty', cell: ({ row }) => <span>{row.original.items.reduce((s, it) => s + it.qty, 0)}</span> }),
    // Amount is branch-only. The production counter's rows mix paid and unpaid
    // sales, so a per-row figure invites reading the column as takings; the money
    // lives in the Daily Summary below, which keeps staff out of the total.
    ...(isProduction
      ? []
      : [col.accessor('grandTotal', { header: 'Amount', cell: (i) => <span className="font-semibold">{cur}{i.getValue()?.toLocaleString()}</span> })]),
    col.accessor('paymentMethod', { header: 'Payment', cell: (i) => <span>{PAYMENT_METHOD_LABELS[i.getValue()] ?? i.getValue()}</span> }),
    // Shown on both surfaces. For a production staff sale the comment is unpaid
    // goods' whole audit trail; on a branch row it is the only record of why a
    // sale looks the way it does — leaving either to the View dialog hides it.
    col.accessor('notes', {
      header: 'Comment',
      // Never squeeze a comment into half a card row.
      meta: { mobileFull: true },
      cell: (i) => {
        const text = (i.getValue() ?? '').trim();
        if (!text) return <span className="text-muted-foreground">—</span>;
        const isUnpaidSale = i.row.original.paymentMethod === UNPAID_PAYMENT_METHOD;
        return (
          <span
            // Full text on hover: truncation must never be the only copy.
            title={text}
            className={cn('text-sm', isUnpaidSale ? 'font-medium' : 'text-muted-foreground')}
          >
            {text.length > 40 ? text.slice(0, 40) + '…' : text}
          </span>
        );
      },
    }),
    col.display({
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" className="h-8" title="View" aria-label="View sale" onClick={() => setViewOrder(row.original)}>
          <Eye className="h-4 w-4 mr-1.5" /> View
        </Button>
      ),
    }),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Sales</h2>
          <p className="text-sm text-muted-foreground">
            {isToday ? 'Today’s sales' : `Sales on ${date}`} · {sales.length} recorded
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1 sm:flex-none">
            <label htmlFor="sales-date" className="text-xs font-medium text-muted-foreground">Date</label>
            {/* Capped at the current business day — there are no sales in the future,
                and an accidental typo there would silently show an empty table. */}
            <Input
              id="sales-date"
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value || today)}
              className="h-9 w-full sm:w-40"
            />
          </div>
          {!isToday && (
            <Button variant="outline" className="h-9" onClick={() => setDate(today)}>Today</Button>
          )}
          {/* Mobile takes this as the FAB below instead. */}
          <Button className="hidden h-9 md:inline-flex" disabled={!canSell} onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Sale
          </Button>
        </div>
      </div>

      {/* Daily summary */}
      <Card>
        <CardContent className="p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Daily Summary · {date}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {methods.filter((m) => m !== UNPAID_PAYMENT_METHOD).map((m) => (
              <div key={m} className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">{PAYMENT_METHOD_LABELS[m]}</p>
                <p className="text-lg font-bold">{cur}{summary.totals[m]!.toLocaleString()}</p>
              </div>
            ))}
            <div className="rounded-lg border border-primary/30 bg-primary/10 p-3">
              <p className="text-xs text-primary">Total Sales</p>
              <p className="text-lg font-bold text-primary">{cur}{summary.total.toLocaleString()}</p>
            </div>
            {/* Staff sits outside the payment tiles and after the total, because it is
                not money taken — it is the value of what left the counter unpaid. */}
            {isProduction && (
              <div className="rounded-lg border border-dashed p-3">
                <p className="text-xs text-muted-foreground">Staff (unpaid)</p>
                <p className="text-lg font-bold text-muted-foreground">{cur}{summary.staff.toLocaleString()}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {canSell && (
        <Fab onClick={() => setShowForm(true)} icon={Plus} label="New sale" />
      )}

      <DataTable columns={columns} data={sales} loading={loading} searchPlaceholder="Search sales…" />

      {/* New Sale dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent
          mobile="fullscreen"
          className="flex flex-col gap-0 overflow-hidden p-0 md:w-[95vw] md:max-w-[1100px] md:rounded-2xl lg:w-[90vw] lg:max-w-[1400px]"
        >
          <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12 sm:px-5">
            <DialogTitle>New Sale</DialogTitle>
          </DialogHeader>
          {/* Wraps only the FORM, never the page: the sales list, invoice reprints
              and the dashboard behind it stay readable from anywhere. Being out of
              area stops new transactions, not access to history. */}
          {canSell ? (
            <GeofenceGate action="Sales">
            <SaleForm
              products={products}
              settings={settings}
              // Production sales carry no branch: the server pins them to its own
              // sentinel row and ignores whatever is sent here.
              branchId={branchId}
              stockById={effectiveStock.stockById}
              stockLoaded={effectiveStock.stockLoaded}
              stockError={effectiveStock.stockError}
              onRefreshStock={loadStock}
              onSaved={handleSaved}
              endpoint={isProduction ? '/api/orders/production-sale' : '/api/orders/pos'}
              paymentMethods={methods}
              schema={isProduction ? CreateProductionSaleSchema : undefined}
            />
            </GeofenceGate>
          ) : (
            <p className="px-4 py-4 text-sm text-destructive">No branch assigned to your account.</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Invoice preview / print */}
      <Dialog open={invoiceOpen} onOpenChange={setInvoiceOpen}>
        {/* Full screen on a phone: the receipt is a fixed 384px column, so inside
            a 90dvh sheet the Print button below it falls off the bottom. */}
        <DialogContent mobile="fullscreen" className="md:max-w-md">
          <DialogHeader>
            <DialogTitle className="no-print">Invoice</DialogTitle>
          </DialogHeader>
          {invoice && (
            <>
              {/* On screen only — the printed copy is the portalled one below,
                  because print CSS crops anything laid out inside the dialog. */}
              <div className="no-print">
                <InvoiceView invoice={invoice} settings={settings} branch={branch} />
              </div>
              <PrintPortal>
                <InvoiceView invoice={invoice} settings={settings} branch={branch} />
              </PrintPortal>
            </>
          )}
          <PrintButton className="w-full" />
        </DialogContent>
      </Dialog>

      {/* View sale details */}
      <Dialog open={!!viewOrder} onOpenChange={(o) => !o && setViewOrder(null)}>
        <DialogContent className="md:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Sale {viewOrder?.orderNumber}</DialogTitle>
          </DialogHeader>
          {viewOrder && (
            <div className="space-y-4 text-sm">
              {/* Meta */}
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div><p className="text-xs text-muted-foreground">Invoice #</p><p className="font-mono font-medium">{viewOrder.orderNumber}</p></div>
                <div><p className="text-xs text-muted-foreground">Date &amp; Time</p><p className="font-medium">{karachiDateStr(new Date(viewOrder.createdAt))} · {karachiTimeStr(new Date(viewOrder.createdAt))}</p></div>
                <div><p className="text-xs text-muted-foreground">Customer</p><p className="font-medium">{viewOrder.customerName}</p></div>
                <div><p className="text-xs text-muted-foreground">Mobile</p><p className="font-medium">{viewOrder.customerPhone || '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">Payment Method</p><p className="font-medium">{PAYMENT_METHOD_LABELS[viewOrder.paymentMethod] ?? viewOrder.paymentMethod}</p></div>
                {/* Only when there is one, so a sale without a note looks exactly as
                    it did before. Spans the grid because a comment is free text. */}
                {viewOrder.notes?.trim() && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">Comment</p>
                    <p className="font-medium whitespace-pre-wrap break-words">{viewOrder.notes.trim()}</p>
                  </div>
                )}
              </div>

              {/* Items — five columns cannot hold their shape inside a sheet on a
                  360px screen, so each line becomes its own small block. */}
              <ul className="divide-y rounded-lg border md:hidden">
                {viewOrder.items.map((it, idx) => (
                  <li key={idx} className="space-y-1 p-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="min-w-0 font-medium">{it.productName}</span>
                      <span className="shrink-0 font-semibold tabular-nums">{cur}{it.lineTotal.toLocaleString()}</span>
                    </div>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {it.qty} × {cur}{it.unitPrice.toLocaleString()}
                      {it.discount ? ` · discount -${cur}${it.discount.toLocaleString()}` : ''}
                    </p>
                  </li>
                ))}
              </ul>

              <div className="hidden overflow-x-auto rounded-lg border md:block">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left">
                    <tr>
                      <th className="p-2 font-semibold">Product</th>
                      <th className="p-2 text-center font-semibold">Qty</th>
                      <th className="p-2 text-right font-semibold">Rate</th>
                      <th className="p-2 text-right font-semibold">Discount</th>
                      <th className="p-2 text-right font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {viewOrder.items.map((it, idx) => (
                      <tr key={idx} className="border-t">
                        <td className="p-2">{it.productName}</td>
                        <td className="p-2 text-center tabular-nums">{it.qty}</td>
                        <td className="p-2 text-right tabular-nums">{cur}{it.unitPrice.toLocaleString()}</td>
                        <td className="p-2 text-right tabular-nums">{it.discount ? `-${cur}${it.discount.toLocaleString()}` : '—'}</td>
                        <td className="p-2 text-right font-medium tabular-nums">{cur}{it.lineTotal.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals */}
              <div className="ml-auto w-full max-w-xs space-y-1.5">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="tabular-nums">{cur}{(viewOrder.subtotal + viewOrder.discountTotal).toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="tabular-nums">-{cur}{viewOrder.discountTotal.toLocaleString()}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Government Tax</span><span className="tabular-nums">{cur}{viewOrder.taxAmount.toLocaleString()}</span></div>
                <Separator />
                <div className="flex justify-between font-bold text-base"><span>Grand Total</span><span className="text-primary tabular-nums">{cur}{viewOrder.grandTotal.toLocaleString()}</span></div>
                {viewOrder.paymentMethod === 'cash' && viewOrder.receivedCash != null && (
                  <>
                    <div className="flex justify-between"><span className="text-muted-foreground">Received Cash</span><span className="tabular-nums">{cur}{viewOrder.receivedCash.toLocaleString()}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Cash Returned</span><span className="tabular-nums">{cur}{(viewOrder.cashReturned ?? 0).toLocaleString()}</span></div>
                  </>
                )}
              </div>

              <p className="text-xs text-muted-foreground">Sold by {viewOrder.createdByName} · {viewOrder.branchName}</p>

              <div className="grid grid-cols-2 gap-3">
                <Button variant="outline" onClick={() => setViewOrder(null)}>Close</Button>
                {/* No menu here — the invoice preview this opens carries one. */}
                <PrintButton
                  className="w-full"
                  showMenu={false}
                  printLabel="Print Invoice"
                  saveLabel="Save Invoice PDF"
                  onPrint={() => { const o = viewOrder; setViewOrder(null); handleReprint(o); }}
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
