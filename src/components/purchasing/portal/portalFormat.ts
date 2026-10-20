import { karachiDateStr } from '@mb/shared';
import { formatDate, formatDateTime } from '@/utils/date';

/**
 * Figures as a supplier reads them: rupees with paisa only when there are
 * paisa, quantities to at most three places. Shared by every portal screen so
 * the review step and the server's confirmed totals look the same.
 */
export function rs(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '—';
  const whole = Number.isInteger(n);
  return `Rs. ${n.toLocaleString('en-PK', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 })}`;
}

export function qty(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-PK', { maximumFractionDigits: 3 });
}

export const day = (iso: string | null | undefined): string => formatDate(iso ?? null);
export const when = (iso: string | null | undefined): string => formatDateTime(iso ?? null);

/** "in 3 days", "in 5 hours", "expired" — for the link's expiry line. */
export function untilText(iso: string, now: number = Date.now()): string {
  const ms = new Date(iso).getTime() - now;
  if (!Number.isFinite(ms)) return '';
  if (ms <= 0) return 'expired';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'in less than an hour';
  if (hours < 48) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `in ${days} days`;
}

/** Today in Pakistan, as the YYYY-MM-DD a date input holds. */
export const todayIso = (now: Date = new Date()): string => karachiDateStr(now);
