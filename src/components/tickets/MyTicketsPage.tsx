'use client';

import { useEffect, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { format } from 'date-fns';
import { Eye } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { useTickets } from '@/lib/queries';
import { DataTable } from '@/components/shared/DataTable';
import { Button } from '@/components/ui/button';
import type { SupportTicket } from '@mb/shared';
import { STATUS_LABEL, STATUS_PILL, PRIORITY_LABEL, PRIORITY_PILL, Pill } from './ticketMeta';
import { NewTicketDialog } from './NewTicketDialog';
import { TicketDetail } from './TicketDetail';

const col = createColumnHelper<SupportTicket>();

export function MyTicketsPage() {
  const { token } = useAuth();
  const ticketsQ = useTickets(token);
  const tickets = ticketsQ.data ?? [];

  const [showNew, setShowNew] = useState(false);
  const [viewId, setViewId] = useState<string | null>(null);

  useEffect(() => {
    if (ticketsQ.isError) toast.error('Failed to load tickets');
  }, [ticketsQ.isError]);

  const columns = [
    col.accessor('ticketNo', { header: 'Ticket No', cell: (i) => <span className="font-mono text-xs">{i.getValue()}</span> }),
    col.accessor('createdAt', { header: 'Date', cell: (i) => <span className="text-sm">{format(new Date(i.getValue()), 'dd MMM yyyy')}</span> }),
    col.accessor('subject', { header: 'Subject', cell: (i) => <span className="font-medium">{i.getValue()}</span> }),
    col.accessor('categoryName', { header: 'Category', cell: (i) => <span className="text-sm text-muted-foreground">{i.getValue()}</span> }),
    col.accessor('priority', { header: 'Priority', cell: (i) => <Pill className={PRIORITY_PILL[i.getValue()]}>{PRIORITY_LABEL[i.getValue()]}</Pill> }),
    col.accessor('status', { header: 'Status', cell: (i) => <Pill className={STATUS_PILL[i.getValue()]}>{STATUS_LABEL[i.getValue()]}</Pill> }),
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Help Desk</h2>
          <p className="text-sm text-muted-foreground">{tickets.length} ticket{tickets.length === 1 ? '' : 's'}</p>
        </div>
        <Button onClick={() => setShowNew(true)}>+ New Query</Button>
      </div>

      <DataTable columns={columns} data={tickets} loading={ticketsQ.isLoading} searchPlaceholder="Search tickets…" />

      <NewTicketDialog open={showNew} onOpenChange={setShowNew} />
      <TicketDetail ticketId={viewId} open={!!viewId} onOpenChange={(o) => !o && setViewId(null)} />
    </div>
  );
}
