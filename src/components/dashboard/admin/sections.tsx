'use client';

import { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  BadgePercent,
  CalendarDays,
  ClipboardCheck,
  Coins,
  Factory,
  Inbox,
  PackageX,
  Receipt,
  RotateCcw,
  Scale,
  ShoppingCart,
  Store,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import {
  businessDateStr,
  type CurrentStockSection,
  type FinanceDashboardMetric,
  type FinanceMonthlyDashboard,
  type ReportSummary,
  type SalesAnalytics,
  type SalesTopProductLimit,
} from '@mb/shared';
import { useFinanceDashboard } from '@/lib/finance';
import type { ProductionOverview } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PaymentMethodSummary } from '@/components/dashboard/daily-sales/PaymentMethodSummary';
import { TopSellingProducts } from '@/components/dashboard/daily-sales/TopSellingProducts';
import { CashStrip, FinanceDashboardBody } from '@/components/finance/dashboard/FinanceMonthlyDashboard';
import { BarList, Panel } from '@/components/finance/dashboard/FinanceCharts';
import {
  dayLabel,
  monthLong,
  sortRows,
  type DrillTarget,
  type Granularity,
  type SortState,
} from '@/components/finance/dashboard/dashboard-model';
import { BranchPerformanceChart, DailyDemandChart, WeeklyReturnDiscountChart } from './AdminCharts';

// recharts is heavy; keep the sales graph out of the dashboard's first bundle.
const DailySalesGraph = dynamic(
  () => import('@/components/dashboard/daily-sales/DailySalesGraph').then((m) => m.DailySalesGraph),
  { ssr: false, loading: () => <Skeleton className="h-[300px] w-full" /> },
);
import {
  branchSummaryRows,
  dailyDemand,
  demandComparison,
  weeklyReturnsDiscount,
  SALES_PERIODS,
  salesPeriodLabel,
  type BranchSummaryRow,
  type LiveSaleRow,
  type SalesPeriod,
} from './admin-model';

type Format = (v: number | null | undefined) => string;
type DrillTo = (metric: FinanceDashboardMetric, extra?: Partial<DrillTarget>) => void;

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** Icon tile tints — the series colour of the figure the tile shows. */
const TONES = {
  share: 'bg-fin-share/12 text-fin-share',
  received: 'bg-fin-received/12 text-fin-received',
  ledger: 'bg-fin-ledger/15 text-fin-ledger',
  returns: 'bg-fin-return/12 text-fin-return',
  discount: 'bg-fin-discount/12 text-fin-discount',
  accent: 'bg-primary/10 text-primary',
  neutral: 'bg-muted text-foreground',
} as const;

