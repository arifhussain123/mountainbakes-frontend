'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useIsFetching, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Download, Printer, RefreshCw } from 'lucide-react';
import { businessDateStr, type FinanceDashboardMetric, type ReportSummary, type SalesTopProductLimit } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useFinanceMonthlyDashboard } from '@/lib/finance';
import { qk } from '@/lib/queryKeys';
import {
  useProductionDashboardSection,
  useProductionOverview,
  useReportSummary,
  useSalesAnalytics,
} from '@/lib/queries';
import { cn } from '@/lib/utils';
import { PAYMENT_METHOD_LABELS } from '@/utils/constants';
import { printDocument } from '@/lib/print/browser/documentPrint';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useMoney } from '@/components/finance/finance-ui';
import { RecordsDrawer } from '@/components/finance/dashboard/RecordsDrawer';
import {
  branchNamer,
  daysInMonth,
  downloadCsv,
  monthLong,
  monthShort,
  shiftMonth,
  type DrillTarget,
  type Granularity,
} from '@/components/finance/dashboard/dashboard-model';
import { LoginHistoryCard } from './LoginHistoryCard';
import { SECTIONS, adminCsv, asSection, currentSaleRows, type Section } from './admin/admin-model';
import {
  BranchSummary,
  CurrentBranchSales,
  FinanceSummary,
  HeadlineKpis,
  ProductionSummary,
  SalesOverview,
  SectionHeading,
  TodaySnapshot,
} from './admin/sections';

const pad = (n: number) => String(n).padStart(2, '0');
/** How far back the month picker reaches — the same as the Finance Dashboard's. */
const MONTHS_BACK = 24;

// The whole Production Dashboard, as the Production tab. Loaded — code and
// requests alike — only when that tab is first opened.
const ProductionDashboard = dynamic(
  () => import('@/components/production/ProductionDashboard').then((m) => m.ProductionDashboard),
  { ssr: false, loading: () => <Skeleton className="h-96 rounded-xl" /> },
);

/**
 * The open tab lives in the address bar (`?section=finance`), so a refresh, a
 * bookmark or an old `/finance-dashboard` link (RouteGuard) opens the right
 * one. Read through `window.location`, not useSearchParams: the app is a static
 * export and the query string only exists in the browser. Other parameters
 * (the Production tab's `?branch=`) are left as they are.
 */
