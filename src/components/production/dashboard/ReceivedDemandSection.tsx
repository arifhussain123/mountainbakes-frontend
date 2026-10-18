'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';
import { DEMAND_STATUS_LABELS } from '@mb/shared';
import { useProductionDashboardSection, type ProductionPeriod } from '@/lib/queries';
import { chartColors, DEMAND_STACK_ORDER, DEMAND_STATUS_COLORS } from './chartColors';
import { BUCKET_UNIT, bucketLabel, fmt, rangeLabel } from './format';
import { Delta, Figure, Kpi, KpiRow, Legend, SectionCard } from './parts';

const DemandStatusColumns = dynamic(() => import('./charts').then((m) => m.DemandStatusColumns), {
  ssr: false,
  loading: () => <Skeleton className="h-[260px] w-full" />,
});

export interface SectionProps {
  token: string;
  period: ProductionPeriod;
  branchId: string | null;
  /** "All branches", or the branch the dashboard is filtered to. */
  scope: string;
  /** "this week", for empty states. */
  periodName: string;
  /** "the same days of last week", for delta tooltips. */
  versus: string;
}

export function ReceivedDemandSection({ token, period, branchId, scope, periodName, versus }: SectionProps) {
  const query = useProductionDashboardSection('received-demand', token, period, branchId);
  const d = query.data;
  const subtitle = d ? `${scope} · units per ${BUCKET_UNIT[d.bucket]} · ${rangeLabel(d.window)}` : `${scope} · ${periodName}`;

  return (
    <SectionCard
      id="received-demand"
      title="Received demand"
      subtitle={subtitle}
      query={query}
      kpiCount={5}
      empty={!!d && d.kpis.orders === 0}
      emptyText={`No demand received ${periodName}`}
      kpis={() => d && (
        <KpiRow>
          <Kpi size="sm" name="Units received" value={fmt(d.kpis.units ?? 0)} delta={<Delta delta={d.comparePrevious.units} versus={versus} />}
            definition="Units on every demand branches sent in this period, whatever happened to it after. Cancelled demands are left out." />
          <Kpi size="sm" name="Demand orders received" value={fmt(d.kpis.orders ?? 0)} delta={<Delta delta={d.comparePrevious.orders} versus={versus} />} />
          <Kpi size="sm" name="Avg units per order" value={d.kpis.avgUnits === null ? '—' : fmt(d.kpis.avgUnits)} delta={<Delta delta={d.comparePrevious.avgUnits} versus={versus} />} />
          <Kpi size="sm" name="Pending verification" value={fmt(d.kpis.pendingVerification ?? 0)} delta={<Delta delta={d.comparePrevious.pendingVerification} versus={versus} invert />}
            definition="Orders Production has sent that the branch has not yet confirmed receiving." note="orders sent, not yet verified" />
          <Kpi size="sm" name="Rejected" value={fmt(d.kpis.rejected ?? 0)} delta={<Delta delta={d.comparePrevious.rejected} versus={versus} invert />} note="orders" />
        </KpiRow>
      )}
    >
      {() => {
        if (!d) return null;
        const busiest = d.series.reduce((m, p) => (p.units > m.units ? p : m), d.series[0]!);
        const label = `Stacked columns: units received per ${BUCKET_UNIT[d.bucket]} by order status, ${rangeLabel(d.window)}. ` +
          `${fmt(d.kpis.units ?? 0)} units in ${fmt(d.kpis.orders ?? 0)} orders` +
          (busiest && busiest.units > 0 ? `; the most, ${fmt(busiest.units)} units, on ${bucketLabel(busiest.bucket, d.bucket)}.` : '.');
        const top = d.breakdown.topProducts;
        const max = Math.max(...top.map((p) => p.units), 1);
        return (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(220px,280px)]">
            <Figure label={label} className="flex flex-col gap-2.5">
              <Legend items={[...DEMAND_STACK_ORDER].reverse().map((s) => ({ label: DEMAND_STATUS_LABELS[s], color: DEMAND_STATUS_COLORS[s] }))} />
              <DemandStatusColumns data={d.series} bucket={d.bucket} />
            </Figure>
            <div className="flex min-w-0 flex-col gap-2.5">
              <p className="text-xs font-bold uppercase tracking-[0.5px] text-muted-foreground">Top 5 products</p>
              <ol className="flex flex-col gap-2.5" aria-label="Top 5 products by units received">
                {top.map((p, i) => (
                  <li key={p.productId ?? p.productName} className="flex flex-col gap-1 text-[12.5px]">
                    <span className="flex items-baseline gap-2">
                      <span className="text-[11px] font-bold tabular-nums text-muted-foreground">{i + 1}</span>
                      <span className="min-w-0 flex-1 truncate font-semibold" title={p.productName}>{p.productName}</span>
                      <b className="tabular-nums">{fmt(p.units)}</b>
                    </span>
                    <span className="block h-2 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full rounded-full" style={{ width: `${Math.max((p.units / max) * 100, 3)}%`, backgroundColor: chartColors.demand }} />
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        );
      }}
    </SectionCard>
  );
}