export function KpiTile({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'accent',
  negative,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: LucideIcon;
  tone?: keyof typeof TONES;
  negative?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="flex min-w-0 flex-col gap-1.5">
        <span className="text-sm font-semibold text-muted-foreground">{label}</span>
        <span className={cn('text-xl font-extrabold tracking-tight tabular-nums sm:text-2xl', negative && 'text-destructive')}>
          {value}
        </span>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </span>
      <span className={cn('flex size-11 flex-none items-center justify-center rounded-xl', TONES[tone])}>
        <Icon className="size-5" aria-hidden />
      </span>
    </>
  );
  const cls = 'flex min-w-0 justify-between gap-3 rounded-xl border bg-card px-4 py-5 text-left shadow-xs';
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      title="View source records"
      className={cn(cls, 'cursor-pointer transition-colors hover:border-primary/50')}
    >
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function SectionHeading({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="text-lg font-bold sm:text-xl">{title}</h2>
      <p className="text-sm text-muted-foreground">{sub}</p>
    </div>
  );
}

const KPI_GRID = 'grid grid-cols-1 gap-3.5 min-[480px]:grid-cols-2 xl:grid-cols-4';

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export function SalesOverview({
  sales,
  loading,
  failed,
  onRetry,
  currency,
  topLimit,
  onTopLimit,
  subtitle,
  format,
}: {
  sales: SalesAnalytics | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  currency: string;
  topLimit: SalesTopProductLimit;
  onTopLimit: (l: SalesTopProductLimit) => void;
  subtitle: string;
  format: Format;
}) {
  const s = sales;
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <SectionHeading title="Sales Overview" sub={`Point-of-sale orders · ${subtitle}`} />
      {failed && !s ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-4 text-sm">
          <span>The sales figures could not be loaded. The rest of the dashboard is unaffected.</span>
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3.5 min-[480px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
            <KpiTile
              label="Total Sales"
              value={s ? format(s.totalSales) : '…'}
              sub="Paid orders at the counter"
              icon={Inbox}
              tone="accent"
            />
            <KpiTile
              label="Transactions"
              value={s ? s.totalTransactions.toLocaleString() : '…'}
              sub="Paid orders, cancelled and staff excluded"
              icon={ShoppingCart}
            />
            <KpiTile
              label="Average Sale"
              value={s ? (s.totalTransactions ? format(s.totalSales / s.totalTransactions) : '—') : '…'}
              sub="Total Sales ÷ transactions"
              icon={Receipt}
              tone="received"
            />
            <KpiTile
              label="Average Daily Sales"
              value={s ? format(s.averageDailySales) : '…'}
              sub="Over every elapsed day of the range"
              icon={CalendarDays}
              tone="ledger"
            />
            <KpiTile
              label="Staff Sales (unpaid)"
              value={s ? format(s.staffTotal) : '…'}
              sub={s ? `${plural(s.staffCount, 'sale')} · not in Total Sales` : 'Not in Total Sales'}
              icon={Users}
              tone="neutral"
            />
          </div>
          <Panel title="Daily Sales" aside={<span className="text-[11px] text-muted-foreground">{subtitle}</span>}>
            {s ? <DailySalesGraph data={s.daily} currency={currency} /> : <Skeleton className="h-[300px] w-full" />}
          </Panel>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            <PaymentMethodSummary analytics={s} loading={loading} currency={currency} />
            <TopSellingProducts
              products={s?.topProducts ?? []}
              loading={loading}
              currency={currency}
              limit={topLimit}
              onLimitChange={onTopLimit}
            />
          </div>
        </>
      )}
    </section>
  );
}

/** One branch's figure for the period: its name in one box, its sale in the other. */
function LiveSaleCard({ row, label, format }: { row: LiveSaleRow; label: string; format: Format }) {
  return (
    <div data-testid="live-sale-card" className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card">
      {/* Two lines' room for every name, so the amount boxes line up across a row. */}
      <div className="flex min-h-[3.75rem] items-center border-b bg-muted/50 px-3.5 py-2.5">
        <p className="line-clamp-2 text-sm leading-snug font-semibold break-words" title={row.branch}>
          {row.branch}
        </p>
      </div>
      <div className="flex flex-1 flex-col px-3.5 py-3">
        <p className={cn('text-lg font-extrabold whitespace-nowrap tabular-nums', !row.sales && 'text-muted-foreground')}>
          {format(row.sales)}
        </p>
        <p className="mt-0.5 text-xs font-medium text-muted-foreground">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{row.orders ? plural(row.orders, 'order') : 'No sales yet'}</p>
      </div>
    </div>
  );
}

/** A card while the figures load, laid out as the loaded one. */
function LiveSaleCardSkeleton() {
  return (
    <div data-testid="live-sale-card-skeleton" className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card">
      <div className="flex min-h-[3.75rem] items-center border-b bg-muted/50 px-3.5 py-2.5">
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="flex flex-col gap-1.5 px-3.5 py-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-3 w-14" />
      </div>
    </div>
  );
}

/**
 * How current the figures are. `live` only while the period takes in today and
 * the last refresh is recent; `closed` for a period that is over, which cannot
 * change; the other three say plainly that updates have stopped, so a frozen
 * figure is never passed off as live.
 */
