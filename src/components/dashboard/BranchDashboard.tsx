'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { useReportSummary } from '@/lib/queries';
import { StatCard } from '@/components/shared/StatCard';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import dynamic from 'next/dynamic';
import { RecentOrdersTable } from './RecentOrdersTable';
import { GeofenceStatusCard } from '@/components/geofence/GeofenceStatusCard';
import { ShoppingCart, DollarSign, Receipt, TrendingUp } from 'lucide-react';

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
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Sales" value={loading ? '…' : money(summary?.totalRevenue ?? 0)} icon={DollarSign} color="green" loading={loading} />
        <StatCard title="Expenses" value={loading ? '…' : money(summary?.totalExpenses ?? 0)} icon={Receipt} color="red" loading={loading} />
        <StatCard title="Net Amount" value={loading ? '…' : money(summary?.totalProfit ?? 0)} icon={TrendingUp} color="orange" loading={loading} />
        <StatCard title="Orders" value={loading ? '…' : (summary?.totalOrders ?? 0).toLocaleString()} icon={ShoppingCart} color="blue" loading={loading} />
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
