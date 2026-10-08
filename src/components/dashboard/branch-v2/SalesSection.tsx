'use client';

import { useMemo, useState } from 'react';
import { FileSpreadsheet, FileText, Loader2 } from 'lucide-react';
import type { SalesAnalytics } from '@mb/shared';

import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PAYMENT_METHOD_LABELS } from '@/utils/constants';
import { cn } from '@/lib/utils';

import { dayCount } from '../daily-sales/ranges';
import { useSalesExport } from '../daily-sales/useSalesExport';
import { Panel, PanelEmpty, SectionBanner, SectionError, Swatch, Tile } from './parts';
import {
  axisMax,
  barPct,
  bucketTrend,
  compact,
  dayLabel,
  pctText,
  rangeLabel,
  share,
  type DashboardPeriod,
  type PeriodMeta,
} from './model';

const TOP_LIMIT = 5;

/** Ghost button on a coloured banner. */
const BANNER_BUTTON =
  'inline-flex items-center gap-1.5 rounded-[3px] border border-white/35 px-2.5 py-1 max-md:py-2 text-[11px] font-semibold text-white transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:outline-none disabled:opacity-60';

/**
 * Segment fills for the payment mix, in the order the API ranks the tenders.
 * Each pairs a fill with a text colour that reads on it in both schemes.
 */
const PAYMENT_FILLS = [
  { bg: 'bg-fin-share', fg: 'text-white' },
  { bg: 'bg-fin-ink-muted', fg: 'text-fin-peach-foreground dark:text-fin-ink' },
  { bg: 'bg-primary', fg: 'text-primary-foreground' },
  { bg: 'bg-fin-ledger', fg: 'text-white' },
  { bg: 'bg-fin-return', fg: 'text-white' },
] as const;

/**
 * The sales half of the dashboard: banner, six tiles, trend chart, product
 * ranking, and — beside the `orders` panel the composer hands in — the payment
 * mix. Everything here is one `/api/sales-analytics` answer.
 */
export function SalesSection({
  token,
  period,
  meta,
  today,
  branchName,
  analytics,
  loading,
  failed,
  stale,
  retrying,
  onRetry,
  compare,
  onCompareChange,
  money,
  orders,
}: {
  token: string;
  period: DashboardPeriod;
  meta: PeriodMeta;
  today: string;
  branchName: string;
  analytics: SalesAnalytics | null;
  loading: boolean;
  failed: boolean;
  /** Showing the previous period's answer while the new one loads. */
  stale: boolean;
  retrying: boolean;
  onRetry: () => void;
  compare: boolean;
  onCompareChange: (next: boolean) => void;
  money: (n: number) => string;
  /** The Orders panel — summary data, so the composer owns it. */
  orders: React.ReactNode;
}) {
  const { exporting, exportReport } = useSalesExport(token, {
    from: meta.from,
    to: meta.to,
    topLimit: TOP_LIMIT,
    compare,
  });

  const windowLabel = analytics ? rangeLabel(analytics.from, analytics.effectiveTo) : rangeLabel(meta.from, meta.to);
  // "No sales" means no money AND no unpaid staff sales — see DailySalesSection.
  const isEmpty = !!analytics && analytics.totalTransactions === 0 && analytics.staffCount === 0;

  return (
    <>
      <SectionBanner title={meta.bannerTitle} tone="income">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[11px] text-fin-ink-muted">
          <span>
            {windowLabel} · {branchName}
          </span>
          <button
            type="button"
            className={cn(BANNER_BUTTON, compare && 'bg-white/15')}
            aria-pressed={compare}
            onClick={() => onCompareChange(!compare)}
          >
            Compare
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger disabled={!!exporting} aria-label="Export sales report" className={BANNER_BUTTON}>
              {exporting && <Loader2 className="size-3 animate-spin" />}
              Export
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Export Report</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => exportReport('excel')} className="gap-2">
                <FileSpreadsheet className="size-4" /> Excel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportReport('pdf')} className="gap-2">
                <FileText className="size-4" /> PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </SectionBanner>

      {failed ? (
        <>
          <SectionError what="sales figures" onRetry={onRetry} retrying={retrying} />
          {orders}
        </>
      ) : (
        <div className={cn('flex flex-col gap-4 transition-opacity', stale && 'opacity-60')} aria-busy={stale || loading}>
          <SalesTiles analytics={analytics} loading={loading} today={today} money={money} />

          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,480px),1fr))] gap-3">
            <Panel title={meta.chartTitle}>
              {loading ? (
                <Skeleton className="h-[250px] w-full" />
              ) : isEmpty || !analytics ? (
                <PanelEmpty>No sales recorded for this period.</PanelEmpty>
              ) : (
                <TrendChart analytics={analytics} period={period} meta={meta} today={today} money={money} />
              )}
            </Panel>

            <Panel title="Top Selling Products" bodyClassName="flex flex-col gap-3">
              {loading ? (
                Array.from({ length: TOP_LIMIT }).map((_, i) => <Skeleton key={i} className="h-7 w-full" />)
              ) : !analytics || analytics.topProducts.length === 0 ? (
                <PanelEmpty>Nothing sold in this period yet.</PanelEmpty>
              ) : (
                <TopProducts analytics={analytics} money={money} />
              )}
            </Panel>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,480px),1fr))] gap-3">
            {orders}
            <Panel title="Payment Methods" bodyClassName="flex flex-col gap-3.5 py-4">
              {loading ? (
                <>
                  <Skeleton className="h-[22px] w-full" />
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </>
              ) : !analytics || analytics.paymentMethods.length === 0 ? (
                <PanelEmpty>No payments in this period yet.</PanelEmpty>
              ) : (
                <PaymentMix analytics={analytics} money={money} />
              )}
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}

