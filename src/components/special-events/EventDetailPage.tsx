'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CalendarCheck, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shared/EmptyState';
import { useAuth } from '@/hooks/useAuth';
import { useConfirmEventDate, useSpecialEvent, useUpdateEventStatus } from '@/lib/queries';
import { ROUTES } from '@/utils/routes';
import type { SpecialEventView } from '@mb/shared';
import { BranchDemandPanel, ConsolidatedDemandPanel } from './BranchDemandPanel';
import {
  EventCategoryBadge,
  EventCountdown,
  EventDateLabel,
  EventPriorityBadge,
  EventStatusBadge,
  ProgressBar,
} from './EventBits';
import { EventFormDialog } from './EventFormDialog';
import { EventNotificationSchedule } from './EventNotificationSchedule';
import { ProductionReadinessPanel } from './ProductionReadinessPanel';

/**
 * One event, everything about it. Admin-only (the branch and production screens
 * have their own, narrower views).
 *
 * Renders its own heading rather than going through pageTitles.ts — that map is
 * keyed by a static pathname and cannot cover a dynamic segment.
 */
export function EventDetailPage({ eventId }: { eventId: string }) {
  const { token } = useAuth();
  const router = useRouter();
  const eventQ = useSpecialEvent(token, eventId);
  const confirmDate = useConfirmEventDate(token);
  const updateStatus = useUpdateEventStatus(token);

  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const event = eventQ.data?.event as SpecialEventView | undefined;

  // Seeded from the event and re-seeded when the server's value changes. It
  // cannot fall back to `event.confirmedDate` on every render — clearing the
  // field would then snap straight back to the old date.
  const [confirmInput, setConfirmInput] = useState('');
  const [seededFrom, setSeededFrom] = useState<string | null>(null);
  const confirmVersion = event ? `${event.id}:${event.confirmedDate ?? ''}` : null;
  if (event && confirmVersion !== seededFrom) {
    setSeededFrom(confirmVersion);
    setConfirmInput(event.confirmedDate ?? '');
  }

  if (eventQ.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!event) {
    return (
      <EmptyState
        icon={CalendarCheck}
        title="Event not found"
        description="It may have been removed."
        action={
          <Button variant="outline" onClick={() => router.push(ROUTES.SPECIAL_EVENTS)}>
            Back to Special Events
          </Button>
        }
      />
    );
  }

  async function onConfirmDate(dateStr: string | null) {
    setBusy(true);
    try {
      await confirmDate.mutateAsync({ id: eventId, confirmedDate: dateStr });
      toast.success(
        dateStr
          ? 'Date confirmed — reminders rescheduled'
          : 'Confirmation cleared — the estimate is in use again',
      );
      setConfirmInput('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to confirm the date');
    } finally {
      setBusy(false);
    }
  }

  async function onStatusChange(status: string) {
    setBusy(true);
    try {
      await updateStatus.mutateAsync({ id: eventId, status });
      toast.success(
        status === 'cancelled' ? 'Event cancelled — pending reminders stopped' : 'Status updated',
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update status');
    } finally {
      setBusy(false);
    }
  }

  const summary = event.demandSummary;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2 mb-1 h-11 md:h-8"
            onClick={() => router.push(ROUTES.SPECIAL_EVENTS)}
          >
            <ArrowLeft className="mr-1.5 h-4 w-4" /> Special Events
          </Button>
          <h1 className="font-heading text-xl font-semibold">{event.name}</h1>
          <p className="text-xs text-muted-foreground">{event.eventNumber}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <EventCategoryBadge category={event.category} />
          <EventPriorityBadge priority={event.priority} />
          <EventStatusBadge status={event.status} />
          <Button variant="outline" size="sm" className="h-11 md:h-9" onClick={() => setFormOpen(true)}>
            <Pencil className="mr-1.5 h-4 w-4" /> Edit
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="space-y-2 p-4">
            <h3 className="font-heading text-sm font-semibold">Schedule</h3>
            <EventDateLabel event={event} />
            <EventCountdown daysRemaining={event.daysRemaining} />
            <dl className="space-y-1 pt-2 text-xs text-muted-foreground">
              <div className="flex justify-between gap-2">
                <dt>Demand due</dt>
                <dd className="font-medium text-foreground">{event.demandDueDate ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Preparation starts</dt>
                <dd className="font-medium text-foreground">{event.preparationStartDate ?? '—'}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Duration</dt>
                <dd className="font-medium text-foreground">
                  {event.durationDays} day{event.durationDays === 1 ? '' : 's'}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt>Branches</dt>
                <dd className="font-medium text-foreground">
                  {event.appliesToAllBranches ? 'All' : `${event.branchIds?.length ?? 0} selected`}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <h3 className="font-heading text-sm font-semibold">Branch Participation</h3>
            {summary ? (
              <>
                <p className="text-2xl font-bold tabular-nums">
                  {summary.submittedBranches}
                  <span className="text-base font-normal text-muted-foreground">
                    /{summary.totalBranches}
                  </span>
                </p>
                <ProgressBar
                  value={
                    summary.totalBranches === 0
                      ? 0
                      : Math.round((summary.submittedBranches / summary.totalBranches) * 100)
                  }
                />
                <p className="text-xs text-muted-foreground">
                  {summary.pendingBranches} pending · {summary.draftBranches} in draft ·{' '}
                  {summary.totalItems} line{summary.totalItems === 1 ? '' : 's'}
                </p>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No demand recorded yet.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="space-y-3 p-4">
            <h3 className="font-heading text-sm font-semibold">Admin Controls</h3>

            <div className="space-y-1">
              <Label htmlFor="confirm-date">Confirmed date</Label>
              <div className="flex gap-2">
                <Input
                  id="confirm-date"
                  type="date"
                  value={confirmInput}
                  onChange={(e) => setConfirmInput(e.target.value)}
                />
                <Button
                  size="sm"
                  disabled={busy || !confirmInput}
                  onClick={() => onConfirmDate(confirmInput)}
                >
                  Confirm
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {event.dateIsEstimated
                  ? 'Currently using the calculated estimate. Confirming reschedules the reminders.'
                  : 'A confirmed date is in use and overrides the estimate.'}
              </p>
              {!event.dateIsEstimated && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="px-0"
                  disabled={busy}
                  onClick={() => onConfirmDate(null)}
                >
                  Clear confirmation
                </Button>
              )}
            </div>

            <div className="space-y-1">
              <Label>Status</Label>
              <Select
                items={[
                  { value: 'upcoming', label: 'Upcoming' },
                  { value: 'active', label: 'Active' },
                  { value: 'completed', label: 'Completed' },
                  { value: 'cancelled', label: 'Cancelled' },
                ]}
                value={event.status}
                onValueChange={(v) => onStatusChange(v as string)}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="upcoming">Upcoming</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      </div>

      {event.description && (
        <p className="text-sm text-muted-foreground">{event.description}</p>
      )}

      <Tabs defaultValue="demands">
        <TabsList>
          <TabsTrigger value="demands">Branch Demands</TabsTrigger>
          <TabsTrigger value="consolidated">Consolidated</TabsTrigger>
          <TabsTrigger value="readiness">Production Readiness</TabsTrigger>
          <TabsTrigger value="reminders">Reminders</TabsTrigger>
        </TabsList>

        <TabsContent value="demands" className="mt-4">
          <BranchDemandPanel eventId={eventId} canReview />
        </TabsContent>

        <TabsContent value="consolidated" className="mt-4">
          <ConsolidatedDemandPanel eventId={eventId} />
        </TabsContent>

        <TabsContent value="readiness" className="mt-4">
          <ProductionReadinessPanel eventId={eventId} editable />
        </TabsContent>

        <TabsContent value="reminders" className="mt-4">
          <EventNotificationSchedule eventId={eventId} />
        </TabsContent>
      </Tabs>

      <EventFormDialog key={event.id} open={formOpen} onOpenChange={setFormOpen} event={event} />
    </div>
  );
}
