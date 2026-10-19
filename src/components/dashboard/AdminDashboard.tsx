'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { useIsFetching, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { Download, Printer, RefreshCw } from 'lucide-react';
import { businessDateStr, type FinanceDashboardMetric, type ReportSummary, type SalesTopProductLimit } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useOnline } from '@/hooks/useOnline';
import { useFinanceMonthlyDashboard } from '@/lib/finance';
import { qk } from '@/lib/queryKeys';
import {
  useBranchSales,
  useBranches,
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
import { adminCsv, asSection, liveSaleRows, salesPeriodRange, type SalesPeriod } from './admin/admin-model';
import {
  FinanceSummary,
  HeadlineKpis,
  LiveBranchSales,
  ProductionSummary,
  SalesOverview,
  SectionHeading,
  TodaySnapshot,
  type LiveSalesStatus,
} from './admin/sections';

const pad = (n: number) => String(n).padStart(2, '0');
/** How far back the month picker reaches — the same as the Finance Dashboard's. */
const MONTHS_BACK = 24;

// The whole Production Dashboard, as the Live Production section. Its code and
// requests wait until the section is scrolled near (WhenVisible).
const ProductionDashboard = dynamic(
  () => import('@/components/production/ProductionDashboard').then((m) => m.ProductionDashboard),
  { ssr: false, loading: () => <Skeleton className="h-96 rounded-xl" /> },
);

/**
 * `?section=sales` (an old tab link, or RouteGuard's landing for the retired
 * `/production-dashboard` and `/finance-dashboard`) scrolls to that part of
 * the page, once, as soon as it has rendered. Read through `window.location`,
 * not useSearchParams: the app is a static export and the query string only
 * exists in the browser. The parameter is then dropped from the address bar.
 */
function useSectionAnchor(ready: boolean) {
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !ready) return;
    const url = new URL(window.location.href);
    const raw = url.searchParams.get('section');
    if (!raw) {
      done.current = true;
      return;
    }
    const el = document.getElementById(`dash-${asSection(raw)}`);
    if (!el) return; // that part is not on the page (an empty month): stay at the top
    done.current = true;
    el.scrollIntoView({ block: 'start' });
    url.searchParams.delete('section');
    window.history.replaceState(window.history.state, '', url);
  }, [ready]);
}

/**
 * Mounts its children once they are about to scroll into view, so a section
 * far down the page costs no requests until someone gets to it. Mounted for
 * good after that — scrolling away does not drop it.
 */
function WhenVisible({ children, placeholder }: { children: React.ReactNode; placeholder: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (shown) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setShown(true);
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [shown]);
  return <div ref={ref} className="min-w-0">{shown ? children : placeholder}</div>;
}