function useSectionParam(): [Section, (s: Section) => void] {
  const [section, setSection] = useState<Section>('overview');
  useEffect(() => {
    const read = () => setSection(asSection(new URLSearchParams(window.location.search).get('section')));
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);
  const set = useCallback((s: Section) => {
    setSection(s);
    const url = new URL(window.location.href);
    if (s === 'overview') url.searchParams.delete('section');
    else url.searchParams.set('section', s);
    window.history.replaceState(window.history.state, '', url);
  }, []);
  return [section, set];
}

/**
 * Admin Dashboard — the admin's one dashboard: Overview, Sales, Branches,
 * Production and Finance as tabs of a single page. The Production and Finance
 * Dashboards are not separate admin pages; RouteGuard sends their old URLs to
 * the matching tab.
 *
 * Two requests drive the month-scoped figures, and the month / branch / day
 * range feed both, so no section can show a different period from its
 * neighbours:
 *   - `/api/finance/dashboard/monthly` (migration 128) for everything that is
 *     Production demand or Finance Ledger — the same response, cards, tables
 *     and drill-down drawer the Finance Dashboard uses, so a figure here and
 *     there cannot disagree;
 *   - `/api/sales-analytics` (migration 100) for the point-of-sale figures.
 * Every figure is summed in Postgres; nothing is added up in the browser.
 *
 * Each tab asks only for what it shows, when it is opened: today's report
 * summary on Overview and Sales, Production's overview and stock on Overview,
 * the whole Production Dashboard (and its code) on Production, and the cash
 * strip on Finance. React Query keeps each answer, so going back to a tab
 * shows it at once and refreshes it in the background.
 *
 * The finance components paint with the `--fin-*` tokens, which the
 * `admin-dash-theme` class re-points to the brand palette (globals.css).
 */
export function AdminDashboard() {
  const { token } = useAuth();
  const { format, symbol } = useMoney();
  // Business date, not the browser's calendar — the day rolls at 02:00 Karachi.
  const today = businessDateStr();
  const currentMonth = today.slice(0, 7);

  const [month, setMonth] = useState(currentMonth);
  const [dayFrom, setDayFrom] = useState(1);
  const [dayTo, setDayTo] = useState(31);
  const [branchId, setBranchId] = useState('');
  const [section, setSection] = useSectionParam();
  const [incGran, setIncGran] = useState<Granularity>('monthly');
  const [expGran, setExpGran] = useState<Granularity>('monthly');
  const [topLimit, setTopLimit] = useState<SalesTopProductLimit>(5);
  const [drill, setDrill] = useState<DrillTarget | null>(null);

  const nd = daysInMonth(month);
  const f = Math.min(dayFrom, nd);
  const t = Math.max(f, Math.min(dayTo, nd));
  const fullMonth = f === 1 && t === nd;
  const from = `${month}-${pad(f)}`;
  const to = `${month}-${pad(t)}`;

  const fin = useFinanceMonthlyDashboard({
    month,
    from: fullMonth ? undefined : from,
    to: fullMonth ? undefined : to,
    branchId: branchId || undefined,
  });
  const salesQ = useSalesAnalytics(
    token,
    { from, to, branchId: branchId || null, topLimit },
    { enabled: !!token, keepPrevious: true },
  );
  // Today's business day, whatever month is selected: the Overview's today
  // tiles and the Sales tab's Current Sale by Branch. Only the branch filter
  // applies; the summary's `branchData` is per branch. Not asked for until one
  // of those two tabs is open.
  const todayQ = useReportSummary(token, 'daily', branchId || null, null, 'full', {
    keepPrevious: true,
    enabled: section === 'overview' || section === 'sales',
  });
  const data = fin.data;
  const sales = salesQ.data ?? null;
  const currentRows = useMemo(
    () => (data && todayQ.data ? currentSaleRows(data.branches, todayQ.data.branchData ?? [], branchId || null) : []),
    [data, todayQ.data, branchId],
  );

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
  const financeRecords = !!s && s.orders + s.receipts + s.ledgerEntries + s.returnCount + s.discountCount > 0;
  const salesRecords = !!sales && sales.totalTransactions + sales.staffCount > 0;
  // Empty only once BOTH answers are in: a month with sales but no demand is
  // not empty, and calling it so before the sales request lands would flash.
  const salesSettled = !!sales || salesQ.isError;
  const isEmpty = !!data && !financeRecords && salesSettled && !salesRecords;
  // Dim only while a new month/branch/range stands on the previous figures —
  // never on a same-filter refresh.
  const updating = (fin.isPlaceholderData || salesQ.isPlaceholderData) && !!data;
  const qc = useQueryClient();
  // Production's overview and sections all sit under this prefix (queryKeys.ts).
  const productionFetching = useIsFetching({ queryKey: ['productionOverview'] }) > 0;
  const refreshing = fin.isFetching || salesQ.isFetching || todayQ.isFetching || productionFetching;

  // Refetches what the open tab shows; the others are refetched as stale when
  // next opened.
  const refresh = () => {
    void fin.refetch();
    void salesQ.refetch();
    if (section === 'overview' || section === 'sales') void todayQ.refetch();
    if (section === 'overview' || section === 'production') {
      void qc.invalidateQueries({ queryKey: ['productionOverview'] });
    }
    if (section === 'finance') void qc.invalidateQueries({ queryKey: qk.financeDashboard({ from: today, to: today }) });
  };
  const exportCsv = () => {
    if (!data) return;
    downloadCsv(
      `admin-dashboard-${month}${branchId ? `-${scopeLabel.replace(/\W+/g, '-').toLowerCase()}` : ''}${fullMonth ? '' : `-${pad(f)}-${pad(t)}`}.csv`,
      adminCsv({
        context,
        finance: data,
        sales,
        paymentLabel: (m) => PAYMENT_METHOD_LABELS[m] ?? m,
        incGran,
        expGran,
      }),
    );
  };

  const selectCls =
    'h-10 rounded-lg border bg-card px-3 text-base text-foreground disabled:opacity-60 md:h-9 md:text-sm';

  return (
    <div className="admin-dash-theme print-area flex min-w-0 flex-col gap-5">
      {/* ---------------- Heading & filters ---------------- */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-xl font-bold sm:text-2xl">Admin Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Sales, branch, production &amp; finance summary · {context}
          </p>
          <p className="text-xs text-muted-foreground no-print" aria-live="polite">
            {updating
              ? 'Updating…'
              : data
                ? `Updated ${new Date(data.generatedAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}`
                : ' '}
          </p>
        </div>

        <div className="no-print flex flex-wrap items-center gap-2">
          <select
            aria-label="Month"
            className={cn(selectCls, 'min-w-[8.5rem]')}
            value={month.slice(5)}
            onChange={(e) => setFilter({ month: `${year}-${e.target.value}` })}
          >
            {monthOptions
              .filter((m) => m.startsWith(year))
              .map((m) => (
                <option key={m} value={m.slice(5)}>
                  {monthLong(m).split(' ')[0]}
                  {m === currentMonth ? ' (current)' : ''}
                </option>
              ))}
          </select>
          <select
            aria-label="Year"
            className={selectCls}
            value={year}
            onChange={(e) => {
              const inYear = monthOptions.filter((m) => m.startsWith(e.target.value));
              setFilter({ month: inYear.find((m) => m.slice(5) === month.slice(5)) ?? inYear[0]! });
            }}
          >
            {years.map((y) => (
              <option key={y}>{y}</option>
            ))}
          </select>
          {/* `basis-48`: a real starting width, so on a phone the select wraps to
              a line of its own and grows to fill it instead of squeezing to 22px. */}
          <select
            aria-label="Branch"
            className={cn(selectCls, 'min-w-0 flex-1 basis-48 sm:flex-none sm:basis-auto sm:min-w-[12rem]')}
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
          <div className="flex h-10 items-center gap-1.5 rounded-lg border bg-card px-2 text-sm text-muted-foreground md:h-9">
            <select
              aria-label="From day"
              className="bg-transparent text-base text-foreground md:text-sm"
              value={f}
              onChange={(e) => setFilter({ from: Number(e.target.value), to: Math.max(Number(e.target.value), t) })}
            >
              {Array.from({ length: nd }, (_, i) => (
                <option key={i} value={i + 1}>
                  {pad(i + 1)}
                </option>
              ))}
            </select>
            <span>to</span>
            <select
              aria-label="To day"
              className="bg-transparent text-base text-foreground md:text-sm"
              value={t}
              onChange={(e) => setFilter({ to: Number(e.target.value), from: Math.min(f, Number(e.target.value)) })}
            >
              {Array.from({ length: nd }, (_, i) => (
                <option key={i} value={i + 1}>
                  {pad(i + 1)}
                </option>
              ))}
            </select>
          </div>
          <Button
            variant="outline"
            onClick={refresh}
            disabled={refreshing}
            className="h-10 md:h-9"
            aria-label="Refresh"
          >
            <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} aria-hidden />
            <span className="hidden xl:inline">Refresh</span>
          </Button>
          <Button onClick={() => printDocument()} disabled={!data} className="h-10 md:h-9 bg-secondary text-secondary-foreground hover:bg-secondary/90 dark:bg-fin-ink-field dark:text-fin-ink-foreground">
            <Printer className="size-4" aria-hidden />
            Print
          </Button>
          <Button variant="outline" onClick={exportCsv} disabled={!data || isEmpty} className="h-10 md:h-9">
            <Download className="size-4" aria-hidden />
            Export CSV
          </Button>
        </div>
      </div>

      {/* ---------------- Section tabs ---------------- */}
      <div role="tablist" aria-label="Dashboard sections" className="no-print -mb-1 flex gap-1 overflow-x-auto border-b">
        {SECTIONS.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            aria-selected={section === x.key}
            onClick={() => setSection(x.key)}
            className={cn(
              '-mb-px shrink-0 border-b-[3px] px-3.5 py-2.5 text-sm font-bold transition-colors',
              section === x.key
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {x.label}
          </button>
        ))}
      </div>

      {/* ---------------- Sections that do not wait for the month ---------------- */}
      {section === 'overview' && (
        <OverviewToday
          token={token}
          branchId={branchId}
          todayQ={todayQ}
          businessDate={today}
          scope={scopeLabel}
          format={format}
        />
      )}
      {section === 'production' && (
        <section className="flex min-w-0 flex-col gap-4">
          <SectionHeading
            title="Live Production"
            sub="Orders, output and stock for today, this week or this month, with its own branch picker. The month and day filters above apply to the Production Summary below."
          />
          <ProductionDashboard embedded />
        </section>
      )}

      {/* ---------------- States ---------------- */}
      {!data && fin.isError ? (
        <StatePanel
          title="Dashboard data could not be loaded."
          body={`The figures for ${context} did not load. Nothing is shown so stale figures aren’t mistaken for current ones.`}
          action={<Button onClick={refresh}>Retry</Button>}
        />
      ) : !data || (!financeRecords && !salesSettled) ? (
        <LoadingSkeleton />
      ) : isEmpty ? (
        <StatePanel
          title="No records found for the selected month and branch."
          body={`${context} has no sales, no approved Production demand, returns or discounts, and no Finance Ledger entries. Figures are hidden rather than shown as Rs. 0.`}
          action={
            <Button variant="outline" onClick={reset}>
              Reset filters
            </Button>
          }
        />
      ) : (
        <div className={cn('flex min-w-0 flex-col gap-8 transition-opacity', updating && 'opacity-60')}>
          {fin.isError && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-2.5 text-sm"
            >
              <span>
                Could not refresh. Showing figures loaded at{' '}
                {new Date(data.generatedAt).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })}.
              </span>
              <Button size="sm" variant="outline" onClick={refresh}>
                Retry
              </Button>
            </div>
          )}

          {section === 'overview' && (
            <section className="flex min-w-0 flex-col gap-4">
              <SectionHeading title={monthLong(month)} sub={`Sales, Company Share and Finance Ledger · ${context}`} />
              <HeadlineKpis
                data={data}
                sales={sales}
                salesFailed={salesQ.isError && !sales}
                drillTo={drillTo}
                format={format}
              />
            </section>
          )}
          {section === 'sales' && (
            <SalesOverview
              sales={sales}
              loading={salesQ.isPending}
              failed={salesQ.isError}
              onRetry={() => void salesQ.refetch()}
              // The two reused cards print `${currency}${n}`; the space matches `format`.
              currency={`${symbol} `}
              topLimit={topLimit}
              onTopLimit={setTopLimit}
              subtitle={context}
              format={format}
              current={
                <CurrentBranchSales
                  rows={currentRows}
                  total={todayQ.data?.totalRevenue ?? null}
                  loading={!todayQ.data && !todayQ.isError}
                  failed={todayQ.isError}
                  onRetry={() => void todayQ.refetch()}
                  businessDate={today}
                  format={format}
                />
              }
            />
          )}
          {section === 'branches' && (
            <BranchSummary data={data} scoped={!!branchId} subtitle={context} drillTo={drillTo} format={format} />
          )}
          {section === 'production' && (
            <ProductionSummary data={data} subtitle={context} context={context} drillTo={drillTo} format={format} />
          )}
          {section === 'finance' && (
            <FinanceSummary
              data={data}
              scoped={!!branchId}
              subtitle={context}
              context={context}
              incGran={incGran}
              setIncGran={setIncGran}
              expGran={expGran}
              setExpGran={setExpGran}
              drillTo={drillTo}
              format={format}
            />
          )}
        </div>
      )}

      {/* Not month-scoped, so outside the figures above and left off the print:
          the login record a super admin audits. */}
      {section === 'overview' && (
        <div className="no-print min-w-0">
          <LoginHistoryCard />
        </div>
      )}

      <RecordsDrawer
        target={drill}
        dashboardBranchId={branchId}
        onClose={() => setDrill(null)}
        className="admin-dash-theme"
      />
    </div>
  );
}

