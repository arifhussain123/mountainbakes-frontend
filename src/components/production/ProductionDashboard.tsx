'use client';

import { useMemo, useState } from 'react';
import { parseISO, format } from 'date-fns';
import dynamic from 'next/dynamic';
import { Plus_Jakarta_Sans } from 'next/font/google';
import { useAuth } from '@/hooks/useAuth';
import { useProductionOverview } from '@/lib/queries';
import type { ProductionPeriod, ProductionWeek, WeekPair } from '@/lib/queries';
import { RefreshCw } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { LoginHistoryCard } from '@/components/dashboard/LoginHistoryCard';
import { Panel } from './ProductionPanel';

// The dashboard's own typeface, per its design. Declared under the app's
// --font-sans name so everything below the wrapper picks it up, charts included.
const jakarta = Plus_Jakarta_Sans({ variable: '--font-sans', subsets: ['latin'] });

// Charts pull in recharts; load lazily on the client to keep the initial bundle lean.
const MonthlyDemandProduction = dynamic(() => import('./ProductionCharts').then((m) => m.MonthlyDemandProduction), { ssr: false });
const DemandProductionTrend = dynamic(() => import('./ProductionCharts').then((m) => m.DemandProductionTrend), { ssr: false });
const OrderStatusDonut = dynamic(() => import('./ProductionCharts').then((m) => m.OrderStatusDonut), { ssr: false });
const BranchCompareBars = dynamic(() => import('./ProductionCharts').then((m) => m.BranchCompareBars), { ssr: false });

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });
const shortBranch = (name: string) => name.replace('Mountain Bakes ', '');

const PERIODS: { key: ProductionPeriod; label: string; name: string; versus: string; unit: string }[] = [
  { key: 'today', label: 'Today', name: 'today', versus: 'yesterday', unit: 'hour' },
  { key: 'week', label: 'This week', name: 'this week', versus: 'the same days of last week', unit: 'day' },
  { key: 'month', label: 'This month', name: 'this month', versus: 'the same days of last month', unit: 'day' },
];

// One dot colour per branch chip, in list order; purely an identifier.
const BRANCH_DOTS = ['#F26B2A', '#6B3A1F', '#D99A1E', '#B5482A', '#A07A55', '#E8A06A', '#8E5B3A', '#C9B08F'];

const TONE = {
  good: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  warn: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  bad: 'bg-red-500/10 text-red-600 dark:text-red-400',
  accent: 'bg-primary/10 text-primary',
} as const;

function Badge({ tone, children }: { tone: keyof typeof TONE; children: React.ReactNode }) {
  return (
    <span className={cn('inline-block whitespace-nowrap rounded-full px-[9px] py-[3px] text-[11.5px] font-bold', TONE[tone])}>
      {children}
    </span>
  );
}

/** Change against the same stretch of the previous period, or null when there is nothing to compare with. */
function pctChange(p: WeekPair | undefined): number | null {
  if (!p || !p.prev) return null;
  return ((p.cur - p.prev) / p.prev) * 100;
}

/** `invert` for figures where a rise is the bad direction (open orders, returns). */
function Delta({ value, suffix = '%', versus, invert }: { value: number | null; suffix?: string; versus: string; invert?: boolean }) {
  if (value === null || !Number.isFinite(value)) return null;
  const up = value >= 0;
  return (
    <span
      className={cn('whitespace-nowrap rounded-full px-[7px] py-0.5 text-[11px] font-bold tabular-nums', (invert ? !up : up) ? TONE.good : TONE.bad)}
      title={`Against ${versus}`}
    >
      {up ? '+' : ''}{value.toFixed(1)}{suffix}
    </span>
  );
}

function Kpi({ name, value, note, delta, loading }: { name: string; value: string; note: string; delta?: React.ReactNode; loading?: boolean }) {
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border bg-card px-[18px] py-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12.5px] font-semibold text-muted-foreground">{name}</p>
        {!loading && delta}
      </div>
      {loading ? <Skeleton className="h-7 w-20" /> : <p className="text-[28px] font-extrabold leading-none tracking-[-0.5px] tabular-nums">{value}</p>}
      <p className="text-[11.5px] text-muted-foreground">{note}</p>
    </div>
  );
}