export type LiveSalesStatus = 'loading' | 'live' | 'closed' | 'stale' | 'offline' | 'error';

const clock = (ms: number) => new Date(ms).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function LiveStatus({ status, updatedAt, onRetry }: { status: LiveSalesStatus; updatedAt: number | null; onRetry: () => void }) {
  if (status === 'loading' || !updatedAt) return null;
  const at = clock(updatedAt);
  const [dot, text] =
    status === 'live'
      ? ['bg-emerald-500 animate-pulse', `Live · updated ${at}`]
      : status === 'closed'
        ? ['bg-muted-foreground', `Closed period · loaded ${at}`]
        : status === 'offline'
          ? ['bg-amber-500', `Offline · showing figures from ${at}`]
          : status === 'stale'
            ? ['bg-amber-500', `Not updating · last updated ${at}`]
            : ['bg-destructive', `Could not refresh · showing figures from ${at}`];
  return (
    <span data-testid="live-sales-status" className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
      <span className={cn('size-2 shrink-0 rounded-full', dot)} aria-hidden />
      {text}
      {(status === 'error' || status === 'stale') && (
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onRetry}>
          Retry
        </Button>
      )}
    </span>
  );
}

/**
 * Live Sales — All Branches: one card per active branch with its paid sales
 * for the chosen period, and the combined total under them.
 *
 * Every figure is a per-branch sum from the server (useBranchSales); the total
 * is those branch figures added together, so it matches the cards exactly.
 * Always every branch, whatever branch the dashboard's own filter is on — that
 * filter scopes the month figures below, this board is the whole company.
 *
 * Wraps two across on a phone and as many as fit on a wider screen, rather
 * than scrolling the page sideways.
 */
