import type { TicketStatus, TicketPriority } from '@mb/shared';

/** Human labels + badge colors for ticket status / priority, shared across the ticket UI. */

export const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  in_progress: 'In Progress',
  waiting_user: 'Waiting for User',
  resolved: 'Resolved',
  closed: 'Closed',
  reopened: 'Reopened',
};

export const STATUS_PILL: Record<TicketStatus, string> = {
  open: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  in_progress: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  waiting_user: 'bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-400',
  resolved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  closed: 'bg-muted text-muted-foreground',
  reopened: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400',
};

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export const PRIORITY_PILL: Record<TicketPriority, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  high: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400',
  urgent: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
};

export function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${className}`}>
      {children}
    </span>
  );
}
