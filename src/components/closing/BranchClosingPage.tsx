'use client';

import { useMemo, useState } from 'react';
import { Banknote, Boxes, Receipt, ShoppingCart, TrendingUp } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { useBranchClosing } from '@/lib/queries';
import { businessDateStr, businessDaysAgoStr } from '@mb/shared';
import { StatCard } from '@/components/shared/StatCard';
import { PrintButton } from '@/components/shared/PrintButton';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PAYMENT_METHOD_LABELS } from '@/utils/constants';

/**
 * The shop's end-of-day sheet.
 *
 * This is NOT the business-day closure. That is `/api/business-day/close` — a
 * once-a-day lock that snapshots and freezes the day, runs as Super Admin, and
 * is what the 2 AM scheduler exists to call. Branch Closing is the read a shift
 * hands over on: what sold, what it was paid in, what went out, what is left on
 * the shelf. Nothing here writes anything, which is why a shift account can open
 * it at all.
 *
 * Every figure is derived from the day's own records rather than a report
 * endpoint, because /api/reports/summary is manager-and-above and a branch_user
 * would get a 403 from it.
 */

// 'staff' takes no money and is excluded from every revenue total (see
// PaymentMethod), so it is not a row in the payment breakdown either.
const PAID_METHODS = ['cash', 'easypaisa', 'foodpanda', 'bank_account'] as const;

export function BranchClosingPage() {
  const { token, user } = useAuth();
  const { settings } = useSettings();
  const [date, setDate] = useState(() => businessDateStr());

  const { data, isLoading } = useBranchClosing(token, date);
  const cur = settings?.currencySymbol || 'Rs.';
  const money = (n: number) => `${cur}${Math.round(n).toLocaleString()}`;

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

    const sales = paid.reduce((s, o) => s + (o.grandTotal || 0), 0);
    const discounts = live.reduce((s, o) => s + (o.discountTotal || 0), 0);
    const expenses = (data?.expenses ?? []).reduce((s, e) => s + (e.amount || 0), 0);

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
    ).sort((a, b) => b[1] - a[1]);

    // Cash in the drawer: cash taken in, less what was paid out of it. Card and
    // wallet takings never touch the till, so they are not in this number.
    const cashSales = paid
      .filter((o) => o.paymentMethod === 'cash')
      .reduce((s, o) => s + (o.grandTotal || 0), 0);
    const cashExpenses = (data?.expenses ?? [])
      .filter((e) => e.paymentMethod === 'cash')
      .reduce((s, e) => s + (e.amount || 0), 0);

    return {
      sales,
      discounts,
      expenses,
      net: sales - expenses,
      orderCount: live.length,
      cancelled: orders.length - live.length,
      byMethod,
      byCategory,
      cashSales,
      cashExpenses,
      cashInHand: cashSales - cashExpenses,
    };
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{user?.branchName || 'Branch'} — Closing</h2>
          <p className="text-sm text-muted-foreground">
            End-of-day summary. This is a read of the day, not a lock on it.
          </p>
        </div>
        <div className="flex items-end gap-2">
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
          <PrintButton onPrint={() => window.print()} printLabel="Print" saveLabel="Save PDF" size="sm" />
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
                {!isLoading && stock.length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">No stock rows for this date.</td></tr>
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
                  rows for this date" would be five zeroes dressed up as a
                  finding. In <tfoot>, so a printed sheet that runs to a second
                  page repeats it — this page has a Print button and the sheet is
                  what a shift hands over on. */}
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
    </div>
  );
}
