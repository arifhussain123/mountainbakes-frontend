import { format, parseISO } from 'date-fns';
import type { DashboardBucket, DashboardWindow } from '@mb/shared';

/** 16,873 — figures in cards, lists and tooltips. */
export const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 });

/** 1.2k — figures drawn on a chart, where room is short. */
export function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (a >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(Math.round(n * 10) / 10);
}

export const pct = (n: number | null) => (n === null ? '—' : `${n.toFixed(1)}%`);

export const shortBranch = (name: string) => name.replace('Mountain Bakes ', '');

/** "Oct 12 to Oct 18", or one date when the window is one day. */
export function rangeLabel(win: Pick<DashboardWindow, 'from' | 'to'>): string {
  try {
    const a = format(parseISO(win.from), 'MMM d');
    return win.from === win.to ? a : `${a} to ${format(parseISO(win.to), 'MMM d')}`;
  } catch {
    return `${win.from} to ${win.to}`;
  }
}

export const BUCKET_UNIT: Record<DashboardBucket, string> = { hour: 'hour', day: 'day', week: 'week' };

/** Axis label for a series key: `2026-10-14T09` → 9a, `2026-10-14` → Wed 14 (Oct 14 by week). */
export function bucketLabel(key: string, bucket: DashboardBucket): string {
  try {
    if (bucket === 'hour') return format(parseISO(`${key}:00`), 'haaaaa');
    if (bucket === 'week') return `w/c ${format(parseISO(key), 'MMM d')}`;
    return format(parseISO(key), 'EEE d');
  } catch {
    return key;
  }
}

/**
 * Indexes worth a label on a time series: the highest point and the latest
 * one, and only where there is something to say. Never a 0 on every point.
 */
export function labelledIndexes(values: number[]): Set<number> {
  const out = new Set<number>();
  if (values.length === 0) return out;
  let peak = 0;
  values.forEach((v, i) => { if (v > values[peak]!) peak = i; });
  if (values[peak]! > 0) out.add(peak);
  const last = values.length - 1;
  if (values[last]! > 0) out.add(last);
  return out;
}

/** "Today 10:30", "Oct 12, 09:15", or "Never". */
export function whenLabel(iso: string | null, now = new Date()): string {
  if (!iso) return 'Never';
  try {
    const d = parseISO(iso);
    return format(d, 'yyyy-MM-dd') === format(now, 'yyyy-MM-dd') ? `Today ${format(d, 'HH:mm')}` : format(d, 'MMM d, HH:mm');
  } catch {
    return '—';
  }
}
