import { businessDateStr } from '@mb/shared';

/**
 * The Daily Sales date filter, in BUSINESS dates.
 *
 * Every boundary here is a business date (`businessDateStr`, 2 AM Karachi
 * rollover) and never a calendar date, because that is the column the API groups
 * on. Using `new Date()` to decide what "today" means would put a sale rung up
 * at 00:30 into tomorrow on this screen and yesterday in the database — the two
 * would disagree by one day's takings for two hours every night.
 *
 * The window is only ever a pair of date strings. Nothing here converts to
 * `Date`: 'YYYY-MM-DD' compares and sorts correctly as a string, and the
 * conversions are where an off-by-one timezone bug gets in.
 */

export type RangePreset =
  | 'today'
  | 'yesterday'
  | 'last7'
  | 'last30'
  | 'thisMonth'
  | 'prevMonth'
  | 'custom';

export interface DateRange {
  from: string;
  to: string;
}

export const RANGE_OPTIONS: { value: RangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7', label: 'Last 7 Days' },
  { value: 'last30', label: 'Last 30 Days' },
  { value: 'thisMonth', label: 'This Month' },
  { value: 'prevMonth', label: 'Previous Month' },
  { value: 'custom', label: 'Custom Range' },
];

/** Add `n` days to a 'YYYY-MM-DD' string. UTC-based, so no local-DST surprises. */
export function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** First day of the month `dateStr` falls in. */
function startOfMonth(dateStr: string): string {
  return `${dateStr.slice(0, 7)}-01`;
}

/** Inclusive day count between two 'YYYY-MM-DD' strings. */
export function dayCount(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.floor((b - a) / 86_400_000) + 1;
}

/**
 * Resolve a preset against today's business date.
 *
 * `custom` returns the window it was handed — the caller owns those two inputs
 * — falling back to today so a half-typed date never produces an inverted or
 * NaN range that the API would have to reject.
 */
export function resolveRange(preset: RangePreset, custom?: Partial<DateRange>): DateRange {
  const today = businessDateStr();

  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: y, to: y };
    }
    case 'last7':
      // Inclusive of today, so "Last 7 Days" is seven points on the graph and
      // not eight. Same for Last 30.
      return { from: addDays(today, -6), to: today };
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'thisMonth':
      // Runs to today rather than to month end. The API clamps it anyway, but
      // sending the real window keeps the request and the answer describing the
      // same thing.
      return { from: startOfMonth(today), to: today };
    case 'prevMonth': {
      const firstOfThis = startOfMonth(today);
      const lastOfPrev = addDays(firstOfThis, -1);
      return { from: startOfMonth(lastOfPrev), to: lastOfPrev };
    }
    case 'custom': {
      const from = custom?.from || today;
      const to = custom?.to || today;
      // An inverted window is a half-finished edit, not an error to shout
      // about: the user has picked the end before the start. Read it the way
      // they meant it.
      return from <= to ? { from, to } : { from: to, to: from };
    }
  }
}

/** Human label for a window — "12 Aug 2026" or "1 – 12 Aug 2026" shaped. */
export function describeRange(range: DateRange, formatDate: (d: string) => string): string {
  return range.from === range.to
    ? formatDate(range.from)
    : `${formatDate(range.from)} – ${formatDate(range.to)}`;
}
