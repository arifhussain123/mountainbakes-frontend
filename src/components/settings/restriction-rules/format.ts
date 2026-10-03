import type { RestrictionEventResult, RestrictionRequestStatus } from '@mb/shared';

/** '06:00' → '06:00 AM'. Settings store business hours as 24-hour 'HH:mm'. */
export function time12(hhmm: string): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]);
  return `${String(h % 12 === 0 ? 12 : h % 12).padStart(2, '0')}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

const PILL = {
  amber: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  green: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  red: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  blue: 'bg-blue-50 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  neutral: 'bg-muted text-muted-foreground',
} as const;

export const REQUEST_STATUS_PILL: Record<RestrictionRequestStatus, string> = {
  pending: PILL.amber,
  approved: PILL.green,
  rejected: PILL.red,
};

export const EVENT_RESULT_PILL: Record<RestrictionEventResult, string> = {
  Blocked: PILL.red,
  Rejected: PILL.red,
  Warned: PILL.amber,
  'Approval requested': PILL.blue,
  Approved: PILL.green,
  Allowed: PILL.green,
  Updated: PILL.neutral,
};

export const MONITOR_STATUS_PILL = { Normal: PILL.green, Warning: PILL.amber, Blocked: PILL.red } as const;

/** The filter chip used by the Approvals and Audit tabs. */
export const chipClass = (active: boolean) =>
  active
    ? 'border-secondary bg-secondary text-secondary-foreground'
    : 'border-border bg-card text-foreground/80 hover:bg-muted';
