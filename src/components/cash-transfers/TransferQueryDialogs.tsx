'use client';

import { useState } from 'react';
import {
  FINANCE_AMENDABLE_FIELDS,
  FINANCE_QUERY_PRIORITIES,
  FINANCE_QUERY_PRIORITY_LABELS,
  FINANCE_RESOLUTION_TYPE_LABELS,
  type CashTransfer,
  type FinanceQueryPriority,
  type FinanceTicket,
} from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import {
  useBranchTransferQueries,
  useBranchTransferQuery,
  useRaiseTransferQuery,
  useReplyTransferQuery,
} from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AttachmentGallery } from '@/components/shared/AttachmentGallery';
import { QueryPriorityBadge, QueryStatusBadge } from '@/components/finance/help-desk-ui';
import { cn } from '@/lib/utils';
import { ApiError } from '@/utils/api';
import { formatDate, formatDateTime } from '@/utils/date';
import { formatCurrency } from '@/utils/currency';
import { Eye, MessageSquareWarning, Send } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Branch → a query on one of its own cash transfers.
 *
 *     Branch  →  query on CT-000123  →  ADMIN
 *
 * The branch cannot change or withdraw a transfer (BranchCashTransfersPage's
 * header says why). When the amount, method or note is wrong — or the transfer
 * should not exist at all — the branch raises a query here and the Admin
 * corrects or deletes the record from the Help Desk, where every change carries
 * the Query ID and a reason. This file is the branch's half: raise, list, read
 * the Admin's answer, reply.
 */

function errorText(err: unknown, fallback: string): string {
  return err instanceof ApiError || err instanceof Error ? err.message : fallback;
}

// ---------------------------------------------------------------------------
// Raise
// ---------------------------------------------------------------------------

