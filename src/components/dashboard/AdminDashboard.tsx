'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { StatCard } from '@/components/shared/StatCard';
import dynamic from 'next/dynamic';
import { RecentOrdersTable } from './RecentOrdersTable';
import { ShoppingCart, Clock, DollarSign, Package } from 'lucide-react';
import type { ReportSummary } from '@mb/shared';
import { LoginHistoryCard } from '@/components/dashboard/LoginHistoryCard';

// Charts pull in recharts; load them lazily on the client so the dashboard's
// initial bundle doesn't include the charting library.
const SalesChart = dynamic(() => import('./SalesChart').then((m) => m.SalesChart), { ssr: false });
const BranchComparisonChart = dynamic(() => import('./BranchComparisonChart').then((m) => m.BranchComparisonChart), { ssr: false });
const TopProductsChart = dynamic(() => import('./TopProductsChart').then((m) => m.TopProductsChart), { ssr: false });

export function AdminDashboard() {
  const { token } = useAuth();
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    apiCall<ReportSummary>('/api/reports/summary?period=monthly', {}, token)
      .then(setSummary)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <div className="space-y-6">
      {/* Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="Total Orders"
          value={loading ? 'â€¦' : (summary?.totalOrders ?? 0).toLocaleString()}
          icon={ShoppingCart}
          color="orange"
          loading={loading}
        />
        <StatCard
          title="Monthly Revenue"
          value={loading ? 'â€¦' : `Rs.${(summary?.totalRevenue ?? 0).toLocaleString()}`}
          icon={DollarSign}
          color="green"
          loading={loading}
        />
        <StatCard
          title="Pending Orders"
          value={loading ? 'â€¦' : (summary?.totalPending ?? 0).toString()}
          icon={Clock}
          color="blue"
          loading={loading}
        />
        <StatCard
          title="Cancelled"
          value={loading ? 'â€¦' : (summary?.totalCancelled ?? 0).toString()}
          icon={Package}
          color="red"
          loading={loading}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <SalesChart data={summary?.dailyData ?? []} loading={loading} />
        </div>
        <div>
          <TopProductsChart data={summary?.topProducts ?? []} loading={loading} />
        </div>
      </div>

      {/* Branch comparison */}
      <BranchComparisonChart data={summary?.branchData ?? []} loading={loading} />

      {/* Recent orders */}
      <RecentOrdersTable />

      {/* Login History. On every dashboard, but not showing the same thing on
          each: the API gives a super admin every account's sessions and pins
          every other role to its own. Last, because it is a record to consult
          rather than something to act on. */}
      <LoginHistoryCard />
    </div>
  );
}
