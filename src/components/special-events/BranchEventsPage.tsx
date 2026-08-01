'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatCard } from '@/components/shared/StatCard';
import { useAuth } from '@/hooks/useAuth';
import { useEventCalendar, useSpecialEvents } from '@/lib/queries';
import { cn } from '@/lib/utils';
import type { SpecialEventView } from '@mb/shared';
import { EventCalendar } from './EventCalendar';
import { EventDemandForm } from './EventDemandForm';
import {
  EventCategoryBadge,
  EventCountdown,
  EventDateLabel,
  EventPriorityBadge,
  EventStatusBadge,
} from './EventBits';

/**
 * The branch view: the events this branch participates in, and the form to
 * submit advance demand for the selected one.
 *
 * The list is scoped SERVER-side — a branch manager's GET /api/special-events
 * already returns only events that apply to every branch or name this one — so
 * there is no client-side filtering to get wrong here.
 */
export function BranchEventsPage() {
  const { token } = useAuth();
  const now = new Date();
  const year = now.getFullYear();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  });

  const eventsQ = useSpecialEvents(token, { year });
  const calendarQ = useEventCalendar(token, calendarMonth.year, calendarMonth.month);

  const events = useMemo(() => eventsQ.data ?? [], [eventsQ.data]);
  const today = now.toISOString().slice(0, 10);

  const upcoming = useMemo(
    () => events.filter((e) => e.status !== 'cancelled' && (!e.eventDate || e.eventDate >= today)),
    [events, today],
  );

  const selected = events.find((e) => e.id === selectedId) ?? upcoming[0] ?? null;

  const dueSoon = upcoming.filter(
    (e) => e.demandDueDate && e.demandDueDate >= today && e.daysRemaining !== null && e.daysRemaining <= 14,
  ).length;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          title="Upcoming Events"
          value={upcoming.length}
          icon={CalendarDays}
          loading={eventsQ.isLoading}
        />
        <StatCard
          title="Demand Due Soon"
          value={dueSoon}
          icon={Clock}
          color="red"
          loading={eventsQ.isLoading}
        />
        <StatCard
          title="Days to Next Event"
          value={upcoming[0]?.daysRemaining ?? '—'}
          icon={Clock}
          color="blue"
          loading={eventsQ.isLoading}
        />
        <StatCard
          title="Next Event"
          value={upcoming[0]?.name ?? '—'}
          icon={CheckCircle2}
          color="green"
          loading={eventsQ.isLoading}
        />
      </div>

      <Tabs defaultValue="events">
        <TabsList>
          <TabsTrigger value="events">Events &amp; Demand</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
        </TabsList>

        <TabsContent value="events" className="mt-4">
          {eventsQ.isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : upcoming.length === 0 ? (
            <EmptyState
              icon={CalendarDays}
              title="No upcoming events"
              description="Events assigned to your branch will appear here, along with reminders to submit advance demand."
            />
          ) : (
            <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
              <div className="space-y-2">
                {upcoming.map((event) => (
                  <EventPickerCard
                    key={event.id}
                    event={event}
                    active={selected?.id === event.id}
                    onSelect={() => setSelectedId(event.id)}
                  />
                ))}
              </div>

              <div>{selected ? <EventDemandForm key={selected.id} event={selected} /> : null}</div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="calendar" className="mt-4">
          <EventCalendar
            events={calendarQ.data ?? []}
            year={calendarMonth.year}
            month={calendarMonth.month}
            onMonthChange={(y, m) => setCalendarMonth({ year: y, month: m })}
            onSelectEvent={(id) => setSelectedId(id)}
            loading={calendarQ.isLoading}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EventPickerCard({
  event,
  active,
  onSelect,
}: {
  event: SpecialEventView;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <Card
      className={cn('transition-colors', active && 'border-primary ring-1 ring-primary')}
    >
      <CardContent className="p-3">
        <Button
          variant="ghost"
          className="h-auto w-full flex-col items-start gap-1 whitespace-normal p-0 text-left hover:bg-transparent"
          onClick={onSelect}
        >
          <span className="flex w-full items-start justify-between gap-2">
            <span className="min-w-0 font-medium">{event.name}</span>
            <EventStatusBadge status={event.status} />
          </span>
          <EventDateLabel event={event} />
          <span className="flex flex-wrap items-center gap-1.5 pt-1">
            <EventCategoryBadge category={event.category} />
            <EventPriorityBadge priority={event.priority} />
          </span>
          <span className="flex w-full items-center justify-between gap-2 pt-1 text-xs">
            <EventCountdown daysRemaining={event.daysRemaining} />
            {event.demandDueDate && (
              <span className="text-muted-foreground">Due {event.demandDueDate}</span>
            )}
          </span>
        </Button>
      </CardContent>
    </Card>
  );
}
