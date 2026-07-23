'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { DataTable } from '@/components/shared/DataTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import type { SupportTicket, SupportReference } from '@mb/shared';
import { createColumnHelper } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Eye, Pencil, SlidersHorizontal, Ban, Trash2, CheckCircle2 } from 'lucide-react';

const col = createColumnHelper<SupportTicket>();

const STATUS_VARIANT: Record<SupportTicket['status'], 'default' | 'secondary' | 'destructive'> = {
  open: 'default',
  resolved: 'secondary',
  rejected: 'destructive',
};

const TYPE_LABEL: Record<SupportReference['type'], string> = { sale: 'Sale', expense: 'Expense', stock: 'Stock' };

/** Read-only, type-aware detail table (auto-adjusts to whatever the reference is). */
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

type DialogMode = 'view' | 'edit' | 'change' | 'reject' | null;

export function SupportCenterPage() {
  const { token } = useAuth();
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [active, setActive] = useState<SupportTicket | null>(null);
  const [mode, setMode] = useState<DialogMode>(null);

  function reload() { setRefreshKey((k) => k + 1); }
  function openDialog(ticket: SupportTicket, m: DialogMode) { setActive(ticket); setMode(m); }
  function closeDialog() { setMode(null); setActive(null); }

  useEffect(() => {
    if (!token) return;
    apiCall<{ tickets: SupportTicket[] }>('/api/support', {}, token)
      .then((r) => setTickets(r.tickets))
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load tickets'))
      .finally(() => setLoading(false));
  }, [token, refreshKey]);

  async function handleDelete(ticket: SupportTicket) {
    if (!confirm(`Delete query ${ticket.ticketNumber}? This cannot be undone.`)) return;
    try {
      await apiCall(`/api/support/${ticket.id}`, { method: 'DELETE' }, token);
      toast.success('Query deleted');
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete');
    }
  }

  const openCount = useMemo(() => tickets.filter((t) => t.status === 'open').length, [tickets]);

  const columns = [
    col.accessor('ticketNumber', {
      header: 'Ticket',
      cell: (info) => <span className="font-mono text-xs">{info.getValue()}</span>,
    }),
    col.accessor('referenceId', {
      header: 'Reference',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Badge variant="outline">{TYPE_LABEL[row.original.referenceType]}</Badge>
          <span className="font-medium">{row.original.referenceId}</span>
        </div>
      ),
    }),
    col.accessor('branchName', {
      header: 'From',
      cell: ({ row }) => (
        <div className="text-sm">
          <p>{row.original.branchName || '—'}</p>
          <p className="text-xs text-muted-foreground capitalize">{(row.original.raisedByRole || '').replace('_', ' ')}</p>
        </div>
      ),
    }),
    col.accessor('message', {
      header: 'Issue',
      cell: (info) => <span className="text-sm line-clamp-2 max-w-[24rem]">{info.getValue()}</span>,
    }),
    col.accessor('status', {
      header: 'Status',
      cell: (info) => <Badge variant={STATUS_VARIANT[info.getValue()]} className="capitalize">{info.getValue()}</Badge>,
    }),
    col.display({
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const t = row.original;
        return (
          <div className="flex items-center gap-0.5 justify-end">
            <IconBtn title="View" onClick={() => openDialog(t, 'view')}><Eye className="h-3.5 w-3.5" /></IconBtn>
            <IconBtn title="Edit" onClick={() => openDialog(t, 'edit')}><Pencil className="h-3.5 w-3.5" /></IconBtn>
            <IconBtn title="Change figures" onClick={() => openDialog(t, 'change')}><SlidersHorizontal className="h-3.5 w-3.5" /></IconBtn>
            <IconBtn title="Reject" className="text-amber-600" onClick={() => openDialog(t, 'reject')}><Ban className="h-3.5 w-3.5" /></IconBtn>
            <IconBtn title="Delete" className="text-destructive" onClick={() => handleDelete(t)}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
          </div>
        );
      },
    }),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Support Center</h2>
          <p className="text-sm text-muted-foreground">
            {openCount} open · {tickets.length} total — resolve queries raised from branches & production.
          </p>
        </div>
      </div>

      <DataTable columns={columns} data={tickets} loading={loading} searchPlaceholder="Search tickets…" />

      {active && mode === 'view' && <ViewDialog ticket={active} onClose={closeDialog} onDone={() => { closeDialog(); reload(); }} />}
      {active && mode === 'edit' && <EditDialog ticket={active} onClose={closeDialog} onDone={() => { closeDialog(); reload(); }} />}
      {active && mode === 'change' && <ChangeDialog ticket={active} onClose={closeDialog} onDone={() => { closeDialog(); reload(); }} />}
      {active && mode === 'reject' && <RejectDialog ticket={active} onClose={closeDialog} onDone={() => { closeDialog(); reload(); }} />}
    </div>
  );
}

function IconBtn({ children, title, onClick, className }: { children: React.ReactNode; title: string; onClick: () => void; className?: string }) {
  return (
    <Button variant="ghost" size="icon" className={`h-8 w-8 ${className ?? ''}`} title={title} onClick={onClick}>
      {children}
    </Button>
  );
}

