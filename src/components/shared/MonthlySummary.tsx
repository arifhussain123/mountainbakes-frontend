import type { ReactNode } from 'react';
import { addMonths, format, parseISO } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * The parts of a month-to-date summary block: the header (title, the
 * "Month to date … starts again on" line, a note on the right) and the KPI
 * tile. First drawn for the Product Returns summary (MonthlyReturnsSummary);
 * Branch → Cash Transfer Details uses the same pieces, so the two blocks read
 * as one design.
 *
 * Dates come from the server's window (`from`/`to`), never the device clock,
 * so the line always names the month the figures cover.
 */

/** "1 October 2026". */
export const longDate = (d: string) => format(parseISO(d), 'd MMMM yyyy');

/** Value colours for status tiles; neutral for the headline figures. */
export const SUMMARY_TONE = {
  neutral: 'text-foreground',
  positive: 'text-emerald-700 dark:text-emerald-400',
  warning: 'text-amber-700 dark:text-amber-400',
  negative: 'text-red-700 dark:text-red-400',
  info: 'text-sky-700 dark:text-sky-400',
} as const;

/** "Month to date, Karachi business day · starts again on 1 November 2026" — the 1st after the window's month. */
export function MonthToDateLine({ from }: { from: string }) {
  return <>Month to date, Karachi business day · starts again on {longDate(format(addMonths(parseISO(from), 1), 'yyyy-MM-dd'))}</>;
}

/** The subtitle when the page's Date filter picks the window instead of the calendar. */
export function FilteredRangeLine() {
  return <>Date filter applied, Karachi business day · clear the Date filter to see this month</>;
}

export function MonthlySummaryHeader({ title, subtitle, note }: { title: ReactNode; subtitle?: ReactNode; note?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        {subtitle ? <p className="text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}

export function SummaryTile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card p-3">
      <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn('mt-1 truncate text-xl font-bold tabular-nums', tone)}>{value}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

/**
 * A tile while its figures load, exactly the loaded tile's size: each bar sits
 * in a line with the real text's classes, so it takes that line's height
 * (line heights follow the font size, which a fixed bar height would not).
 */
export function SummaryTileSkeleton() {
  const bar = (width: string) => <Skeleton className={`inline-block max-w-full align-top ${width}`}>{' '}</Skeleton>;
  return (
    <div data-testid="summary-tile-skeleton" aria-hidden="true" className="min-w-0 rounded-lg border bg-card p-3">
      <div className="text-xs font-medium">{bar('w-24')}</div>
      <div className="mt-1 text-xl font-bold">{bar('w-32')}</div>
      <div className="mt-0.5 text-xs">{bar('w-20')}</div>
    </div>
  );
}
