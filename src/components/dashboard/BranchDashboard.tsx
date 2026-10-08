'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { WifiOff } from 'lucide-react';
import { businessDateStr, type ReportSummary, type SalesAnalytics } from '@mb/shared';

import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { useReportSummary, useSalesAnalytics } from '@/lib/queries';
import { formatTime } from '@/utils/date';
import { logger } from '@/utils/logger';
import { cn } from '@/lib/utils';
import { GeofenceStatusCard } from '@/components/geofence/GeofenceStatusCard';
import { LoginHistoryCard } from '@/components/dashboard/LoginHistoryCard';

import { dayCount } from './daily-sales/ranges';
import { BandCard, Panel, SectionError, StatRow } from './branch-v2/parts';
import { SalesSection } from './branch-v2/SalesSection';
import { StockSection } from './branch-v2/StockSection';
import {
  PERIODS,
  barPct,
  dayLabel,
  pctText,
  periodMeta,
  rangeLabel,
  share,
  type DashboardPeriod,
  type PeriodMeta,
} from './branch-v2/model';

/**
 * Branch Dashboard v2 — `Desing File/Branch Dashboard v2.dc.html`.
 *
 * Top to bottom: the period's money (three banded cards and one bar strip), the
 * sales trend (tiles, chart, ranking, orders, payment mix), then stock.
 *
 * ─── Where each figure comes from ────────────────────────────────────────────
 *
 * Four requests, each already aggregated by the API and each scoped to the
 * caller's own branch SERVER-side from the JWT. Nothing on this screen is
 * totalled in the browser.
 *
 *   /api/reports/summary     the Sales and Deductions bands, the bar strip, Orders
 *   /api/sales-analytics     the trend band, tiles, chart, products, payments
 *   /api/stock/history?date  today's stock statement, tiles and flow
 *   /api/stock/history?days  the seven-day history table
 *
 * The period toggle reframes the first two. Stock is always today and seven
 * days: what is on the shelf is a fact about now.
 *
 * `docs/branch-dashboard-v2-api-map.md` has the full account.
 */

/** `navigator.onLine`, subscribed — so the "Offline" note appears and clears on its own. */
function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}
function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}

