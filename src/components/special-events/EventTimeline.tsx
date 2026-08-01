'use client';

import { useMemo } from 'react';
import { format } from 'date-fns';
import { CalendarDays } from 'lucide-react';
import { EmptyState } from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils';
import type { SpecialEventView } from '@mb/shared';
import {
  EventCategoryBadge,
  EventCountdown,
  EventDateLabel,
  EventPriorityBadge,
  EventStatusBadge,
  ProgressBar,
} from './EventBits';

/**
 * Vertical, month-grouped timeline of the year's events.
 *
 * Pure flexbox and borders — the rail is a left border on the group, the dots are
 * absolutely-positioned spans. No chart or timeline library, and it collapses to
 * a single readable column on a phone without a breakpoint branch.
 */
export function EventTimeline({
  events,
  onSelectEvent,
}: {
  events: SpecialEventView[];
  onSelectEvent: (id: string) => void;
}) {
  const groups = useMemo(() => {
    const byMonth = new Map<string, SpecialEventView[]>();
    // Events with no resolved date get their own bucket at the end rather than
    // being dropped — an unresolved Hijri estimate is exactly what an admin needs
    // to see and fix.
    const undated: SpecialEventView[] = [];

    for (const event of [...events].sort((a, b) => (a.eventDate ?? '9999').localeCompare(b.eventDate ?? '9999'))) {
      if (!event.eventDate) {
        undated.push(event);
        continue;
      }
      const key = event.eventDate.slice(0, 7);
      byMonth.set(key, [...(byMonth.get(key) ?? []), event]);
    }

    return { byMonth: [...byMonth.entries()], undated };
  }, [events]);

  if (events.length === 0) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No events to show"
        description="Adjust the filters, or add an event to start planning."
      />
    );
  }

  return (
    <div className="space-y-6">
      {groups.byMonth.map(([monthKey, monthEvents]) => (
        <div key={monthKey}>
          <h3 className="mb-2 font-heading text-sm font-semibold text-muted-foreground">
            {format(new Date(`${monthKey}-15T12:00:00.000Z`), 'MMMM yyyy')}
          </h3>
          <div className="space-y-2 border-l-2 border-border pl-4">
            {monthEvents.map((event) => (
              <TimelineRow key={event.id} event={event} onSelect={onSelectEvent} />
            ))}
          </div>
        </div>
      ))}

      {groups.undated.length > 0 && (
        <div>
          <h3 className="mb-2 font-heading text-sm font-semibold text-muted-foreground">
            Date not yet resolved
          </h3>
          <p className="mb-2 text-xs text-muted-foreground">
            These have no Gregorian date yet. Run Refresh Estimates, or set a confirmed date.
          </p>
          <div className="space-y-2 border-l-2 border-dashed border-border pl-4">
            {groups.undated.map((event) => (
              <TimelineRow key={event.id} event={event} onSelect={onSelectEvent} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TimelineRow({
  event,
  onSelect,
}: {
  event: SpecialEventView;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(event.id)}
      className="relative w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span
        aria-hidden
        className={cn('absolute -left-[1.3rem] top-5 h-2.5 w-2.5 rounded-full ring-2 ring-background')}
        style={{ backgroundColor: event.color ?? 'var(--primary)' }}
      />

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-medium">{event.name}</p>
          <EventDateLabel event={event} className="mt-0.5" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <EventCategoryBadge category={event.category} />
          <EventPriorityBadge priority={event.priority} />
          <EventStatusBadge status={event.status} />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <EventCountdown daysRemaining={event.daysRemaining} />
        {event.demandDueDate && <span>Demand due {event.demandDueDate}</span>}
        {event.demandSummary && (
          <span>
            {event.demandSummary.submittedBranches}/{event.demandSummary.totalBranches} branches submitted
          </span>
        )}
      </div>

      {typeof event.readinessPercentage === 'number' && (
        <ProgressBar value={event.readinessPercentage} label="Production readiness" className="mt-2" />
      )}
    </button>
  );
}