// --- View + Resolve --------------------------------------------------------
function ViewDialog({ ticket, onClose, onDone }: { ticket: SupportTicket; onClose: () => void; onDone: () => void }) {
  const { token } = useAuth();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function resolve() {
    setBusy(true);
    try {
      await apiCall(`/api/support/${ticket.id}/resolve`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved', resolutionNote: note }) }, token);
      toast.success('Query resolved');
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to resolve');
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {ticket.ticketNumber}
            <Badge variant={STATUS_VARIANT[ticket.status]} className="capitalize">{ticket.status}</Badge>
          </DialogTitle>
          <DialogDescription>
            {ticket.referenceId} · from {ticket.branchName || ticket.raisedByName || '—'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {ticket.referenceSnapshot && <ReferenceDetail reference={ticket.referenceSnapshot} />}
          <div>
            <Label className="text-xs text-muted-foreground">Issue</Label>
            <p className="text-sm">{ticket.message}</p>
          </div>
          {ticket.resolutionNote && (
            <div className="rounded-md bg-muted/50 px-3 py-2">
              <Label className="text-xs text-muted-foreground">Resolution</Label>
              <p className="text-sm">{ticket.resolutionNote}</p>
            </div>
          )}
          {ticket.status === 'open' && (
            <div className="space-y-1">
              <Label>Resolution note (optional)</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What was done" />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          {ticket.status === 'open' && (
            <Button onClick={resolve} disabled={busy}>
              <CheckCircle2 className="h-4 w-4 mr-1" /> {busy ? 'Resolving…' : 'Mark Resolved'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Edit ticket text ------------------------------------------------------
function EditDialog({ ticket, onClose, onDone }: { ticket: SupportTicket; onClose: () => void; onDone: () => void }) {
  const { token } = useAuth();
  const [message, setMessage] = useState(ticket.message);
  const [note, setNote] = useState(ticket.resolutionNote ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await apiCall(`/api/support/${ticket.id}`, { method: 'PATCH', body: JSON.stringify({ message, resolutionNote: note }) }, token);
      toast.success('Ticket updated');
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {ticket.ticketNumber}</DialogTitle>
          <DialogDescription>Adjust the issue text or add an internal note.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Issue</Label>
            <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} />
          </div>
          <div className="space-y-1">
            <Label>Note</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy || message.trim().length < 3}>{busy ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Change figures (live for expenses; recorded for sale/stock) -----------
function ChangeDialog({ ticket, onClose, onDone }: { ticket: SupportTicket; onClose: () => void; onDone: () => void }) {
  const { token } = useAuth();
  const ref = ticket.referenceSnapshot;
  const isLiveEdit = (ref?.editableFields.length ?? 0) > 0;

  // Editable rows: expense's editableFields, or (for sale/stock) the display
  // fields as recorded corrections.
  const rows = useMemo(() => {
    if (!ref) return [] as { key: string; label: string; value: string }[];
    return isLiveEdit
      ? ref.editableFields.map((f) => ({ key: f.key, label: f.label, value: String(f.value) }))
      : ref.fields.map((f) => ({ key: f.label, label: f.label, value: f.value }));
  }, [ref, isLiveEdit]);

  const initial = useMemo(() => Object.fromEntries(rows.map((r) => [r.key, r.value])), [rows]);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    // Only send fields the admin actually changed.
    const edits: Record<string, string> = {};
    for (const r of rows) if (values[r.key] !== initial[r.key]) edits[r.key] = values[r.key];
    if (Object.keys(edits).length === 0) { toast.error('Change at least one value'); return; }
    setBusy(true);
    try {
      const res = await apiCall<{ applied: boolean }>(`/api/support/${ticket.id}/figures`, { method: 'PATCH', body: JSON.stringify({ edits, note }) }, token);
      toast.success(res.applied ? 'Figures updated & query resolved' : 'Correction recorded & query resolved');
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to apply change');
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Change figures — {ticket.referenceId}</DialogTitle>
          <DialogDescription>
            {isLiveEdit
              ? 'Edits are written directly to the record and the query is resolved.'
              : 'Sales & stock figures are derived, so corrections here are recorded on the ticket for manual follow-up.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {rows.map((r) => {
            const editable = !isLiveEdit || ref!.editableFields.some((f) => f.key === r.key);
            return (
              <div key={r.key} className="space-y-1">
                <Label>{r.label}</Label>
                <Input
                  value={values[r.key] ?? ''}
                  disabled={!editable}
                  onChange={(e) => setValues((v) => ({ ...v, [r.key]: e.target.value }))}
                />
              </div>
            );
          })}
          <div className="space-y-1">
            <Label>Note (optional)</Label>
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Reason for the change" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy}>{busy ? 'Applying…' : 'Apply & Resolve'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Reject ----------------------------------------------------------------
function RejectDialog({ ticket, onClose, onDone }: { ticket: SupportTicket; onClose: () => void; onDone: () => void }) {
  const { token } = useAuth();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  async function reject() {
    setBusy(true);
    try {
      await apiCall(`/api/support/${ticket.id}/resolve`, { method: 'PATCH', body: JSON.stringify({ status: 'rejected', resolutionNote: note }) }, token);
      toast.success('Query rejected');
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reject');
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reject {ticket.ticketNumber}</DialogTitle>
          <DialogDescription>Let the raiser know why this query is being rejected.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label>Reason</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Why this can't be actioned" />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" onClick={reject} disabled={busy}>{busy ? 'Rejecting…' : 'Reject Query'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
