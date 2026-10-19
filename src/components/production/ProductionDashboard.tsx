'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { parseISO, format } from 'date-fns';
import dynamic from 'next/dynamic';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useProductionOverview } from '@/lib/queries';
import type { ProductionPeriod, ProductionWeek, WeekPair } from '@/lib/queries';
import { RefreshCw, X } from 'lucide-react';
import type { DashboardDelta } from '@mb/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { LoginHistoryCard } from '@/components/dashboard/LoginHistoryCard';
import { Panel } from './ProductionPanel';
import { Badge, Delta, Kpi, SectionBoundary, TONE } from './dashboard/parts';
import { ReceivedDemandSection } from './dashboard/ReceivedDemandSection';
import { BranchSummarySection } from './dashboard/BranchSummarySection';
import { RepairedStockSection } from './dashboard/RepairedStockSection';
import { ReturnStockSection } from './dashboard/ReturnStockSection';
import { CurrentStockSection } from './dashboard/CurrentStockSection';

// The dashboard's own typeface, per its design. Declared under the app's
// --font-sans name so everything below the wrapper picks it up, charts included.
const jakarta = Plus_Jakarta_Sans({ variable: '--font-sans', subsets: ['latin'] });

// Charts pull in recharts; load lazily on the client to keep the initial bundle lean.
const MonthlyDemandProduction = dynamic(() => import('./ProductionCharts').then((m) => m.MonthlyDemandProduction), { ssr: false });
const DemandProductionTrend = dynamic(() => import('./ProductionCharts').then((m) => m.DemandProductionTrend), { ssr: false });

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });
const shortBranch = (name: string) => name.replace('Mountain Bakes ', '');

const PERIODS: { key: ProductionPeriod; label: string; name: string; versus: string; unit: string }[] = [
  { key: 'today', label: 'Today', name: 'today', versus: 'yesterday', unit: 'hour' },
  { key: 'week', label: 'This week', name: 'this week', versus: 'the same days of last week', unit: 'day' },
  { key: 'month', label: 'This month', name: 'this month', versus: 'the same days of last month', unit: 'day' },
];

/** Change against the same stretch of the previous period, or null when there is nothing to compare with. */
function pctChange(p: WeekPair | undefined): DashboardDelta | null {
  if (!p || !p.prev) return null;
  return { value: ((p.cur - p.prev) / p.prev) * 100, unit: '%' };
}

const FULFILMENT_DEFINITION = 'Delivered ÷ demanded: units branches received (orders they verified, or Production delivered) out of the units they asked for, same orders, same period. Not capped at 100%. It used to add the shelf stock in, which measured supply, not fulfilment.';

/**
 * The branch filter lives in the address bar (`?branch=<id>`) so a view can be
 * shared and survives a refresh. Read and written through `window.location`
 * and `history`, not useSearchParams: the app is a static export and the query
 * string only exists in the browser.
 */
