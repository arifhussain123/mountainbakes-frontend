'use client';

import { useMemo, useState } from 'react';
import {
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { formatHijriFor, type SpecialEventView } from '@mb/shared';
import { EventCategoryBadge, EventCountdown, EventDateLabel } from './EventBits';

/**
 * Month calendar for the events module.
 *
 * Self-contained on purpose. There is no calendar component and no
 * `react-day-picker` in this project, and — more to the point — there is no
 * `popover` primitive either, so the usual "click a day, float a card" pattern is
 * not available. Instead, selecting a day renders its events in a panel *below*
 * the grid on a phone and in a right-hand column at `lg`. No floating layer, no
 * focus trap, no positioning library, and it reads better on a 375px screen than
 * a popover would.
 *
 * Grid maths uses date-fns (already a dependency) and always produces 35 or 42
 * cells, so the grid never reflows height between months mid-navigation.
 */

interface EventCalendarProps {
  events: SpecialEventView[];
  year: number;
  /** 1–12. */
  month: number;
  onMonthChange: (year: number, month: number) => void;
  onSelectEvent: (id: string) => void;
  loading?: boolean;
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function EventCalendar({
  events,
  year,
  month,
  onMonthChange,
  onSelectEvent,
  loading,
}: EventCalendarProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const monthStart = useMemo(() => new Date(Date.UTC(year, month - 1, 1, 12)), [year, month]);

  const days = useMemo(() => {
    // weekStartsOn: 1 — the bakery's week starts Monday, matching businessRange().
    const gridStart = startOfWeek(startOfMonth(monthStart), { weekStartsOn: 1 });
    const gridEnd = endOfWeek(endOfMonth(monthStart), { weekStartsOn: 1 });
    return eachDayOfInterval({ start: gridStart, end: gridEnd });
  }, [monthStart]);

  /**
   * date → events. Each event is expanded across every day it spans, so a 3-day
   * Eid shows on all three rather than only on its start date.
   */
  const eventsByDate = useMemo(() => {
    const map = new Map<string, SpecialEventView[]>();
    for (const event of events) {
      if (!event.eventDate) continue;
      const end = event.eventEndDate ?? event.eventDate;
      const cursor = new Date(`${event.eventDate}T12:00:00.000Z`);
      const last = new Date(`${end}T12:00:00.000Z`);
      // Guard against a bad end date producing an unbounded loop.
      let guard = 0;
      while (cursor <= last && guard < 60) {
        const key = cursor.toISOString().slice(0, 10);
        map.set(key, [...(map.get(key) ?? []), event]);
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        guard += 1;
      }
    }
    return map;
  }, [events]);

  /**
   * The month's events, de-duplicated and date-ordered. `events` already covers
   * this month (the API range-filters on it), but a multi-day event appears once
   * per day it spans in `eventsByDate`, so the list is built from the source
   * array rather than by flattening that map.
   */
  const monthEvents = useMemo(
    () =>
      [...events].sort((a, b) => (a.eventDate ?? '').localeCompare(b.eventDate ?? '')),
    [events],
  );

  const listedEvents = selectedDate ? (eventsByDate.get(selectedDate) ?? []) : monthEvents;

  function goToMonth(delta: number) {
    const next = new Date(Date.UTC(year, month - 1 + delta, 1, 12));
    setSelectedDate(null);
    onMonthChange(next.getUTCFullYear(), next.getUTCMonth() + 1);
  }

  function goToToday() {
    const now = new Date();
    setSelectedDate(null);
    onMonthChange(now.getFullYear(), now.getMonth() + 1);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate font-heading text-base font-semibold">
                {format(monthStart, 'MMMM yyyy')}
              </h3>
              <p className="truncate text-xs text-muted-foreground">
                {formatHijriFor(format(monthStart, 'yyyy-MM-15'))}
              </p>
            </div>
            <div className="flex flex-shrink-0 items-center gap-1">
              <Button variant="outline" size="sm" onClick={goToToday} className="h-11 md:h-8">
                Today
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Previous month"
                onClick={() => goToMonth(-1)}
                className="h-11 w-11 md:h-8 md:w-8"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Next month"
                onClick={() => goToMonth(1)}
                className="h-11 w-11 md:h-8 md:w-8"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-7 gap-px text-center text-xs font-medium text-muted-foreground">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="py-1">
                <span className="sm:hidden">{label.charAt(0)}</span>
                <span className="hidden sm:inline">{label}</span>
              </div>
            ))}
          </div>

          <div className={cn('grid grid-cols-7 gap-px', loading && 'opacity-50')}>
            {days.map((day) => {
              const key = format(day, 'yyyy-MM-dd');
              const dayEvents = eventsByDate.get(key) ?? [];
              const outside = !isSameMonth(day, monthStart);
              const selected = selectedDate === key;

              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDate(selected ? null : key)}
                  aria-label={format(day, 'd MMMM yyyy')}
                  aria-pressed={selected}
                  className={cn(
                    'flex min-h-16 flex-col items-start gap-0.5 rounded-md border border-transparent p-1 text-left transition-colors sm:min-h-24 sm:p-1.5',
                    'hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    outside && 'opacity-40',
                    selected && 'border-primary bg-primary/5',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-full text-xs tabular-nums',
                      isToday(day) && 'bg-primary font-semibold text-white',
                    )}
                  >
                    {format(day, 'd')}
                  </span>

                  {/* Below sm a chip does not fit — collapse to coloured dots and
                      let the day panel carry the detail. */}
                  <span className="flex flex-wrap gap-0.5 sm:hidden">
                    {dayEvents.slice(0, 3).map((event) => (
                      <span
                        key={event.id}
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: event.color ?? 'var(--primary)' }}
                      />
                    ))}
                  </span>

                  <span className="hidden w-full flex-col gap-0.5 sm:flex">
                    {dayEvents.slice(0, 2).map((event) => (
                      <span
                        key={event.id}
                        className={cn(
                          'truncate rounded px-1 py-0.5 text-[10px] leading-tight',
                          // Dashed border marks an estimate, so a calculated
                          // Hijri date never reads as announced.
                          event.dateIsEstimated && 'border border-dashed',
                        )}
                        style={{
                          backgroundColor: `${event.color ?? '#F97316'}1A`,
                          color: event.color ?? undefined,
                          borderColor: event.dateIsEstimated ? (event.color ?? '#F97316') : undefined,
                        }}
                        title={event.name}
                      >
                        {event.name}
                      </span>
                    ))}
                    {dayEvents.length > 2 && (
                      <span className="px-1 text-[10px] text-muted-foreground">
                        +{dayEvents.length - 2} more
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/*
        The side list is always populated — it shows the whole month by default
        and narrows to a single day only once one is picked. An empty panel
        waiting for a click hid the fact that the month HAD events at all, which
        is the one thing this panel exists to tell you.
      */}
      <Card className="lg:sticky lg:top-0 lg:self-start">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h4 className="font-heading text-sm font-semibold">
                {selectedDate
                  ? format(new Date(`${selectedDate}T12:00:00.000Z`), 'd MMMM yyyy')
                  : `Events in ${format(monthStart, 'MMMM')}`}
              </h4>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {selectedDate
                  ? formatHijriFor(selectedDate)
                  : `${monthEvents.length} event${monthEvents.length === 1 ? '' : 's'} · auto-detected`}
              </p>
            </div>
            {selectedDate && (
              <Button
                variant="ghost"
                size="sm"
                className="h-11 flex-shrink-0 md:h-8"
                onClick={() => setSelectedDate(null)}
              >
                Show all
              </Button>
            )}
          </div>

          <div className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto">
            {listedEvents.length === 0 && (
              <p className="text-sm text-muted-foreground">
                {selectedDate ? 'No events on this day.' : 'No events this month.'}
              </p>
            )}
            {listedEvents.map((event) => (
              <button
                key={`${event.id}:${event.eventDate}`}
                type="button"
                onClick={() => onSelectEvent(event.id)}
                className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                style={{ borderLeft: `3px solid ${event.color ?? 'var(--primary)'}` }}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 font-medium">{event.name}</span>
                  <EventCategoryBadge category={event.category} />
                </div>
                <EventDateLabel event={event} className="mt-1" />
                <div className="mt-1">
                  <EventCountdown daysRemaining={event.daysRemaining} />
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
