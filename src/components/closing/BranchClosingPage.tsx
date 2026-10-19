'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { Banknote, Boxes, Receipt, ShoppingCart, TrendingUp } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { useBranchClosing } from '@/lib/queries';
import { useStockRealtime } from '@/hooks/useStockRealtime';
import { businessDateStr, businessDaysAgoStr, computeClosingTotals } from '@mb/shared';
import { StatCard } from '@/components/shared/StatCard';
import { PopPrintButton } from '@/components/print/PopPrintButton';
import { printBranchClosing, type BranchClosingDoc } from '@/lib/print';
import { useCachedLogo } from '@/lib/print/logoCache';
import { Button } from '@/components/ui/button';
import { ClosingExportModal } from './ClosingExportModal';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PAYMENT_METHOD_LABELS, COMPANY_NAME } from '@/utils/constants';
import { formatDate, formatTime } from '@/utils/date';
import { FileSpreadsheet } from 'lucide-react';

/**
 * The shop's end-of-day sheet.
 *
 * This is NOT the business-day closure. That is `/api/business-day/close` — a
 * once-a-day lock that snapshots and freezes the day, runs as Super Admin, and
 * is what the 2 AM scheduler exists to call. Branch Closing is the read a shift
 * hands over on: what sold, what it was paid in, what went out, what is left on
 * the shelf. Nothing here writes anything.
 *
 * Every figure is derived from the day's own records rather than a report
 * endpoint.
 */

// 'staff' takes no money and is excluded from every revenue total (see
// PaymentMethod), so it is not a row in the payment breakdown either.
const PAID_METHODS = ['cash', 'easypaisa', 'foodpanda', 'bank_account'] as const;

// recharts is heavy; keep it out of the closing sheet's initial bundle.
const ClosingStockHistogram = dynamic(
  () => import('./ClosingStockHistogram').then((m) => m.ClosingStockHistogram),
  { ssr: false, loading: () => <Skeleton className="h-48 w-full" /> },
);

