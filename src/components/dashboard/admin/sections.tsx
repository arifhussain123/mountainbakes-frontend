'use client';

import { useMemo, useState } from 'react';
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
  Receipt,
  RotateCcw,
  Scale,
  ShoppingCart,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type {
  FinanceDashboardMetric,
  FinanceMonthlyDashboard,
  SalesAnalytics,
  SalesTopProductLimit,
} from '@mb/shared';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PaymentMethodSummary } from '@/components/dashboard/daily-sales/PaymentMethodSummary';
import { TopSellingProducts } from '@/components/dashboard/daily-sales/TopSellingProducts';
import { financeOverviewGroups, OverviewCard } from '@/components/finance/dashboard/FinanceMonthlyDashboard';
import { BarList, DailyShareReceivedChart, Panel, SERIES } from '@/components/finance/dashboard/FinanceCharts';
import { ExpenseTable, IncomeTable } from '@/components/finance/dashboard/FinanceTables';
import {
  bucketRange,
  dailySeries,
  dayLabel,
  expenseRows,
  incomeRows,
  ledgerHeadTotals,
  monthLong,
  sortRows,
  type DrillTarget,
  type Granularity,
  type SortState,
} from '@/components/finance/dashboard/dashboard-model';
import { BranchPerformanceChart, DailyDemandChart, WeeklyReturnDiscountChart } from './AdminCharts';
import {
  branchSummaryRows,
  dailyDemand,
  demandComparison,
  weeklyReturnsDiscount,
  type BranchSummaryRow,
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
}: {
  sales: SalesAnalytics | null;
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  currency: string;
  topLimit: SalesTopProductLimit;
  onTopLimit: (l: SalesTopProductLimit) => void;
  subtitle: string;
}) {
  const money = (n: number) => `${currency}${Math.round(n).toLocaleString()}`;
  const s = sales;
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <SectionHeading title="Sales Overview" sub={`Point-of-sale orders · ${subtitle}`} />
      {failed && !s ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card px-4 py-4 text-sm">
          <span>The sales figures could not be loaded. The finance figures below are unaffected.</span>
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <div className={KPI_GRID}>
            <KpiTile
              label="Total Sales"
              value={s ? money(s.totalSales) : '…'}
              sub="Paid orders, cancelled and staff excluded"
              icon={Wallet}
            />
            <KpiTile
              label="Transactions"
              value={s ? s.totalTransactions.toLocaleString() : '…'}
              sub={s && s.staffCount ? `+ ${plural(s.staffCount, 'staff sale')} (unpaid)` : 'Paid orders'}
              icon={ShoppingCart}
              tone="received"
            />
            <KpiTile
              label="Average Sale"
              value={s ? (s.totalTransactions ? money(s.totalSales / s.totalTransactions) : '—') : '…'}
              sub="Total Sales ÷ transactions"
              icon={Receipt}
              tone="ledger"
            />
            <KpiTile
              label="Average Daily Sales"
              value={s ? money(s.averageDailySales) : '…'}
              sub="Over every elapsed day of the range"
              icon={CalendarDays}
              tone="neutral"
            />
          </div>
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
  { key: 'lastMonthBalance', label: 'Last Month Balance', signed: true },
  { key: 'ledger', label: 'Ledger Expense', metric: 'ledger' },
  { key: 'returns', label: 'Return', metric: 'return' },
  { key: 'discount', label: 'Discount', metric: 'discount' },
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
    if (key === 'demand') return plural(r.orders, 'demand');
    if (key === 'companyShare') return `${pct(r.companyShare, r.demand)} of demand`;
    if (key === 'received') return `${pct(r.received, r.companyShare)} of share`;
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
          Balance = Company Share − Received. Last Month Balance is {monthLong(data.previousMonth)}’s, shown beside it,
          not carried into it. Company expenses carry no branch and sit under “Company / unassigned”.
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
          sub={plural(s.orders, 'reviewed order')}
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
  const s = data.summary;
  const daily = useMemo(() => dailySeries(data), [data]);
  const heads = useMemo(() => ledgerHeadTotals(data), [data]);
  const inc = useMemo(() => incomeRows(data, incGran), [data, incGran]);
  const exp = useMemo(() => expenseRows(data, expGran), [data, expGran]);
  const overview = financeOverviewGroups(data, scoped, drillTo);
  const scopeOnly = context.split(' · ').slice(1).join(' · ');

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <SectionHeading
        title="Finance Summary"
        sub={`Company Share, Finance Ledger receipts and company expenses · ${subtitle}`}
      />
      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
        {overview.map((g) => (
          <OverviewCard key={g.title} group={g} format={format} />
        ))}
      </div>

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
        <Panel
          title="Company Share vs Received"
          aside={<span className="text-[11px] text-muted-foreground">Tap a day for its demands</span>}
        >
          <DailyShareReceivedChart
            data={daily}
            onDay={(d) => drillTo('share', { from: d, to: d, context: `${dayLabel(d)} ${d.slice(0, 4)} · ${scopeOnly}` })}
          />
        </Panel>
        <Panel title="Ledger Head Breakdown" bodyClassName="max-h-[19rem] overflow-y-auto">
          <BarList
            emptyMessage={
              scoped
                ? 'No ledger expense is recorded against this branch — company expenses carry no branch.'
                : 'No ledger expense in this period.'
            }
            rows={heads.map((h) => ({
              key: h.ledgerHeadId,
              label: h.name,
              sub: `${plural(h.entries, 'entry', 'entries')} · ${pct(h.amount, s.ledgerExpense)}`,
              value: h.amount,
              color: SERIES.ledger,
              onClick: () => drillTo('ledger', { ledgerHeadId: h.ledgerHeadId, context: `${context} · ${h.name}` }),
            }))}
          />
        </Panel>
      </div>

      <IncomeTable
        rows={inc}
        gran={incGran}
        onGran={setIncGran}
        onDrill={(metric, r) =>
          drillTo(metric, {
            ...bucketRange(incGran, r.bucket, data.from, data.to),
            branchId: r.branchId,
            context: `${r.period} · ${r.branch}`,
          })
        }
      />
      <ExpenseTable
        rows={exp}
        gran={expGran}
        onGran={setExpGran}
        heads={heads}
        onDrill={(metric, r) =>
          drillTo(metric, {
            ...bucketRange(expGran, r.bucket, data.from, data.to),
            branchId: r.branchId,
            ledgerHeadId: r.ledgerHeadId ?? undefined,
            context: `${r.period} · ${r.branch}${r.kind === 'ledger' ? ` · ${r.ledgerHead}` : ''}`,
          })
        }
      />
    </section>
  );
}

/** The four headline tiles above the sections. */
export function HeadlineKpis({
  data,
  sales,
  salesFailed,
  currency,
  drillTo,
  format,
}: {
  data: FinanceMonthlyDashboard;
  sales: SalesAnalytics | null;
  salesFailed: boolean;
  currency: string;
  drillTo: DrillTo;
  format: Format;
}) {
  const s = data.summary;
  const prevMonth = monthLong(data.previousMonth);
  return (
    <div className={KPI_GRID}>
      <KpiTile
        label="Total Sales"
        value={sales ? `${currency}${Math.round(sales.totalSales).toLocaleString()}` : salesFailed ? '—' : '…'}
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
