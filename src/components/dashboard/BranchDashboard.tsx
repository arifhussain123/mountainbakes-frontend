'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { useReportSummary } from '@/lib/queries';
import { businessDateStr } from '@mb/shared';
import { StatCard } from '@/components/shared/StatCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import dynamic from 'next/dynamic';
import { RecentOrdersTable } from './RecentOrdersTable';
import { BranchStockHistoryCard } from './BranchStockHistoryCard';
import { BranchDailyStockCard } from './BranchDailyStockCard';
import { GeofenceStatusCard } from '@/components/geofence/GeofenceStatusCard';
import { ShoppingCart, DollarSign, Receipt, TrendingUp, Percent } from 'lucide-react';

const PERIODS = [
  { value: 'daily', label: 'Today', budgetKey: 'daily' as const },
  { value: 'weekly', label: 'This Week', budgetKey: 'weekly' as const },
  { value: 'monthly', label: 'This Month', budgetKey: 'monthly' as const },
  { value: 'yearly', label: 'This Year', budgetKey: null },
];

// Charts pull in recharts; load lazily on the client to keep the initial bundle lean.
const SalesChart = dynamic(() => import('./SalesChart').then((m) => m.SalesChart), { ssr: false });
const SalesVsExpensesChart = dynamic(() => import('./SalesVsExpensesChart').then((m) => m.SalesVsExpensesChart), { ssr: false });
const TopProductsChart = dynamic(() => import('./TopProductsChart').then((m) => m.TopProductsChart), { ssr: false });

export function BranchDashboard() {
  const { token, user } = useAuth();
  const { settings } = useSettings();
  const [period, setPeriod] = useState('daily');
  // Its own state, not derived from `period`. The period select drives money
  // figures for one window; the stock card is a day-by-day ledger and a branch
  // manager reading it wants to change its depth without also reframing every
  // stat above it.
  const [stockDays, setStockDays] = useState(7);
  // The day the Stock Detail statement is showing. Owned here rather than inside
  // the card so it survives a re-render of the dashboard and can later drive
  // anything else that wants the same day.
  const [stockDate, setStockDate] = useState(businessDateStr());

  const cur = settings?.currencySymbol || 'Rs.';

  // Server state via TanStack Query — cached (60s) & deduped, so switching periods
  // back and forth or revisiting the dashboard is instant with no refetch.
  const summaryQ = useReportSummary(token, period, user?.branchId ?? null);
  const summary = summaryQ.data ?? null;
  const loading = !token || summaryQ.isLoading;

  const periodMeta = PERIODS.find((p) => p.value === period);
  const budgetForPeriod = periodMeta?.budgetKey && summary?.budget ? summary.budget[periodMeta.budgetKey] : 0;
  const actual = summary?.totalRevenue ?? 0;
  const budgetPct = budgetForPeriod > 0 ? Math.min(100, Math.round((actual / budgetForPeriod) * 100)) : 0;

  const completed = summary ? Math.max(0, summary.totalOrders - summary.totalPending - summary.totalCancelled) : 0;
  const money = (n: number) => `${cur}${Math.round(n).toLocaleString()}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{user?.branchName || 'Branch Dashboard'}</h2>
          <p className="text-sm text-muted-foreground">{periodMeta?.label} overview</p>
        </div>
        <Select value={period} onValueChange={(v) => v && setPeriod(v)}>
          <SelectTrigger className="w-40 h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Renders nothing unless geofencing applies to this user, so the dashboard
          is unchanged for everyone else. */}
      <GeofenceStatusCard />

      {/* Primary stats */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard title="Sales" value={loading ? '…' : money(summary?.totalRevenue ?? 0)} icon={DollarSign} color="green" loading={loading} />
        <StatCard title="Expenses" value={loading ? '…' : money(summary?.totalExpenses ?? 0)} icon={Receipt} color="red" loading={loading} />
        <StatCard title="Net Amount" value={loading ? '…' : money(summary?.totalProfit ?? 0)} icon={TrendingUp} color="orange" loading={loading} />
        <StatCard title="Orders" value={loading ? '…' : (summary?.totalOrders ?? 0).toLocaleString()} icon={ShoppingCart} color="blue" loading={loading} />
        {/* Discount already deducted from Sales — shown so a branch can see what it
            gave away, without it being double-counted anywhere. */}
        <StatCard title="Discounts" value={loading ? '…' : money(summary?.totalDiscount ?? 0)} icon={Percent} color="brown" loading={loading} />
      </div>

      {/* Budget vs actual + Orders breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2"><CardTitle className="text-base">Budget vs Actual ({periodMeta?.label})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {budgetForPeriod > 0 ? (
              <>
                <div className="flex items-end justify-between">
                  <div>
                    <p className="text-2xl font-bold">{money(actual)}</p>
                    <p className="text-xs text-muted-foreground">of {money(budgetForPeriod)} budget</p>
                  </div>
                  <span className={`text-sm font-semibold ${budgetPct >= 100 ? 'text-emerald-600' : 'text-primary'}`}>{budgetPct}%</span>
                </div>
                <Progress value={budgetPct} />
              </>
            ) : (
              <p className="text-sm text-muted-foreground py-4">No budget set for this period. Ask Admin to configure branch budgets.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Orders</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Total</span><span className="font-semibold">{summary?.totalOrders ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Pending</span><span className="font-semibold">{summary?.totalPending ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Completed</span><span className="font-semibold">{completed}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Cancelled</span><span className="font-semibold">{summary?.totalCancelled ?? 0}</span></div>
          </CardContent>
        </Card>
      </div>

      {/* Stock, two ways, side by side: the ledger day by day, and one day of it
          opened out line by line. Both read the same movements, so a figure
          picked out of the history on the left can be understood from the
          statement on the right without leaving the screen.

          Paired only at `xl`. Each card holds a table that is already near its
          natural width at full span — the history card alone carries six figure
          groups — so splitting them 50/50 any earlier would leave both scrolling
          sideways on an ordinary laptop. Below `xl` they stack full width and
          behave exactly as they did apart. */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <BranchStockHistoryCard days={stockDays} onDaysChange={setStockDays} branchId={user?.branchId ?? null} />
        <BranchDailyStockCard date={stockDate} onDateChange={setStockDate} branchId={user?.branchId ?? null} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2"><SalesChart data={summary?.dailyData ?? []} loading={loading} /></div>
        <div><TopProductsChart data={summary?.topProducts ?? []} loading={loading} /></div>
      </div>

      <SalesVsExpensesChart data={summary?.dailyData ?? []} loading={loading} />

      <RecentOrdersTable branchId={user?.branchId ?? undefined} />
    </div>
  );
}
