'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';
import { useProductionDashboardSection } from '@/lib/queries';
import { chartColors } from './chartColors';
import { BUCKET_UNIT, fmt, pct, rangeLabel } from './format';
import { Delta, EmptyState, Figure, Kpi, KpiRow, Legend, SectionCard } from './parts';
import type { SectionProps } from './ReceivedDemandSection';

const RepairedArea = dynamic(() => import('./charts').then((m) => m.RepairedArea), {
  ssr: false,
  loading: () => <Skeleton className="h-[240px] w-full" />,
});

export function RepairedStockSection({ token, period, branchId, scope, periodName, versus }: SectionProps) {
  const query = useProductionDashboardSection('repaired-stock', token, period, branchId);
  const d = query.data;
  const subtitle = d ? `${scope} · units per ${BUCKET_UNIT[d.bucket]} · ${rangeLabel(d.window)}` : `${scope} · ${periodName}`;
  const returnedInPeriod = d ? d.series.reduce((s, p) => s + p.returned, 0) : 0;

  return (
    <SectionCard
      id="repaired-stock"
      title="Repaired stock"
      subtitle={subtitle}
      query={query}
      kpiCount={4}
      empty={!!d && returnedInPeriod === 0 && (d.kpis.backToStock ?? 0) === 0}
      emptyText={`No returns ${periodName}, so nothing to repair`}
      kpis={() => d && (
        <KpiRow>
          <Kpi size="sm" name="Units repaired" value={fmt(d.kpis.repaired ?? 0)} delta={<Delta delta={d.comparePrevious.repaired} versus={versus} />}
            definition="Units of accepted returns that Production marked Repaired when accepting them." />
          <Kpi size="sm" name="Repair rate" value={pct(d.kpis.repairRate)} delta={<Delta delta={d.comparePrevious.repairRate} versus={versus} />}
            definition="Repaired ÷ returned: of the units accepted back this period, the share marked Repaired." />
          <Kpi size="sm" name="Top repaired product" value={d.breakdown.topProduct?.productName ?? '—'}
            note={d.breakdown.topProduct ? `${fmt(d.breakdown.topProduct.units)} units` : 'nothing repaired'} />
          <Kpi size="sm" name="Sent back to stock" value={fmt(d.kpis.backToStock ?? 0)} delta={<Delta delta={d.comparePrevious.backToStock} versus={versus} />}
            note={branchId ? 'all branches — Return Stock is one pool' : 'Return Stock → Production Stock'}
            definition="Units transferred from Branch Return Stock into Production Stock this period. A transfer is not tied to the return it came from, so this counts every transfer, repaired or not." />
        </KpiRow>
      )}
    >
      {() => {
        if (!d) return null;
        const top = d.breakdown.topProducts;
        const max = Math.max(...top.map((p) => p.units), 1);
        const label = `Area chart of units repaired per ${BUCKET_UNIT[d.bucket]}, with a dashed line of units returned, ${rangeLabel(d.window)}. ` +
          `${fmt(d.kpis.repaired ?? 0)} of ${fmt(returnedInPeriod)} returned units repaired.`;
        return (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]">
            <Figure label={label} className="flex flex-col gap-2.5">
              <Legend items={[{ label: 'Repaired', color: chartColors.repaired }, { label: 'Returned', color: chartColors.returned, line: true }]} />
              <RepairedArea data={d.series} bucket={d.bucket} />
            </Figure>
            <div className="flex min-w-0 flex-col gap-2.5">
              <p className="text-xs font-bold uppercase tracking-[0.5px] text-muted-foreground">Top 10 repaired products</p>
              {top.length === 0 ? (
                <EmptyState height={160}>
                  <span className="max-w-[240px] px-3">
                    No returns were marked Repaired {periodName}. Choose <b>Repaired</b> when accepting a return to record one.
                  </span>
                </EmptyState>
              ) : (
                <ol className="flex flex-col gap-2" aria-label="Top 10 products by units repaired">
                  {top.map((p) => (
                    <li key={p.productId ?? p.productName} className="grid grid-cols-[minmax(0,120px)_1fr_44px] items-center gap-2 text-[12.5px]">
                      <span className="truncate font-semibold" title={p.productName}>{p.productName}</span>
                      <span className="block h-2.5 overflow-hidden rounded-full bg-muted">
                        <span className="block h-full rounded-full" style={{ width: `${Math.max((p.units / max) * 100, 3)}%`, backgroundColor: chartColors.repaired }} />
                      </span>
                      <b className="text-right tabular-nums">{fmt(p.units)}</b>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        );
      }}
    </SectionCard>
  );
}