function Empty({ children = 'No data yet' }: { children?: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

function TopProducts({ rows }: { rows: ProductionWeek['plan'] }) {
  if (rows.length === 0) return <Empty />;
  const max = Math.max(...rows.map((r) => r.demand), 1);
  return (
    <ol className="flex flex-col gap-[9px]">
      {rows.map((r, i) => (
        <li key={r.productId ?? r.productName} className="grid grid-cols-[22px_minmax(0,130px)_1fr_52px] items-center gap-2.5 text-[12.5px]">
          <span className="text-[11px] font-bold tabular-nums text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
          <span className="truncate font-semibold" title={r.productName}>{r.productName}</span>
          <span className="block overflow-hidden rounded bg-muted">
            <span
              className="block h-3 rounded"
              style={{
                width: `${Math.max((r.demand / max) * 100, 2)}%`,
                // Fades from the accent toward grey down the ranking, as in the design.
                backgroundColor: `color-mix(in oklab, var(--chart-1) ${100 - i * 8}%, var(--muted-foreground))`,
              }}
            />
          </span>
          <span className="text-right font-bold tabular-nums">{fmt(r.demand)}</span>
        </li>
      ))}
    </ol>
  );
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

export function ProductionDashboard() {
  const { token } = useAuth();
  const [branchId, setBranchId] = useState<string | null>(null);
  const [period, setPeriod] = useState<ProductionPeriod>('week');
  const { data, isLoading, isPlaceholderData, isFetching, refetch, dataUpdatedAt } = useProductionOverview(token, branchId, period);
  const per = PERIODS.find((p) => p.key === period) ?? PERIODS[1];

  const c = data?.cards;
  const w = data?.week;
  const k = w?.kpis;
  const branches = data?.branches ?? [];
  const branchName = branchId ? shortBranch(branches.find((b) => b.branchId === branchId)?.branchName ?? 'Branch') : null;
  const scope = branchName ?? 'All branches';

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
        : `${format(parseISO(w.from), 'MMM d')} – ${format(parseISO(w.to), 'MMM d')}`;
    } catch { return per.name; }
  }, [w, per.name]);

  let updatedAt = '';
  try { if (dataUpdatedAt) updatedAt = format(new Date(dataUpdatedAt), 'hh:mm:ss a'); } catch { /* keep blank */ }

  const demand = k?.demand.cur ?? 0;
  const produced = k?.produced.cur ?? 0;
  // The pool can be negative (more promised than held); a shortfall is not
  // stock, so it adds nothing to what is available to meet demand.
  const poolStock = Math.max(c?.availableProductionStock ?? 0, 0);
  const rate = (num: number, den: number) => (den > 0 ? Math.min((num / den) * 100, 100) : null);
  // One branch: what it actually received. All branches: what Production can
  // supply — the period's output plus what is still on the shelf.
  const fulfilment = branchId ? rate(k?.delivered.cur ?? 0, demand) : rate(produced + poolStock, demand);
  const prevFulfilment = branchId && k ? rate(k.delivered.prev, k.demand.prev) : null;
  const deliveredTo = (w?.branchCompare ?? []).filter((b) => b.delivered > 0).length;

  const os = w?.orderStatus;
  const statusSlices = [
    { label: 'Waiting approval', value: os?.pending ?? 0, color: '#D99A1E' },
    { label: 'Awaiting branch verification', value: os?.awaitingVerification ?? 0, color: 'var(--chart-1)' },
    { label: 'Verified by branch', value: os?.verified ?? 0, color: 'var(--chart-3)' },
    { label: 'Delivered', value: os?.approved ?? 0, color: 'var(--chart-2)' },
    { label: 'Rejected', value: os?.rejected ?? 0, color: 'var(--destructive)' },
  ];

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
    { name: "Today's production", value: c?.todayProduction ?? 0 },
    { name: 'Weekly production', value: c?.weeklyProduction ?? 0 },
    { name: 'Monthly production', value: c?.monthlyProduction ?? 0 },
  ];

  const chip = (active: boolean) => cn(
    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-semibold transition-colors',
    active ? 'border-foreground bg-foreground text-background' : 'bg-card hover:bg-muted',
  );
  const delta = (pair: WeekPair | undefined, invert?: boolean) => <Delta value={pctChange(pair)} versus={per.versus} invert={invert} />;

  return (
    <div className={cn(jakarta.variable, 'space-y-4 font-sans')}>
      {/* Live indicator, period switch, refresh */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="mr-auto flex items-center gap-1.5 whitespace-nowrap text-[11.5px] text-muted-foreground">
          <span className="size-[7px] rounded-full bg-emerald-500 animate-pulse" />
          <span>Live{updatedAt && <> · updated <span className="tabular-nums">{updatedAt}</span></>}</span>
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
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex items-center gap-1.5 rounded-[9px] border bg-card px-3.5 py-[7px] text-[12.5px] font-semibold transition-colors hover:bg-muted disabled:opacity-60"
        >
          <RefreshCw className={cn('size-3.5', isFetching && 'animate-spin')} aria-hidden />
          Refresh
        </button>
      </div>

      {/* Branch filter */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by branch">
        <span className="mr-1 text-xs font-bold uppercase tracking-[0.6px] text-muted-foreground">Branch</span>
        <button type="button" className={chip(branchId === null)} aria-pressed={branchId === null} onClick={() => setBranchId(null)}>
          <span className={cn('size-[7px] rounded-full', branchId === null ? 'bg-background' : 'bg-foreground')} aria-hidden />
          All branches
        </button>
        {branches.map((b, i) => (
          <button key={b.branchId} type="button" className={chip(branchId === b.branchId)} aria-pressed={branchId === b.branchId} onClick={() => setBranchId(b.branchId)}>
            <span className="size-[7px] rounded-full" style={{ backgroundColor: BRANCH_DOTS[i % BRANCH_DOTS.length] }} aria-hidden />
            {shortBranch(b.branchName)}
          </button>
        ))}
      </div>

      <div className={cn('space-y-4 transition-opacity', isPlaceholderData && 'opacity-60')}>
        {/* KPIs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fit,minmax(190px,1fr))]">
          <Kpi name="Total demand" value={fmt(demand)} note={`units requested ${per.name}`} delta={delta(k?.demand)} loading={isLoading} />
          <Kpi
            name="Produced"
            value={fmt(produced)}
            note={branchId ? 'all branches — central pool' : demand > 0 ? `${Math.round((produced / demand) * 100)}% of demand` : `units prepared ${per.name}`}
            delta={delta(k?.produced)}
            loading={isLoading}
          />
          <Kpi
            name="Fulfilment rate"
            value={fulfilment === null ? '—' : `${fulfilment.toFixed(1)}%`}
            note={branchId ? 'delivered ÷ demand' : 'incl. available stock'}
            delta={<Delta value={fulfilment !== null && prevFulfilment !== null ? fulfilment - prevFulfilment : null} suffix=" pts" versus={per.versus} />}
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

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <DemandProductionTrend
              data={trend}
              subtitle={`${scope} · units per ${per.unit} · ${rangeLabel}${branchId ? ' · produced is all branches' : ''}`}
              loading={isLoading}
            />
          </div>
          <OrderStatusDonut
            slices={statusSlices}
            extra={{ label: 'Changed by production', value: os?.changed ?? 0 }}
            subtitle={`${scope}, ${per.name}`}
            loading={isLoading}
          />
        </div>

        <MonthlyDemandProduction
          data={monthly}
          subtitle={`${scope} · units per month, last 12 months · the current month is to date${branchId ? ' · produced is all branches' : ''}`}
          loading={isLoading}
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <BranchCompareBars
            data={w?.branchCompare ?? []}
            selectedId={branchId}
            onSelect={(id) => setBranchId((cur) => (cur === id ? null : id))}
            loading={isLoading}
          />
          <Panel title="Top 10 requested products" subtitle={`${scope} · units demanded ${per.name}`}>
            {isLoading ? <Skeleton className="h-60 w-full" /> : <TopProducts rows={plan} />}
          </Panel>
        </div>

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
      <LoginHistoryCard />
    </div>
  );
}
