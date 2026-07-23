'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import type { SupportTicket, SupportReference } from '@mb/shared';
import { CreateSupportTicketSchema } from '@mb/shared';
import { toast } from 'sonner';
import { Plus, Search, Loader2, Headset } from 'lucide-react';

const STATUS_VARIANT: Record<SupportTicket['status'], 'default' | 'secondary' | 'destructive'> = {
  open: 'default',
  resolved: 'secondary',
  rejected: 'destructive',
};

/** Read-only detail table for a resolved reference (auto-adjusts to the type). */
function ReferenceDetail({ reference }: { reference: SupportReference }) {
  return (
    <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
      <p className="text-sm font-semibold">{reference.title}</p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {reference.fields.map((f) => (
          <div key={f.label} className="contents">
            <dt className="text-muted-foreground">{f.label}</dt>
            <dd className="font-medium text-right">{f.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function NewQueryDialog({ open, onOpenChange, onCreated }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const { token } = useAuth();
  const [referenceId, setReferenceId] = useState('');
  const [reference, setReference] = useState<SupportReference | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // Note: this dialog is remounted (via `key`) each time it opens, so state
  // starts fresh without a reset effect.

  async function handleLookup() {
    const ref = referenceId.trim();
    if (!ref) return;
    setLooking(true); setLookupError(''); setReference(null);
    try {
      const { reference } = await apiCall<{ reference: SupportReference }>(
        `/api/support/lookup?ref=${encodeURIComponent(ref)}`, {}, token,
      );
      setReference(reference);
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Could not find that ID');
    } finally {
      setLooking(false);
    }
  }

  async function handleSubmit() {
    const parsed = CreateSupportTicketSchema.safeParse({ referenceId: reference?.referenceId ?? referenceId, message });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Please complete the form');
      return;
    }
    setSubmitting(true);
    try {
      await apiCall('/api/support', { method: 'POST', body: JSON.stringify(parsed.data) }, token);
      toast.success('Query sent to admin');
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send query');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Query</DialogTitle>
          <DialogDescription>
            Search a sale (MB-…), expense (EXP-…), or stock (STK-…) ID. Its details load automatically —
            then describe the issue for the admin.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Reference ID</Label>
            <div className="flex gap-2">
              <Input
                value={referenceId}
                onChange={(e) => setReferenceId(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleLookup(); } }}
                placeholder="e.g. EXP-000012"
                autoFocus
              />
              <Button type="button" variant="secondary" onClick={handleLookup} disabled={looking || !referenceId.trim()}>
                {looking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                <span className="ml-1">Find</span>
              </Button>
            </div>
            {lookupError && <p className="text-xs text-destructive">{lookupError}</p>}
          </div>

          {reference && <ReferenceDetail reference={reference} />}

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
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting || !reference || message.trim().length < 3}>
            {submitting ? 'Sending…' : 'Submit to Admin'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function HelpDeskPage() {
  const { token } = useAuth();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [newKey, setNewKey] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (!token) return;
    apiCall<{ tickets: SupportTicket[] }>('/api/support', {}, token)
      .then((r) => setTickets(r.tickets))
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load queries'))
      .finally(() => setLoading(false));
  }, [token, refreshKey]);

  const open = tickets.filter((t) => t.status === 'open');
  const past = tickets.filter((t) => t.status !== 'open');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Help Desk</h2>
          <p className="text-sm text-muted-foreground">
            Detected an issue with a record? Forward it to admin — it stays here until resolved.
          </p>
        </div>
        <Button onClick={() => { setNewKey((k) => k + 1); setShowNew(true); }}>
          <Plus className="h-4 w-4 mr-1" /> New Query
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : tickets.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          <Headset className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No queries yet. Raise one with “New Query”.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {open.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">Awaiting admin ({open.length})</h3>
              {open.map((t) => <TicketCard key={t.id} ticket={t} />)}
            </section>
          )}
          {past.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">Resolved & rejected</h3>
              {past.map((t) => <TicketCard key={t.id} ticket={t} />)}
            </section>
          )}
        </div>
      )}

      <NewQueryDialog key={newKey} open={showNew} onOpenChange={setShowNew} onCreated={() => setRefreshKey((k) => k + 1)} />
    </div>
  );
}

function TicketCard({ ticket }: { ticket: SupportTicket }) {
  return (
    <div className="rounded-lg border p-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{ticket.ticketNumber}</span>
          <Badge variant="outline">{ticket.referenceId}</Badge>
        </div>
        <Badge variant={STATUS_VARIANT[ticket.status]} className="capitalize">{ticket.status}</Badge>
      </div>
      {ticket.referenceSnapshot && <ReferenceDetail reference={ticket.referenceSnapshot} />}
      <p className="text-sm"><span className="text-muted-foreground">Issue: </span>{ticket.message}</p>
      {ticket.resolutionNote && (
        <p className="text-sm rounded-md bg-muted/50 px-3 py-2">
          <span className="text-muted-foreground">Admin: </span>{ticket.resolutionNote}
        </p>
      )}
    </div>
  );
}
