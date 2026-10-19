'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';
import { useProductionDashboardSection } from '@/lib/queries';
import { chartColors, RETURN_REASON_COLORS } from './chartColors';
import { BUCKET_UNIT, fmt, pct, rangeLabel, shortBranch } from './format';
import { Delta, Figure, HeatGrid, Kpi, KpiRow, SectionCard } from './parts';
import type { SectionProps } from './ReceivedDemandSection';

const ReasonDonut = dynamic(() => import('./charts').then((m) => m.ReasonDonut), {
  ssr: false,
  loading: () => <Skeleton className="size-[150px] rounded-full" />,
});
const ReturnsLine = dynamic(() => import('./charts').then((m) => m.ReturnsLine), {
  ssr: false,
  loading: () => <Skeleton className="h-[200px] w-full" />,
});

export function ReturnStockSection({ token, period, branchId, scope, periodName, versus }: SectionProps) {
  const query = useProductionDashboardSection('return-stock', token, period, branchId);
  const d = query.data;
  const subtitle = d ? `${scope} · units accepted back per ${BUCKET_UNIT[d.bucket]} · ${rangeLabel(d.window)}` : `${scope} · ${periodName}`;

  return (
    <SectionCard
      id="return-stock"
      title="Return stock"
      subtitle={subtitle}
      query={query}
      kpiCount={5}
      empty={!!d && (d.kpis.returned ?? 0) === 0}
      emptyText={`No returns ${periodName}`}
      kpis={() => d && (
        <KpiRow>
          <Kpi size="sm" name="Units returned" value={fmt(d.kpis.returned ?? 0)} delta={<Delta delta={d.comparePrevious.returned} versus={versus} invert />}
            definition="Units of branch returns Production accepted, by the return's business date. Pending and rejected returns are left out." />
          <Kpi size="sm" name="Return rate" value={pct(d.kpis.returnRate)} delta={<Delta delta={d.comparePrevious.returnRate} versus={versus} invert />}
            definition="Returned ÷ delivered: units accepted back out of units delivered to branches in the same period and scope." note="of delivered" />
          <Kpi size="sm" name="Return stock on hand" value={fmt(d.kpis.onHand ?? 0)} note="live · one pool, all branches"
            definition="Units in Branch Return Stock right now, waiting to be transferred into Production Stock." />
          <Kpi size="sm" name="Top returning branch" value={d.breakdown.topBranch ? shortBranch(d.breakdown.topBranch.branchName) : '—'}
            note={d.breakdown.topBranch ? `${fmt(d.breakdown.topBranch.units)} units` : 'no returns'} />
          <Kpi size="sm" name="Top returned product" value={d.breakdown.topProduct?.productName ?? '—'}
            note={d.breakdown.topProduct ? `${fmt(d.breakdown.topProduct.units)} units` : 'no returns'} />
        </KpiRow>
      )}
    >
      {() => {
        if (!d) return null;
        const total = d.kpis.returned ?? 0;
        const slices = d.breakdown.byReason.map((r) => ({ label: r.label, value: r.units, color: RETURN_REASON_COLORS[r.reason] }));
        const lead = [...slices].sort((a, b) => b.value - a.value)[0];
        const donutLabel = `Donut of returned units by reason. ${slices.filter((s) => s.value > 0).map((s) => `${s.label} ${fmt(s.value)}`).join(', ')}.`;
        const peak = d.series.reduce((m, p) => (p.returned > m.returned ? p : m), d.series[0]!);
        const lineLabel = `Line of units returned per ${BUCKET_UNIT[d.bucket]}, ${rangeLabel(d.window)}; ${fmt(total)} in all` + (peak ? `, the most on one ${BUCKET_UNIT[d.bucket]} ${fmt(peak.returned)}.` : '.');
        return (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              <Figure label={donutLabel} className="flex flex-col gap-3">
                <p className="text-xs font-bold uppercase tracking-[0.5px] text-muted-foreground">By reason</p>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
                  <ReasonDonut slices={slices} />
                  <ul className="flex min-w-[170px] flex-1 flex-col gap-2 text-[12.5px]">
                    {slices.map((s) => (
                      <li key={s.label} className="flex items-center gap-2">
                        <span className="size-[9px] shrink-0 rounded-[3px]" style={{ backgroundColor: s.color }} aria-hidden />
                        <span className="min-w-0 flex-1 truncate font-medium text-muted-foreground">{s.label}</span>
                        <b className="tabular-nums">{fmt(s.value)}</b>
                        <span className="w-11 text-right text-[11px] tabular-nums text-muted-foreground">{total > 0 ? `${Math.round((s.value / total) * 100)}%` : ''}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Sorted from the free-text reason by keyword{lead && lead.value > 0 ? `; ${lead.label.toLowerCase()} leads` : ''}.
                </p>
              </Figure>
              <Figure label={lineLabel} className="flex flex-col gap-3">
                <p className="text-xs font-bold uppercase tracking-[0.5px] text-muted-foreground">Returned per {BUCKET_UNIT[d.bucket]}</p>
                <ReturnsLine data={d.series} bucket={d.bucket} />
              </Figure>
            </div>
            <div className="flex flex-col gap-2">
              <p className="text-xs font-bold uppercase tracking-[0.5px] text-muted-foreground">Branch × top 5 returned products</p>
              <HeatGrid
                products={d.breakdown.heat.products}
                rows={d.breakdown.heat.rows}
                color={chartColors.returned}
                selectedId={branchId}
                label={`Units returned per branch for the ${d.breakdown.heat.products.length} most-returned products, ${rangeLabel(d.window)}`}
              />
            </div>
          </div>
        );
      }}
    </SectionCard>
  );
}
