'use client';

import { useMemo } from 'react';
import { parseISO, startOfWeek, format } from 'date-fns';
import { useAuth } from '@/hooks/useAuth';
import { useProductionOverview } from '@/lib/queries';
import { useProductionRealtime } from '@/hooks/useProductionRealtime';
import { StatCard } from '@/components/shared/StatCard';
import dynamic from 'next/dynamic';
import {
  Clock, CheckCircle2, Truck, Undo2, RefreshCw, CalendarDays,
  CalendarRange, TrendingUp, Store, Package, BarChart3, Boxes,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type CardColor = 'orange' | 'brown' | 'green' | 'blue' | 'red';

function safeDay(date: string) {
  try { return format(parseISO(date), 'MMM d'); } catch { return date; }
}

// Charts pull in recharts; load lazily on the client to keep the initial bundle lean.
const DemandLineChart = dynamic(() => import('./ProductionCharts').then((m) => m.DemandLineChart), { ssr: false });
const DemandBarChart = dynamic(() => import('./ProductionCharts').then((m) => m.DemandBarChart), { ssr: false });
const BranchDemandChart = dynamic(() => import('./ProductionCharts').then((m) => m.BranchDemandChart), { ssr: false });
const TopRequestedChart = dynamic(() => import('./ProductionCharts').then((m) => m.TopRequestedChart), { ssr: false });

export function ProductionDashboard() {
  const { token } = useAuth();
  useProductionRealtime();
  const { data, isLoading } = useProductionOverview(token);

  const c = data?.cards;

  const cards: { title: string; value: number; icon: LucideIcon; color: CardColor }[] = [
    { title: 'Waiting Orders', value: c?.waitingOrders ?? 0, icon: Clock, color: 'orange' },
    { title: 'Approved Orders', value: c?.approvedOrders ?? 0, icon: CheckCircle2, color: 'green' },
    { title: 'Delivered Orders', value: c?.deliveredOrders ?? 0, icon: Truck, color: 'blue' },
    { title: 'Returned Products', value: c?.returnedProducts ?? 0, icon: Undo2, color: 'red' },
    { title: 'Changed Orders', value: c?.changedOrders ?? 0, icon: RefreshCw, color: 'brown' },
    { title: "Today's Production", value: c?.todayProduction ?? 0, icon: CalendarDays, color: 'orange' },
    { title: 'Weekly Production', value: c?.weeklyProduction ?? 0, icon: CalendarRange, color: 'blue' },
    { title: 'Monthly Production', value: c?.monthlyProduction ?? 0, icon: TrendingUp, color: 'green' },
    { title: 'Total Branches', value: c?.totalBranches ?? 0, icon: Store, color: 'brown' },
    { title: 'Total Products', value: c?.totalProducts ?? 0, icon: Package, color: 'orange' },
    { title: 'Total Demand Qty', value: c?.totalDemandQty ?? 0, icon: BarChart3, color: 'blue' },
    { title: 'Available Prod. Stock', value: c?.availableProductionStock ?? 0, icon: Boxes, color: 'green' },
  ];

  const daily = useMemo(
    () => (data?.demandByDay ?? []).slice(-14).map((d) => ({ label: safeDay(d.date), qty: d.qty })),
    [data],
  );

  const weekly = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of data?.demandByDay ?? []) {
      let key: string;
      try { key = format(startOfWeek(parseISO(d.date), { weekStartsOn: 1 }), 'MMM d'); } catch { key = d.date; }
      map.set(key, (map.get(key) ?? 0) + d.qty);
    }
    return [...map.entries()].map(([label, qty]) => ({ label, qty })).slice(-8);
  }, [data]);

  const monthly = useMemo(
    () => (data?.demandByMonth ?? []).map((m) => {
      let label = m.month;
      try { label = format(parseISO(`${m.month}-01`), 'MMM yy'); } catch { /* keep raw */ }
      return { label, qty: m.qty };
    }),
    [data],
  );

  return (
    <div className="space-y-6">
      {/* Live indicator */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
        Live — updates in real time as branches submit demands
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {cards.map((card) => (
          <StatCard key={card.title} title={card.title} value={card.value} icon={card.icon} color={card.color} loading={isLoading} />
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DemandLineChart title="Daily Demand" data={daily} loading={isLoading} />
        <DemandBarChart title="Monthly Demand" data={monthly} loading={isLoading} />
        <DemandBarChart title="Weekly Demand" data={weekly} loading={isLoading} />
        <BranchDemandChart data={data?.branchDemand ?? []} loading={isLoading} />
      </div>

      <TopRequestedChart data={data?.topProducts ?? []} loading={isLoading} />
    </div>
  );
}
