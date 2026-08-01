'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDate } from '@/utils/date';
import {
  EVENT_CATEGORY_LABELS,
  EVENT_PRIORITY_LABELS,
  formatHijriFor,
  type EventCategory,
  type EventPriority,
  type EventStatus,
  type SpecialEventView,
} from '@mb/shared';

/**
 * The small, shared display pieces for the Special Events screens: status and
 * priority pills, the date + Hijri label, and the countdown.
 *
 * Kept in one file because each is a handful of lines and all three appear
 * together on every event row, card and header — splitting them would mean four
 * imports to render one line of a table.
 */

const STATUS_STYLES: Record<EventStatus, { label: string; className: string }> = {
  upcoming: { label: 'Upcoming', className: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  active: { label: 'Active', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  completed: { label: 'Completed', className: 'bg-muted text-muted-foreground' },
  cancelled: { label: 'Cancelled', className: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300' },
};

export function EventStatusBadge({ status }: { status: EventStatus }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.upcoming;
  return (
    <Badge variant="outline" className={cn('border-transparent', style.className)}>
      {style.label}
    </Badge>
  );
}

const PRIORITY_STYLES: Record<EventPriority, string> = {
  low: 'bg-muted text-muted-foreground',
  normal: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
  high: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300',
  critical: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300',
};

/** Expected demand level. The label says "Very High", the enum says `critical`. */
export function EventPriorityBadge({ priority }: { priority: EventPriority }) {
  return (
    <Badge variant="outline" className={cn('border-transparent', PRIORITY_STYLES[priority])}>
      {EVENT_PRIORITY_LABELS[priority]}
    </Badge>
  );
}

const CATEGORY_STYLES: Record<EventCategory, string> = {
  islamic: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300',
  ahlul_bayt: 'bg-teal-50 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
  national: 'bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-300',
  international: 'bg-pink-50 text-pink-700 dark:bg-pink-950 dark:text-pink-300',
  company: 'bg-primary/10 text-primary',
};

export function EventCategoryBadge({ category }: { category: EventCategory }) {
  return (
    <Badge variant="outline" className={cn('border-transparent', CATEGORY_STYLES[category])}>
      {EVENT_CATEGORY_LABELS[category]}
    </Badge>
  );
}

/**
 * The event's date, with its Hijri equivalent underneath.
 *
 * When the date is still an estimate it is rendered with a dashed underline and
 * an "estimated" note — Umm al-Qura is calculated, and Pakistan's announcement
 * can differ by a day or two, so an unconfirmed date must never look final.
 *
 * `hijriLabel` comes from the SERVER (it is on every event response). The
 * client-side `formatHijriFor` is only the fallback for a date the server did not
 * label, because a trimmed ICU in an old Android WebView can be a day off.
 */
export function EventDateLabel({
  event,
  className,
}: {
  event: Pick<SpecialEventView, 'eventDate' | 'eventEndDate' | 'durationDays' | 'dateIsEstimated' | 'hijriLabel'>;
  className?: string;
}) {
  if (!event.eventDate) {
    return (
      <span className={cn('text-sm text-muted-foreground', className)}>
        Date not resolved
      </span>
    );
  }

  const multiDay = event.durationDays > 1 && event.eventEndDate;
  const hijri = event.hijriLabel ?? formatHijriFor(event.eventDate);

  return (
    <span className={cn('block', className)}>
      <span
        className={cn(
          'text-sm font-medium',
          event.dateIsEstimated && 'underline decoration-dashed underline-offset-4 decoration-muted-foreground',
        )}
        title={event.dateIsEstimated ? 'Estimated — subject to moon sighting' : 'Confirmed date'}
      >
        {formatDate(event.eventDate)}
        {multiDay ? ` – ${formatDate(event.eventEndDate)}` : ''}
      </span>
      <span className="block text-xs text-muted-foreground">
        {hijri}
        {event.dateIsEstimated ? ' · estimated' : ''}
      </span>
    </span>
  );
}

/** "in 23 days" / "today" / "12 days ago". */
export function EventCountdown({
  daysRemaining,
  className,
}: {
  daysRemaining: number | null;
  className?: string;
}) {
  if (daysRemaining === null) {
    return <span className={cn('text-sm text-muted-foreground', className)}>—</span>;
  }

  const text =
    daysRemaining === 0
      ? 'Today'
      : daysRemaining > 0
        ? `in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`
        : `${Math.abs(daysRemaining)} day${Math.abs(daysRemaining) === 1 ? '' : 's'} ago`;

  return (
    <span
      className={cn(
        'text-sm font-medium tabular-nums',
        // Under a fortnight is when preparation actually has to be underway.
        daysRemaining < 0
          ? 'text-muted-foreground'
          : daysRemaining <= 3
            ? 'text-red-600 dark:text-red-400'
            : daysRemaining <= 14
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-foreground',
        className,
      )}
    >
      {text}
    </span>
  );
}

/**
 * A labelled progress bar. Used for readiness and for each preparation stage.
 *
 * Deliberately a plain div rather than the Progress primitive: Progress renders
 * its own track/indicator pair and does not accept a per-bar colour, and these
 * bars need to shift from red to green as they fill.
 */
export function ProgressBar({
  value,
  label,
  className,
}: {
  value: number;
  label?: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className={cn('space-y-1', className)}>
      {label && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium tabular-nums">{clamped}%</span>
        </div>
      )}
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label ?? 'Progress'}
      >
        <div
          className={cn(
            'h-full rounded-full transition-all',
            clamped === 100
              ? 'bg-emerald-500'
              : clamped >= 50
                ? 'bg-primary'
                : clamped > 0
                  ? 'bg-amber-500'
                  : 'bg-transparent',
          )}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
