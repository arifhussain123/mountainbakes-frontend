'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  BellRing,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  Clock,
  Plus,
  Store,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Fab } from '@/components/shared/Fab';
import { StatCard } from '@/components/shared/StatCard';
import { useAuth } from '@/hooks/useAuth';
import { useDeleteEvent, useEventCalendar, useEventSummary, useSpecialEvents } from '@/lib/queries';
import { ROUTES } from '@/utils/routes';
import { EVENT_CATEGORY_LABELS, type SpecialEventView } from '@mb/shared';
import { EventCalendar } from './EventCalendar';
import { EventFormDialog } from './EventFormDialog';
import { EventListTable } from './EventListTable';
import { EventTimeline } from './EventTimeline';

/**
 * The admin Special Events screen: dashboard cards plus Calendar / Timeline /
 * List views of the same event set.
 *
 * The catalogue is AUTO-DETECTED, not maintained by hand. Changing the year
 * filter asks the server for that year, and the server materialises it from each
 * series' anchor — Hijri events through the Umm al-Qura calendar, Gregorian ones
 * from their fixed month/day. That is why there is no "generate next year"
 * button: the year you look at is the year that gets built.
 */
export function SpecialEventsPage() {
  const { token } = useAuth();
  const router = useRouter();

  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [category, setCategory] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState({
    year: now.getFullYear(),
    month: now.getMonth() + 1,
  });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SpecialEventView | null>(null);

  const eventsQ = useSpecialEvents(token, { year, category, status });
  const summaryQ = useEventSummary(token);
  const calendarQ = useEventCalendar(token, calendarMonth.year, calendarMonth.month);
  const deleteEvent = useDeleteEvent(token);

  const events = eventsQ.data ?? [];
  const summary = summaryQ.data;

  function openNew() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(event: SpecialEventView) {
    setEditing(event);
    setFormOpen(true);
  }

  async function onDelete(event: SpecialEventView) {
    // No confirm dialog primitive in this project, and the action is a soft
    // delete that cancels pending reminders — recoverable, so a native confirm
    // is proportionate.
    if (!window.confirm(`Remove "${event.name}" from the events calendar? Pending reminders will be cancelled.`)) {
      return;
    }
    try {
      await deleteEvent.mutateAsync(event.id);
      toast.success('Event removed');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove event');
    }
  }

  function goToEvent(id: string) {
    router.push(`${ROUTES.SPECIAL_EVENTS}/${id}`);
  }

  const years = [year - 1, year, year + 1];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          title="Upcoming Events"
          value={summary?.upcomingEvents ?? 0}
          icon={CalendarDays}
          loading={summaryQ.isLoading}
        />
        <StatCard
          title="Active Preparations"
          value={summary?.activeEvents ?? 0}
          icon={CalendarClock}
          color="brown"
          loading={summaryQ.isLoading}
        />
        <StatCard
          title="Branches Submitted"
          value={summary?.branchesSubmitted ?? 0}
          icon={CheckCircle2}
          color="green"
          loading={summaryQ.isLoading}
        />
        <StatCard
          title="Branches Pending"
          value={summary?.branchesPending ?? 0}
          icon={Store}
          color="red"
          loading={summaryQ.isLoading}
        />
        <StatCard
          title="Days to Next Event"
          value={summary?.nextEvent?.daysRemaining ?? '—'}
          icon={Clock}
          color="blue"
          loading={summaryQ.isLoading}
        />
        <StatCard
          title="Next Event Readiness"
          value={`${summary?.nextEvent?.readinessPercentage ?? 0}%`}
          icon={CheckCircle2}
          color="green"
          loading={summaryQ.isLoading}
        />
        <StatCard
          title="Reminders Sent"
          value={summary?.notificationsSent ?? 0}
          icon={BellRing}
          loading={summaryQ.isLoading}
        />
        <StatCard
          title="Reminders Pending"
          value={summary?.notificationsPending ?? 0}
          icon={BellRing}
          color="brown"
          loading={summaryQ.isLoading}
        />
      </div>

      {summary?.nextEvent && (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          Next up: <span className="font-medium">{summary.nextEvent.name}</span>
          {summary.nextEvent.eventDate ? ` on ${summary.nextEvent.eventDate}` : ''}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Select
          items={years.map((y) => ({ value: String(y), label: String(y) }))}
          value={String(year)}
          onValueChange={(v) => setYear(Number(v))}
        >
          <SelectTrigger className="h-11 w-28 md:h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          items={[{ value: 'all', label: 'All categories' }, ...Object.entries(EVENT_CATEGORY_LABELS).map(([value, label]) => ({ value, label }))]}
          value={category ?? 'all'}
          onValueChange={(v) => setCategory(v === 'all' ? null : (v as string))}
        >
          <SelectTrigger className="h-11 w-40 md:h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {Object.entries(EVENT_CATEGORY_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          items={[
            { value: 'all', label: 'All statuses' },
            { value: 'upcoming', label: 'Upcoming' },
            { value: 'active', label: 'Active' },
            { value: 'completed', label: 'Completed' },
            { value: 'cancelled', label: 'Cancelled' },
          ]}
          value={status ?? 'all'}
          onValueChange={(v) => setStatus(v === 'all' ? null : (v as string))}
        >
          <SelectTrigger className="h-11 w-36 md:h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="upcoming">Upcoming</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>

        <div className="ml-auto flex flex-wrap gap-2">
          {/*
            No "Refresh Estimates" / "Roll forward" buttons: the calendar
            populates itself. Switching the year filter materialises that year
            from the Islamic and Gregorian anchors on the server. "New Event"
            stays for the things no calendar can derive — a branch opening, a
            promo weekend, the company anniversary.

            Paired with the mobile Fab below, so the action appears exactly once
            at every width.
          */}
          <Button size="sm" className="hidden h-9 md:inline-flex" onClick={openNew}>
            <Plus className="mr-1.5 h-4 w-4" /> Add Company Event
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Islamic, national and international events are detected automatically — Hijri dates are
        resolved from the Umm al-Qura calendar for whichever year you select, and shift with it
        each year. Dates shown with a dashed underline are estimates until confirmed against the
        moon-sighting announcement.
      </p>

      <Tabs defaultValue="calendar">
        <TabsList>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="list">List</TabsTrigger>
        </TabsList>

        <TabsContent value="calendar" className="mt-4">
          <EventCalendar
            events={calendarQ.data ?? []}
            year={calendarMonth.year}
            month={calendarMonth.month}
            onMonthChange={(y, m) => setCalendarMonth({ year: y, month: m })}
            onSelectEvent={goToEvent}
            loading={calendarQ.isLoading}
          />
        </TabsContent>

        <TabsContent value="timeline" className="mt-4">
          <EventTimeline events={events} onSelectEvent={goToEvent} />
        </TabsContent>

        <TabsContent value="list" className="mt-4">
          <EventListTable
            events={events}
            loading={eventsQ.isLoading}
            onSelect={goToEvent}
            onEdit={openEdit}
            onDelete={onDelete}
          />
        </TabsContent>
      </Tabs>

      <Fab onClick={openNew} icon={Plus} label="New event" />

      <EventFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        // Remounting on the edit target clears react-hook-form's defaults, which
        // are captured once at mount.
        key={editing?.id ?? 'new'}
        event={editing}
      />
    </div>
  );
}
