'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { toast } from 'sonner';
import {
  BarChart3,
  CalendarRange,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Minus,
  Printer,
  Receipt,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Trophy,
  Wallet,
} from 'lucide-react';

import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { useBranches, useSalesAnalytics } from '@/lib/queries';
import { apiCall, ApiError } from '@/utils/api';
import { formatDate } from '@/utils/date';
import { logger } from '@/utils/logger';
import { cn } from '@/lib/utils';
import { printDocument } from '@/lib/print/browser/documentPrint';
import { usePaperCapability } from '@/hooks/usePrintCapability';

import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { StatCard } from '@/components/shared/StatCard';
import { EmptyState } from '@/components/shared/EmptyState';

import { PaymentMethodSummary } from './PaymentMethodSummary';
import { TopSellingProducts } from './TopSellingProducts';
import { RANGE_OPTIONS, describeRange, resolveRange, type RangePreset } from './ranges';
import { businessDateStr, type SalesAnalyticsComparison, type SalesTopProductLimit } from '@mb/shared';

/**
 * Daily Sales — the analytics section on the Admin and Branch dashboards.
 *
 * ONE component for both surfaces, because the only difference between them is
 * whether a branch can be chosen, and that decision is the API's to make, not
 * the screen's. A super_admin gets the branch picker; every other role that can
 * reach a dashboard is a branch role, sees its own shop, and is pinned there
 * SERVER-side — `/api/sales-analytics` resolves the scope from the JWT and
 * discards the `branchId` parameter for a branch account, so the picker's
 * absence here is a UI fact and not the security boundary.
 *
 * Every figure comes from one request, aggregated in Postgres (migration 100).
 * Changing the range, the branch or the ranking depth changes the query key and
 * refetches that one request — no reload, and no month of orders in the browser.
 */

// recharts is heavy; keep it out of the dashboard's initial bundle.
const DailySalesGraph = dynamic(
  () => import('./DailySalesGraph').then((m) => m.DailySalesGraph),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[300px] w-full" />,
  },
);

const ALL_BRANCHES = 'all';