function useBranchParam(): [string | null, (id: string | null) => void] {
  const [branchId, setBranchId] = useState<string | null>(null);
  useEffect(() => {
    const read = () => setBranchId(new URLSearchParams(window.location.search).get('branch') || null);
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);
  const set = useCallback((id: string | null) => {
    setBranchId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('branch', id);
    else url.searchParams.delete('branch');
    window.history.replaceState(window.history.state, '', url);
  }, []);
  return [branchId, set];
}

function Empty({ children = 'No data yet' }: { children?: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

/**
 * Output plus what is on the shelf, against demand. Covered: the period's own
 * output meets demand. From stock: it only does with the shelf added. Short:
 * not even then, by the amount shown.
 */
function coverage(r: { demand: number; produced: number; stock: number }) {
  const balance = r.produced + r.stock - r.demand;
  const pct = r.demand > 0 ? Math.round(((r.produced + r.stock) / r.demand) * 100) : 100;
  if (r.produced >= r.demand) return { pct, balance, tone: 'good' as const, label: 'Covered', bar: 'bg-emerald-500' };
  if (balance >= 0) return { pct, balance, tone: 'warn' as const, label: 'From stock', bar: 'bg-amber-500' };
  return { pct, balance, tone: 'bad' as const, label: `Short ${fmt(-balance)}`, bar: 'bg-red-500' };
}

function PlanTable({ rows }: { rows: ProductionWeek['plan'] }) {
  if (rows.length === 0) return <Empty />;
  const th = 'px-1.5 py-2 text-right text-[11px] font-bold uppercase tracking-[0.5px] text-muted-foreground first:pl-0 last:pr-0';
  const td = 'px-1.5 py-2.5 text-right tabular-nums';
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-[13px]">
        <thead>
          <tr className="border-b">
            <th className={cn(th, 'text-left')}>Product</th>
            <th className={th}>Demand</th>
            <th className={th}>Produced</th>
            <th className={th}>In stock</th>
            <th className={th}>Balance</th>
            <th className={cn(th, 'text-left')}>Coverage</th>
            <th className={cn(th, 'text-left')}>Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const c = coverage(r);
            return (
              <tr key={r.productId ?? r.productName} className="border-b border-border/60 last:border-0">
                <td className="py-2.5 pr-1.5 text-left font-semibold">{r.productName}</td>
                <td className={td}>{fmt(r.demand)}</td>
                <td className={td}>{fmt(r.produced)}</td>
                <td className={cn(td, 'text-muted-foreground')}>{fmt(r.stock)}</td>
                <td className={cn(td, 'font-bold', c.balance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                  {c.balance >= 0 ? '+' : ''}{fmt(c.balance)}
                </td>
                <td className="px-1.5 py-2.5">
                  <div className="flex min-w-[150px] items-center gap-2">
                    <div className="h-[7px] flex-1 overflow-hidden rounded-full bg-muted">
                      <div className={cn('h-full rounded-full', c.bar)} style={{ width: `${Math.min(c.pct, 100)}%` }} />
                    </div>
                    <span className="w-9 text-right text-[11.5px] tabular-nums text-muted-foreground">{c.pct}%</span>
                  </div>
                </td>
                <td className="py-2.5 pl-1.5 text-left"><Badge tone={c.tone}>{c.label}</Badge></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Heatmap({ heat, selectedId }: { heat: ProductionWeek['heat']; selectedId: string | null }) {
  if (heat.rows.length === 0 || heat.products.length === 0) return <Empty />;
  const max = Math.max(...heat.rows.flatMap((r) => r.values), 1);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] table-fixed border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th className="w-[150px]" />
            {heat.products.map((p) => (
              <th key={p.productId ?? p.productName} className="px-0.5 pb-1 text-center align-bottom text-[10.5px] font-bold leading-tight text-muted-foreground [text-wrap:balance]" title={p.productName}>
                {p.productName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {heat.rows.map((r) => (
            // The whole grid stays up under a branch filter; the others are dimmed
            // so the selected branch can still be read against them.
            <tr key={r.branchId} className={cn('transition-opacity', selectedId && selectedId !== r.branchId && 'opacity-30')}>
              <th scope="row" className="truncate pr-2 text-left font-semibold" title={shortBranch(r.branchName)}>{shortBranch(r.branchName)}</th>
              {r.values.map((v, i) => {
                // Eased, so the many small orders are still told apart beside one large one.
                const t = Math.pow(v / max, 0.55);
                const a = v > 0 ? 0.06 + 0.9 * t : 0;
                return (
                  <td
                    key={i}
                    className={cn('h-8 rounded-md text-center text-[11.5px] font-bold tabular-nums', v === 0 && 'bg-muted/50 text-muted-foreground', t > 0.55 && 'text-white')}
                    style={v > 0 ? { backgroundColor: `color-mix(in oklab, var(--chart-1) ${Math.round(a * 100)}%, transparent)` } : undefined}
                  >
                    {v > 0 ? fmt(v) : '–'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ORDER_STATUS: Record<string, { label: string; tone: keyof typeof TONE }> = {
  pending: { label: 'Waiting', tone: 'warn' },
  awaiting_verification: { label: 'Sent', tone: 'accent' },
  verified: { label: 'Verified', tone: 'good' },
  approved: { label: 'Delivered', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'bad' },
};

function Recent({ rows }: { rows: ProductionWeek['recent'] }) {
  if (rows.length === 0) return <Empty>No demands yet</Empty>;
  return (
    <ul className="-mb-[9px]">
      {rows.map((r) => {
        const s = ORDER_STATUS[r.status] ?? { label: r.status, tone: 'accent' as const };
        let day = '', time = '';
        try { const d = parseISO(r.submittedAt); day = format(d, 'MMM d'); time = format(d, 'HH:mm'); } catch { /* keep blank */ }
        return (
          <li key={r.id} className="grid grid-cols-[44px_1fr_auto] items-center gap-2.5 border-t border-border/60 py-[9px]">
            <span className="text-[11.5px] font-semibold leading-tight text-muted-foreground">
              <span className="block tabular-nums">{time}</span>
              <span className="block text-[10px] font-medium">{day}</span>
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <b className="truncate text-[13px] font-semibold">{shortBranch(r.branchName ?? '')}</b>
              <span className="text-[11.5px] text-muted-foreground">
                {r.products} {r.products === 1 ? 'product' : 'products'} · {fmt(r.units)} units{r.wasChanged ? ' · changed' : ''}
              </span>
            </span>
            <Badge tone={s.tone}>{s.label}</Badge>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * `embedded`: rendered as the Admin Dashboard's Production tab, which keeps a
 * single Login History card of its own on its Overview tab.
 */
export function ProductionDashboard({ embedded = false }: { embedded?: boolean } = {}) {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [branchId, setBranchId] = useBranchParam();
  const [period, setPeriod] = useState<ProductionPeriod>('week');
  const { data, isLoading, isPlaceholderData, dataUpdatedAt } = useProductionOverview(token, branchId, period);
  // The overview and every section share the 'productionOverview' prefix, so
  // Refresh, mutations and live notifications all reach all of them at once.
  const fetching = useIsFetching({ queryKey: ['productionOverview'] }) > 0;
  const refreshAll = () => qc.invalidateQueries({ queryKey: ['productionOverview'] });
  const per = PERIODS.find((p) => p.key === period) ?? PERIODS[1];

  const c = data?.cards;
  const w = data?.week;
  const k = w?.kpis;
  const branches = data?.branches;
  const selected = branchId ? branches?.find((b) => b.branchId === branchId) : undefined;
  const branchName = selected ? shortBranch(selected.branchName) : branchId ? 'Branch' : null;
  const scope = branchName ?? 'All branches';

  // A shared link to a branch that has since closed, or a mistyped id: back to
  // the company-wide view rather than a dashboard of zeros for nobody.
  useEffect(() => {
    if (branchId && branches && !branches.some((b) => b.branchId === branchId)) setBranchId(null);
  }, [branchId, branches, setBranchId]);

  const toggleBranch = useCallback((id: string) => setBranchId(branchId === id ? null : id), [branchId, setBranchId]);

  // Today is one business day, so a per-day series would be a single point:
  // it is drawn by the hour instead. Every other period is one point per day.
  const hourly = period === 'today';
  const trend = useMemo(
    () => (hourly
      ? (w?.hourly ?? []).map((h) => {
        let label = h.hour;
        try { label = format(parseISO(h.hour), 'haaaaa'); } catch { /* keep raw */ }
        return { label, demand: h.demand, produced: h.produced };
      })
      : (w?.trend ?? []).map((d) => {
        let label = d.date;
        try { label = format(parseISO(d.date), period === 'month' ? 'MMM d' : 'EEE d'); } catch { /* keep raw */ }
        return { label, demand: d.demand, produced: d.produced };
      })),
    [w, hourly, period],
  );

  const monthly = useMemo(
    () => (w?.monthly ?? []).map((m) => {
      let label = m.month;
      try { label = format(parseISO(`${m.month}-01`), 'MMM'); } catch { /* keep raw */ }
      return { label, demand: m.demand, produced: m.produced };
    }),
    [w],
  );

  const rangeLabel = useMemo(() => {
    if (!w) return per.name;
    try {
      return w.from === w.to
        ? format(parseISO(w.to), 'MMM d')
        : `${format(parseISO(w.from), 'MMM d')} to ${format(parseISO(w.to), 'MMM d')}`;
    } catch { return per.name; }
  }, [w, per.name]);

  let updatedAt = '';
  try { if (dataUpdatedAt) updatedAt = format(new Date(dataUpdatedAt), 'hh:mm:ss a'); } catch { /* keep blank */ }

  const demand = k?.demand.cur ?? 0;
  const produced = k?.produced.cur ?? 0;
  // Delivered ÷ demanded, for all branches and for one alike, never capped.
  // It used to be (produced + pool stock) ÷ demand, clamped at 100% for all
  // branches — a measure of supply, which read 100% beside falling deliveries.
  const rate = (num: number, den: number) => (den > 0 ? (num / den) * 100 : null);
  const fulfilment = rate(k?.delivered.cur ?? 0, demand);
  const prevFulfilment = k ? rate(k.delivered.prev, k.demand.prev) : null;
  const deliveredTo = (w?.branchCompare ?? []).filter((b) => b.delivered > 0).length;

  const plan = w?.plan ?? [];
  const planCounts = plan.reduce(
    (acc, r) => { acc[coverage(r).tone] += 1; return acc; },
    { good: 0, warn: 0, bad: 0 },
  );

  const strip: { name: string; value: number; negative?: boolean }[] = [
    { name: 'Active branches', value: c?.totalBranches ?? 0 },
    { name: 'Products', value: c?.totalProducts ?? 0 },
    // Day-scoped and can go NEGATIVE — more left the pool than entered it, and
    // the difference is production still to do. Red when it does.
    { name: 'Available prod. stock', value: c?.availableProductionStock ?? 0, negative: (c?.availableProductionStock ?? 0) < 0 },
    // A separate inventory from the figure above — returned goods are not
    // production stock and are not counted in it.
    { name: 'Branch return stock', value: c?.branchReturnStock ?? 0 },
    // Summed in SQL from the same prepare movements as the Produced card, so
    // "Weekly production" and Produced on This week are the same number.
    { name: "Today's production", value: c?.todayProduction ?? 0 },
    { name: 'Weekly production', value: c?.weeklyProduction ?? 0 },
    { name: 'Monthly production', value: c?.monthlyProduction ?? 0 },
  ];

  const delta = (pair: WeekPair | undefined, invert?: boolean) => <Delta delta={pctChange(pair)} versus={per.versus} invert={invert} />;
  const sectionProps = { token, period, branchId, scope, periodName: per.name, versus: per.versus };

  return (
    <div className={cn(jakarta.variable, 'min-w-0 space-y-4 font-sans')}>
      {/* Live indicator, branch in view, period switch, refresh */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-muted-foreground">
            <span className="size-[7px] rounded-full bg-emerald-500 animate-pulse" />
            <span>Live{updatedAt && <> · updated <span className="tabular-nums">{updatedAt}</span></>}</span>
          </div>
          {branchId && (
            <span className="inline-flex items-center gap-1 rounded-full border border-foreground bg-foreground py-1 pl-3 pr-1 text-[12.5px] font-semibold text-background">
              Viewing: {branchName}
              <button
                type="button"
                onClick={() => setBranchId(null)}
                className="inline-flex size-5 items-center justify-center rounded-full hover:bg-background/20"
                aria-label="Show all branches"
                title="Show all branches"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </span>
          )}
        </div>
        <div className="flex gap-0.5 rounded-[10px] bg-muted p-[3px]" role="group" aria-label="Period">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              aria-pressed={period === p.key}
              onClick={() => setPeriod(p.key)}
              className={cn(
                'whitespace-nowrap rounded-lg px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors',
                period === p.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={refreshAll}
          disabled={fetching}
          className="inline-flex items-center gap-1.5 rounded-[9px] border bg-card px-3.5 py-[7px] text-[12.5px] font-semibold transition-colors hover:bg-muted disabled:opacity-60"
        >
          <RefreshCw className={cn('size-3.5', fetching && 'animate-spin')} aria-hidden />
          Refresh
        </button>
      </div>

      <div className={cn('space-y-4 transition-opacity', isPlaceholderData && 'opacity-60')}>
        {/* KPIs — company-wide until a branch is picked below, then that branch's. */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(190px,1fr))]">
          <Kpi name="Total demand" value={fmt(demand)} note={`units requested ${per.name}`} delta={delta(k?.demand)} loading={isLoading} />
          <Kpi
            name="Produced"
            value={fmt(produced)}
            note={branchId ? 'all branches — central pool' : demand > 0 ? `${Math.round((produced / demand) * 100)}% of demand` : `units prepared ${per.name}`}
            delta={delta(k?.produced)}
            definition="Units prepared into Production Stock (prepare movements), by business date. The same figure as the production strip below."
            loading={isLoading}
          />
          <Kpi
            name="Fulfilment rate"
            value={fulfilment === null ? '—' : `${fulfilment.toFixed(1)}%`}
            note="delivered ÷ demanded"
            delta={<Delta delta={fulfilment !== null && prevFulfilment !== null ? { value: fulfilment - prevFulfilment, unit: 'pts' } : null} versus={per.versus} />}
            definition={FULFILMENT_DEFINITION}
            loading={isLoading}
          />
          <Kpi name="Open orders" value={fmt(k?.openOrders.cur ?? 0)} note="waiting approval" delta={delta(k?.openOrders, true)} loading={isLoading} />
          <Kpi
            name="Delivered orders"
            value={fmt(k?.deliveredOrders.cur ?? 0)}
            note={branchId ? 'received by this branch' : `to ${deliveredTo} ${deliveredTo === 1 ? 'branch' : 'branches'}`}
            delta={delta(k?.deliveredOrders)}
            loading={isLoading}
          />
          <Kpi
            name="Returned units"
            value={fmt(k?.returns.cur ?? 0)}
            note={demand > 0 ? `${(((k?.returns.cur ?? 0) / demand) * 100).toFixed(1)}% of demand` : 'units accepted back'}
            delta={delta(k?.returns, true)}
            loading={isLoading}
          />
        </div>

        {/* Strip */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-y-2 rounded-[14px] border bg-card px-1.5 py-3">
          {strip.map((s) => (
            <div key={s.name} className="flex flex-col gap-[3px] border-l border-border/70 px-4 py-1">
              <p className="text-[11.5px] font-semibold text-muted-foreground">{s.name}</p>
              {isLoading
                ? <Skeleton className="h-5 w-14" />
                : <p className={cn('text-[17px] font-extrabold tabular-nums', s.negative && 'text-red-600 dark:text-red-400')}>{fmt(s.value)}</p>}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <DemandProductionTrend
            data={trend}
            subtitle={`${scope} · units per ${per.unit} · ${rangeLabel}${branchId ? ' · produced is all branches' : ''}`}
            loading={isLoading}
          />
          <MonthlyDemandProduction
            data={monthly}
            subtitle={`${scope} · units per month, last 12 months, this one to date${branchId ? ' · produced is all branches' : ''}`}
            loading={isLoading}
          />
        </div>
      </div>

      {/* The five summary sections. Each fetches, fails and retries on its own. */}
      <SectionBoundary title="Received demand"><ReceivedDemandSection {...sectionProps} /></SectionBoundary>
      <SectionBoundary title="Branch-wise summary">
        <BranchSummarySection token={token} period={period} periodName={per.name} versus={per.versus} selectedId={branchId} onSelect={toggleBranch} />
      </SectionBoundary>
      <SectionBoundary title="Repaired stock"><RepairedStockSection {...sectionProps} /></SectionBoundary>
      <SectionBoundary title="Return stock"><ReturnStockSection {...sectionProps} /></SectionBoundary>
      <SectionBoundary title="Current stock"><CurrentStockSection token={token} period={period} branchId={branchId} scope={scope} /></SectionBoundary>

      <div className={cn('space-y-4 transition-opacity', isPlaceholderData && 'opacity-60')}>
        <Panel
          title="Production plan"
          subtitle={`Demand against output and stock on hand, ${per.name}${branchId ? ` · demand is ${branchName} only, output and stock are the central pool` : ''}`}
          action={(
            <div className="flex flex-wrap gap-1.5">
              <Badge tone="good">{planCounts.good} covered</Badge>
              <Badge tone="warn">{planCounts.warn} from stock</Badge>
              <Badge tone="bad">{planCounts.bad} short</Badge>
            </div>
          )}
        >
          {isLoading ? <Skeleton className="h-72 w-full" /> : <PlanTable rows={plan} />}
        </Panel>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Panel className="lg:col-span-2" title="Branch × product demand" subtitle={`Units requested per branch, ${per.name}. Darker cells are larger orders.`}>
            {isLoading ? <Skeleton className="h-60 w-full" /> : <Heatmap heat={w?.heat ?? { products: [], rows: [] }} selectedId={branchId} />}
          </Panel>
          <Panel className="gap-1.5" title="Recent branch demands" subtitle={`Latest submissions from ${branchName ?? 'all branches'}`}>
            {isLoading ? <Skeleton className="h-60 w-full" /> : <Recent rows={w?.recent ?? []} />}
          </Panel>
        </div>
      </div>

      {/* Login History. On every dashboard, but not showing the same thing on
          each: the API gives a super admin every account's sessions and pins
          every other role to its own. Last, because it is a record to consult
          rather than something to act on. */}
      {!embedded && <LoginHistoryCard />}
    </div>
  );
}
