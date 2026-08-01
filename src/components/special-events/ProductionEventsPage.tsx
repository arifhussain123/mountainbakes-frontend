'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, CheckCircle2, Clock, Factory } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatCard } from '@/components/shared/StatCard';
import { useAuth } from '@/hooks/useAuth';
import { useSpecialEvents } from '@/lib/queries';
import { cn } from '@/lib/utils';
import { BranchDemandPanel, ConsolidatedDemandPanel } from './BranchDemandPanel';
import {
  EventCategoryBadge,
  EventCountdown,
  EventDateLabel,
  EventPriorityBadge,
  EventStatusBadge,
  ProgressBar,
} from './EventBits';
import { ProductionReadinessPanel } from './ProductionReadinessPanel';

/**
 * The production view: upcoming events, the consolidated demand to plan against,
 * and the four preparation stages to keep updated.
 *
 * Production users are a central role with no branch claim, so they see every
 * branch's demand for every event — the API enforces that, and the reminders
 * they receive carry no branch scoping for the same reason.
 */
export function ProductionEventsPage() {
  const { token } = useAuth();
  const now = new Date();
  const year = now.getFullYear();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const eventsQ = useSpecialEvents(token, { year });
  const events = useMemo(() => eventsQ.data ?? [], [eventsQ.data]);
  const today = now.toISOString().slice(0, 10);

  const upcoming = useMemo(
    () => events.filter((e) => e.status !== 'cancelled' && (!e.eventDate || e.eventDate >= today)),
    [events, today],
  );

  const selected = events.find((e) => e.id === selectedId) ?? upcoming[0] ?? null;

  const submittedBranches = upcoming.reduce(
    (sum, e) => sum + (e.demandSummary?.submittedBranches ?? 0),
    0,
  );

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
          title="Days to Next Event"
          value={upcoming[0]?.daysRemaining ?? '—'}
          icon={Clock}
          color="blue"
          loading={eventsQ.isLoading}
        />
        <StatCard
          title="Demands Received"
          value={submittedBranches}
          icon={CheckCircle2}
          color="green"
          loading={eventsQ.isLoading}
        />
        <StatCard
          title="Next Event Readiness"
          value={`${upcoming[0]?.readinessPercentage ?? 0}%`}
          icon={Factory}
          color="brown"
          loading={eventsQ.isLoading}
        />
      </div>

      {eventsQ.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : upcoming.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No upcoming events"
          description="Events appear here once Admin schedules them, with reminders 21, 14, 7 and 3 days out."
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-[20rem_1fr]">
          <div className="space-y-2">
            {upcoming.map((event) => (
              <button
                key={event.id}
                type="button"
                onClick={() => setSelectedId(event.id)}
                className={cn(
                  'w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  selected?.id === event.id && 'border-primary ring-1 ring-primary',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 truncate font-medium">{event.name}</span>
                  <EventStatusBadge status={event.status} />
                </div>
                <EventDateLabel event={event} className="mt-0.5" />
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <EventCategoryBadge category={event.category} />
                  <EventPriorityBadge priority={event.priority} />
                </div>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs">
                  <EventCountdown daysRemaining={event.daysRemaining} />
                  {event.demandSummary && (
                    <span className="text-muted-foreground">
                      {event.demandSummary.submittedBranches}/{event.demandSummary.totalBranches} branches
                    </span>
                  )}
                </div>
                <ProgressBar
                  value={event.readinessPercentage ?? 0}
                  label="Readiness"
                  className="mt-2"
                />
              </button>
            ))}
          </div>

          <div>
            {selected && (
              <>
                <Card className="mb-4">
                  <CardContent className="p-4">
                    <h2 className="font-heading text-base font-semibold">{selected.name}</h2>
                    <EventDateLabel event={selected} className="mt-1" />
                    <dl className="mt-2 grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                      <div className="flex justify-between gap-2">
                        <dt>Preparation starts</dt>
                        <dd className="font-medium text-foreground">
                          {selected.preparationStartDate ?? '—'}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt>Branch demand due</dt>
                        <dd className="font-medium text-foreground">{selected.demandDueDate ?? '—'}</dd>
                      </div>
                    </dl>
                    {selected.description && (
                      <p className="mt-2 text-sm text-muted-foreground">{selected.description}</p>
                    )}
                  </CardContent>
                </Card>

                <Tabs defaultValue="consolidated" key={selected.id}>
                  <TabsList>
                    <TabsTrigger value="consolidated">Consolidated Demand</TabsTrigger>
                    <TabsTrigger value="branches">By Branch</TabsTrigger>
                    <TabsTrigger value="readiness">Preparation</TabsTrigger>
                  </TabsList>

                  <TabsContent value="consolidated" className="mt-4">
                    <ConsolidatedDemandPanel eventId={selected.id} />
                  </TabsContent>

                  <TabsContent value="branches" className="mt-4">
                    <BranchDemandPanel eventId={selected.id} canReview />
                  </TabsContent>

                  <TabsContent value="readiness" className="mt-4">
                    <ProductionReadinessPanel eventId={selected.id} editable />
                  </TabsContent>
                </Tabs>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