export function DailySalesSection() {
  const { token, user } = useAuth();
  const { settings } = useSettings();
  const { paper } = usePaperCapability();

  const isAdmin = user?.role === 'super_admin';
  const cur = settings?.currencySymbol || 'Rs.';

  // The business date, not the calendar one: between midnight and 2 AM they
  // differ, and the API clamps against the business date.
  const today = businessDateStr();

  const [preset, setPreset] = useState<RangePreset>('last7');
  // Seeded to today so the custom inputs are never empty — an empty date input
  // submits '' and would send the API a window it has to reject.
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const [branch, setBranch] = useState<string>(ALL_BRANCHES);
  const [topLimit, setTopLimit] = useState<SalesTopProductLimit>(5);
  const [compare, setCompare] = useState(true);
  const [exporting, setExporting] = useState<string | null>(null);

  const range = useMemo(
    () => resolveRange(preset, { from: customFrom, to: customTo }),
    [preset, customFrom, customTo],
  );

  // Only an admin's choice is sent. A branch account sends nothing, so there is
  // not even a parameter to tamper with; the API would ignore it either way.
  const branchId = isAdmin && branch !== ALL_BRANCHES ? branch : null;

  const branchesQ = useBranches(token, { enabled: !!token && isAdmin });
  const analyticsQ = useSalesAnalytics(
    token,
    { from: range.from, to: range.to, branchId, topLimit, compare },
    { enabled: !!token },
  );

  const analytics = analyticsQ.data ?? null;
  const loading = !token || analyticsQ.isPending;
  const failed = analyticsQ.isError;

  // The technical detail goes to the app's logger; the user gets a sentence and
  // a Retry. A Postgres or PostgREST message on a shop-floor screen is noise at
  // best and an information leak at worst.
  useEffect(() => {
    if (analyticsQ.error) {
      logger.error('Daily Sales analytics request failed', analyticsQ.error);
    }
  }, [analyticsQ.error]);

  /*
   * A 4xx carries a message this API wrote for a person to read — "Range too
   * wide — 366 days maximum", "from is not a real date" — and burying it under
   * a generic sentence leaves the user retrying a request that will never
   * succeed. Anything else (5xx, a network failure, a Postgres error the
   * handler masked) gets the generic line: those messages are for the log, not
   * for a shop floor.
   */
  const error = analyticsQ.error;
  const failureDetail =
    error instanceof ApiError && error.status >= 400 && error.status < 500
      ? error.message
      : 'The sales figures could not be fetched. Check your connection and try again.';

  const money = (n: number) => `${cur}${Math.round(n).toLocaleString()}`;

  // "No sales" means no money AND no unpaid staff sales — a period where the
  // only thing that happened was staff consumption is not an empty period, and
  // saying it is would hide the one thing worth looking at.
  const isEmpty =
    !loading && !failed && !!analytics && analytics.totalTransactions === 0 && analytics.staffCount === 0;

  const scopeLabel = isAdmin
    ? analytics?.branchName ?? (branch === ALL_BRANCHES ? 'All Branches' : 'Selected branch')
    : user?.branchName ?? 'Your branch';

  async function handleExport(type: 'excel' | 'pdf') {
    setExporting(type);
    try {
      const query = new URLSearchParams({
        from: range.from,
        to: range.to,
        topLimit: String(topLimit),
        compare: String(compare),
        type,
      });
      if (branchId) query.set('branchId', branchId);

      // The API re-resolves the branch scope for the export exactly as it does
      // for the screen, so an export can never contain a branch the caller is
      // not allowed to read.
      const blob = await apiCall<Blob>(`/api/sales-analytics/export?${query.toString()}`, {}, token);
      const scope = range.from === range.to ? range.from : `${range.from}_to_${range.to}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `mountain-bakes-daily-sales-${scope}.${type === 'excel' ? 'xlsx' : 'pdf'}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success(`${type === 'excel' ? 'Excel' : 'PDF'} exported`);
    } catch (err) {
      logger.error('Daily Sales export failed', err);
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(null);
    }
  }

  return (
    /* `print-area` is what Print prints: globals.css hides every other body
       child and reveals this subtree, so the sheet is the Daily Sales report
       and not a screenshot of the whole dashboard. */
    <section className="print-area space-y-6">
      {/* ── Heading + filters ─────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="font-heading text-lg font-semibold">Daily Sales</h2>
          <p className="text-sm text-muted-foreground">
            Sales performance by day · {scopeLabel} · {describeRange(range, formatDate)}
          </p>
        </div>

        {/* Horizontally scrollable rather than wrapping into three rows on a
            tablet — the brief's requirement, and it keeps the heading beside
            the controls instead of above a stack of them. `-mx-1 px-1` so the
            focus ring of the first control is not clipped by the scroll box. */}
        <div className="no-print -mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 lg:flex-wrap lg:justify-end lg:overflow-visible">
          <Select value={preset} onValueChange={(v) => v && setPreset(v as RangePreset)}>
            <SelectTrigger className="h-9 w-36 shrink-0" aria-label="Date range">
              <CalendarRange className="size-4 text-muted-foreground" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {preset === 'custom' && (
            <>
              <Input
                type="date"
                value={customFrom}
                // A window starting after today has no days in it; the API says
                // so honestly, but the picker should not offer it at all.
                max={customTo < today ? customTo : today}
                onChange={(e) => setCustomFrom(e.target.value || customFrom)}
                className="h-9 w-36 shrink-0"
                aria-label="From date"
              />
              <Input
                type="date"
                value={customTo}
                min={customFrom}
                max={today}
                onChange={(e) => setCustomTo(e.target.value || customTo)}
                className="h-9 w-36 shrink-0"
                aria-label="To date"
              />
            </>
          )}

          {isAdmin && (
            <Select value={branch} onValueChange={(v) => v && setBranch(v)}>
              <SelectTrigger className="h-9 w-44 shrink-0" aria-label="Branch">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_BRANCHES}>All Branches</SelectItem>
                {(branchesQ.data ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button
            variant={compare ? 'secondary' : 'outline'}
            size="lg"
            className="h-9 shrink-0"
            aria-pressed={compare}
            onClick={() => setCompare((c) => !c)}
          >
            <TrendingUp className="size-4" />
            Compare
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={!!exporting}
              aria-label="Export report"
              className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'h-9 shrink-0')}
            >
              {exporting ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
              Export
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Export Report</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleExport('excel')} className="gap-2">
                <FileSpreadsheet className="size-4" /> Excel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExport('pdf')} className="gap-2">
                <FileText className="size-4" /> PDF
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => printDocument({ paper })} className="gap-2">
                <Printer className="size-4" /> Print
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {failed ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={BarChart3}
              title="Unable to load sales data."
              description={failureDetail}
              action={
                <Button onClick={() => analyticsQ.refetch()} disabled={analyticsQ.isFetching}>
                  {analyticsQ.isFetching ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <RefreshCw className="size-4" />
                  )}
                  Retry
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <>
          {/* ── Summary ─────────────────────────────────────────────────────
              One column on a phone, as the brief lays out, widening to the
              same five-across row the dashboards already use above it. Every
              value is a skeleton while loading — never "Rs. 0", which reads as
              a real figure and would have a branch manager reaching for the
              phone over a request that simply had not landed yet. */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
            <StatCard
              title="Today's Sales"
              value={money(analytics?.todaySales ?? 0)}
              icon={Wallet}
              color="green"
              loading={loading}
            />
            <StatCard
              title="Total Sales"
              value={money(analytics?.totalSales ?? 0)}
              icon={BarChart3}
              color="orange"
              loading={loading}
            />
            <StatCard
              title="Average Daily"
              value={money(analytics?.averageDailySales ?? 0)}
              icon={TrendingUp}
              color="blue"
              loading={loading}
            />
            <StatCard
              title="Highest Day"
              value={analytics?.highestDay ? money(analytics.highestDay.sales) : '—'}
              icon={Trophy}
              color="brown"
              loading={loading}
            />
            {/* Lowest is over TRADING days only — the day series is dense, so a
                day the branch was shut sits in it as a zero and would win this
                tile on every window containing one. An em dash rather than Rs.0
                when nothing sold at all: there is no worst day without a day. */}
            <StatCard
              title="Lowest Day"
              value={analytics?.lowestDay ? money(analytics.lowestDay.sales) : '—'}
              icon={TrendingDown}
              color="blue"
              loading={loading}
            />
            <StatCard
              title="Transactions"
              value={(analytics?.totalTransactions ?? 0).toLocaleString()}
              icon={Receipt}
              color="red"
              loading={loading}
            />
          </div>

          {/* The highest day's DATE, which the card above has no room for and
              which is the half of that figure worth acting on. */}
          {!loading && analytics?.highestDay && (
            <p className="-mt-3 text-xs text-muted-foreground">
              Highest day: {formatDate(analytics.highestDay.date)} ·{' '}
              {analytics.highestDay.transactions.toLocaleString()} transactions
              {analytics.lowestDay && analytics.lowestDay.date !== analytics.highestDay.date && (
                <> · Lowest day: {formatDate(analytics.lowestDay.date)}</>
              )}{' '}
              · averaged over{' '}
              {describeRange({ from: analytics.from, to: analytics.effectiveTo }, formatDate)}
            </p>
          )}

          {isEmpty ? (
            <Card>
              <CardContent>
                <EmptyState
                  icon={CalendarRange}
                  title="No sales recorded for this period."
                  description={`Nothing was sold at ${scopeLabel.toLowerCase()} between ${describeRange(range, formatDate)}.`}
                  action={
                    <Button
                      variant="outline"
                      // Widen to a month — unless that IS the empty window, in
                      // which case open the custom pickers. A button labelled
                      // "Change Date Range" that leaves the range alone reads as
                      // a broken button.
                      onClick={() => setPreset(preset === 'last30' ? 'custom' : 'last30')}
                    >
                      <CalendarRange className="size-4" />
                      Change Date Range
                    </Button>
                  }
                />
              </CardContent>
            </Card>
          ) : (
            <>
              {/* ── The graph ─────────────────────────────────────────────── */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Daily Sales</CardTitle>
                  <TrendBadge analytics={analytics} loading={loading} money={money} />
                </CardHeader>
                <CardContent>
                  {loading ? (
                    <Skeleton className="h-[300px] w-full" />
                  ) : (
                    <DailySalesGraph data={analytics?.daily ?? []} currency={cur} />
                  )}
                </CardContent>
              </Card>

              {/* ── Payment mix and the product ranking ───────────────────── */}
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
                <PaymentMethodSummary analytics={analytics} loading={loading} currency={cur} />
                <div className="lg:col-span-2">
                  <TopSellingProducts
                    products={analytics?.topProducts ?? []}
                    loading={loading}
                    currency={cur}
                    limit={topLimit}
                    onLimitChange={setTopLimit}
                  />
                </div>
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}

/**
 * The period-on-period verdict.
 *
 * Three states, and the third is the point: a previous window that took nothing
 * gets a sentence, not a percentage. "+100%" against zero is a fabrication that
 * reads exactly like a measurement, and `changePct` is null precisely so this
 * component cannot print one by accident.
 *
 * `stable` is its own state too, with a neutral colour — the API applies a dead
 * band (SALES_TREND_STABLE_PCT) so a fraction of a percent of drift does not
 * arrive as a red arrow and send someone looking for a cause that is not there.
 */
function TrendBadge({
  analytics,
  loading,
  money,
}: {
  analytics: { comparison: SalesAnalyticsComparison | null } | null;
  loading: boolean;
  money: (n: number) => string;
}) {
  if (loading) return <Skeleton className="h-5 w-48" />;

  const c = analytics?.comparison;
  if (!c) return null;

  // `changePct` is null exactly when the previous window took nothing, so there
  // is one thing to say and no percentage to say it with.
  if (c.changePct === null) {
    return (
      <p className="text-xs text-muted-foreground">
        No sales in the previous period — nothing to compare against.
      </p>
    );
  }

  const Icon = c.direction === 'up' ? TrendingUp : c.direction === 'down' ? TrendingDown : Minus;
  const tone =
    c.direction === 'up'
      ? 'text-emerald-600 dark:text-emerald-400'
      : c.direction === 'down'
        ? 'text-red-600 dark:text-red-400'
        : 'text-muted-foreground';

  const verdict =
    c.direction === 'up'
      ? 'higher than the previous period'
      : c.direction === 'down'
        ? 'lower than the previous period'
        : 'about level with the previous period';

  return (
    <p className={cn('flex flex-wrap items-center gap-1.5 text-xs', tone)}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="font-semibold tabular-nums">
        {c.direction === 'stable' ? '' : c.changePct > 0 ? '+' : ''}
        {c.changePct}%
      </span>
      <span className="text-muted-foreground">
        Sales are {verdict} ({money(c.sales)})
      </span>
    </p>
  );
}
