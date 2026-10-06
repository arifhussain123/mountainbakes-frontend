import { businessDateStr, type SalesAnalyticsDay } from '@mb/shared';
import { addDays } from '../daily-sales/ranges';

/**
 * Branch Dashboard v2 — the pure half.
 *
 * Nothing here is a financial calculation. Every headline figure on the screen
 * is printed as the API returned it; this file only decides which window to ask
 * for, how to group the server's dense day series into bars, and how to turn two
 * server figures into a bar width or a percentage caption.
 */

export type DashboardPeriod = 'daily' | 'weekly' | 'monthly';

export const PERIODS: { value: DashboardPeriod; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

/** How many calendar months the Monthly trend reaches back, this month included. */
const TREND_MONTHS = 6;

export interface PeriodMeta {
  /** Suffix on the Sales / Deductions bands — the window `/api/reports/summary` answers for. */
  summaryLabel: string;
  /** Title of the trend band — the window `/api/sales-analytics` answers for. */
  trendLabel: string;
  /** What one bar on the trend chart stands for. */
  bucketNoun: 'day' | 'week' | 'month';
  chartTitle: string;
  bannerTitle: string;
  /** Business dates, inclusive. */
  from: string;
  to: string;
}

/**
 * Resolve a period against today's BUSINESS date (2 AM Karachi rollover) — the
 * column the API groups on. See `daily-sales/ranges.ts` for why nothing here
 * goes through a local `Date`.
 */
export function periodMeta(period: DashboardPeriod, today: string = businessDateStr()): PeriodMeta {
  switch (period) {
    case 'daily':
      return {
        summaryLabel: 'Today',
        trendLabel: 'Last 7 days',
        bucketNoun: 'day',
        chartTitle: 'Sales · Daily',
        bannerTitle: 'Daily Sales',
        // Inclusive of today, so seven bars and not eight.
        from: addDays(today, -6),
        to: today,
      };
    case 'weekly':
      return {
        summaryLabel: 'This week',
        trendLabel: 'Last 4 weeks',
        bucketNoun: 'week',
        chartTitle: 'Sales · Weekly',
        bannerTitle: 'Weekly Sales',
        from: addDays(today, -27),
        to: today,
      };
    case 'monthly':
      return {
        summaryLabel: 'This month',
        trendLabel: `Last ${TREND_MONTHS} months`,
        bucketNoun: 'month',
        chartTitle: 'Sales · Monthly',
        bannerTitle: 'Monthly Sales',
        from: monthsBack(today, TREND_MONTHS - 1),
        to: today,
      };
  }
}

/** First day of the month `n` months before the one `dateStr` falls in. */
function monthsBack(dateStr: string, n: number): string {
  const [y, m] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 - n, 1));
  return d.toISOString().slice(0, 10);
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function parts(date: string): { y: number; m: number; d: number } | null {
  const [y, m, d] = date.split('-').map(Number);
  return y && m && d ? { y, m, d } : null;
}

/** 'Tue' */
export function weekday(date: string): string {
  const p = parts(date);
  return p ? DAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()]! : date;
}

/** '06 Oct' */
export function shortDate(date: string): string {
  const p = parts(date);
  return p ? `${String(p.d).padStart(2, '0')} ${MONTHS[p.m - 1]}` : date;
}

/** 'Tue 06 Oct' */
export function dayLabel(date: string): string {
  return `${weekday(date)} ${shortDate(date)}`;
}

/** '06 Oct 2026' */
export function fullDate(date: string): string {
  const p = parts(date);
  return p ? `${shortDate(date)} ${p.y}` : date;
}

/** '30 Sep – 06 Oct 2026' */
export function rangeLabel(from: string, to: string): string {
  return from === to ? fullDate(to) : `${shortDate(from)} – ${fullDate(to)}`;
}

export interface TrendBucket {
  key: string;
  /** Under the bar. */
  label: string;
  /** In the hover note. */
  title: string;
  sales: number;
  transactions: number;
  /** The bucket holding today's business date — drawn in the accent colour. */
  current: boolean;
}

/**
 * Group the API's day series into the bars the chart draws.
 *
 * Daily is one bar per day, untouched. Weekly and Monthly SUM consecutive days —
 * the series is dense (a closed day is a zero, not a gap) so the groups are
 * complete, and the sum of the bars is the API's own `totalSales`.
 *
 * Weeks are counted back from the last day rather than aligned to a calendar
 * week, so the newest bar is always a full seven days and never a stub.
 */
export function bucketTrend(
  daily: readonly SalesAnalyticsDay[],
  period: DashboardPeriod,
  today: string = businessDateStr(),
): TrendBucket[] {
  if (period === 'daily') {
    return daily.map((d) => ({
      key: d.date,
      label: weekday(d.date),
      title: dayLabel(d.date),
      sales: d.sales,
      transactions: d.transactions,
      current: d.date === today,
    }));
  }

  const groups: SalesAnalyticsDay[][] = [];
  if (period === 'weekly') {
    for (let end = daily.length; end > 0; end -= 7) {
      groups.unshift(daily.slice(Math.max(0, end - 7), end));
    }
  } else {
    for (const d of daily) {
      const last = groups[groups.length - 1];
      if (last && last[0]!.date.slice(0, 7) === d.date.slice(0, 7)) last.push(d);
      else groups.push([d]);
    }
  }

  return groups.map((g) => {
    const first = g[0]!.date;
    const last = g[g.length - 1]!.date;
    const p = parts(first);
    return {
      key: first,
      label: period === 'weekly' ? shortDate(first) : p ? MONTHS[p.m - 1]! : first,
      title: period === 'weekly' ? rangeLabel(first, last) : p ? `${MONTHS[p.m - 1]} ${p.y}` : first,
      sales: g.reduce((sum, d) => sum + d.sales, 0),
      transactions: g.reduce((sum, d) => sum + d.transactions, 0),
      current: first <= today && today <= last,
    };
  });
}

/**
 * A round axis maximum at or above `value`, with four equal steps under it.
 * 51,650 → 60,000 (ticks every 15,000), which is what the design draws.
 */
export function axisMax(value: number): number {
  if (!(value > 0)) return 4;
  const step = value / 4;
  const magnitude = 10 ** Math.floor(Math.log10(step));
  const nice = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10].find((n) => n * magnitude >= step) ?? 10;
  return nice * magnitude * 4;
}

/** 15000 → '15k', 1250000 → '1.3M'. Axis and bar captions only — never a headline figure. */
export function compact(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (abs >= 1_000) return `${trim(n / 1_000)}k`;
  return String(Math.round(n));
}

function trim(n: number): string {
  return n.toFixed(1).replace(/\.0$/, '');
}

/** `part` as a share of `whole`, 0–100. Null when there is no whole to take a share of. */
export function share(part: number, whole: number): number | null {
  return whole > 0 ? (part / whole) * 100 : null;
}

/** Bar width in percent of the scale, clamped — a negative figure draws no bar rather than a backwards one. */
export function barPct(value: number, max: number): number {
  if (!(max > 0) || !(value > 0)) return 0;
  return Math.min(100, (value / max) * 100);
}

/** '1.8%' — one decimal, as the design prints its captions. */
export function pctText(pct: number): string {
  return `${pct.toFixed(1)}%`;
}
