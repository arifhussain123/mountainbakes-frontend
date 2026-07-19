'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import dynamic from 'next/dynamic';
import { StatCard } from '@/components/shared/StatCard';
import { ShoppingCart, DollarSign, TrendingDown, TrendingUp, BarChart3, Receipt, Printer } from 'lucide-react';
import type { ReportSummary } from '@mb/shared';
import { toast } from 'sonner';
import { PAYMENT_METHOD_LABELS } from '@/utils/constants';

const PERIODS = [
  { value: 'daily', label: 'Today' },
  { value: 'weekly', label: 'This Week' },
  { value: 'monthly', label: 'This Month' },
  { value: 'yearly', label: 'This Year' },
];

// Charts pull in recharts; load lazily on the client to keep the initial bundle lean.
const SalesChart = dynamic(() => import('@/components/dashboard/SalesChart').then((m) => m.SalesChart), { ssr: false });
const BranchComparisonChart = dynamic(() => import('@/components/dashboard/BranchComparisonChart').then((m) => m.BranchComparisonChart), { ssr: false });
const TopProductsChart = dynamic(() => import('@/components/dashboard/TopProductsChart').then((m) => m.TopProductsChart), { ssr: false });

export function ReportsPage() {
  const { token, user } = useAuth();
  const [period, setPeriod] = useState('monthly');
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    const branchParam = user?.role === 'branch_manager' && user.branchId ? `&branchId=${user.branchId}` : '';
    apiCall<ReportSummary>(`/api/reports/summary?period=${period}${branchParam}`, {}, token)
      .then((r) => { setSummary(r); setLoading(false); })
      .catch(console.error);
  }, [token, period, user?.branchId, user?.role]);

  async function handleExport(type: 'pdf' | 'excel' | 'csv') {
    try {
      const blob = await apiCall<Blob>(`/api/reports/export?type=${type}&period=${period}`, {}, token);
      const ext = type === 'excel' ? 'xlsx' : type;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mountain-bakes-report-${period}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${type.toUpperCase()} exported`);
    } catch {
      toast.error('Export failed');
    }
  }

  return (
    <div className="space-y-6 print-area">
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Reports &amp; Analytics</h2>
          <p className="text-sm text-muted-foreground">
            {summary ? `${summary.from?.slice(0, 10)} – ${summary.to?.slice(0, 10)}` : 'Loading…'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap no-print">
          <Select value={period} onValueChange={(v) => { if (v) { setLoading(true); setPeriod(v); } }}>
            <SelectTrigger className="w-36 h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {PERIODS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" className="h-9" onClick={() => handleExport('pdf')}>PDF</Button>
          <Button variant="outline" size="sm" className="h-9" onClick={() => handleExport('excel')}>Excel</Button>
          <Button variant="outline" size="sm" className="h-9" onClick={() => handleExport('csv')}>CSV</Button>
          <Button variant="outline" size="sm" className="h-9" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5 mr-1.5" /> Print
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          title="Total Orders"
          value={loading ? 'â€¦' : (summary?.totalOrders ?? 0).toLocaleString()}
          icon={ShoppingCart}
          color="orange"
          loading={loading}
        />
        <StatCard
          title="Revenue"
          value={loading ? 'â€¦' : `Rs.${(summary?.totalRevenue ?? 0).toLocaleString()}`}
          icon={DollarSign}
          color="green"
          loading={loading}
        />
        <StatCard
          title="Avg. Order Value"
          value={loading ? 'â€¦' : `Rs.${Math.round(summary?.averageOrderValue ?? 0).toLocaleString()}`}
          icon={BarChart3}
          color="brown"
          loading={loading}
        />
        <StatCard
          title="Cancelled"
          value={loading ? '…' : (summary?.totalCancelled ?? 0).toString()}
          icon={TrendingDown}
          color="red"
          loading={loading}
        />
      </div>

      {/* Expenses, profit & payment mix */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title="Expenses"
          value={loading ? '…' : `Rs.${(summary?.totalExpenses ?? 0).toLocaleString()}`}
          icon={Receipt}
          color="red"
          loading={loading}
        />
        <StatCard
          title="Profit (Sales − Expenses)"
          value={loading ? '…' : `Rs.${(summary?.totalProfit ?? 0).toLocaleString()}`}
          icon={TrendingUp}
          color="green"
          loading={loading}
        />
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Payment Methods</CardTitle></CardHeader>
          <CardContent className="space-y-1.5 text-sm">
            {(summary?.paymentMethodBreakdown ?? []).length === 0 ? (
              <p className="text-muted-foreground">No sales in this period</p>
            ) : (
              (summary?.paymentMethodBreakdown ?? []).map((pm) => (
                <div key={pm.method} className="flex justify-between">
                  <span className="text-muted-foreground">{PAYMENT_METHOD_LABELS[pm.method] ?? pm.method} ({pm.count})</span>
                  <span className="font-semibold">Rs.{pm.total.toLocaleString()}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <Tabs defaultValue="sales">
        <TabsList>
          <TabsTrigger value="sales">Sales Trend</TabsTrigger>
          {user?.role === 'super_admin' && <TabsTrigger value="branches">Branch Comparison</TabsTrigger>}
          <TabsTrigger value="products">Top Products</TabsTrigger>
        </TabsList>

        <TabsContent value="sales" className="mt-4">
          <SalesChart data={summary?.dailyData ?? []} loading={loading} />
        </TabsContent>

        {user?.role === 'super_admin' && (
          <TabsContent value="branches" className="mt-4">
            <BranchComparisonChart data={summary?.branchData ?? []} loading={loading} />
          </TabsContent>
        )}

        <TabsContent value="products" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <TopProductsChart data={summary?.topProducts ?? []} loading={loading} />
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-base">Top 10 Products</CardTitle></CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground">#</th>
                      <th className="text-left px-4 py-2 text-xs font-semibold text-muted-foreground">Product</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-muted-foreground">Qty</th>
                      <th className="text-right px-4 py-2 text-xs font-semibold text-muted-foreground">Revenue</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {(summary?.topProducts ?? []).slice(0, 10).map((p, i) => (
                      <tr key={p.productId} className="hover:bg-muted/30">
                        <td className="px-4 py-2.5 text-muted-foreground">{i + 1}</td>
                        <td className="px-4 py-2.5">
                          <p className="font-medium">{p.productName}</p>
                          <p className="text-xs text-muted-foreground">{p.categoryName}</p>
                        </td>
                        <td className="px-4 py-2.5 text-right">{p.totalQty}</td>
                        <td className="px-4 py-2.5 text-right font-semibold">Rs.{p.totalRevenue.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