/**
 * Admin Dashboard — the admin's one dashboard. What used to be the Overview,
 * Sales, Branches, Production and Finance tabs is one page, top to bottom:
 * today's tiles, Live Sales — All Branches, the month's headline tiles, sales
 * trends, production, finance and login history. The
 * Production and Finance Dashboards are not separate admin pages; RouteGuard
 * sends their old URLs to the matching part of this one (`?section=`).
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
 * Today's tiles and Live Sales have requests of their own and do not wait for
 * the month. The whole Production Dashboard (and its code) is loaded only when
 * its section is scrolled near. Everything mounted is refetched by the app's
 * 30-second refresh tick (useAppRefresh) while the tab is visible.
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
  // Today's business day, whatever month is selected: the today tiles. Only
  // the branch filter applies.
  const todayQ = useReportSummary(token, 'daily', branchId || null, null, 'full', { keepPrevious: true });
  const data = fin.data;
  const sales = salesQ.data ?? null;

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
  // Waits for the month's figures, which are what push the sections down.
  useSectionAnchor(!!data || fin.isError);
  // Production's overview and sections all sit under this prefix (queryKeys.ts).
  const productionFetching = useIsFetching({ queryKey: ['productionOverview'] }) > 0;

  const branchSalesFetching = useIsFetching({ queryKey: qk.dataResource('orders') }) > 0;
  const refreshing = fin.isFetching || salesQ.isFetching || todayQ.isFetching || productionFetching || branchSalesFetching;

  // Everything on the page: React Query refetches only what is mounted.
  const refresh = () => {
    void fin.refetch();
    void salesQ.refetch();
    void todayQ.refetch();
    void qc.invalidateQueries({ queryKey: qk.dataResource('orders') });
    void qc.invalidateQueries({ queryKey: ['productionOverview'] });
    void qc.invalidateQueries({ queryKey: qk.financeDashboard({ from: today, to: today }) });
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

      {/* ---------------- Today & live sales: not month-scoped ---------------- */}
      <div id="dash-overview" className="flex min-w-0 scroll-mt-20 flex-col gap-5">
        <OverviewToday
          token={token}
          branchId={branchId}
          todayQ={todayQ}
          businessDate={today}
          scope={scopeLabel}
          format={format}
        />
        <LiveSales token={token} today={today} format={format} />
      </div>

      {/* ---------------- The selected month ---------------- */}
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
          <div id="dash-sales" className="min-w-0 scroll-mt-20">
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
            />
          </div>
        </div>
      )}

      {/* ---------------- Production ----------------
          The live board has its own period and branch picker and does not wait
          for the month, so it stays up when the month's figures are empty or
          failed. Kept off the print: it is a working screen, not a report. */}
      <section id="dash-production" className="flex min-w-0 scroll-mt-20 flex-col gap-4">
        <div className="no-print flex min-w-0 flex-col gap-4">
          <SectionHeading
            title="Live Production"
            sub="Orders, output and stock for today, this week or this month, with its own branch picker."
          />
          <WhenVisible placeholder={<Skeleton className="h-96 rounded-xl" />}>
            <ProductionDashboard embedded />
          </WhenVisible>
        </div>
        {data && !isEmpty && (
          <div className={cn('min-w-0 transition-opacity', updating && 'opacity-60')}>
            <ProductionSummary data={data} subtitle={context} context={context} drillTo={drillTo} format={format} />
          </div>
        )}
      </section>

      {/* ---------------- Finance ---------------- */}
      {data && !isEmpty && (
        <div id="dash-finance" className={cn('min-w-0 scroll-mt-20 transition-opacity', updating && 'opacity-60')}>
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
        </div>
      )}

      {/* Not month-scoped, and left off the print: the login record a super
          admin audits. */}
      <div className="no-print min-w-0">
        <LoginHistoryCard />
      </div>

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
 * Today's tiles. With no branch picked, Production's two requests share their
 * cache with the Live Production section's Today view and its stock section.
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

/**
 * How long without a successful refresh before the board stops calling itself
 * live: three of the app's 30-second refresh ticks (useAppRefresh).
 */
const STALE_AFTER_MS = 90_000;

/**
 * Live Sales — All Branches: the period picker, the per-branch request and
 * the decision whether the figures can still be called live.
 *
 * No timer of its own fetches anything. The board is a mounted query, so the
 * app's single 30-second refresh tick refetches it while the tab is visible,
 * and catches up the moment a hidden tab is shown again; a sale saved on this
 * device invalidates `orders` and refreshes it at once. Sales rung up on a
 * branch's till arrive with the next tick — there is no sale notification to
 * push them sooner. The one interval here only re-reads the clock, so
 * "Live" turns into "Not updating" when the refreshes stop.
 */
function LiveSales({ token, today, format }: { token: string; today: string; format: (v: number | null | undefined) => string }) {
  const [period, setPeriod] = useState<SalesPeriod>('today');
  const [custom, setCustom] = useState({ from: today, to: today });
  const range = salesPeriodRange(period, today, custom);
  const salesQ = useBranchSales(token, range);
  const branchesQ = useBranches(token);
  const online = useOnline();

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, []);

  // A failed branch list still lets the sales through — cards for the branches
  // that sold, rather than none at all.
  const branchesSettled = !!branchesQ.data || branchesQ.isError;
  const rows = useMemo(
    () => (salesQ.data && branchesSettled ? liveSaleRows(branchesQ.data ?? [], salesQ.data.rows) : []),
    [salesQ.data, branchesQ.data, branchesSettled],
  );
  const loading = !salesQ.isError && (!salesQ.data || !branchesSettled);
  const updatedAt = salesQ.data ? salesQ.dataUpdatedAt : null;

  let status: LiveSalesStatus = 'loading';
  if (updatedAt) {
    if (!online) status = 'offline';
    else if (salesQ.isError) status = 'error';
    else if (range.to < today) status = 'closed';
    else if (now - updatedAt > STALE_AFTER_MS && !salesQ.isFetching) status = 'stale';
    else status = 'live';
  }

  return (
    <LiveBranchSales
      rows={rows}
      loading={loading}
      failed={salesQ.isError}
      onRetry={() => void salesQ.refetch()}
      period={period}
      onPeriod={setPeriod}
      custom={custom}
      onCustom={setCustom}
      today={today}
      from={range.from}
      to={range.to}
      status={status}
      updatedAt={updatedAt}
      format={format}
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