export function RaiseTransferQueryDialog({
  transfer,
  open,
  onClose,
  onRaised,
}: {
  transfer: CashTransfer | null;
  open: boolean;
  onClose: () => void;
  /** Called with the new query, so the caller can open its thread. */
  onRaised?: (ticket: FinanceTicket) => void;
}) {
  const { token } = useAuth();
  const raise = useRaiseTransferQuery(token);
  // null = the default subject for whichever transfer is open.
  const [subjectEdit, setSubject] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<FinanceQueryPriority>('normal');
  const subject = subjectEdit ?? (transfer ? `Query on ${transfer.transferNo}` : '');

  function close() {
    setSubject(null);
    setDescription('');
    setPriority('normal');
    onClose();
  }

  async function submit() {
    if (!transfer) return;
    if (subject.trim().length < 3) return void toast.error('Give the query a short subject.');
    if (description.trim().length < 3) return void toast.error('Describe what is wrong with this transfer.');
    try {
      const { ticket } = await raise.mutateAsync({
        transferId: transfer.id,
        subject: subject.trim(),
        description: description.trim(),
        priority,
        attachmentIds: [],
      });
      toast.success(`Query ${ticket.queryNo} sent to Admin`);
      close();
      onRaised?.(ticket);
    } catch (err) {
      toast.error(errorText(err, 'Could not raise the query'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
        <DialogHeader>
          <DialogTitle>Raise a Query</DialogTitle>
          <DialogDescription>
            Goes to Admin, who can correct the amount, method or note, or delete this transfer.
          </DialogDescription>
        </DialogHeader>

        {transfer && (
          <div className="grid grid-cols-2 gap-2 rounded-md bg-muted/40 p-3 text-sm">
            <span className="text-muted-foreground">Transfer ID</span>
            <span className="text-right font-mono font-medium">{transfer.transferNo}</span>
            <span className="text-muted-foreground">Amount</span>
            <span className="text-right font-semibold tabular-nums">{formatCurrency(transfer.amount)}</span>
            <span className="text-muted-foreground">Date</span>
            <span className="text-right">{formatDate(transfer.date)}</span>
          </div>
        )}

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="tq-subject">Subject</Label>
            <Input id="tq-subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="tq-description">What is wrong?</Label>
            <Textarea
              id="tq-description"
              rows={4}
              maxLength={4000}
              value={description}
              placeholder="e.g. Amount should be Rs. 25,000, not 2,500 · Sent by Easypaisa, not cash · Entered twice, please delete"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Priority</Label>
            <div className="grid grid-cols-4 gap-1.5">
              {FINANCE_QUERY_PRIORITIES.map((p) => (
                <Button
                  key={p}
                  type="button"
                  size="sm"
                  variant={priority === p ? 'default' : 'outline'}
                  onClick={() => setPriority(p)}
                >
                  {FINANCE_QUERY_PRIORITY_LABELS[p]}
                </Button>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={raise.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={raise.isPending || !transfer}>
            <Send className="mr-1.5 h-4 w-4" /> {raise.isPending ? 'Sending…' : 'Send to Admin'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// One query — the Admin's answer, what was changed, and the thread
// ---------------------------------------------------------------------------

/** "amount" → "Amount", from the same list the Admin's Amend dialog reads. */
function fieldLabel(field: string): string {
  return FINANCE_AMENDABLE_FIELDS.cash_transfer.find((f) => f.key === field)?.label ?? field;
}

export function TransferQueryDialog({
  ticketId,
  open,
  onClose,
}: {
  ticketId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const { token, user } = useAuth();
  const q = useBranchTransferQuery(token, open ? ticketId : null);
  const reply = useReplyTransferQuery(token);
  const [body, setBody] = useState('');
  const ticket = q.data;

  function close() {
    setBody('');
    onClose();
  }

  async function send() {
    if (!ticketId || !body.trim()) return;
    try {
      await reply.mutateAsync({ id: ticketId, body: body.trim() });
      setBody('');
    } catch (err) {
      toast.error(errorText(err, 'Could not send the reply'));
    }
  }

  const canReply = !!ticket && ticket.status !== 'closed' && !ticket.deletedAt;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-xl">
        <DialogHeader>
          <DialogTitle>{ticket?.queryNo ?? 'Query'}</DialogTitle>
          {ticket && (
            <DialogDescription>
              {ticket.referenceNo} · raised {formatDateTime(ticket.createdAt)} by {ticket.raisedByName}
            </DialogDescription>
          )}
        </DialogHeader>

        {q.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : !ticket ? (
          <p className="py-4 text-center text-sm text-muted-foreground">This query could not be loaded.</p>
        ) : (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <QueryStatusBadge status={ticket.status} />
              <QueryPriorityBadge priority={ticket.priority} />
              {ticket.amount !== null && (
                <span className="ml-auto font-semibold tabular-nums">{formatCurrency(ticket.amount)}</span>
              )}
            </div>

            <div>
              <p className="font-medium">{ticket.subject}</p>
              <p className="mt-1 whitespace-pre-wrap break-words text-muted-foreground">{ticket.message}</p>
            </div>

            {(ticket.adminResponse || ticket.resolutionNote) && (
              <div className="space-y-1 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-950 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100">
                <p className="text-xs font-semibold uppercase tracking-wide">Admin&apos;s answer</p>
                {ticket.adminResponse && <p className="whitespace-pre-wrap break-words">{ticket.adminResponse}</p>}
                {ticket.resolutionNote && (
                  <p className="whitespace-pre-wrap break-words">
                    {ticket.resolutionType ? `${FINANCE_RESOLUTION_TYPE_LABELS[ticket.resolutionType]}: ` : ''}
                    {ticket.resolutionNote}
                  </p>
                )}
              </div>
            )}

            {!!ticket.amendments?.length && (
              <div className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Changes Admin made to {ticket.referenceNo}
                </p>
                <ul className="space-y-1.5">
                  {ticket.amendments.map((a) => (
                    <li key={a.id} className="rounded-md bg-muted/40 p-2.5">
                      {a.action === 'delete' ? (
                        <span className="font-medium text-red-700 dark:text-red-300">Transfer deleted</span>
                      ) : (
                        <>
                          <span className="font-medium">{fieldLabel(a.field)}</span>: {a.originalValue ?? '—'} →{' '}
                          <span className="font-medium">{a.newValue ?? '—'}</span>
                        </>
                      )}
                      <span className="block text-xs text-muted-foreground">
                        {a.reason} · {a.adminName} · {formatDateTime(a.createdAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conversation</p>
              {!ticket.messages?.length ? (
                <p className="text-muted-foreground">No messages yet.</p>
              ) : (
                <ul className="space-y-2">
                  {ticket.messages.map((m) => {
                    const mine = m.authorId === user?.uid;
                    return (
                      <li
                        key={m.id}
                        className={cn(
                          'max-w-[85%] rounded-lg p-2.5',
                          m.authorSide === 'admin' ? 'bg-muted' : 'ml-auto bg-primary/10',
                        )}
                      >
                        <p className="text-xs text-muted-foreground">
                          {m.authorSide === 'admin' ? 'Admin' : mine ? 'You' : m.authorName} ·{' '}
                          {formatDateTime(m.createdAt)}
                        </p>
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        {!!m.attachments?.length && (
                          <AttachmentGallery attachments={m.attachments} size="xs" title="Message photo" />
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {canReply ? (
              <div className="flex items-end gap-2">
                <Textarea
                  rows={2}
                  maxLength={4000}
                  value={body}
                  placeholder="Reply to Admin…"
                  onChange={(e) => setBody(e.target.value)}
                />
                <Button onClick={send} disabled={reply.isPending || !body.trim()} aria-label="Send reply">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                This query is closed. Raise a new one for anything further.
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// The branch's queries, newest first
// ---------------------------------------------------------------------------

export function BranchTransferQueriesPanel({ onOpen }: { onOpen: (id: string) => void }) {
  const { token } = useAuth();
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const q = useBranchTransferQueries(token, { page, pageSize });
  const tickets = q.data?.tickets ?? [];
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  if (!q.isLoading && total === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <MessageSquareWarning className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold">Queries on Transfers</h3>
        <span className="text-sm text-muted-foreground">({total})</span>
      </div>
      <ul className="divide-y rounded-md border">
        {q.isLoading
          ? Array.from({ length: 2 }).map((_, i) => (
              <li key={i} className="p-3">
                <Skeleton className="h-5 w-full" />
              </li>
            ))
          : tickets.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-sm">
                <span className="font-mono font-medium">{t.queryNo}</span>
                <span className="font-mono text-muted-foreground">{t.referenceNo}</span>
                <span className="min-w-0 flex-1 truncate">{t.subject}</span>
                <span className="text-xs text-muted-foreground">{formatDate(t.createdAt)}</span>
                <QueryStatusBadge status={t.status} />
                <Button variant="ghost" size="sm" onClick={() => onOpen(t.id)}>
                  <Eye className="mr-1.5 h-4 w-4" /> View
                </Button>
              </li>
            ))}
      </ul>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-muted-foreground">
            {page} / {pages}
          </span>
          <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </section>
  );
}
