'use client';

import { useEffect, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { format } from 'date-fns';
import { Eye, LifeBuoy, MailOpen, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useTickets, useTicketStats } from '@/lib/queries';
import { DataTable } from '@/components/shared/DataTable';
import { StatCard } from '@/components/shared/StatCard';
import { Button } from '@/components/ui/button';
import type { SupportTicket } from '@mb/shared';
import { STATUS_LABEL, STATUS_PILL, PRIORITY_LABEL, PRIORITY_PILL, Pill } from './ticketMeta';
import { TicketDetail } from './TicketDetail';

const col = createColumnHelper<SupportTicket>();

export function SupportCenterPage() {
  const { token } = useAuth();
  const ticketsQ = useTickets(token);
  const statsQ = useTicketStats(token);
  const tickets = ticketsQ.data ?? [];
  const stats = statsQ.data;
  const [viewId, setViewId] = useState<string | null>(null);

  useEffect(() => {
    if (ticketsQ.isError) toast.error('Failed to load tickets');
  }, [ticketsQ.isError]);

  const columns = [
    col.accessor('ticketNo', { header: 'Ticket No', cell: (i) => <span className="font-mono text-xs">{i.getValue()}</span> }),
    col.accessor('createdAt', { header: 'Date', cell: (i) => <span className="text-sm">{format(new Date(i.getValue()), 'dd MMM yyyy')}</span> }),
    col.accessor('department', { header: 'Branch / Dept', cell: (i) => <span className="text-sm">{i.getValue() ?? '—'}</span> }),
    col.accessor('subject', {
      header: 'Subject',
      cell: (i) => (
        <div>
          <p className="font-medium">{i.getValue()}</p>
          <p className="text-xs text-muted-foreground">{i.row.original.categoryName}</p>
        </div>
      ),
    }),
    col.accessor('priority', { header: 'Priority', cell: (i) => <Pill className={PRIORITY_PILL[i.getValue()]}>{PRIORITY_LABEL[i.getValue()]}</Pill> }),
    col.accessor('status', { header: 'Status', cell: (i) => <Pill className={STATUS_PILL[i.getValue()]}>{STATUS_LABEL[i.getValue()]}</Pill> }),
    col.accessor('assignedToName', { header: 'Assigned To', cell: (i) => <span className="text-sm text-muted-foreground">{i.getValue() ?? '—'}</span> }),
    col.accessor('updatedAt', { header: 'Last Updated', cell: (i) => <span className="text-xs text-muted-foreground">{format(new Date(i.getValue()), 'dd MMM, HH:mm')}</span> }),
    col.display({
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <Button size="sm" variant="outline" className="h-8" onClick={() => setViewId(row.original.id)}>
          <Eye className="mr-1 h-3.5 w-3.5" /> View
        </Button>
      ),
    }),
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatCard title="Total" value={stats?.total ?? 0} icon={LifeBuoy} loading={statsQ.isLoading} />
        <StatCard title="Open" value={stats?.open ?? 0} icon={MailOpen} color="orange" loading={statsQ.isLoading} />
        <StatCard title="In Progress" value={stats?.inProgress ?? 0} icon={Loader2} color="blue" loading={statsQ.isLoading} />
        <StatCard title="Resolved" value={stats?.resolved ?? 0} icon={CheckCircle} color="green" loading={statsQ.isLoading} />
        <StatCard title="Closed" value={stats?.closed ?? 0} icon={CheckCircle} color="brown" loading={statsQ.isLoading} />
        <StatCard title="High Priority" value={stats?.highPriority ?? 0} icon={AlertTriangle} color="red" loading={statsQ.isLoading} />
        <StatCard title="Today" value={stats?.today ?? 0} icon={LifeBuoy} color="blue" loading={statsQ.isLoading} />
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">All Tickets</h2>
        <DataTable columns={columns} data={tickets} loading={ticketsQ.isLoading} searchPlaceholder="Search ticket no, subject, branch…" />
      </div>

      <TicketDetail ticketId={viewId} open={!!viewId} onOpenChange={(o) => !o && setViewId(null)} />
    </div>
  );
}
