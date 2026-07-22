'use client';

import { useState } from 'react';
import { format } from 'date-fns';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useTicket } from '@/lib/queries';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TicketConversation } from './TicketConversation';
import { STATUS_LABEL, STATUS_PILL, PRIORITY_LABEL, PRIORITY_PILL, Pill } from './ticketMeta';

const ACTION_LABEL: Record<string, string> = {
  created: 'Ticket created',
  reply_added: 'Reply added',
  status_changed: 'Status changed',
  priority_changed: 'Priority changed',
  assigned: 'Assigned',
  resolved: 'Resolved',
  reopened: 'Reopened',
  deleted: 'Deleted',
};

export function TicketDetail({
  ticketId,
  open,
  onOpenChange,
}: {
  ticketId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { token } = useAuth();
  const ticketQ = useTicket(token, open ? ticketId : null);
  const ticket = ticketQ.data;
  const [showHistory, setShowHistory] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">{ticket?.ticketNo ?? 'Ticket'}</DialogTitle>
        </DialogHeader>

        {ticketQ.isLoading || !ticket ? (
          <div className="space-y-2 py-6">
            <div className="h-5 w-1/2 animate-pulse rounded bg-muted" />
            <div className="h-24 w-full animate-pulse rounded bg-muted" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Meta */}
            <div>
              <h3 className="text-base font-semibold">{ticket.subject}</h3>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Pill className={STATUS_PILL[ticket.status]}>{STATUS_LABEL[ticket.status]}</Pill>
                <Pill className={PRIORITY_PILL[ticket.priority]}>{PRIORITY_LABEL[ticket.priority]}</Pill>
                {ticket.categoryName && <span>· {ticket.categoryName}</span>}
                {ticket.department && <span>· {ticket.department}</span>}
                <span>· by {ticket.createdByName}</span>
              </div>
            </div>

            {/* Conversation */}
            <TicketConversation ticket={ticket} />

            {/* Audit history */}
            <div className="border-t pt-2">
              <button
                type="button"
                onClick={() => setShowHistory((v) => !v)}
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                {showHistory ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                History ({ticket.history?.length ?? 0})
              </button>
              {showHistory && (
                <ul className="mt-2 space-y-1.5">
                  {(ticket.history ?? []).map((h) => (
                    <li key={h.id} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-border" />
                      <span>
                        <span className="text-foreground">{ACTION_LABEL[h.action] ?? h.action}</span>
                        {h.oldValue && h.newValue && <> · {h.oldValue} → {h.newValue}</>}
                        {' · '}{h.performedByName ?? 'system'}
                        {' · '}{format(new Date(h.performedAt), 'dd MMM, HH:mm')}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