/**
 * The Overview's today tiles. Production's two requests live here so they are
 * made only while the Overview is open; with no branch picked they share
 * their cache with the Production tab's Today view and its stock section.
 */
function OverviewToday({
  token,
  branchId,
  todayQ,
  businessDate,
  scope,
  format,
}: {
  token: string;
  branchId: string;
  todayQ: UseQueryResult<ReportSummary>;
  businessDate: string;
  scope: string;
  format: (v: number | null | undefined) => string;
}) {
  const prod = useProductionOverview(token, branchId || null, 'today');
  const stock = useProductionDashboardSection('current-stock', token, 'today', branchId || null);
  return (
    <TodaySnapshot
      businessDate={businessDate}
      scope={scope}
      today={{ data: todayQ.data, failed: todayQ.isError }}
      production={{ data: prod.data, failed: prod.isError }}
      stock={{ data: stock.data, failed: stock.isError }}
      format={format}
      onRetry={() => {
        if (todayQ.isError) void todayQ.refetch();
        if (prod.isError) void prod.refetch();
        if (stock.isError) void stock.refetch();
      }}
    />
  );
}

function StatePanel({ title, body, action }: { title: string; body: string; action: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border bg-card px-6 py-14 text-center">
      <p className="text-lg font-bold">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
      {action}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading dashboard">
      <div className="grid grid-cols-1 gap-3.5 min-[480px]:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-80 rounded-xl" />
      <Skeleton className="h-64 rounded-xl" />
    </div>
  );
}