export function BranchDashboard() {
  const { token, user } = useAuth();
  const { settings } = useSettings();
  const online = useOnline();
  const [period, setPeriod] = useState<DashboardPeriod>('daily');
  const [compare, setCompare] = useState(true);

  const cur = settings?.currencySymbol || 'Rs.';
  const money = (n: number) => `${cur} ${Math.round(n).toLocaleString()}`;

  // The business date, not the calendar one: between midnight and 2 AM they
  // differ, and every API here groups on the business date.
  const today = businessDateStr();
  const meta = useMemo(() => periodMeta(period, today), [period, today]);
  const branchId = user?.branchId ?? null;
  const branchName = user?.branchName || 'Your branch';

  // `basic`: this screen reads the summary's totals only — the product ranking
  // and payment mix come from sales-analytics, so the server skips those
  // group-bys. `keepPrevious` leaves the last period's figures up (dimmed)
  // while the next loads, rather than collapsing the page to skeletons.
  const summaryQ = useReportSummary(token, period, branchId, null, 'basic', { keepPrevious: true });
  const analyticsQ = useSalesAnalytics(
    token,
    { from: meta.from, to: meta.to, topLimit: 5, compare },
    { enabled: !!token, keepPrevious: true },
  );

  useEffect(() => {
    if (summaryQ.error) logger.error('Branch dashboard: summary request failed', summaryQ.error);
    if (analyticsQ.error) logger.error('Branch dashboard: sales analytics request failed', analyticsQ.error);
  }, [summaryQ.error, analyticsQ.error]);

  const summary = summaryQ.data ?? null;
  const analytics = analyticsQ.data ?? null;
  const summaryLoading = summaryQ.isPending;
  const analyticsLoading = analyticsQ.isPending;
  const summaryFailed = summaryQ.isError && !summary;
  const analyticsFailed = analyticsQ.isError && !analytics;
  const summaryStale = summaryQ.isPlaceholderData;

  // Cached figures are never presented as live: offline, or after a failed
  // refresh, the heading says when they were fetched.
  const showingCache = !!summary && (!online || summaryQ.isError);

  const ordersPanel = (
    <OrdersPanel
      summary={summary}
      meta={meta}
      loading={summaryLoading}
      failed={summaryFailed}
      stale={summaryStale}
      money={money}
    />
  );

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-4 tabular-nums">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-extrabold tracking-[-0.01em]">{branchName}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {meta.summaryLabel} overview · {dayLabel(today)} {today.slice(0, 4)}
          </p>
          {showingCache && (
            <p role="status" className="mt-1 flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
              <WifiOff className="size-3.5" aria-hidden />
              {online ? 'Could not refresh' : 'Offline'} · last updated {formatTime(new Date(summaryQ.dataUpdatedAt))}
            </p>
          )}
        </div>
        <div role="group" aria-label="Period" className="flex overflow-hidden rounded-[4px] border bg-card">
          {PERIODS.map((p) => (
            <button
              key={p.value}
              type="button"
              aria-pressed={period === p.value}
              onClick={() => setPeriod(p.value)}
              className={cn(
                'px-3.5 py-1.5 text-xs font-semibold transition-colors max-md:py-2.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
                period === p.value ? 'bg-fin-income text-white' : 'text-muted-foreground hover:bg-fin-soft',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Renders nothing unless geofencing applies to this user. */}
      <GeofenceStatusCard />

      {/* ── Summary trio ───────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-3">
        {summaryFailed ? (
          <div className="flex-[2_1_480px]">
            <SectionError
              what="the dashboard"
              onRetry={() => summaryQ.refetch()}
              retrying={summaryQ.isFetching}
            />
          </div>
        ) : (
          <SummaryBands
            summary={summary}
            meta={meta}
            period={period}
            loading={summaryLoading}
            stale={summaryStale}
            money={money}
          />
        )}
        <TrendBand
          analytics={analytics}
          meta={meta}
          compare={compare}
          loading={analyticsLoading}
          failed={analyticsFailed}
          stale={analyticsQ.isPlaceholderData}
          money={money}
        />
      </div>

      {!summaryFailed && (
        <DeductionBars summary={summary} meta={meta} today={today} loading={summaryLoading} stale={summaryStale} money={money} />
      )}

      {/* ── Sales ──────────────────────────────────────────────────────────── */}
      <SalesSection
        token={token}
        period={period}
        meta={meta}
        today={today}
        branchName={branchName}
        analytics={analytics}
        loading={analyticsLoading}
        failed={analyticsFailed}
        stale={analyticsQ.isPlaceholderData}
        retrying={analyticsQ.isFetching}
        onRetry={() => analyticsQ.refetch()}
        compare={compare}
        onCompareChange={setCompare}
        money={money}
        orders={ordersPanel}
      />

      {/* ── Stock ──────────────────────────────────────────────────────────── */}
      <StockSection token={token} branchId={branchId} today={today} money={money} />

      {/* Not in the design, and last for that reason: it is a record to consult
          ("was that me?"), not part of the shop's trading. */}
      <LoginHistoryCard />
    </div>
  );
}

const BAND_CARD = 'flex-[1_1_240px]';

/** Completed is what is left once pending and cancelled are taken off the total. */
function completedOrders(s: ReportSummary): number {
  return Math.max(0, s.totalOrders - s.totalPending - s.totalCancelled);
}

function SummaryBands({
  summary,
  meta,
  period,
  loading,
  stale,
  money,
}: {
  summary: ReportSummary | null;
  meta: PeriodMeta;
  period: DashboardPeriod;
  loading: boolean;
  stale: boolean;
  money: (n: number) => string;
}) {
  const s = summary;
  const revenue = s?.totalRevenue ?? 0;
  const expensePct = share(s?.totalExpenses ?? 0, revenue);
  const discountPct = share(s?.totalDiscount ?? 0, revenue);
  // The budget for the range the actual came from — a week's takings against a
  // daily target is a figure that is always over. Absent or zero is "not set",
  // never 0%.
  const budget = s?.budget?.[period] ?? 0;
  const budgetPct = budget > 0 ? Math.round((revenue / budget) * 100) : null;
  const dim = cn(BAND_CARD, 'transition-opacity', stale && 'opacity-60');

  return (
    <>
      <BandCard title={`Sales · ${meta.summaryLabel}`} tone="income" className={dim}>
        <StatRow
          label="Sales"
          note={s ? `${completedOrders(s).toLocaleString()} completed orders` : undefined}
          value={money(revenue)}
          loading={loading}
        />
        {/* `totalProfit` is revenue − expenses on the server (reports.routes.ts),
            which is exactly what the caption says. */}
        <StatRow
          label="Net Amount"
          note="Sales − Expenses"
          value={money(s?.totalProfit ?? 0)}
          valueClassName={(s?.totalProfit ?? 0) < 0 ? 'text-destructive' : undefined}
          loading={loading}
        />
        <StatRow
          label="Orders"
          note={s ? `${s.totalPending.toLocaleString()} pending · ${s.totalCancelled.toLocaleString()} cancelled` : undefined}
          value={(s?.totalOrders ?? 0).toLocaleString()}
          loading={loading}
          last
        />
      </BandCard>

      <BandCard title={`Deductions · ${meta.summaryLabel}`} tone="expense" className={dim}>
        <StatRow
          label="Expenses"
          note={expensePct === null ? 'No sales to compare against' : `${pctText(expensePct)} of sales`}
          value={money(s?.totalExpenses ?? 0)}
          loading={loading}
        />
        {/* Already deducted from Sales by the server — shown so a branch can see
            what it gave away, not to be subtracted again. */}
        <StatRow
          label="Discounts"
          note={discountPct === null ? 'Already off Sales' : `${pctText(discountPct)} of sales · already off Sales`}
          value={money(s?.totalDiscount ?? 0)}
          loading={loading}
        />
        {budgetPct === null ? (
          <StatRow
            label="Budget vs Actual"
            note="Ask Admin to configure branch budgets"
            value="Not set"
            valueClassName="text-[13px] font-bold text-muted-foreground"
            loading={loading}
            last
          />
        ) : (
          <StatRow
            label="Budget vs Actual"
            note={`${money(revenue)} of ${money(budget)}`}
            value={`${budgetPct}%`}
            valueClassName={budgetPct >= 100 ? 'text-emerald-600 dark:text-emerald-400' : undefined}
            loading={loading}
            last
          />
        )}
      </BandCard>
    </>
  );
}

/** The third card of the trio: the trend window in three lines. */
function TrendBand({
  analytics,
  meta,
  compare,
  loading,
  failed,
  stale,
  money,
}: {
  analytics: SalesAnalytics | null;
  meta: PeriodMeta;
  compare: boolean;
  loading: boolean;
  failed: boolean;
  stale: boolean;
  money: (n: number) => string;
}) {
  const a = analytics;
  const c = a?.comparison ?? null;
  const dash = <span className="text-muted-foreground">—</span>;

  let changeNote = 'Turn on Compare to see the previous period';
  let changeValue: React.ReactNode = dash;
  let changeTone: string | undefined;
  if (compare && c) {
    changeNote = `Previous: ${money(c.sales)}`;
    // Null exactly when the previous window took nothing — there is no
    // percentage against zero, so there is a sentence instead.
    if (c.changePct === null) {
      changeNote = 'No sales in the previous period';
    } else {
      changeValue = `${c.changePct > 0 ? '+' : ''}${c.changePct}%`;
      changeTone =
        c.direction === 'up'
          ? 'text-emerald-600 dark:text-emerald-400'
          : c.direction === 'down'
            ? 'text-red-600 dark:text-red-400'
            : 'text-muted-foreground';
    }
  }

  return (
    <BandCard
      title={meta.trendLabel}
      tone="ink"
      className={cn(BAND_CARD, 'transition-opacity', stale && 'opacity-60')}
    >
      <StatRow
        label="Total Sales"
        note={
          failed
            ? 'Unable to load — retry below'
            : a
              ? `${rangeLabel(a.from, a.effectiveTo)} · ${a.totalTransactions.toLocaleString()} transactions`
              : undefined
        }
        value={a ? money(a.totalSales) : dash}
        loading={loading}
      />
      <StatRow
        label="Average Daily"
        note={a ? `Averaged over ${dayCount(a.from, a.effectiveTo)} days` : undefined}
        value={a ? money(a.averageDailySales) : dash}
        loading={loading}
      />
      <StatRow
        label="vs Previous Period"
        note={a ? changeNote : undefined}
        value={a ? changeValue : dash}
        valueClassName={changeTone}
        loading={loading}
        last
      />
    </BandCard>
  );
}

/** Sales, Net, Expenses and Discounts as four bars on ONE scale. */
function DeductionBars({
  summary,
  meta,
  today,
  loading,
  stale,
  money,
}: {
  summary: ReportSummary | null;
  meta: PeriodMeta;
  today: string;
  loading: boolean;
  stale: boolean;
  money: (n: number) => string;
}) {
  const s = summary;
  const bars = [
    { label: 'Sales', kind: 'Income', value: s?.totalRevenue ?? 0, fill: 'bg-fin-share' },
    { label: 'Net Amount', kind: 'Income', value: s?.totalProfit ?? 0, fill: 'bg-fin-ink-muted' },
    { label: 'Expenses', kind: 'Deduction', value: s?.totalExpenses ?? 0, fill: 'bg-fin-ledger' },
    { label: 'Discounts', kind: 'Deduction', value: s?.totalDiscount ?? 0, fill: 'bg-primary' },
  ];
  const max = Math.max(...bars.map((b) => b.value));
  const when = meta.bucketNoun === 'day' ? dayLabel(today) : meta.summaryLabel;

  return (
    <Panel
      title={`Sales vs Deductions · ${when}`}
      className={cn('transition-opacity', stale && 'opacity-60')}
      bodyClassName="flex flex-col gap-2 py-3"
    >
      {bars.map((b) => (
        <div key={b.label} className="grid grid-cols-[minmax(0,120px)_1fr_auto] items-center gap-3">
          <div>
            <div className="text-xs font-bold">{b.label}</div>
            <div className="text-[9px] tracking-[0.06em] text-muted-foreground uppercase">{b.kind}</div>
          </div>
          <div className="h-2.5 rounded-[2px] bg-muted" aria-hidden>
            {!loading && (
              <div
                className={cn('h-full rounded-[2px]', b.fill)}
                // A figure that exists is never drawn as nothing.
                style={{ width: `${barPct(b.value, max)}%`, minWidth: b.value > 0 ? 4 : 0 }}
              />
            )}
          </div>
          <span className="min-w-[90px] text-right text-xs font-extrabold tabular-nums">
            {loading ? '…' : money(b.value)}
          </span>
        </div>
      ))}
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        Bars share one scale, so a deduction that is small against sales draws small.
      </p>
    </Panel>
  );
}

function OrdersPanel({
  summary,
  meta,
  loading,
  failed,
  stale,
  money,
}: {
  summary: ReportSummary | null;
  meta: PeriodMeta;
  loading: boolean;
  failed: boolean;
  stale: boolean;
  money: (n: number) => string;
}) {
  const s = summary;
  const completed = s ? completedOrders(s) : 0;
  const pct = s ? share(completed, s.totalOrders) : null;
  const rows: { label: string; value: string; bold?: boolean }[] = [
    { label: 'Total', value: (s?.totalOrders ?? 0).toLocaleString(), bold: true },
    { label: 'Completed', value: completed.toLocaleString() },
    { label: 'Pending', value: (s?.totalPending ?? 0).toLocaleString() },
    { label: 'Cancelled', value: (s?.totalCancelled ?? 0).toLocaleString() },
    { label: 'Avg. order value', value: money(s?.averageOrderValue ?? 0) },
  ];

  return (
    <Panel
      title={`Orders · ${meta.summaryLabel}`}
      className={cn('transition-opacity', stale && 'opacity-60')}
      bodyClassName="flex flex-wrap items-center gap-5 py-4"
    >
      {failed ? (
        <p className="py-6 text-sm text-muted-foreground">Unable to load orders. Retry at the top of the page.</p>
      ) : (
        <>
          <div
            role="img"
            aria-label={pct === null ? 'No orders yet' : `${Math.round(pct)}% of orders completed`}
            className="grid size-[110px] flex-none place-items-center rounded-full"
            style={{
              background: `conic-gradient(var(--primary) 0 ${pct ?? 0}%, var(--muted) ${pct ?? 0}% 100%)`,
            }}
          >
            <div className="grid size-20 place-items-center rounded-full bg-card text-center">
              <div>
                <div className="text-xl font-extrabold">{loading ? '…' : pct === null ? '—' : `${Math.round(pct)}%`}</div>
                <div className="text-[9px] font-bold tracking-[0.06em] text-muted-foreground uppercase">
                  {pct === null && !loading ? 'No orders' : 'Completed'}
                </div>
              </div>
            </div>
          </div>
          <dl className="min-w-[200px] flex-1">
            {rows.map((r) => (
              <div
                key={r.label}
                className="flex justify-between border-b border-border/60 py-1.5 text-xs last:border-b-0"
              >
                <dt className={r.bold ? 'font-bold' : 'font-medium'}>{r.label}</dt>
                <dd className="font-extrabold tabular-nums">{loading ? '…' : r.value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </Panel>
  );
}

