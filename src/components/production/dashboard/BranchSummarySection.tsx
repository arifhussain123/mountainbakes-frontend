'use client';

import dynamic from 'next/dynamic';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { BranchSummaryRow } from '@mb/shared';
import { useProductionDashboardSection } from '@/lib/queries';
import { chartColors } from './chartColors';
import { BUCKET_UNIT, fmt, pct, rangeLabel, shortBranch, whenLabel } from './format';
import { Delta, Figure, Kpi, KpiRow, Legend, SectionCard, Sparkline } from './parts';
import type { SectionProps } from './ReceivedDemandSection';

const BranchGroupedBars = dynamic(() => import('./charts').then((m) => m.BranchGroupedBars), {
  ssr: false,
  loading: () => <Skeleton className="h-[300px] w-full" />,
});

const FULFILMENT = 'Delivered ÷ demanded: units branches received (orders they verified, or Production delivered) out of the units they asked for, same orders, same period. Not capped at 100%.';

function BranchCard({ b, selected, dimmed, onSelect, unit }: { b: BranchSummaryRow; selected: boolean; dimmed: boolean; onSelect: () => void; unit: string }) {
  const idle = b.demanded === 0;
  const name = shortBranch(b.branchName);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${name}: ${idle ? 'no demand this period' : `${fmt(b.demanded)} demanded, ${fmt(b.delivered)} delivered, ${fmt(b.returned)} returned`}. ${selected ? 'Showing this branch; press to show all branches.' : 'Press to filter the dashboard to this branch.'}`}
      className={cn(
        'flex min-w-0 flex-col gap-2.5 rounded-xl border bg-card p-3.5 text-left transition-[opacity,box-shadow,border-color] hover:border-foreground/30',
        selected && 'border-foreground ring-2 ring-foreground/10',
        dimmed && 'opacity-50',
        idle && !selected && 'bg-muted/30',
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <b className="block truncate text-[13.5px] font-bold" title={b.branchName}>{name}</b>
          <span className="block text-[11px] text-muted-foreground">Last demand {whenLabel(b.lastSubmittedAt)}</span>
        </span>
        <Sparkline values={b.spark} color={chartColors.demand} label={`Demand per ${unit}: ${b.spark.map(fmt).join(', ')}`} />
      </span>
      {idle ? (
        <span className="text-[12px] font-semibold text-muted-foreground">No demand this period</span>
      ) : (
        <>
          <span className="grid grid-cols-3 gap-1.5 text-[11px] text-muted-foreground">
            {([['Demanded', b.demanded, chartColors.demand], ['Delivered', b.delivered, chartColors.delivered], ['Returned', b.returned, chartColors.returned]] as const).map(([label, v, color]) => (
              <span key={label} className="flex min-w-0 flex-col gap-0.5">
                <span className="flex items-center gap-1"><span className="size-[7px] shrink-0 rounded-[2px]" style={{ backgroundColor: color }} aria-hidden />{label}</span>
                <b className="text-[15px] font-extrabold tabular-nums text-foreground">{fmt(v)}</b>
              </span>
            ))}
          </span>
          <span className="flex items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full" style={{ width: `${Math.min(b.fulfilment ?? 0, 100)}%`, backgroundColor: chartColors.delivered }} />
            </span>
            <span className="text-[11.5px] font-bold tabular-nums" title={FULFILMENT}>{pct(b.fulfilment)}</span>
          </span>
        </>
      )}
    </button>
  );
}

export function BranchSummarySection({
  token, period, periodName, versus, selectedId, onSelect,
}: Omit<SectionProps, 'branchId' | 'scope'> & { selectedId: string | null; onSelect: (branchId: string) => void }) {
  const query = useProductionDashboardSection('branch-summary', token, period, null);
  const d = query.data;
  const subtitle = d
    ? `Every active branch · units ${periodName} · ${rangeLabel(d.window)} · click a branch to filter the dashboard`
    : `Every active branch · ${periodName}`;

  return (
    <SectionCard
      id="branch-summary"
      title="Branch-wise summary"
      subtitle={subtitle}
      query={query}
      kpiCount={5}
      empty={!!d && d.series.length === 0}
      emptyText="No active branches"
      kpis={() => d && (
        <KpiRow>
          <Kpi size="sm" name="Active branches" value={fmt(d.kpis.activeBranches ?? 0)} />
          <Kpi size="sm" name="Branches with demand" value={fmt(d.kpis.branchesWithDemand ?? 0)} delta={<Delta delta={d.comparePrevious.branchesWithDemand} versus={versus} />} />
          <Kpi size="sm" name="Units demanded" value={fmt(d.kpis.demanded ?? 0)} delta={<Delta delta={d.comparePrevious.demanded} versus={versus} />} />
          <Kpi size="sm" name="Units delivered" value={fmt(d.kpis.delivered ?? 0)} delta={<Delta delta={d.comparePrevious.delivered} versus={versus} />} />
          <Kpi size="sm" name="Fulfilment" value={pct(d.kpis.fulfilment)} delta={<Delta delta={d.comparePrevious.fulfilment} versus={versus} />} definition={FULFILMENT} />
        </KpiRow>
      )}
    >
      {() => {
        if (!d) return null;
        const unit = BUCKET_UNIT[d.bucket];
        const leader = d.series[0];
        const label = `Grouped columns per branch: units demanded, delivered and returned, ${rangeLabel(d.window)}, highest demand first, left to right.` +
          (leader && leader.demanded > 0 ? ` ${shortBranch(leader.branchName)} asked for the most, ${fmt(leader.demanded)} units.` : '');
        return (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4" role="group" aria-label="Branches">
              {d.series.map((b) => (
                <BranchCard
                  key={b.branchId}
                  b={b}
                  unit={unit}
                  selected={selectedId === b.branchId}
                  dimmed={!!selectedId && selectedId !== b.branchId}
                  onSelect={() => onSelect(b.branchId)}
                />
              ))}
            </div>
            <Figure label={label} className="flex flex-col gap-2.5">
              <Legend items={[
                { label: 'Demanded', color: chartColors.demand },
                { label: 'Delivered', color: chartColors.delivered },
                { label: 'Returned', color: chartColors.returned },
              ]} />
              <BranchGroupedBars rows={d.series} selectedId={selectedId} onSelect={onSelect} />
            </Figure>
          </div>
        );
      }}
    </SectionCard>
  );
}
