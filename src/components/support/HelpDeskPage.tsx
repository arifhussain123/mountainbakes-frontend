'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce } from '@/hooks/useDebounce';
import { apiCall } from '@/utils/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Pagination } from '@/components/data-engine';
import type { SupportTicket, SupportReference } from '@mb/shared';
import { CreateSupportTicketSchema, DEFAULT_PAGE_SIZE, type PageSize } from '@mb/shared';
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
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Query</DialogTitle>
          <DialogDescription>
            Search a sale (MB-…), demand (DMD-…), expense (EXP-…), or stock (STK-…) ID. Its details
            load automatically — then describe the issue for the admin.
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

  // "Awaiting admin" is a work queue, not history — nobody should be able to
  // page past an old-but-still-open query and miss it, so it's fetched in full
  // (capped generously, not paginated). §21: this is live operational data.
  const [openTickets, setOpenTickets] = useState<SupportTicket[]>([]);
  const [openLoading, setOpenLoading] = useState(true);

  // "Resolved & rejected" is the unbounded part — this used to arrive as part
  // of the same flat `.limit(500)` fetch as the open queue (support.routes.ts),
  // so a branch with a long history downloaded and rendered all of it on every
  // visit. Now server-paged + server-searched, same shape as Finance Help Desk.
  const [historyTickets, setHistoryTickets] = useState<SupportTicket[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search.trim(), 350);

  const [showNew, setShowNew] = useState(false);
  const [newKey, setNewKey] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);

  // Page resets to 1 the moment someone edits the search box, not when the
  // debounced value later settles — the eventual query should always start on
  // its first page, and doing it here (an event handler) rather than an effect
  // keyed on the debounced value avoids a synchronous setState-in-effect.
  function handleSearchChange(value: string) {
    setSearch(value);
    setPage(1);
  }

  useEffect(() => {
    if (!token) return;
    void (async () => {
      try {
        const r = await apiCall<{ tickets: SupportTicket[] }>('/api/support?status=open&pageSize=100', {}, token);
        setOpenTickets(r.tickets);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Failed to load queries');
      } finally {
        setOpenLoading(false);
      }
    })();
  }, [token, refreshKey]);

  // Guards against an old page's response landing after a newer one — a fast
  // search edit or page change can resolve out of order over a slow connection.
  useEffect(() => {
    if (!token) return;
    let stale = false;
    void (async () => {
      setHistoryLoading(true);
      const params = new URLSearchParams({
        excludeStatus: 'open',
        page: String(page),
        pageSize: String(pageSize),
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      try {
        const r = await apiCall<{ tickets: SupportTicket[]; total: number }>(`/api/support?${params}`, {}, token);
        if (stale) return;
        setHistoryTickets(r.tickets);
        setHistoryTotal(r.total);
      } catch (err) {
        if (!stale) toast.error(err instanceof Error ? err.message : 'Failed to load history');
      } finally {
        if (!stale) setHistoryLoading(false);
      }
    })();
    return () => { stale = true; };
  }, [token, refreshKey, page, pageSize, debouncedSearch]);

  const loading = openLoading && historyLoading;
  const nothingAtAll = !openLoading && !historyLoading
    && openTickets.length === 0 && historyTickets.length === 0 && !debouncedSearch;

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
      ) : nothingAtAll ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
          <Headset className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No queries yet. Raise one with “New Query”.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {openTickets.length > 0 && (
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">Awaiting admin ({openTickets.length})</h3>
              {openTickets.map((t) => <TicketCard key={t.id} ticket={t} />)}
            </section>
          )}

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-muted-foreground">Resolved & rejected</h3>
              <div className="relative w-full max-w-[16rem]">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Search history…"
                  className="pl-8"
                />
              </div>
            </div>
            {historyLoading && historyTickets.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Loading…</p>
            ) : historyTickets.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                {debouncedSearch ? 'No history matches that search.' : 'No resolved or rejected queries yet.'}
              </p>
            ) : (
              <>
                {historyTickets.map((t) => <TicketCard key={t.id} ticket={t} />)}
                <Pagination
                  page={page}
                  pageSize={pageSize}
                  total={historyTotal}
                  onPageChange={setPage}
                  onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
                  loading={historyLoading}
                />
              </>
            )}
          </section>
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
