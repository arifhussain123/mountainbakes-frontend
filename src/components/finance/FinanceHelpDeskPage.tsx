'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Headset, Loader2, Plus, Search, Trash2 } from 'lucide-react';
import {
  CreateFinanceTicketSchema,
  FINANCE_TICKET_REFERENCE_LABELS,
  FINANCE_TICKET_PREFIXES,
  type FinanceTicket,
  type FinanceTicketReferenceLookup,
} from '@mb/shared';
import {
  lookupFinanceReference,
  useFinanceMutation,
  useFinanceTickets,
} from '@/lib/finance';
import { FinancePageHeader, useFinanceAbilities } from './finance-ui';

/**
 * Finance Help Desk.
 *
 * One page for both sides of the queue, because they are the same list seen from
 * two angles: an Accountant raises a query and watches it; a Finance Admin works
 * through everything outstanding. Splitting them into two screens would duplicate
 * the card, the filters and the empty states to change one verb.
 *
 * Every control here is decided by `useFinanceAbilities()` plus the role, and
 * every one of them calls an endpoint that decides the same thing again from the
 * JWT. Hiding a button is courtesy; the API is the boundary.
 */

const STATUS_VARIANT: Record<FinanceTicket['status'], 'default' | 'secondary' | 'destructive'> = {
  open: 'default',
  resolved: 'secondary',
  rejected: 'destructive',
};

const PREFIX_HINT = FINANCE_TICKET_PREFIXES.map((p) => `${p}-…`).join(', ');

/**
 * The referenced record's figures.
 *
 * The snapshot is a whole API row, so the keys are whatever that table has. It is
 * rendered generically rather than per-type: a hand-written field list for six
 * record types is six lists to forget to update, and the point of the snapshot is
 * to show what was there, not a curated view of it.
 */
