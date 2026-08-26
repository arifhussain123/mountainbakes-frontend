'use client';

import { useState } from 'react';
import { BellRing, RefreshCw, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { useAuth } from '@/hooks/useAuth';
import {
  useDispatchEventNotifications,
  useEventNotifications,
  useRegenerateEventSchedule,
} from '@/lib/queries';
import { formatDate } from '@/utils/date';
import { cn } from '@/lib/utils';
import type { EventNotificationStatus } from '@mb/shared';

/**
 * The reminder schedule for one event, plus the button that actually sends.
 *
 * "Send due reminders now" is not a convenience: the server's cron schedulers are
 * commented out in server.ts, so until someone arms them this button is the only
 * thing that delivers a reminder. A manual dispatch deliberately ignores the
 * eventNotificationsEnabled setting, exactly like the closing-summary dispatch —
 * the toggle governs the unattended job, not a deliberate admin action.
 */

const STATUS_STYLES: Record<EventNotificationStatus, { label: string; className: string }> = {
  pending: { label: 'Scheduled', className: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  sending: { label: 'Sending', className: 'bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300' },
  sent: { label: 'Sent', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  failed: { label: 'Failed', className: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300' },
  // Not an error: a reminder whose date was already past when the schedule was
  // built, so it is recorded rather than fired in a burst.
  skipped: { label: 'Skipped', className: 'bg-muted text-muted-foreground' },
  cancelled: { label: 'Cancelled', className: 'bg-muted text-muted-foreground' },
};

const AUDIENCE_LABELS: Record<string, string> = {
  branch: 'Branch',
  production: 'Production',
  admin: 'Admin',
};

export function EventNotificationSchedule({ eventId }: { eventId?: string }) {
  const { token } = useAuth();
  const scheduleQ = useEventNotifications(token, eventId ?? null);
  const dispatch = useDispatchEventNotifications(token);
  const regenerate = useRegenerateEventSchedule(token);
  const [busy, setBusy] = useState(false);

  const rows = scheduleQ.data ?? [];
  const pending = rows.filter((r) => r.status === 'pending').length;
  const sent = rows.filter((r) => r.status === 'sent').length;

  async function sendDue() {
    setBusy(true);
    try {
      const result = await dispatch.mutateAsync({});
      if (result.skipped) {
        toast.info(result.skipped);
      } else if (result.dispatched === 0) {
        toast.info('No reminders are due today.');
      } else {
        toast.success(
          `${result.sent} reminder(s) sent · ${result.messagesSent} message(s) delivered` +
            (result.failed > 0 ? ` · ${result.failed} failed` : ''),
        );
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to dispatch reminders');
    } finally {
      setBusy(false);
    }
  }

  async function rebuild() {
    if (!eventId) return;
    setBusy(true);
    try {
      const result = await regenerate.mutateAsync(eventId);
      toast.success(
        `Schedule rebuilt — ${result.created} added, ${result.updated} moved, ${result.removed} cancelled.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to rebuild the schedule');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <h3 className="font-heading text-sm font-semibold">Reminder Schedule</h3>
            <p className="text-xs text-muted-foreground">
              {pending} scheduled · {sent} sent
            </p>
          </div>
          <div className="flex flex-wrap gap-2 [&_button]:min-h-11 md:[&_button]:min-h-9">
            {eventId && (
              <Button variant="outline" size="sm" onClick={rebuild} disabled={busy}>
                <RefreshCw className="mr-1.5 h-4 w-4" /> Rebuild
              </Button>
            )}
            <Button size="sm" onClick={sendDue} disabled={busy}>
              <Send className="mr-1.5 h-4 w-4" /> Send due reminders now
            </Button>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Automatic sending is currently off on the server. Until the scheduler is armed, reminders go
        out when this button is pressed.
      </p>

      {scheduleQ.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={BellRing}
          title="No reminders scheduled"
          description="Reminders appear here once the event has a resolved date."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-sm">
                <thead>
                  <tr data-table-head className="border-b text-left text-xs">
                    <th className="p-3 font-medium">Send On</th>
                    <th className="p-3 font-medium">Audience</th>
                    <th className="p-3 font-medium">Reminder</th>
                    <th className="p-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const style = STATUS_STYLES[row.status] ?? STATUS_STYLES.pending;
                    return (
                      <tr key={row.id} className="border-b last:border-0">
                        <td className="p-3 whitespace-nowrap">{formatDate(row.scheduledFor)}</td>
                        <td className="p-3">
                          {AUDIENCE_LABELS[row.audience] ?? row.audience}
                        </td>
                        <td className="p-3">
                          {row.reminderKind === 'demand_due'
                            ? `Demand deadline · ${row.offsetDays} day before`
                            : `${row.offsetDays} days before event`}
                        </td>
                        <td className="p-3">
                          <Badge variant="outline" className={cn('border-transparent', style.className)}>
                            {style.label}
                          </Badge>
                          {row.errorMessage && (
                            <p className="mt-1 max-w-64 text-xs text-destructive">{row.errorMessage}</p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
