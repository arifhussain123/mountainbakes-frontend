'use client';

import { createColumnHelper } from '@tanstack/react-table';
import { CalendarDays, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import type { SpecialEventView } from '@mb/shared';
import {
  EventCategoryBadge,
  EventCountdown,
  EventDateLabel,
  EventPriorityBadge,
  EventStatusBadge,
  ProgressBar,
} from './EventBits';

const col = createColumnHelper<SpecialEventView>();

/**
 * Table view of the events list.
 *
 * `meta.mobile` annotations route each column into the card layout DataTable
 * renders below `md`, so the phone view comes for free — see
 * components/shared/table-meta.ts.
 */
export function EventListTable({
  events,
  loading,
  onSelect,
  onEdit,
  onDelete,
}: {
  events: SpecialEventView[];
  loading?: boolean;
  onSelect: (id: string) => void;
  /** Admin-only. Omit for the branch and production views. */
  onEdit?: (event: SpecialEventView) => void;
  onDelete?: (event: SpecialEventView) => void;
}) {
  const columns = [
    col.accessor('name', {
      header: 'Event',
      meta: { mobile: 'title' },
      cell: (info) => (
        <button
          type="button"
          onClick={() => onSelect(info.row.original.id)}
          className="text-left font-medium hover:underline"
        >
          {info.getValue()}
        </button>
      ),
    }),
    col.accessor('eventDate', {
      header: 'Date',
      meta: { mobile: 'subtitle' },
      cell: (info) => <EventDateLabel event={info.row.original} />,
    }),
    col.accessor('category', {
      header: 'Category',
      meta: { mobile: 'badge' },
      cell: (info) => <EventCategoryBadge category={info.getValue()} />,
    }),
    col.accessor('priority', {
      header: 'Demand Level',
      meta: { mobile: 'badge' },
      cell: (info) => <EventPriorityBadge priority={info.getValue()} />,
    }),
    col.accessor('status', {
      header: 'Status',
      meta: { mobile: 'badge' },
      cell: (info) => <EventStatusBadge status={info.getValue()} />,
    }),
    col.accessor('daysRemaining', {
      header: 'Days Remaining',
      cell: (info) => <EventCountdown daysRemaining={info.getValue()} />,
    }),
    col.accessor('demandDueDate', {
      header: 'Demand Due',
      cell: (info) => info.getValue() ?? '—',
    }),
    col.display({
      id: 'branches',
      header: 'Branches',
      cell: (info) => {
        const summary = info.row.original.demandSummary;
        if (!summary) return '—';
        return (
          <span className="tabular-nums">
            {summary.submittedBranches}/{summary.totalBranches}
          </span>
        );
      },
    }),
    col.accessor('readinessPercentage', {
      header: 'Readiness',
      meta: { mobileFull: true },
      cell: (info) => <ProgressBar value={info.getValue() ?? 0} label="Readiness" className="min-w-28" />,
    }),
    // Searchable but not shown: the global filter can only match values it reaches
    // through a column accessor.
    col.accessor('eventNumber', { header: 'No.' }),
  ];

  if (onEdit || onDelete) {
    columns.push(
      col.display({
        id: 'actions',
        header: '',
        cell: (info) => (
          <div className="flex items-center gap-1 [&_button]:min-h-11 [&_button]:min-w-11 md:[&_button]:min-h-8 md:[&_button]:min-w-8">
            {onEdit && (
              <Button variant="ghost" size="icon" aria-label="Edit event" onClick={() => onEdit(info.row.original)}>
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {onDelete && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Delete event"
                onClick={() => onDelete(info.row.original)}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            )}
          </div>
        ),
      }) as typeof columns[number],
    );
  }

  return (
    <DataTable
      columns={columns}
      data={events}
      loading={loading}
      searchPlaceholder="Search events…"
      columnVisibility={{ eventNumber: false }}
      empty={
        <EmptyState
          icon={CalendarDays}
          title="No events found"
          description="Adjust the filters, or add an event to start planning."
        />
      }
    />
  );
}