function ReferenceDetail({
  snapshot,
  heading,
}: {
  snapshot: Record<string, unknown> | null;
  heading: string;
}) {
  const rows = useMemo(() => {
    if (!snapshot) return [];
    return Object.entries(snapshot)
      // Ids and the snapshot's own plumbing are noise to a human reading a query.
      .filter(([k, v]) => !k.endsWith('Id') && k !== 'id' && v !== null && v !== '' && typeof v !== 'object')
      .slice(0, 12);
  }, [snapshot]);

  if (!snapshot) return null;

  return (
    <div className="space-y-2 rounded-lg border bg-muted/40 p-3">
      <p className="text-sm font-semibold">{heading}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {rows.map(([key, value]) => (
          <div key={key} className="contents">
            <dt className="text-muted-foreground capitalize">
              {key.replace(/([A-Z])/g, ' $1').toLowerCase()}
            </dt>
            <dd className="truncate text-right font-medium">{String(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function NewQueryDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { token } = useAuth();
  const mutation = useFinanceMutation();
  const [referenceNo, setReferenceNo] = useState('');
  const [reference, setReference] = useState<FinanceTicketReferenceLookup | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  // Remounted via `key` each time it opens, so state starts fresh with no reset effect.

  async function handleLookup() {
    const ref = referenceNo.trim();
    if (!ref) return;
    setLooking(true);
    setLookupError('');
    setReference(null);
    try {
      setReference(await lookupFinanceReference(ref, token));
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Could not find that reference');
    } finally {
      setLooking(false);
    }
  }

  async function handleSubmit() {
    const parsed = CreateFinanceTicketSchema.safeParse({
      referenceNo: reference?.referenceNo ?? referenceNo,
      subject,
      message,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Please complete the form');
      return;
    }
    try {
      await mutation.mutateAsync({ path: '/api/finance/tickets', body: parsed.data });
      toast.success('Query sent to the Finance Admin');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send query');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Finance Query</DialogTitle>
          <DialogDescription>
            Enter the reference of the finance record in question ({PREFIX_HINT}). Its figures load
            automatically and are attached to the query, so they stay readable even if the record
            changes later.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Reference number</Label>
            <div className="flex gap-2">
              <Input
                value={referenceNo}
                onChange={(e) => setReferenceNo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleLookup();
                  }
                }}
                placeholder="e.g. RV-000001"
                autoFocus
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => void handleLookup()}
                disabled={looking || !referenceNo.trim()}
              >
                {looking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                <span className="ml-1">Find</span>
              </Button>
            </div>
            {lookupError && <p className="text-xs text-destructive">{lookupError}</p>}
          </div>

          {reference && (
            <ReferenceDetail
              snapshot={reference.snapshot}
              heading={`${reference.label} · ${reference.referenceNo}`}
            />
          )}

          <div className="space-y-1">
            <Label>Subject</Label>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Short summary, e.g. Amount does not match the deposit slip"
            />
          </div>

          <div className="space-y-1">
            <Label>Describe the issue</Label>
            <Textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="What looks wrong with this record?"
              rows={4}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={
              mutation.isPending || !reference || subject.trim().length < 3 || message.trim().length < 3
            }
          >
            {mutation.isPending ? 'Sending…' : 'Submit to Finance Admin'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResolveDialog({
  ticket,
  onClose,
}: {
  ticket: FinanceTicket | null;
  onClose: () => void;
}) {
  const mutation = useFinanceMutation();
  const [note, setNote] = useState('');

  async function close(status: 'resolved' | 'rejected') {
    if (!ticket) return;
    try {
      await mutation.mutateAsync({
        path: `/api/finance/tickets/${ticket.id}/resolve`,
        method: 'PATCH',
        body: { status, resolutionNote: note },
      });
      toast.success(`Query ${ticket.ticketNo} ${status}`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to close the query');
    }
  }

  return (
    <Dialog open={Boolean(ticket)} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>Close query {ticket?.ticketNo}</DialogTitle>
          <DialogDescription>
            Your note goes back to whoever raised it. Closing is final — a query cannot be reopened,
            so a further problem with the same record is a new query.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <Label>Resolution note</Label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What was done, or why this is not an error"
            rows={4}
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={mutation.isPending} onClick={() => void close('rejected')}>
            Reject
          </Button>
          <Button disabled={mutation.isPending} onClick={() => void close('resolved')}>
            {mutation.isPending ? 'Saving…' : 'Resolve'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TicketCard({
  ticket,
  isAdmin,
  onResolve,
  onDelete,
}: {
  ticket: FinanceTicket;
  isAdmin: boolean;
  onResolve: (t: FinanceTicket) => void;
  onDelete: (t: FinanceTicket) => void;
}) {
  return (
    <div className="space-y-2 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{ticket.ticketNo}</span>
          <Badge variant="outline">{ticket.referenceNo}</Badge>
          <span className="text-xs text-muted-foreground">
            {FINANCE_TICKET_REFERENCE_LABELS[ticket.referenceType] ?? ticket.referenceType}
          </span>
        </div>
        <Badge variant={STATUS_VARIANT[ticket.status]} className="capitalize">
          {ticket.status}
        </Badge>
      </div>

      <p className="font-medium">{ticket.subject}</p>

      <ReferenceDetail
        snapshot={ticket.referenceSnapshot}
        heading={`${FINANCE_TICKET_REFERENCE_LABELS[ticket.referenceType] ?? 'Record'} · ${ticket.referenceNo}`}
      />

      <p className="text-sm">
        <span className="text-muted-foreground">Issue: </span>
        {ticket.message}
      </p>

      {ticket.resolutionNote && (
        <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">
          <span className="text-muted-foreground">Finance Admin: </span>
          {ticket.resolutionNote}
        </p>
      )}

      <div className="flex items-center justify-between gap-2 pt-1">
        <p className="text-xs text-muted-foreground">
          Raised by {ticket.raisedByName || 'unknown'} ·{' '}
          {new Date(ticket.createdAt).toLocaleString('en-PK')}
          {ticket.resolvedByName && ` · closed by ${ticket.resolvedByName}`}
        </p>
        {isAdmin && (
          <div className="flex shrink-0 gap-2">
            {ticket.status === 'open' && (
              <Button size="sm" variant="secondary" onClick={() => onResolve(ticket)}>
                Resolve
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => onDelete(ticket)}
              aria-label={`Delete query ${ticket.ticketNo}`}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

export function FinanceHelpDeskPage() {
  const { user } = useAuth();
  const abilities = useFinanceAbilities();
  const mutation = useFinanceMutation();

  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'resolved' | 'rejected'>('all');
  const [showNew, setShowNew] = useState(false);
  const [newKey, setNewKey] = useState(0);
  const [resolving, setResolving] = useState<FinanceTicket | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FinanceTicket | null>(null);

  const { data: tickets = [], isLoading } = useFinanceTickets(
    statusFilter === 'all' ? {} : { status: statusFilter },
  );

  // Mirrors requireFinanceTicketAdmin() on the API. The server decides for real.
  const isAdmin = user?.role === 'finance_admin' || user?.role === 'super_admin';

  const open = tickets.filter((t) => t.status === 'open');
  const past = tickets.filter((t) => t.status !== 'open');

  async function confirmDelete() {
    if (!pendingDelete) return;
    try {
      await mutation.mutateAsync({
        path: `/api/finance/tickets/${pendingDelete.id}`,
        method: 'DELETE',
      });
      toast.success(`Query ${pendingDelete.ticketNo} deleted`);
      setPendingDelete(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete the query');
    }
  }

  return (
    <div className="space-y-6">
      <FinancePageHeader
        title="Finance Help Desk"
        description={
          isAdmin
            ? 'Queries raised against finance records. Resolve, reject or permanently delete them — every action is written to the audit trail.'
            : 'Something wrong with a voucher, salary or expense? Raise it here and the Finance Admin will respond.'
        }
        actions={
          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
              className="h-9 rounded-md border bg-background px-2 text-sm"
              aria-label="Filter by status"
            >
              <option value="all">All statuses</option>
              <option value="open">Open</option>
              <option value="resolved">Resolved</option>
              <option value="rejected">Rejected</option>
            </select>
            {abilities.create && (
              <Button
                onClick={() => {
                  setNewKey((k) => k + 1);
                  setShowNew(true);
                }}
              >
                <Plus className="mr-1 h-4 w-4" /> New Query
              </Button>
            )}
          </div>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : tickets.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          <Headset className="mx-auto mb-2 h-8 w-8 opacity-50" />
          <p className="text-sm">
            {abilities.create
              ? 'No queries here. Raise one with “New Query”.'
              : 'No queries have been raised.'}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {open.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">
                {isAdmin ? `Awaiting you (${open.length})` : `Awaiting Finance Admin (${open.length})`}
              </h3>
              {open.map((t) => (
                <TicketCard
                  key={t.id}
                  ticket={t}
                  isAdmin={isAdmin}
                  onResolve={setResolving}
                  onDelete={setPendingDelete}
                />
              ))}
            </section>
          )}
          {past.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">Resolved &amp; rejected</h3>
              {past.map((t) => (
                <TicketCard
                  key={t.id}
                  ticket={t}
                  isAdmin={isAdmin}
                  onResolve={setResolving}
                  onDelete={setPendingDelete}
                />
              ))}
            </section>
          )}
        </div>
      )}

      <NewQueryDialog key={newKey} open={showNew} onOpenChange={setShowNew} />
      <ResolveDialog ticket={resolving} onClose={() => setResolving(null)} />

      <Dialog open={Boolean(pendingDelete)} onOpenChange={(v) => !v && setPendingDelete(null)}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete query {pendingDelete?.ticketNo} and record {pendingDelete?.referenceNo}?</DialogTitle>
            <DialogDescription>
              This deletes two things, both permanently and neither recoverable.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 text-sm text-muted-foreground">
            <ul className="list-disc space-y-1 pl-5">
              <li>the query itself — subject, message and attached figures</li>
              <li>
                <span className="font-medium text-foreground">
                  {pendingDelete
                    ? `${FINANCE_TICKET_REFERENCE_LABELS[pendingDelete.referenceType] ?? 'the record'} ${pendingDelete.referenceNo}`
                    : 'the referenced record'}
                </span>{' '}
                — removed from the books entirely
              </li>
            </ul>
            {pendingDelete?.referenceType === 'ledger_entry' && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">
                This is a posted ledger voucher. Deleting it does not recompute the running balance
                on later entries for that day, so the ledger and the day&apos;s totals will
                disagree. To correct a wrong figure without this, cancel and post a reversing entry
                instead.
              </p>
            )}
            <p>The audit trail records that you deleted both, but not what the query said.</p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={mutation.isPending} onClick={() => void confirmDelete()}>
              {mutation.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