export function LiveBranchSales({
  rows,
  loading,
  failed,
  onRetry,
  period,
  onPeriod,
  custom,
  onCustom,
  today,
  from,
  to,
  status,
  updatedAt,
  format,
}: {
  rows: LiveSaleRow[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  period: SalesPeriod;
  onPeriod: (p: SalesPeriod) => void;
  custom: { from: string; to: string };
  onCustom: (c: { from: string; to: string }) => void;
  today: string;
  from: string;
  to: string;
  status: LiveSalesStatus;
  updatedAt: number | null;
  format: Format;
}) {
  const label = salesPeriodLabel(period, from, to);
  const range = from === to ? `${dayLabel(from)} ${from.slice(0, 4)}` : `${dayLabel(from)} – ${dayLabel(to)} ${to.slice(0, 4)}`;
  const total = rows.reduce((s, r) => s + r.sales, 0);
  const orders = rows.reduce((s, r) => s + r.orders, 0);
  const dateCls = 'h-10 rounded-lg border bg-card px-2.5 text-base text-foreground md:h-8 md:text-sm';
  return (
    <section
      id="live-sales"
      data-testid="live-sales"
      aria-labelledby="live-sales-title"
      className="min-w-0 scroll-mt-20 overflow-hidden rounded-xl border bg-card shadow-xs"
    >
      <div className="flex flex-col gap-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2 id="live-sales-title" className="text-base font-bold tracking-wide uppercase sm:text-lg">
              Live Sales — All Branches
            </h2>
            <p className="text-xs text-muted-foreground">
              {label} · {range} · paid orders, cancelled and staff sales excluded
            </p>
          </div>
          <LiveStatus status={status} updatedAt={updatedAt} onRetry={onRetry} />
        </div>
        <div className="no-print flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Sales period" className="flex max-w-full flex-wrap gap-1 rounded-lg bg-muted p-[3px]">
            {SALES_PERIODS.map((p) => (
              <button
                key={p.key}
                type="button"
                aria-pressed={period === p.key}
                onClick={() => onPeriod(p.key)}
                className={cn(
                  'h-9 shrink-0 rounded-md px-3 text-sm font-semibold transition-colors md:h-7',
                  period === p.key ? 'bg-card text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          {period === 'custom' && (
            <div className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
              <input
                type="date"
                aria-label="From date"
                className={dateCls}
                max={today}
                value={custom.from}
                onChange={(e) => e.target.value && onCustom({ from: e.target.value, to: custom.to < e.target.value ? e.target.value : custom.to })}
              />
              <span>to</span>
              <input
                type="date"
                aria-label="To date"
                className={dateCls}
                min={custom.from}
                max={today}
                value={custom.to}
                onChange={(e) => e.target.value && onCustom({ from: custom.from > e.target.value ? e.target.value : custom.from, to: e.target.value })}
              />
            </div>
          )}
        </div>
      </div>
      {failed && !rows.length ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 text-sm">
          <span>Branch sales could not be loaded. No figures are shown rather than out-of-date ones.</span>
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : !loading && !rows.length ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">There are no active branches to show.</p>
      ) : (
        <div className="flex flex-col gap-3 p-4" aria-busy={loading || undefined}>
          <div className="grid auto-rows-fr grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]">
            {loading
              ? [0, 1, 2, 3].map((i) => <LiveSaleCardSkeleton key={i} />)
              : rows.map((r) => <LiveSaleCard key={r.branchId} row={r} label={label} format={format} />)}
          </div>
          {!loading && (
            <div
              data-testid="live-sales-total"
              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 rounded-lg bg-fin-soft px-3.5 py-2.5"
            >
              <span className="text-sm font-extrabold uppercase">Total Sales</span>
              <span className="flex items-baseline gap-2">
                <span className="text-xs text-muted-foreground">{plural(orders, 'order')}</span>
                <span className="text-lg font-extrabold whitespace-nowrap tabular-nums">{format(total)}</span>
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Branch summary
// ---------------------------------------------------------------------------

type BranchKey =
  | 'branch'
  | 'demand'
  | 'companyShare'
  | 'received'
  | 'balance'
  | 'lastMonthBalance'
  | 'ledger'
  | 'returns'
  | 'discount';

const BRANCH_COLS: { key: BranchKey; label: string; metric?: FinanceDashboardMetric; signed?: boolean }[] = [
  { key: 'branch', label: 'Branch' },
  { key: 'demand', label: 'Demand Amount', metric: 'demand' },
  { key: 'companyShare', label: 'Company Share', metric: 'share' },
  { key: 'received', label: 'Received', metric: 'received' },
  { key: 'balance', label: 'Balance', signed: true },
  { key: 'ledger', label: 'Ledger Expense', metric: 'ledger' },
  { key: 'returns', label: 'Return', metric: 'return' },
  { key: 'discount', label: 'Discount', metric: 'discount' },
  { key: 'lastMonthBalance', label: 'Last Month Balance', signed: true },
];

function SortIcon({ active, dir }: { active: boolean; dir: 1 | -1 }) {
  const Icon = !active ? ArrowUpDown : dir === 1 ? ArrowUp : ArrowDown;
  return <Icon className={cn('size-3', !active && 'opacity-40')} aria-hidden />;
}

export function BranchSummary({
  data,
  scoped,
  subtitle,
  drillTo,
  format,
}: {
  data: FinanceMonthlyDashboard;
  scoped: boolean;
  subtitle: string;
  drillTo: DrillTo;
  format: Format;
}) {
  const rows = useMemo(() => branchSummaryRows(data), [data]);
  const [sort, setSort] = useState<SortState<BranchKey>>({ key: 'companyShare', dir: -1 });
  const sorted = useMemo(
    () => sortRows(rows, sort, (a, b) => a.branch.localeCompare(b.branch)),
    [rows, sort],
  );
  const s = data.summary;
  const month = monthLong(data.month);
  const sub = (r: BranchSummaryRow, key: BranchKey): string | null => {
    // Company expenses have no demand behind them — no count, no percentage.
    if (key === 'demand') return r.orders ? plural(r.orders, 'demand') : null;
    if (key === 'companyShare') return r.demand ? `${pct(r.companyShare, r.demand)} of demand` : null;
    if (key === 'received') return r.companyShare ? `${pct(r.received, r.companyShare)} of share` : null;
    return null;
  };
  const drillBranch = (metric: FinanceDashboardMetric, r: BranchSummaryRow) =>
    drillTo(metric, { branchId: r.branchId, context: `${month} · ${r.branch}` });

  const totals: Record<Exclude<BranchKey, 'branch'>, number | null> = {
    demand: s.demand,
    companyShare: s.companyShare,
    received: s.received,
    balance: s.balance,
    lastMonthBalance: s.lastMonthBalance,
    ledger: s.ledgerExpense,
    returns: s.returns,
    discount: s.discount,
  };

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <SectionHeading
        title="Branch Summary"
        sub={`Production demand, finance receipts and expenses per branch · ${subtitle}`}
      />
      <div className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[68rem] border-collapse text-sm">
            <thead>
              <tr className="border-b">
                {BRANCH_COLS.map((c) => {
                  const active = sort.key === c.key;
                  return (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
                      className={cn(
                        'px-3.5 py-3 text-xs font-bold whitespace-nowrap text-muted-foreground',
                        c.key === 'branch' ? 'text-left' : 'text-right',
                      )}
                    >
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 hover:text-foreground"
                        onClick={() =>
                          setSort(
                            active
                              ? { key: c.key, dir: sort.dir === 1 ? -1 : 1 }
                              : { key: c.key, dir: c.key === 'branch' ? 1 : -1 },
                          )
                        }
                      >
                        {c.label}
                        <SortIcon active={active} dir={sort.dir} />
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.branchId ?? '~unassigned'} className="border-b last:border-b-0 hover:bg-fin-row-hover">
                  {BRANCH_COLS.map((c) => {
                    if (c.key === 'branch') {
                      return (
                        <th key={c.key} scope="row" className="px-3.5 py-3 text-left font-semibold whitespace-nowrap">
                          {r.branch}
                        </th>
                      );
                    }
                    const v = r[c.key];
                    const negative = c.signed && v !== null && v < 0;
                    const text = v === null ? 'No records' : format(v);
                    const note = sub(r, c.key);
                    // A zero has no source records to open.
                    const canDrill = c.metric && v !== null && v !== 0;
                    return (
                      <td
                        key={c.key}
                        className={cn(
                          'px-3.5 py-3 text-right whitespace-nowrap tabular-nums',
                          c.key === 'balance' && 'font-bold',
                          negative && 'text-destructive',
                          v === null && 'text-muted-foreground',
                        )}
                      >
                        {canDrill ? (
                          <button
                            type="button"
                            title="View source records"
                            onClick={() => drillBranch(c.metric!, r)}
                            className="cursor-pointer border-b border-dotted border-muted-foreground/60 hover:border-primary hover:text-primary"
                          >
                            {text}
                          </button>
                        ) : (
                          text
                        )}
                        {note && <span className="block text-[11.5px] font-medium text-muted-foreground">{note}</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-fin-soft font-extrabold">
                <th scope="row" className="px-3.5 py-3 text-left">
                  Total
                </th>
                {BRANCH_COLS.slice(1).map((c) => {
                  const v = totals[c.key as Exclude<BranchKey, 'branch'>];
                  return (
                    <td
                      key={c.key}
                      className={cn(
                        'px-3.5 py-3 text-right whitespace-nowrap tabular-nums',
                        c.signed && v !== null && v < 0 && 'text-destructive',
                      )}
                    >
                      {v === null ? 'No records' : format(v)}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
          Balance = Company Share − Received. Last Month Balance is {monthLong(data.previousMonth)}’s, shown in the last column,
          not carried into Balance. Company expenses carry no branch and sit under “Company / unassigned”.
        </p>
      </div>

      {!scoped && (
        <Panel
          title="Branch Performance"
          aside={<span className="text-[11px] text-muted-foreground">Tap a branch for its company share</span>}
        >
          <BranchPerformanceChart rows={rows} onBranch={(r) => drillBranch('share', r)} />
        </Panel>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Production
// ---------------------------------------------------------------------------

export function ProductionSummary({
  data,
  subtitle,
  context,
  drillTo,
  format,
}: {
  data: FinanceMonthlyDashboard;
  subtitle: string;
  context: string;
  drillTo: DrillTo;
  format: Format;
}) {
  const s = data.summary;
  const daily = useMemo(() => dailyDemand(data), [data]);
  const weeks = useMemo(() => weeklyReturnsDiscount(data), [data]);
  const branches = useMemo(() => branchSummaryRows(data).filter((r) => r.demand > 0), [data]);
  const cmp = useMemo(() => demandComparison(data), [data]);
  const prevMonth = monthLong(data.previousMonth);
  const scopeOnly = context.split(' · ').slice(1).join(' · ');

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <SectionHeading title="Production Summary" sub={`Branch demand reviewed by Production · ${subtitle}`} />
      <div className="grid grid-cols-1 gap-3.5 min-[480px]:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <KpiTile
          label="Demand Amount"
          value={format(s.demand)}
          sub="Approved qty × product price"
          icon={Factory}
          tone="neutral"
          onClick={s.orders ? () => drillTo('demand') : undefined}
        />
        <KpiTile
          label="Company Share"
          value={format(s.companyShare)}
          sub={`${pct(s.companyShare, s.demand)} of demand`}
          icon={Coins}
          tone="share"
          onClick={s.orders ? () => drillTo('share') : undefined}
        />
        <KpiTile
          label="Approved Demands"
          value={s.orders.toLocaleString()}
          sub={`${data.branches.filter((b) => b.isActive).length} active branches`}
          icon={ClipboardCheck}
          tone="accent"
        />
        <KpiTile
          label="Average Daily Demand"
          value={cmp ? format(cmp.currentAvg) : '—'}
          sub={cmp ? 'Per elapsed day of the range' : 'No day of the range has passed yet'}
          icon={TrendingUp}
          tone="neutral"
        />
        <KpiTile
          label="Return"
          value={format(s.returns)}
          sub={`${plural(s.returnCount, 'accepted return')} · ${pct(s.returns, s.demand)}`}
          icon={RotateCcw}
          tone="returns"
          onClick={s.returnCount ? () => drillTo('return') : undefined}
        />
        <KpiTile
          label="Discount"
          value={format(s.discount)}
          sub={`${plural(s.discountCount, 'approved discount')} · ${pct(s.discount, s.demand)}`}
          icon={BadgePercent}
          tone="discount"
          onClick={s.discountCount ? () => drillTo('discount') : undefined}
        />
      </div>

      {s.unpricedLines > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {s.unpricedLines} delivered line{s.unpricedLines === 1 ? ' has' : 's have'} no product price and{' '}
          {s.unpricedLines === 1 ? 'is' : 'are'} valued at Rs. 0 in Demand and Company Share. Set the price under
          Products to include {s.unpricedLines === 1 ? 'it' : 'them'}.
        </p>
      )}

      <Panel
        title="Daily Approved Demand"
        aside={<span className="text-[11px] text-muted-foreground">Tap a day for its demands</span>}
      >
        {cmp && (
          <p className="mb-2 flex flex-wrap items-baseline gap-x-1.5 text-sm">
            {cmp.changePct === null ? (
              <span className="text-muted-foreground">No approved demand in {prevMonth} to compare against.</span>
            ) : (
              <>
                <strong className={cn('tabular-nums', cmp.changePct < 0 ? 'text-destructive' : 'text-emerald-700 dark:text-emerald-400')}>
                  {cmp.changePct >= 0 ? '+' : '−'}
                  {Math.abs(cmp.changePct).toFixed(1)}%
                </strong>
                <span className="text-muted-foreground">
                  daily average against {prevMonth} ({format(cmp.previousAvg)} a day)
                </span>
              </>
            )}
          </p>
        )}
        <DailyDemandChart
          data={daily}
          onDay={(d) => drillTo('demand', { from: d, to: d, context: `${dayLabel(d)} ${d.slice(0, 4)} · ${scopeOnly}` })}
        />
      </Panel>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <Panel title="Demand by Branch">
          <BarList
            emptyMessage="No approved demand in this date range."
            rows={branches.map((b) => ({
              key: b.branchId ?? '~unassigned',
              label: b.branch,
              sub: `${plural(b.orders, 'demand')} · ${pct(b.demand, s.demand)}`,
              value: b.demand,
              color: 'var(--chart-1)',
              onClick: () =>
                drillTo('demand', { branchId: b.branchId, context: `${monthLong(data.month)} · ${b.branch}` }),
            }))}
          />
        </Panel>
        <Panel title="Return & Discount · Weekly">
          <WeeklyReturnDiscountChart data={weeks} />
        </Panel>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

/**
 * The Finance Dashboard's own body — every card, chart and table it shows —
 * fed the Admin Dashboard's request, so the two pages cannot disagree and the
 * admin needs no separate Finance Dashboard. The cash strip is today's
 * position, company-wide, under the Finance Dashboard's own query key, so the
 * two pages share one cached answer.
 */
export function FinanceSummary({
  data,
  scoped,
  subtitle,
  context,
  incGran,
  setIncGran,
  expGran,
  setExpGran,
  drillTo,
  format,
}: {
  data: FinanceMonthlyDashboard;
  scoped: boolean;
  subtitle: string;
  context: string;
  incGran: Granularity;
  setIncGran: (g: Granularity) => void;
  expGran: Granularity;
  setExpGran: (g: Granularity) => void;
  drillTo: DrillTo;
  format: Format;
}) {
  const today = businessDateStr();
  const cash = useFinanceDashboard({ from: today, to: today });
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <SectionHeading
        title="Finance Summary"
        sub={`Company Share, Finance Ledger receipts and company expenses · ${subtitle}`}
      />
      <CashStrip cash={cash.data} loading={cash.isLoading} format={format} />
      <FinanceDashboardBody
        data={data}
        context={context}
        scoped={scoped}
        incGran={incGran}
        setIncGran={setIncGran}
        expGran={expGran}
        setExpGran={setExpGran}
        drillTo={drillTo}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/**
 * Today at a glance, from three requests the app already makes — none summed
 * here: the daily report summary (sales, orders, shop expenses), Production's
 * overview (orders waiting, active branches) and its live stock section (low
 * and out-of-stock products). Each tile says "…" while its request is in
 * flight and "—" if it failed, so one slow source never blanks the others.
 *
 * The profit tile is the report's own `totalProfit` — sales less shop expenses,
 * nothing else — and says so under the figure: there is no production cost
 * behind it, so it must not read as the business's profit.
 */
export function TodaySnapshot({
  businessDate,
  scope,
  today,
  production,
  stock,
  format,
  onRetry,
}: {
  businessDate: string;
  scope: string;
  today: { data: ReportSummary | undefined; failed: boolean };
  production: { data: ProductionOverview | undefined; failed: boolean };
  stock: { data: CurrentStockSection | undefined; failed: boolean };
  format: Format;
  onRetry: () => void;
}) {
  const t = today.data;
  const c = production.data?.cards;
  const k = stock.data?.kpis;
  const v = (ok: boolean, failed: boolean, value: () => string) => (ok ? value() : failed ? '—' : '…');
  const anyFailed = (today.failed && !t) || (production.failed && !c) || (stock.failed && !k);
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <SectionHeading title="Today" sub={`Business day ${dayLabel(businessDate)} ${businessDate.slice(0, 4)} · ${scope}`} />
      {anyFailed && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-2.5 text-sm">
          <span>Some of today&apos;s figures could not be loaded and show as —.</span>
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3.5 min-[480px]:grid-cols-2 lg:grid-cols-3 min-[1760px]:grid-cols-4">
        <KpiTile
          label="Today's Sales"
          value={v(!!t, today.failed, () => format(t!.totalRevenue))}
          sub={t ? `${plural(t.totalOrders, 'order')} · staff sales excluded` : 'Point-of-sale orders'}
          icon={Inbox}
          tone="accent"
        />
        <KpiTile
          label="Today's Shop Expenses"
          value={v(!!t, today.failed, () => format(t!.totalExpenses))}
          sub="Recorded by the branches today"
          icon={Receipt}
          tone="ledger"
        />
        <KpiTile
          label="Today's Profit"
          value={v(!!t, today.failed, () => format(t!.totalProfit))}
          negative={!!t && t.totalProfit < 0}
          sub="Sales less shop expenses · production cost not included"
          icon={TrendingUp}
          tone="received"
        />
        <KpiTile
          label="Pending Orders"
          value={v(!!t, today.failed, () => t!.totalPending.toLocaleString())}
          sub="Point-of-sale orders still pending today"
          icon={ShoppingCart}
          tone="neutral"
        />
        <KpiTile
          label="Waiting Production Orders"
          value={v(!!c, production.failed, () => c!.waitingOrders.toLocaleString())}
          sub="Branch demands not yet taken up by Production"
          icon={Factory}
          tone="share"
        />
        <KpiTile
          label="Active Branches"
          value={v(!!c, production.failed, () => c!.totalBranches.toLocaleString())}
          sub="Branches open for orders"
          icon={Store}
          tone="received"
        />
        <KpiTile
          label="Low-Stock Products"
          value={v(!!k, stock.failed, () => k!.low.toLocaleString())}
          sub={
            k
              ? `${plural(k.out, 'product')} out of stock · under ${stock.data!.breakdown.threshold} units`
              : 'Production plus branch stock'
          }
          icon={PackageX}
          tone="returns"
        />
      </div>
    </section>
  );
}

/** The four headline tiles for the selected month. */
export function HeadlineKpis({
  data,
  sales,
  salesFailed,
  drillTo,
  format,
}: {
  data: FinanceMonthlyDashboard;
  sales: SalesAnalytics | null;
  salesFailed: boolean;
  drillTo: DrillTo;
  format: Format;
}) {
  const s = data.summary;
  const prevMonth = monthLong(data.previousMonth);
  return (
    <div className={KPI_GRID}>
      <KpiTile
        label="Total Sales"
        value={sales ? format(sales.totalSales) : salesFailed ? '—' : '…'}
        sub={
          sales
            ? `${plural(sales.totalTransactions, 'transaction')} at the counter`
            : salesFailed
              ? 'Sales could not be loaded'
              : 'Loading sales…'
        }
        icon={Inbox}
        tone="accent"
      />
      <KpiTile
        label="Company Share"
        value={format(s.companyShare)}
        sub={`${pct(s.companyShare, s.demand)} of ${format(s.demand)} demand`}
        icon={Coins}
        tone="share"
        onClick={s.orders ? () => drillTo('share') : undefined}
      />
      <KpiTile
        label="Received"
        value={format(s.received)}
        sub={`${pct(s.received, s.companyShare)} of company share`}
        icon={Wallet}
        tone="received"
        onClick={s.receipts ? () => drillTo('received') : undefined}
      />
      <KpiTile
        label="Balance"
        value={format(s.balance)}
        negative={s.balance < 0}
        sub={
          s.lastMonthBalance === null
            ? `No records in ${prevMonth}`
            : `${prevMonth}: ${format(s.lastMonthBalance)}`
        }
        icon={Scale}
        tone="neutral"
      />
    </div>
  );
}
