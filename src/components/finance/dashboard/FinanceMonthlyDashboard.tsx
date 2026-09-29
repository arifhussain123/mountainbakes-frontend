'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { AlertTriangle, Download, RotateCcw } from 'lucide-react';
import { businessDateStr, type FinanceDashboardMetric, type FinanceMonthlyDashboard as Dashboard } from '@mb/shared';
import { useFinanceDashboard, useFinanceMonthlyDashboard } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ROUTES } from '@/utils/routes';
import { cn } from '@/lib/utils';
import { useMoney } from '../finance-ui';
import {
  BarList,
  BranchExpenseChart,
  BranchIncomeChart,
  DailyShareReceivedChart,
  ExpenseTrendChart,
  MonthlyTrendChart,
  Panel,
  SERIES,
} from './FinanceCharts';
import { ExpenseTable, IncomeTable } from './FinanceTables';
import { RecordsDrawer } from './RecordsDrawer';
import {
  branchNamer,
  branchTotals,
  bucketRange,
  dailySeries,
  dayLabel,
  daysInMonth,
  downloadCsv,
  expenseRows,
  incomeRows,
  ledgerHeadTotals,
  monthLong,
  monthShort,
  shiftMonth,
  toCsv,
  type DrillTarget,
  type Granularity,
} from './dashboard-model';

const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
/** How far back the month picker reaches. */
const MONTHS_BACK = 24;

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Mountain Bakes Finance — the monthly finance control centre.
 *
 * Income is Production's approved demand and the company's share of it, set
 * against what the Finance Ledger shows as received; expense is the ledger's
 * company expense heads beside Production's returns and discounts. Every figure
 * is summed in Postgres (migration 128) and every figure opens its own source
 * records. docs/finance-dashboard-audit.md traces each one to the rule it
 * reuses.
 *
 * One request drives the page (plus the small cash strip): the month, branch
 * and date range change a single query key, so no card, chart or table can show
 * a different period from its neighbours.
 */