export function BranchClosingPage() {
  const { token, user } = useAuth();
  const { settings } = useSettings();
  const [date, setDate] = useState(() => businessDateStr());
  const [exportOpen, setExportOpen] = useState(false);

  const { data, isLoading } = useBranchClosing(token, date);
  // Closing Stock lists only products that moved or hold stock, so a Production
  // approval or an admin correction landing while the sheet is open can add a
  // row or empty one. This refreshes the sheet on those events the same way the
  // Stock page refreshes itself.
  useStockRealtime();
  const cur = settings?.currencySymbol || 'Rs.';
  const money = (n: number) => `${cur}${Math.round(n).toLocaleString()}`;
  const logo = useCachedLogo(settings?.logoUrl);
  const companyName = settings?.companyName?.trim() || COMPANY_NAME;
  const branchName = user?.branchName || 'Branch';

  // The expenses endpoint only serves the last 7 business days. Outside that
  // window the expense figures are absent rather than zero, and saying so beats
  // showing a total that quietly understates the day.
  const expensesOutOfRange = date < businessDaysAgoStr(6);

  const totals = useMemo(() => {
    const orders = data?.orders ?? [];
    const live = orders.filter((o) => o.status !== 'cancelled');
    // 'staff' orders are real records but take no money — counted as orders,
    // never as revenue.
    const paid = live.filter((o) => o.paymentMethod !== 'staff');

    // The money figures come from @mb/shared rather than being summed here, so
    // this screen and the Excel export of the same window cannot disagree about
    // a number that has to reconcile with the drawer. The breakdowns below stay
    // local — they are how this page displays the day, not what it owes.
    const figures = computeClosingTotals(orders, data?.expenses ?? []);

    const byMethod = PAID_METHODS.map((m) => ({
      method: m,
      total: paid.filter((o) => o.paymentMethod === m).reduce((s, o) => s + (o.grandTotal || 0), 0),
      count: paid.filter((o) => o.paymentMethod === m).length,
    })).filter((r) => r.count > 0);

    const byCategory = Object.entries(
      (data?.expenses ?? []).reduce<Record<string, number>>((acc, e) => {
        acc[e.category] = (acc[e.category] ?? 0) + (e.amount || 0);
        return acc;
      }, {}),
    );

    return { ...figures, byMethod, byCategory };
  }, [data]);

  const stock = data?.stock ?? [];

  // Every stock column totalled in one pass. The footer row, the caption above the
  // table and the Stock on Hand card all read from this — three places that must
  // agree, and did not have to when each summed the rows for itself.
  const stockTotals = useMemo(
    () =>
      (data?.stock ?? []).reduce(
        (t, r) => ({
          opening: t.opening + (r.opening || 0),
          newQty: t.newQty + (r.newQty || 0),
          sold: t.sold + (r.sold || 0),
          returned: t.returned + (r.returned || 0),
          balance: t.balance + (r.balance || 0),
        }),
        { opening: 0, newQty: 0, sold: 0, returned: 0, balance: 0 },
      ),
    [data],
  );

  // The receipt's own Balance Stock section — positive balance only. A missing
  // or non-numeric balance is treated as zero rather than printed as stock that
  // is not really there. Filtered here, not on the screen table above: a
  // product sitting at zero is still useful to see on screen (it says what ran
  // out), just not worth handing over on the printed sheet.
  const printableStock = useMemo(
    () =>
      (data?.stock ?? [])
        .filter((r) => Number.isFinite(Number(r.balance)) && Number(r.balance) > 0)
        .map((r) => ({ productName: r.productName, balance: Number(r.balance) })),
    [data],
  );

  const closingDoc: BranchClosingDoc = useMemo(() => {
    const now = new Date();
    return {
      branchName,
      businessDateText: formatDate(date),
      printDateText: formatDate(now),
      printTimeText: formatTime(now),
      companyName,
      currencySymbol: cur,
      stockLines: printableStock,
      paymentLines: totals.byMethod.map((r) => ({
        label: PAYMENT_METHOD_LABELS[r.method] ?? r.method,
        amount: r.total,
      })),
      totalSales: totals.sales,
      discounts: totals.discounts,
      totalExpenses: totals.expenses,
      cashInHand: totals.cashInHand,
      orderCount: totals.orderCount,
      cancelled: totals.cancelled,
      logo,
    };
  }, [branchName, date, companyName, cur, printableStock, totals, logo]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{branchName} — Closing</h2>
          <p className="text-sm text-muted-foreground">
            End-of-day summary. This is a read of the day, not a lock on it.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Business date</Label>
            <Input
              type="date"
              value={date}
              max={businessDateStr()}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="h-9 w-40"
            />
          </div>
          {/* Beside Print, because both answer "get this off the screen" — one
              for the folder on the wall, one for a spreadsheet. Print is the
              single day on show; this one takes a window. */}
          <Button variant="outline" size="sm" className="h-9" onClick={() => setExportOpen(true)}>
            <FileSpreadsheet className="mr-1.5 h-4 w-4" /> Export Excel
          </Button>
          {/* POP Print sends the canonical Branch Closing receipt — Balance
              Stock (positive balance only) plus the full Payment Details — to
              the printer this computer has installed, on its own 80mm/58mm
              roll. Not `PrintButton`/`window.print()`: this is a till receipt,
              not an A4 report. */}
          <PopPrintButton
            label="Print"
            size="sm"
            disabled={isLoading}
            print={(hooks) => printBranchClosing(closingDoc, { paper: hooks.paper, onJobUpdate: hooks.onJobUpdate })}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard title="Sales" value={isLoading ? '…' : money(totals.sales)} icon={ShoppingCart} color="green" loading={isLoading} />
        <StatCard title="Expenses" value={isLoading ? '…' : money(totals.expenses)} icon={Receipt} color="red" loading={isLoading} />
        <StatCard title="Net" value={isLoading ? '…' : money(totals.net)} icon={TrendingUp} color="orange" loading={isLoading} />
        <StatCard title="Cash in Hand" value={isLoading ? '…' : money(totals.cashInHand)} icon={Banknote} color="brown" loading={isLoading} />
        <StatCard title="Stock on Hand" value={isLoading ? '…' : stockTotals.balance.toLocaleString()} icon={Boxes} color="blue" loading={isLoading} />
      </div>

      {expensesOutOfRange && (
        <Card className="border-dashed">
          <CardContent className="p-4 text-sm text-muted-foreground">
            Shop expenses are only available for the last 7 business days, so the expense,
            net and cash figures above cover sales only for this date.
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Takings by Payment Method</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {totals.byMethod.length === 0 && (
              <p className="text-sm text-muted-foreground">No sales recorded for this date.</p>
            )}
            {totals.byMethod.map((r) => (
              <div key={r.method} className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0">
                <div>
                  <p className="text-sm font-medium">{PAYMENT_METHOD_LABELS[r.method] ?? r.method}</p>
                  <p className="text-xs text-muted-foreground">{r.count} order{r.count === 1 ? '' : 's'}</p>
                </div>
                <p className="font-semibold">{money(r.total)}</p>
              </div>
            ))}
            <div className="flex items-center justify-between pt-2 text-sm">
              <span className="text-muted-foreground">Orders / cancelled</span>
              <span className="font-medium">{totals.orderCount} / {totals.cancelled}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Discounts given</span>
              <span className="font-medium">{money(totals.discounts)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Shop Expenses</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {totals.byCategory.length === 0 && (
              <p className="text-sm text-muted-foreground">No expenses recorded for this date.</p>
            )}
            {totals.byCategory.map(([category, amount]) => (
              <div key={category} className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0">
                <p className="text-sm font-medium">{category}</p>
                <p className="font-semibold">{money(amount)}</p>
              </div>
            ))}
            <div className="flex items-center justify-between pt-2 text-sm">
              <span className="text-muted-foreground">Paid from the till (cash)</span>
              <span className="font-medium">{money(totals.cashExpenses)}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Closing Stock</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-muted-foreground">
            {stockTotals.sold.toLocaleString()} units sold · {stockTotals.returned.toLocaleString()} returned to production ·{' '}
            {stockTotals.balance.toLocaleString()} left on the shelf
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr data-table-head className="border-b text-left text-xs">
                  <th className="py-2 pr-3 font-medium">Product</th>
                  <th className="py-2 px-3 text-right font-medium">Opening</th>
                  <th className="py-2 px-3 text-right font-medium">Received</th>
                  <th className="py-2 px-3 text-right font-medium">Sold</th>
                  <th className="py-2 px-3 text-right font-medium">Returned</th>
                  <th className="py-2 pl-3 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody>
                {isLoading && (
                  <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">Loading…</td></tr>
                )}
                {/* The API returns only products with a non-zero Opening,
                    Received, Sold, Returned or Balance, so an empty list means
                    nothing moved and nothing is on the shelf — not that stock
                    was never set up. */}
                {!isLoading && stock.length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No stock activity for this business day.</td></tr>
                )}
                {stock.map((r) => (
                  <tr key={r.productId} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{r.productName}</td>
                    <td className="py-2 px-3 text-right">{r.opening}</td>
                    <td className="py-2 px-3 text-right">{r.newQty}</td>
                    <td className="py-2 px-3 text-right">{r.sold}</td>
                    <td className="py-2 px-3 text-right">{r.returned}</td>
                    <td className="py-2 pl-3 text-right font-semibold">{r.balance}</td>
                  </tr>
                ))}
              </tbody>
              {/* Only when there are rows to total. A Total line under "No stock
                  activity for this business day" would be five zeroes dressed up
                  as a finding. */}
              {!isLoading && stock.length > 0 && (
                <tfoot>
                  <tr data-table-foot className="border-t-2 font-semibold">
                    <td className="py-2 pr-3">
                      Total
                      <span className="ml-1 font-normal text-xs text-muted-foreground">
                        ({stock.length} product{stock.length === 1 ? '' : 's'})
                      </span>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">{stockTotals.opening.toLocaleString()}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{stockTotals.newQty.toLocaleString()}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{stockTotals.sold.toLocaleString()}</td>
                    <td className="py-2 px-3 text-right tabular-nums">{stockTotals.returned.toLocaleString()}</td>
                    <td className="py-2 pl-3 text-right tabular-nums">{stockTotals.balance.toLocaleString()}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>

      {/* The same `stock` rows and `stockTotals` the table above just showed —
          the graph is the table drawn, not a second read of the day. */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Closing Stock Histogram</CardTitle>
        </CardHeader>
        <CardContent>
          <ClosingStockHistogram rows={stock} totals={stockTotals} loading={isLoading} />
        </CardContent>
      </Card>

      {/* Seeded with the day on screen, so "export this day" is one click and a
          wider window is a deliberate widening rather than a default. */}
      <ClosingExportModal
        open={exportOpen}
        onOpenChange={setExportOpen}
        token={token}
        defaultDate={date}
      />
    </div>
  );
}
