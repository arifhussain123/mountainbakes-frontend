'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { apiCall } from '@/utils/api';
import { useProducts } from '@/lib/queries';import {
  type Order,
  type Branch,
  type StockRow,
  businessDayBounds,
  karachiDateStr,
  karachiTimeStr,
} from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { DataTable } from '@/components/shared/DataTable';
import { SaleForm } from './SaleForm';
import { InvoiceView, type InvoiceData } from './InvoiceView';
import { Eye, Plus, Printer } from 'lucide-react';
import { createColumnHelper } from '@tanstack/react-table';
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from '@/utils/constants';

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

export function SalesPage() {
  const { token, user } = useAuth();
  const { settings } = useSettings();
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

  const cur = settings?.currencySymbol || 'Rs.';

  // A price change — from this browser or another device — refreshes the product
  // list backing the New Sale form, so the cashier never quotes a stale rate.
  // isActive:true → qk.products(true). Must NOT be the unfiltered key, or inactive
  // products would appear in the POS picker. `?? []` preserves the previous
  // behaviour of rendering an empty combobox rather than crashing on a load failure.
  const productsQ = useProducts(token, { isActive: true });
  const products = productsQ.data ?? [];

  // Current available balance per product (derived stock). Refreshed on open, on a
  // short poll while the form is open, and after every sale — so validation stays live.
  const loadStock = useCallback(() => {
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

  useEffect(() => {
    if (!token) return;
    if (user?.branchId) {
      apiCall<{ branch: Branch }>(`/api/branches/${user.branchId}`, {}, token)
        .then((r) => setBranch(r.branch))
        .catch(() => setBranch(null));
    }
    loadStock();
  }, [token, user?.branchId, loadStock]);

  function loadSales() {
    if (!token) return;
    setLoading(true);
    const from = businessDayBounds().fromISO;
    apiCall<{ orders: Order[] }>(`/api/orders?status=delivered&from=${encodeURIComponent(from)}`, {}, token)
      .then((r) => setSales(r.orders ?? []))
      .catch(() => setSales([]))
      .finally(() => setLoading(false));
  }
  useEffect(loadSales, [token]);

  // Auto-open the browser print dialog when a sale is saved with "Save & Print"
  useEffect(() => {
    if (invoiceOpen) {
      const id = setTimeout(() => window.print(), 350);
      return () => clearTimeout(id);
    }
  }, [invoiceOpen]);

  function handleSaved(inv: InvoiceData, shouldPrint: boolean) {
    setShowForm(false);
    loadSales();
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

  // Daily summary by payment method
  const summary = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const m of PAYMENT_METHODS) totals[m] = 0;
    let total = 0;
    for (const s of sales) {
      totals[s.paymentMethod] = (totals[s.paymentMethod] ?? 0) + s.grandTotal;
      total += s.grandTotal;
    }
    return { totals, total };
  }, [sales]);

  const columns = [
    col.accessor('createdAt', { header: 'Time', cell: (i) => <span className="text-sm">{i.getValue() ? karachiTimeStr(new Date(i.getValue())) : ''}</span> }),
    col.accessor('customerName', {
      header: 'Customer',
      cell: (i) => (
        <div>
          <p className="font-medium">{i.getValue()}</p>
          {i.row.original.customerPhone && <p className="text-xs text-muted-foreground">{i.row.original.customerPhone}</p>}
        </div>
      ),
    }),
    col.accessor('items', {
      header: 'Products',
      cell: (i) => {
        const names = i.getValue().map((it) => it.productName).join(', ');
        return <span className="text-sm">{names.length > 40 ? names.slice(0, 40) + '…' : names}</span>;
      },
    }),
    col.display({ id: 'qty', header: 'Qty', cell: ({ row }) => <span>{row.original.items.reduce((s, it) => s + it.qty, 0)}</span> }),
    col.accessor('grandTotal', { header: 'Amount', cell: (i) => <span className="font-semibold">{cur}{i.getValue()?.toLocaleString()}</span> }),
    col.accessor('paymentMethod', { header: 'Payment', cell: (i) => <span>{PAYMENT_METHOD_LABELS[i.getValue()] ?? i.getValue()}</span> }),
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Sales</h2>
          <p className="text-sm text-muted-foreground">Today&rsquo;s sales · {sales.length} recorded</p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4 mr-1" /> New Sale
        </Button>
      </div>

      <DataTable columns={columns} data={sales} loading={loading} searchPlaceholder="Search sales…" />

      {/* Daily summary */}
      <Card>
        <CardContent className="p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Daily Summary</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {PAYMENT_METHODS.map((m) => (
              <div key={m} className="rounded-lg border bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">{PAYMENT_METHOD_LABELS[m]}</p>
                <p className="text-lg font-bold">{cur}{summary.totals[m]!.toLocaleString()}</p>
              </div>
            ))}
            <div className="rounded-lg border border-primary/30 bg-primary/10 p-3">
              <p className="text-xs text-primary">Total Sales</p>
              <p className="text-lg font-bold text-primary">{cur}{summary.total.toLocaleString()}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* New Sale dialog */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="flex h-full w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 top-0 left-0 sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[90vh] sm:w-[95vw] sm:max-w-[1100px] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl lg:w-[90vw] lg:max-w-[1400px]">
          <DialogHeader className="shrink-0 border-b px-4 py-3 pr-12 sm:px-5">
            <DialogTitle>New Sale</DialogTitle>
          </DialogHeader>
          {user?.branchId ? (
            <SaleForm
              products={products}
              settings={settings}
              branchId={user.branchId}
              stockById={stockById}
              stockLoaded={stockLoaded}
              stockError={stockError}
              onRefreshStock={loadStock}
              onSaved={handleSaved}
            />
          ) : (
            <p className="px-4 py-4 text-sm text-destructive">No branch assigned to your account.</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Invoice preview / print */}
      <Dialog open={invoiceOpen} onOpenChange={setInvoiceOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="no-print">Invoice</DialogTitle>
          </DialogHeader>
          {invoice && <InvoiceView invoice={invoice} settings={settings} branch={branch} />}
          <Button className="no-print w-full" onClick={() => window.print()}>
            <Printer className="h-4 w-4 mr-1.5" /> Print
          </Button>
        </DialogContent>
      </Dialog>

      {/* View sale details */}
      <Dialog open={!!viewOrder} onOpenChange={(o) => !o && setViewOrder(null)}>
        <DialogContent className="w-[95vw] max-w-2xl max-h-[90vh] overflow-y-auto">
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
              </div>

              {/* Items */}
              <div className="overflow-x-auto rounded-lg border">
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
                <Button onClick={() => { const o = viewOrder; setViewOrder(null); handleReprint(o); }}>
                  <Printer className="h-4 w-4 mr-1.5" /> Print Invoice
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