function SalesTiles({
  analytics,
  loading,
  today,
  money,
}: {
  analytics: SalesAnalytics | null;
  loading: boolean;
  today: string;
  money: (n: number) => string;
}) {
  const a = analytics;
  const windowLabel = a ? rangeLabel(a.from, a.effectiveTo) : '';
  const c = a?.comparison ?? null;
  // A previous window that took nothing has no percentage — `changePct` is null
  // so that "+100%" against zero cannot be printed by accident.
  const totalNote = !c
    ? windowLabel
    : c.changePct === null
      ? 'No sales in previous period'
      : `${c.changePct > 0 ? '+' : ''}${c.changePct}% vs previous`;

  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,130px),1fr))] gap-2.5">
      <Tile
        label="Today's Sales"
        value={money(a?.todaySales ?? 0)}
        note={dayLabel(today)}
        swatch="bg-primary"
        loading={loading}
      />
      <Tile
        label="Total Sales"
        value={money(a?.totalSales ?? 0)}
        note={totalNote}
        swatch="bg-fin-share"
        loading={loading}
      />
      <Tile
        label="Average Daily"
        value={money(a?.averageDailySales ?? 0)}
        note={a ? `Over ${dayCount(a.from, a.effectiveTo)} days` : undefined}
        swatch="bg-fin-ink-muted"
        loading={loading}
      />
      {/* An em dash rather than Rs. 0 when nothing sold: there is no best or
          worst day without a day. Lowest is over TRADING days only. */}
      <Tile
        label="Highest Day"
        value={a?.highestDay ? money(a.highestDay.sales) : '—'}
        note={
          a?.highestDay
            ? `${dayLabel(a.highestDay.date)} · ${a.highestDay.transactions.toLocaleString()} txns`
            : 'No sales yet'
        }
        swatch="bg-emerald-600"
        loading={loading}
      />
      <Tile
        label="Lowest Day"
        value={a?.lowestDay ? money(a.lowestDay.sales) : '—'}
        note={a?.lowestDay ? dayLabel(a.lowestDay.date) : 'No sales yet'}
        swatch="bg-red-600"
        loading={loading}
      />
      <Tile
        label="Transactions"
        value={(a?.totalTransactions ?? 0).toLocaleString()}
        note={windowLabel}
        swatch="bg-fin-ledger"
        loading={loading}
      />
    </div>
  );
}

function TrendChart({
  analytics,
  period,
  meta,
  today,
  money,
}: {
  analytics: SalesAnalytics;
  period: DashboardPeriod;
  meta: PeriodMeta;
  today: string;
  money: (n: number) => string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const buckets = useMemo(() => bucketTrend(analytics.daily, period, today), [analytics.daily, period, today]);

  // Per day it is the API's own average. Per week / month it is the same total
  // spread over the bars drawn, which is what a line across those bars means.
  const average =
    period === 'daily' ? analytics.averageDailySales : buckets.length ? analytics.totalSales / buckets.length : 0;
  const max = axisMax(Math.max(average, ...buckets.map((b) => b.sales)));
  const ticks = [4, 3, 2, 1, 0].map((i) => (max / 4) * i);
  const columns = { gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))` };
  const active = buckets.find((b) => b.key === hover) ?? null;

  const note = active
    ? [
        active.title,
        money(active.sales),
        `${active.transactions.toLocaleString()} txns`,
        average > 0 ? `${signed(((active.sales - average) / average) * 100)} vs average` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'Hover or tap a bar for the exact amount.';

  return (
    <div>
      <div className="mb-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Swatch className="size-2 bg-fin-share" />
          Sales
        </span>
        <span className="flex items-center gap-1.5">
          <Swatch className="size-2 bg-primary" />
          {meta.summaryLabel}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="w-3 border-t border-dashed border-muted-foreground" />
          Average {money(average)}
        </span>
      </div>

      <div className="grid grid-cols-[34px_1fr] gap-x-2 gap-y-1.5">
        <div
          aria-hidden
          className="flex h-[200px] flex-col justify-between text-right font-mono text-[9px] text-muted-foreground"
        >
          {ticks.map((t) => (
            <span key={t}>{compact(t)}</span>
          ))}
        </div>
        <div
          role="group"
          aria-label={`${meta.chartTitle}, ${rangeLabel(analytics.from, analytics.effectiveTo)}`}
          className="relative grid h-[200px] items-end gap-[clamp(6px,2.5vw,28px)] border-b border-border px-1"
          style={{
            ...columns,
            backgroundImage:
              'repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px 25%)',
          }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-muted-foreground"
            style={{ bottom: `${barPct(average, max)}%` }}
          />
          {buckets.map((b) => (
            <button
              key={b.key}
              type="button"
              aria-label={`${b.title}: ${money(b.sales)}, ${b.transactions} transactions`}
              onMouseEnter={() => setHover(b.key)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(b.key)}
              onBlur={() => setHover(null)}
              onClick={() => setHover(b.key)}
              className="relative flex h-full min-w-0 cursor-pointer flex-col items-center justify-end outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="mb-[3px] text-[9px] font-bold text-muted-foreground tabular-nums">
                {compact(b.sales)}
              </span>
              <span
                className={cn(
                  'block w-full max-w-11 rounded-t-[2px] transition-colors',
                  hover === b.key ? 'bg-foreground' : b.current ? 'bg-primary' : 'bg-fin-share',
                )}
                // A day that sold something is never drawn as nothing.
                style={{ height: `${barPct(b.sales, max)}%`, minHeight: b.sales > 0 ? 2 : 0 }}
              />
            </button>
          ))}
        </div>
        <div />
        <div
          aria-hidden
          className="grid gap-[clamp(6px,2.5vw,28px)] px-1 text-center text-[10px] text-muted-foreground"
          style={columns}
        >
          {buckets.map((b) => (
            <span key={b.key} className="truncate">
              {b.label}
            </span>
          ))}
        </div>
      </div>

      <p className="mt-2.5 min-h-4 text-[11px] text-muted-foreground tabular-nums" aria-live="polite">
        {note}
      </p>
    </div>
  );
}

function signed(pct: number): string {
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`;
}

