'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { format } from 'date-fns';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useProductionDashboardSection } from '@/lib/queries';
import { chartColors } from './chartColors';
import { fmt } from './format';
import { EmptyState, Figure, Kpi, KpiRow, Legend, SectionCard } from './parts';
import type { SectionProps } from './ReceivedDemandSection';

const StockBars = dynamic(() => import('./charts').then((m) => m.StockBars), {
  ssr: false,
  loading: () => <Skeleton className="h-[320px] w-full" />,
});

/** Stock right now. It ignores the period switch, and says so. */
export function CurrentStockSection({ token, period, branchId, scope }: Omit<SectionProps, 'periodName' | 'versus'>) {
  const query = useProductionDashboardSection('current-stock', token, period, branchId);
  const d = query.data;
  const [search, setSearch] = useState('');
  const [lowOnly, setLowOnly] = useState(false);

  let asOf = '';
  try { if (d) asOf = format(new Date(d.generatedAt), 'HH:mm'); } catch { /* keep blank */ }
  const threshold = d?.breakdown.threshold ?? 5;

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (d?.series ?? []).filter((r) => (!lowOnly || r.state !== 'ok') && (!q || r.productName.toLowerCase().includes(q)));
  }, [d, search, lowOnly]);

  return (
    <SectionCard
      id="current-stock"
      title="Current stock"
      subtitle={`Live${asOf ? `, as of ${asOf}` : ''} · production stock + ${branchId ? `${scope}'s` : 'all branches\''} shelves · not affected by the period`}
      query={query}
      kpiCount={5}
      empty={!!d && d.series.length === 0}
      emptyText="No active products"
      kpis={() => d && (
        <KpiRow>
          <Kpi size="sm" name="Total production stock" value={fmt(d.kpis.production)}
            definition="Available in the central pool: what is on the shelf less what branches have already been promised. Can be negative." />
          <Kpi size="sm" name="Total branch stock" value={fmt(d.kpis.branch)} note={branchId ? scope : 'all branches'} />
          <Kpi size="sm" name="SKUs in stock" value={fmt(d.kpis.inStock)} note={`of ${fmt(d.breakdown.products)} products`} />
          <Kpi size="sm" name="Low-stock SKUs" value={fmt(d.kpis.low)} note={`under ${threshold} units`}
            definition={`Production plus branch stock above 0 but under ${threshold} units (LOW_STOCK_THRESHOLD, the same alert level the branches use).`} />
          <Kpi size="sm" name="Out-of-stock SKUs" value={fmt(d.kpis.out)} note="nothing anywhere" />
        </KpiRow>
      )}
    >
      {() => {
        if (!d) return null;
        const label = `Horizontal bars per product, production stock stacked with branch stock, largest first. ` +
          `${fmt(d.kpis.low)} products are low (amber) and ${fmt(d.kpis.out)} are out of stock.`;
        return (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative min-w-[180px] max-w-xs flex-1">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search products"
                  aria-label="Search products"
                  className="h-8 pl-8 text-[12.5px]"
                />
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-semibold" title={`Products under ${threshold} units, out of stock included`}>
                <Switch checked={lowOnly} onCheckedChange={setLowOnly} aria-label="Low stock only" />
                Low stock only
              </label>
              <div className="ml-auto">
                <Legend items={[
                  { label: 'Production stock', color: chartColors.productionStock },
                  { label: 'Branch stock', color: chartColors.branchStock },
                  { label: `Low (< ${threshold})`, color: chartColors.lowStock },
                  { label: 'Out', color: chartColors.outOfStock },
                ]} />
              </div>
            </div>
            {rows.length === 0 ? (
              <EmptyState height={140}>{lowOnly ? 'Nothing is running low' : 'No products match'}</EmptyState>
            ) : (
              <Figure label={label} className="max-h-[560px] overflow-y-auto pr-1">
                <StockBars rows={rows} />
              </Figure>
            )}
          </div>
        );
      }}
    </SectionCard>
  );
}