export function FinanceMonthlyDashboard() {
  const { format } = useMoney();
  // Business date, not the browser's calendar — the day rolls at 02:00 Karachi.
  const today = businessDateStr();
  const currentMonth = today.slice(0, 7);

  const [month, setMonth] = useState(currentMonth);
  const [dayFrom, setDayFrom] = useState(1);
  const [dayTo, setDayTo] = useState(31);
  const [branchId, setBranchId] = useState('');
  const [incGran, setIncGran] = useState<Granularity>('monthly');
  const [expGran, setExpGran] = useState<Granularity>('monthly');
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  const nd = daysInMonth(month);
  const f = Math.min(dayFrom, nd);
  const t = Math.max(f, Math.min(dayTo, nd));
  const fullMonth = f === 1 && t === nd;
  const q = useFinanceMonthlyDashboard({
    month,
    from: fullMonth ? undefined : `${month}-${pad(f)}`,
    to: fullMonth ? undefined : `${month}-${pad(t)}`,
    branchId: branchId || undefined,
  });
  const data = q.data;
  const cash = useFinanceDashboard({ from: today, to: today });

  const monthOptions = useMemo(
    () => Array.from({ length: MONTHS_BACK }, (_, i) => shiftMonth(currentMonth, -i)),
    [currentMonth],
  );
  const years = [...new Set(monthOptions.map((m) => m.slice(0, 4)))];
  const year = month.slice(0, 4);

  const setFilter = (next: { month?: string; branchId?: string; from?: number; to?: number }) => {
    if (next.month !== undefined) {
      setMonth(next.month);
      setDayFrom(1);
      setDayTo(31);
    }
    if (next.branchId !== undefined) setBranchId(next.branchId);
    if (next.from !== undefined) setDayFrom(next.from);
    if (next.to !== undefined) setDayTo(next.to);
  };
  const reset = () => {
    setFilter({ month: currentMonth, branchId: '' });
    setIncGran('monthly');
    setExpGran('monthly');
  };

  const name = data ? branchNamer(data) : () => '';
  const scopeLabel = !branchId ? 'All Branches' : data ? name(branchId) : 'Selected branch';
  const rangeLabel = fullMonth ? 'Full month' : `${pad(f)}–${pad(t)} ${monthShort(month)}`;
  const context = `${monthLong(month)} · ${scopeLabel}${fullMonth ? '' : ` · ${rangeLabel}`}`;
  const drillTo = (metric: FinanceDashboardMetric, extra: Partial<DrillTarget> = {}) =>
    data && setDrill({ metric, from: data.from, to: data.to, context, ...extra });

  const s = data?.summary;
  const hasRecords = !!s && s.orders + s.receipts + s.ledgerEntries + s.returnCount + s.discountCount > 0;
  // Dim only while a new month/branch/range stands on the previous figures
  // (placeholder data) — never on a same-filter refresh, which swaps the new
  // figures in silently so the background tick does not flash the screen.
  const updating = q.isPlaceholderData && !!data;

  const exportCsv = () => {
    if (!data) return;
    const inc = incomeRows(data, incGran);
    const exp = expenseRows(data, expGran);
    const csv = [
      `Mountain Bakes Finance — ${context}`,
      '',
      'INCOME',
      toCsv(
        ['Period', 'Branch Name', 'Demand Amount', 'Company Share', 'Received Amount', 'Balance', 'Last Month Balance'],
        inc.map((r) => [r.period, r.branch, r.demand, r.companyShare, r.received, r.balance, r.lastMonthBalance]),
      ),
      '',
      'EXPENSES',
      toCsv(
        ['Period', 'Branch Name', 'Ledger Head', 'Amount', 'Return', 'Discount'],
        exp.map((r) => [r.period, r.branch, r.ledgerHead, r.amount, r.returns, r.discount]),
      ),
    ].join('\n');
    downloadCsv(
      `finance-${month}${branchId ? `-${scopeLabel.replace(/\W+/g, '-').toLowerCase()}` : ''}${fullMonth ? '' : `-${pad(f)}-${pad(t)}`}.csv`,
      csv,
    );
  };

  const selectCls =
    'h-10 rounded-md border border-fin-income bg-fin-ink-field px-2.5 text-sm font-semibold text-fin-ink-foreground disabled:opacity-60 md:h-9';
  const labelCls = 'flex flex-col gap-1 text-[10px] font-bold tracking-[0.14em] text-fin-ink-muted';

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {/* ---------------- Header & filters ---------------- */}
      <div className="-mx-4 -mt-4 flex flex-wrap items-end justify-end gap-x-7 gap-y-4 bg-fin-ink px-4 py-4 text-fin-ink-foreground sm:-mx-6 sm:-mt-6 sm:px-6 print:mx-0 print:mt-0">
        <div className="flex w-full flex-wrap items-end justify-end gap-3 print:hidden">
          <label className={labelCls}>
            MONTH
            <select
              className={cn(selectCls, 'min-w-[8.5rem]')}
              value={month.slice(5)}
              onChange={(e) => setFilter({ month: `${year}-${e.target.value}` })}
            >
              {monthOptions
                .filter((m) => m.startsWith(year))
                .map((m) => (
                  <option key={m} value={m.slice(5)}>
                    {MONTH_NAMES[Number(m.slice(5)) - 1]}
                    {m === currentMonth ? ' (current)' : ''}
                  </option>
                ))}
            </select>
          </label>
          <label className={labelCls}>
            YEAR
            <select
              className={cn(selectCls, 'min-w-[5.5rem]')}
              value={year}
              onChange={(e) => {
                const inYear = monthOptions.filter((m) => m.startsWith(e.target.value));
                setFilter({
                  month: inYear.find((m) => m.slice(5) === month.slice(5)) ?? inYear[0]!,
                });
              }}
            >
              {years.map((y) => (
                <option key={y}>{y}</option>
              ))}
            </select>
          </label>
          <div className={labelCls}>
            DATE RANGE
            <div className="flex items-center gap-1.5">
              <select
                className={cn(selectCls, 'w-16')}
                aria-label="From day"
                value={f}
                onChange={(e) =>
                  setFilter({
                    from: Number(e.target.value),
                    to: Math.max(Number(e.target.value), t),
                  })
                }
              >
                {Array.from({ length: nd }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {pad(i + 1)}
                  </option>
                ))}
              </select>
              <span className="text-xs text-fin-ink-muted">to</span>
              <select
                className={cn(selectCls, 'w-16')}
                aria-label="To day"
                value={t}
                onChange={(e) =>
                  setFilter({
                    to: Number(e.target.value),
                    from: Math.min(f, Number(e.target.value)),
                  })
                }
              >
                {Array.from({ length: nd }, (_, i) => (
                  <option key={i} value={i + 1}>
                    {pad(i + 1)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className={cn(labelCls, 'min-w-0 flex-1 sm:flex-none')}>
            BRANCH NAME
            <select
              className={cn(selectCls, 'w-full sm:min-w-[12rem]')}
              value={branchId}
              disabled={!data}
              onChange={(e) => setFilter({ branchId: e.target.value })}
            >
              <option value="">All Branches</option>
              {(data?.branches ?? []).map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.isActive ? '' : ' (inactive)'}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={exportCsv}
              disabled={!hasRecords}
              className="h-10 border-fin-ink-muted/50 bg-transparent text-fin-ink-foreground hover:bg-fin-ink-field md:h-9"
              aria-label="Export CSV"
            >
              <Download className="size-4" aria-hidden />
              <span className="hidden lg:inline">CSV</span>
            </Button>
            <Button
              variant="outline"
              onClick={reset}
              className="h-10 border-fin-ink-muted/50 bg-transparent text-fin-ink-foreground hover:bg-fin-ink-field md:h-9"
              aria-label="Reset filters"
            >
              <RotateCcw className="size-4" aria-hidden />
              <span className="hidden lg:inline">Reset</span>
            </Button>
          </div>
        </div>
      </div>

      <CashStrip cash={cash.data} loading={cash.isLoading} format={format} />

      {/* ---------------- States ---------------- */}
      {!data && q.isError ? (
        <StatePanel
          title="Finance data could not be loaded."
          body={`The finance summary for ${context} did not load. No figures are shown so nothing stale is mistaken for current.`}
          action={<Button onClick={() => void q.refetch()}>Retry</Button>}
        />
      ) : !data ? (
        <LoadingSkeleton label={`Loading ${context}…`} />
      ) : (
        <>
          {q.isError && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-2.5 text-sm"
            >
              <span>
                Could not refresh. Showing figures loaded at{' '}
                {new Date(data.generatedAt).toLocaleTimeString('en-PK', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                .
              </span>
              <Button size="sm" variant="outline" onClick={() => void q.refetch()}>
                Retry
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-lg font-extrabold tracking-[0.02em] sm:text-xl">
              {monthLong(data.month)} · {scopeLabel}
            </h2>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {rangeLabel} ·{' '}
              {updating
                ? 'Updating…'
                : `Updated ${new Date(data.generatedAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}`}
            </p>
          </div>

          {!hasRecords ? (
            <StatePanel
              title="No finance records found for the selected month and branch."
              body={`${context} has no approved Production demand, returns or discounts, and no Finance Ledger entries. Figures are hidden rather than shown as Rs. 0.`}
              action={
                <Button variant="outline" onClick={reset}>
                  Reset filters
                </Button>
              }
            />
          ) : (
            <div className={cn('flex min-w-0 flex-col gap-4 transition-opacity', updating && 'opacity-60')}>
              <DashboardBody
                data={data}
                context={context}
                scoped={!!branchId}
                incGran={incGran}
                setIncGran={setIncGran}
                expGran={expGran}
                setExpGran={setExpGran}
                drillTo={drillTo}
              />
            </div>
          )}
        </>
      )}

      <RecordsDrawer target={drill} dashboardBranchId={branchId} onClose={() => setDrill(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function DashboardBody({
  data,
  context,
  scoped,
  incGran,
  setIncGran,
  expGran,
  setExpGran,
  drillTo,
}: {
  data: Dashboard;
  context: string;
  scoped: boolean;
  incGran: Granularity;
  setIncGran: (g: Granularity) => void;
  expGran: Granularity;
  setExpGran: (g: Granularity) => void;
  drillTo: (metric: FinanceDashboardMetric, extra?: Partial<DrillTarget>) => void;
}) {
  const { format } = useMoney();
  const s = data.summary;
  const prevLabel = monthLong(data.previousMonth);
  const daily = useMemo(() => dailySeries(data), [data]);
  const branches = useMemo(() => branchTotals(data), [data]);
  const heads = useMemo(() => ledgerHeadTotals(data), [data]);
  const inc = useMemo(() => incomeRows(data, incGran), [data, incGran]);
  const exp = useMemo(() => expenseRows(data, expGran), [data, expGran]);
  const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');

  const overview: OverviewGroup[] = [
    {
      title: 'INCOME',
      band: 'bg-fin-income',
      items: [
        {
          label: 'Company Share',
          value: s.companyShare,
          sub: `${s.orders} approved demand${s.orders === 1 ? '' : 's'}`,
          onClick: () => drillTo('share'),
        },
        {
          label: 'Received Amount',
          value: s.received,
          sub: `${s.receipts} ledger receipt${s.receipts === 1 ? '' : 's'} · incl. fuel`,
          onClick: () => drillTo('received'),
        },
        {
          label: 'Balance',
          value: s.balance,
          sub: 'Company Share − Received',
          signed: true,
          strong: true,
        },
        {
          label: 'Last Month Balance',
          value: s.lastMonthBalance,
          sub: s.lastMonthBalance === null ? `No records in ${prevLabel}` : `${prevLabel} · Share − Received`,
          signed: true,
        },
      ],
    },
    {
      title: 'EXPENSE',
      band: 'bg-fin-expense',
      items: [
        {
          label: 'Ledger Expenses',
          value: s.ledgerExpense,
          sub:
            scoped && !s.ledgerEntries
              ? 'Company expenses carry no branch'
              : `${s.ledgerEntries} approved ledger entr${s.ledgerEntries === 1 ? 'y' : 'ies'}`,
          onClick: s.ledgerEntries ? () => drillTo('ledger') : undefined,
        },
        {
          label: 'Return',
          value: s.returns,
          sub: `${s.returnCount} accepted production return${s.returnCount === 1 ? '' : 's'}`,
          onClick: s.returnCount ? () => drillTo('return') : undefined,
        },
        {
          label: 'Discount',
          value: s.discount,
          sub: `${s.discountCount} approved production discount${s.discountCount === 1 ? '' : 's'}`,
          onClick: s.discountCount ? () => drillTo('discount') : undefined,
        },
      ],
    },
    {
      title: 'OVERALL · FINANCE LEDGER',
      band: 'bg-fin-ink',
      items: [
        {
          label: 'Total Income',
          value: s.ledgerIncome,
          sub: 'All ledger receipts (debits), every head',
        },
        {
          label: 'Total Expense',
          value: s.ledgerExpenseTotal,
          sub: 'All ledger payments (credits), every head',
        },
        {
          label: 'Net',
          value: s.ledgerNet,
          sub: 'Total Income − Total Expense',
          signed: true,
          strong: true,
        },
      ],
      note: 'The ledger’s own totals, as the Daily Ledger defines them. Production figures (Company Share, Return, Discount) are not combined into a single net figure: no business rule in the system relates them.',
    },
  ];

  return (
    <>
      <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
        {overview.map((g) => (
          <OverviewCard key={g.title} group={g} format={format} />
        ))}
      </div>

      {s.unpricedLines > 0 && (
        <p className="flex items-start gap-2 rounded-lg border border-amber-300/60 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {s.unpricedLines} delivered line
          {s.unpricedLines === 1 ? ' has' : 's have'} no product price and {s.unpricedLines === 1 ? 'is' : 'are'} valued
          at Rs. 0 in Demand and Company Share — the same way the production slip values them. Set the price under
          Products to include them.
        </p>
      )}

      <Panel title={`Income vs Expense · ${monthLong(data.month)}`}>
        <BarList
          emptyMessage="No income or expense in this period."
          rows={[
            {
              key: 'share',
              label: 'Company Share',
              sub: 'Income',
              value: s.companyShare,
              color: SERIES.share,
              onClick: () => drillTo('share'),
            },
            {
              key: 'received',
              label: 'Received Amount',
              sub: 'Income',
              value: s.received,
              color: SERIES.received,
              onClick: () => drillTo('received'),
            },
            {
              key: 'ledger',
              label: 'Ledger Expenses',
              sub: 'Expense',
              value: s.ledgerExpense,
              color: SERIES.ledger,
              onClick: () => drillTo('ledger'),
            },
            {
              key: 'return',
              label: 'Return',
              sub: 'Expense',
              value: s.returns,
              color: SERIES.returns,
              onClick: () => drillTo('return'),
            },
            {
              key: 'discount',
              label: 'Discount',
              sub: 'Expense',
              value: s.discount,
              color: SERIES.discount,
              onClick: () => drillTo('discount'),
            },
          ]}
        />
        <p className="mt-3 text-xs text-muted-foreground">
          Each figure is its own bar on one scale; none are added together.
        </p>
      </Panel>

      {/* ---------------- Income ---------------- */}
      <section className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-xs">
        <header className="flex flex-wrap items-center justify-between gap-2 bg-fin-income px-4 py-2.5 text-fin-ink-foreground">
          <h2 className="text-[13px] font-extrabold tracking-[0.12em]">INCOME</h2>
          <span className="text-xs text-fin-ink-muted">{context}</span>
        </header>
        <div className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 bg-fin-row-hover p-3.5 sm:grid-cols-3 xl:grid-cols-5">
          <StatCard
            label="Demand Amount"
            value={s.demand}
            sub={`${s.orders} Production-reviewed orders`}
            color={SERIES.demand}
            onClick={() => drillTo('demand')}
            format={format}
          />
          <StatCard
            label="Company Share"
            value={s.companyShare}
            sub={`${pct(s.companyShare, s.demand)} of demand`}
            color={SERIES.share}
            onClick={() => drillTo('share')}
            format={format}
          />
          <StatCard
            label="Received"
            value={s.received}
            sub={`${pct(s.received, s.companyShare)} of company share`}
            color={SERIES.received}
            onClick={() => drillTo('received')}
            format={format}
          />
          <StatCard
            label="Balance"
            value={s.balance}
            sub="Company Share − Received"
            color={SERIES.balance}
            signed
            format={format}
          />
          <StatCard
            label="Last Month Balance"
            value={s.lastMonthBalance}
            sub={s.lastMonthBalance === null ? `No records in ${prevLabel}` : prevLabel}
            color={SERIES.demand}
            signed
            format={format}
          />
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel
          title="Company Share vs Received · daily"
          aside={<span className="text-[11px] text-muted-foreground">Tap a day for its demand</span>}
        >
          <DailyShareReceivedChart
            data={daily}
            onDay={(d) =>
              drillTo('share', {
                from: d,
                to: d,
                context: `${dayLabel(d)} ${d.slice(0, 4)} · ${context.split(' · ').slice(1).join(' · ')}`,
              })
            }
          />
        </Panel>
        <Panel title="Monthly income trend · 6 months">
          <MonthlyTrendChart
            data={data.trend.map((m) => ({ ...m, label: monthShort(m.month) }))}
            current={data.month}
          />
        </Panel>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Panel title="Balance reconciliation">
          <Reconciliation data={data} format={format} />
        </Panel>
        {!scoped && (
          <Panel
            title="Branch comparison · income"
            aside={<span className="text-[11px] text-muted-foreground">Tap a branch for its demand</span>}
          >
            <BranchIncomeChart
              rows={branches}
              onBranch={(b) =>
                drillTo('share', {
                  branchId: b.branchId,
                  context: `${monthLong(data.month)} · ${b.branch}`,
                })
              }
            />
          </Panel>
        )}
      </div>

      {/* ---------------- Expense ---------------- */}
      <section className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-xs">
        <header className="flex flex-wrap items-center justify-between gap-2 bg-fin-expense px-4 py-2.5 text-fin-ink-foreground">
          <h2 className="text-[13px] font-extrabold tracking-[0.12em]">EXPENSES</h2>
          <span className="text-xs text-fin-ink-muted">{context}</span>
        </header>
        <div className="grid gap-3.5 bg-fin-row-hover p-3.5 lg:grid-cols-2">
          <div className="grid grid-cols-1 content-start gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            <StatCard
              label="Ledger Head"
              value={s.ledgerExpense}
              sub={`${heads.length} head${heads.length === 1 ? '' : 's'} · ${s.ledgerEntries} entries`}
              color={SERIES.ledger}
              onClick={s.ledgerEntries ? () => drillTo('ledger') : undefined}
              format={format}
            />
            <StatCard
              label="Return"
              value={s.returns}
              sub={`${pct(s.returns, s.demand)} of demand`}
              color={SERIES.returns}
              onClick={s.returnCount ? () => drillTo('return') : undefined}
              format={format}
            />
            <StatCard
              label="Discount"
              value={s.discount}
              sub={`${pct(s.discount, s.demand)} of demand`}
              color={SERIES.discount}
              onClick={s.discountCount ? () => drillTo('discount') : undefined}
              format={format}
            />
          </div>
          <div className="min-w-0 rounded-lg border bg-card">
            <p className="border-b bg-fin-soft px-3 py-2 text-[11px] font-extrabold tracking-[0.1em]">
              LEDGER HEAD BREAKDOWN
            </p>
            <div className="max-h-72 overflow-y-auto p-3">
              <BarList
                emptyMessage={
                  scoped
                    ? 'No ledger expense is recorded against this branch — company expenses carry no branch.'
                    : 'No ledger expense in this period.'
                }
                rows={heads.map((h) => ({
                  key: h.ledgerHeadId,
                  label: h.name,
                  sub: `${h.entries} entr${h.entries === 1 ? 'y' : 'ies'} · ${pct(h.amount, s.ledgerExpense)}`,
                  value: h.amount,
                  color: SERIES.ledger,
                  onClick: () =>
                    drillTo('ledger', {
                      ledgerHeadId: h.ledgerHeadId,
                      context: `${context} · ${h.name}`,
                    }),
                }))}
              />
            </div>
          </div>
        </div>
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Panel title="Expense trend · daily">
          <ExpenseTrendChart data={daily} />
        </Panel>
        {!scoped && (
          <Panel title="Branch comparison · expense">
            <BranchExpenseChart rows={branches} />
          </Panel>
        )}
      </div>

      {/* ---------------- Detail tables ---------------- */}
      <IncomeTable
        rows={inc}
        gran={incGran}
        onGran={setIncGran}
        onDrill={(metric, r) => {
          const range = bucketRange(incGran, r.bucket, data.from, data.to);
          drillTo(metric, {
            ...range,
            branchId: r.branchId,
            context: `${r.period} · ${r.branch}`,
          });
        }}
      />
      <ExpenseTable
        rows={exp}
        gran={expGran}
        onGran={setExpGran}
        heads={heads}
        onDrill={(metric, r) => {
          const range = bucketRange(expGran, r.bucket, data.from, data.to);
          drillTo(metric, {
            ...range,
            branchId: r.branchId,
            ledgerHeadId: r.ledgerHeadId ?? undefined,
            context: `${r.period} · ${r.branch}${r.kind === 'ledger' ? ` · ${r.ledgerHead}` : ''}`,
          });
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

type Format = (v: number | null | undefined) => string;

interface OverviewGroup {
  title: string;
  band: string;
  items: {
    label: string;
    value: number | null;
    sub: string;
    onClick?: () => void;
    signed?: boolean;
    strong?: boolean;
  }[];
  note?: string;
}

function OverviewCard({ group, format }: { group: OverviewGroup; format: Format }) {
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card shadow-xs">
      <h3 className={cn('px-3.5 py-2 text-xs font-extrabold tracking-[0.12em] text-fin-ink-foreground', group.band)}>
        {group.title}
      </h3>
      {group.items.map((it) => {
        const negative = it.signed && it.value !== null && it.value < 0;
        const body = (
          <>
            <span className="min-w-0">
              <span className="block text-[12.5px] font-bold">{it.label}</span>
              <span className="block text-[11px] text-muted-foreground">{it.sub}</span>
            </span>
            <span
              className={cn(
                'text-base font-extrabold whitespace-nowrap tabular-nums',
                negative && 'text-destructive',
                it.value === null && 'text-muted-foreground',
              )}
            >
              {it.value === null ? 'No records' : format(it.value)}
            </span>
          </>
        );
        const cls = 'flex items-baseline justify-between gap-3 border-b px-3.5 py-2.5 text-left last:border-b-0';
        return it.onClick ? (
          <button
            key={it.label}
            type="button"
            onClick={it.onClick}
            className={cn(cls, 'cursor-pointer hover:bg-fin-row-hover')}
            title="View source records"
          >
            {body}
          </button>
        ) : (
          <div key={it.label} className={cls}>
            {body}
          </div>
        );
      })}
      {group.note && (
        <p className="mt-auto bg-fin-row-hover px-3.5 py-2.5 text-[11.5px] leading-snug text-muted-foreground">
          {group.note}
        </p>
      )}
    </section>
  );
}

function StatCard({
  label,
  value,
  sub,
  color,
  onClick,
  signed,
  inverse,
  format,
}: {
  label: string;
  value: number | null;
  sub: string;
  color: string;
  onClick?: () => void;
  signed?: boolean;
  inverse?: boolean;
  format: Format;
}) {
  const negative = signed && value !== null && value < 0;
  const body = (
    <>
      <span
        className={cn(
          'flex items-center gap-2 text-[10.5px] font-bold tracking-[0.1em] uppercase',
          inverse ? 'text-fin-ink-muted' : 'text-muted-foreground',
        )}
      >
        <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: color }} aria-hidden />
        {label}
      </span>
      <span
        className={cn(
          'text-lg font-extrabold tracking-tight tabular-nums sm:text-xl',
          negative && 'text-destructive',
          value === null && 'text-muted-foreground',
        )}
      >
        {value === null ? 'No records' : format(value)}
      </span>
      <span className={cn('text-[11.5px]', inverse ? 'text-fin-ink-muted' : 'text-muted-foreground')}>{sub}</span>
    </>
  );
  const cls = cn(
    'flex min-w-0 flex-col gap-1 rounded-lg border px-3.5 py-3 text-left',
    inverse ? 'border-transparent bg-fin-ink text-fin-ink-foreground' : 'bg-card',
  );
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cn(cls, 'cursor-pointer hover:border-fin-share/60')}
      title="View source records"
    >
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function Reconciliation({ data, format }: { data: Dashboard; format: Format }) {
  const s = data.summary;
  const rate = s.companyShare > 0 ? (s.received / s.companyShare) * 100 : null;
  const ring = rate === null ? 0 : Math.max(0, Math.min(rate, 100));
  const line = 'flex justify-between gap-3 border-b py-2 text-sm';
  return (
    <div className="flex flex-wrap items-center gap-6">
      <div
        className="flex size-32 flex-none items-center justify-center rounded-full"
        style={{
          background: `conic-gradient(var(--fin-received) 0 ${ring}%, var(--fin-soft) ${ring}% 100%)`,
        }}
        role="img"
        aria-label={rate === null ? 'No company share this period' : `${rate.toFixed(0)}% of company share received`}
      >
        <div className="flex size-24 flex-col items-center justify-center rounded-full bg-card">
          <span className="text-xl font-extrabold tabular-nums">{rate === null ? '—' : `${rate.toFixed(0)}%`}</span>
          <span className="text-[10px] font-semibold tracking-[0.06em] text-muted-foreground">RECEIVED</span>
        </div>
      </div>
      <div className="min-w-[15rem] flex-1">
        <div className={line}>
          <span className="text-muted-foreground">Company Share</span>
          <strong className="tabular-nums">{format(s.companyShare)}</strong>
        </div>
        <div className={line}>
          <span className="text-muted-foreground">− Received</span>
          <strong className="tabular-nums">{format(s.received)}</strong>
        </div>
        <div className={cn(line, 'border-b-2 border-foreground/70')}>
          <span className="font-semibold">Balance</span>
          <strong className={cn('tabular-nums', s.balance < 0 && 'text-destructive')}>{format(s.balance)}</strong>
        </div>
        <div className="flex justify-between gap-3 pt-2 text-sm">
          <span className="text-muted-foreground">Last month balance · {monthLong(data.previousMonth)}</span>
          <strong
            className={cn('tabular-nums', s.lastMonthBalance !== null && s.lastMonthBalance < 0 && 'text-destructive')}
          >
            {s.lastMonthBalance === null ? 'No records' : format(s.lastMonthBalance)}
          </strong>
        </div>
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          Shown side by side, not added: the system defines no carry-forward rule for this balance.
        </p>
      </div>
    </div>
  );
}

function CashStrip({
  cash,
  loading,
  format,
}: {
  cash:
    | {
        cashInHand: number;
        bankBalance: number;
        pendingExpenseApprovals: number;
        pendingExpenseAmount: number;
      }
    | undefined;
  loading: boolean;
  format: Format;
}) {
  if (loading) return <Skeleton className="h-11 w-full print:hidden" />;
  if (!cash) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 rounded-lg border bg-card px-4 py-2.5 text-sm print:hidden">
      <span className="text-[10.5px] font-bold tracking-[0.1em] text-muted-foreground uppercase">
        Today · company-wide
      </span>
      <span>
        Cash in hand <strong className="tabular-nums">{format(cash.cashInHand)}</strong>
      </span>
      <span>
        Bank <strong className="tabular-nums">{format(cash.bankBalance)}</strong>
      </span>
      <Link
        href={ROUTES.FINANCE_ENTRIES}
        className="ml-auto font-semibold text-fin-share underline-offset-2 hover:underline"
      >
        {cash.pendingExpenseApprovals} pending approval
        {cash.pendingExpenseApprovals === 1 ? '' : 's'} · {format(cash.pendingExpenseAmount)}
      </Link>
    </div>
  );
}

function StatePanel({ title, body, action }: { title: string; body: string; action: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border bg-card px-6 py-12 text-center">
      <p className="text-lg font-bold">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

function LoadingSkeleton({ label }: { label: string }) {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <p className="text-sm font-semibold text-muted-foreground">{label}</p>
      <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-56 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-44 rounded-xl" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
      <Skeleton className="h-80 rounded-xl" />
    </div>
  );
}