function TopProducts({ analytics, money }: { analytics: SalesAnalytics; money: (n: number) => string }) {
  const products = analytics.topProducts;
  const maxSales = Math.max(...products.map((p) => p.sales));
  const maxQty = Math.max(...products.map((p) => p.qty));

  return (
    <>
      <div className="flex gap-3.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <Swatch className="size-2 bg-fin-share" />
          Sales
        </span>
        <span className="flex items-center gap-1.5">
          <Swatch className="size-2 bg-primary" />
          Qty sold
        </span>
      </div>
      {products.map((p) => (
        <div
          key={p.productId || p.productName}
          className="grid grid-cols-[minmax(0,130px)_1fr] items-center gap-3"
        >
          <div className="truncate text-xs font-bold" title={p.productName}>
            {p.productName}
          </div>
          {/* Bars stop at 82% so the widest one still has room for its figure. */}
          <div className="flex min-w-0 flex-col gap-[3px]">
            <div className="flex items-center gap-1.5">
              <div
                className="h-[9px] min-w-[2px] rounded-[1px] bg-fin-share"
                style={{ width: `${barPct(p.sales, maxSales) * 0.82}%` }}
              />
              <span className="text-[10px] font-bold whitespace-nowrap tabular-nums">{money(p.sales)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div
                className="h-[9px] min-w-[2px] rounded-[1px] bg-primary"
                style={{ width: `${barPct(p.qty, maxQty) * 0.82}%` }}
              />
              <span className="text-[10px] whitespace-nowrap text-muted-foreground tabular-nums">
                {p.qty.toLocaleString()} pcs
              </span>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function PaymentMix({ analytics, money }: { analytics: SalesAnalytics; money: (n: number) => string }) {
  // The rows sum exactly to `totalSales` (staff sales are excluded from both).
  const total = analytics.totalSales;
  const methods = analytics.paymentMethods.map((m, i) => ({
    ...m,
    name: PAYMENT_METHOD_LABELS[m.method] ?? m.method,
    pct: share(m.total, total) ?? 0,
    fill: PAYMENT_FILLS[i % PAYMENT_FILLS.length]!,
  }));

  return (
    <>
      <div
        role="img"
        aria-label={methods.map((m) => `${m.name} ${pctText(m.pct)}`).join(', ')}
        className="flex h-[22px] overflow-hidden rounded-[2px] bg-muted"
      >
        {methods.map((m) => (
          <div
            key={m.method}
            className={cn('flex items-center overflow-hidden pl-2 text-[10px] font-bold', m.fill.bg, m.fill.fg)}
            style={{ width: `${m.pct}%` }}
          >
            {/* Only where the segment is wide enough to hold it; the row below
                always carries the share. */}
            {m.pct >= 12 ? pctText(m.pct) : null}
          </div>
        ))}
      </div>
      <div>
        {methods.map((m) => (
          <div key={m.method} className="flex items-center gap-2.5 border-b border-border/60 py-1.5 last:border-b-0">
            <Swatch className={cn('size-2', m.fill.bg)} />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold">{m.name}</div>
              <div className="text-[11px] text-muted-foreground tabular-nums">
                {m.count.toLocaleString()} sales · {pctText(m.pct)}
              </div>
            </div>
            <span className="text-[13px] font-extrabold tabular-nums">{money(m.total)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
