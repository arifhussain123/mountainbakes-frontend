'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AttachmentGallery } from '@/components/shared/AttachmentGallery';
import { PhotoCapture } from '@/components/shared/PhotoCapture';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Loader2,
  MessageSquare,
  Send,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import {
  FINANCE_AMENDABLE_FIELDS,
  FINANCE_AMENDMENT_ACTION_LABELS,
  FINANCE_QUERY_TYPE_LABELS,
  FINANCE_TICKET_REFERENCE_LABELS,
  FINANCE_TICKET_STATUS_LABELS,
  type Attachment,
  type FinanceAmendableField,
  type FinanceTicket,
  type FinanceTicketMessage,
  type FinanceTicketStatus,
} from '@mb/shared';
import { useFinanceMutation, useFinanceTicket } from '@/lib/finance';
import { useMoney } from './finance-ui';
import {
  QueryPriorityBadge,
  QueryStatusBadge,
  RecordFigures,
  formatQueryDate,
  useHelpDeskAbilities,
} from './help-desk-ui';

/**
 * The View popup (§5) and every Admin action that hangs off it (§14).
 *
 * One dialog for both sides of the desk rather than a Finance view and an Admin
 * view: it is the same query seen from two angles, and two components would
 * duplicate the query information, the referenced record and the conversation in
 * order to change which buttons sit at the bottom.
 *
 * Which buttons those are is decided by `useHelpDeskAbilities().admin`, and
 * every one of them calls an endpoint that decides the same thing again from the
 * JWT. Hiding a button is courtesy; `requireFinanceHelpDeskAdmin()` is the
 * boundary. See §14: "Do not rely only on hiding frontend buttons."
 */

// ---------------------------------------------------------------------------
// The moves an admin may make from here, mirroring FINANCE_TICKET_TRANSITIONS
// on the API. The API refuses anything else; this only decides what to offer.
// ---------------------------------------------------------------------------
const NEXT_STATUSES: Record<FinanceTicketStatus, FinanceTicketStatus[]> = {
  open: ['under_review', 'resolved', 'rejected'],
  under_review: ['waiting_for_information', 'resolved', 'rejected'],
  waiting_for_information: ['under_review', 'resolved', 'rejected'],
  resolved: ['closed'],
  rejected: ['closed'],
  closed: [],
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium">{children}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Conversation (§17)
// ---------------------------------------------------------------------------

function Conversation({
  ticket,
  onPosted,
}: {
  ticket: FinanceTicket;
  onPosted: () => void;
}) {
  const abilities = useHelpDeskAbilities();
  const mutation = useFinanceMutation();
  const [body, setBody] = useState('');
  const [photos, setPhotos] = useState<Attachment[]>([]);

  const messages = ticket.messages ?? [];
  const closed = ticket.status === 'closed' || Boolean(ticket.deletedAt);

  async function post() {
    const text = body.trim();
    if (!text) return;
    try {
      await mutation.mutateAsync({
        path: `/api/finance/tickets/${ticket.id}/messages`,
        body: { body: text, attachmentIds: photos.map((p) => p.id) },
      });
      setBody('');
      setPhotos([]);
      onPosted();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not post the message');
    }
  }

  return (
    <section className="space-y-3">
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        <MessageSquare className="h-4 w-4" /> Conversation
        {messages.length > 0 && <span className="text-muted-foreground">({messages.length})</span>}
      </h4>

      {messages.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing yet. {abilities.admin ? 'Ask the raiser for anything you need.' : 'Add anything that would help the Admin.'}
        </p>
      ) : (
        <ol className="space-y-3">
          {messages.map((m: FinanceTicketMessage) => (
            <li
              key={m.id}
              className={
                // The admin's replies sit on the accent; the raiser's stay plain.
                // Alignment is deliberately NOT used to separate them — a chat
                // layout on a record that gets printed and audited reads badly,
                // and the role label is the thing that actually matters.
                m.authorSide === 'admin'
                  ? 'rounded-lg border border-primary/30 bg-primary/5 p-3'
                  : 'rounded-lg border p-3'
              }
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  {m.authorName}{' '}
                  <Badge variant="outline" className="ml-1 capitalize">
                    {m.authorSide === 'admin' ? 'Admin' : (m.authorRole ?? 'finance').replace(/_/g, ' ')}
                  </Badge>
                </p>
                <p className="text-xs text-muted-foreground">{formatQueryDate(m.createdAt)}</p>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{m.body}</p>
              <AttachmentGallery attachments={m.attachments} size="xs" className="mt-2" />
            </li>
          ))}
        </ol>
      )}

      {closed ? (
        <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
          {ticket.deletedAt
            ? 'This query has been deleted. The conversation is kept on record.'
            : 'This query is closed. Raise a new query for anything further.'}
        </p>
      ) : (
        <div className="space-y-2 rounded-lg border p-3">
          <Label htmlFor="hd-reply">
            {abilities.admin ? 'Reply to the raiser' : 'Add information'}
          </Label>
          <Textarea
            id="hd-reply"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder={
              abilities.admin
                ? 'What you found, or what you need from them'
                : 'Anything that helps the Admin investigate'
            }
          />
          <PhotoCapture
            entity="finance_ticket_message"
            value={photos}
            onChange={setPhotos}
            label="Supporting document"
            hint="Optional"
          />
          <div className="flex justify-end">
            <Button size="sm" disabled={mutation.isPending || !body.trim()} onClick={() => void post()}>
              {mutation.isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-1 h-4 w-4" />
              )}
              Send
            </Button>
          </div>
          {ticket.status === 'waiting_for_information' && !abilities.admin && (
            <p className="text-xs text-muted-foreground">
              The Admin is waiting on you. Sending this marks the information as received and puts the
              query back under review.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Amend / Overwrite (§9, §11)
// ---------------------------------------------------------------------------

/**
 * The Admin's correction form.
 *
 * `amend` and `overwrite` are the same write with different ceremony, which is
 * the brief's own distinction: §9 amends a record, §11 requires an explicit
 * acknowledgement before an APPROVED one is written over. The confirmation is
 * sent to the server rather than being a dialog the API cannot see — a checkbox
 * that never leaves the browser guards nothing.
 */
function AmendDialog({
  ticket,
  live,
  onClose,
  onDone,
}: {
  ticket: FinanceTicket;
  live: Record<string, unknown> | null | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const mutation = useFinanceMutation();
  const { format } = useMoney();

  const fields: FinanceAmendableField[] = ticket.referenceType
    ? (FINANCE_AMENDABLE_FIELDS[ticket.referenceType] ?? [])
    : [];

  const [fieldKey, setFieldKey] = useState(fields[0]?.key ?? '');
  const [newValue, setNewValue] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const spec = fields.find((f) => f.key === fieldKey);
  const current = live?.[fieldKey];
  const currentText = current === undefined || current === null ? '' : String(current);

  // The brief's §11 warning is shown when the record is already APPROVED or in
  // the book — those are the states where a change is an overwrite of something
  // somebody signed off, rather than an edit of a draft.
  const status = String(live?.['status'] ?? '');
  const isApproved = ['approved', 'posted', 'locked'].includes(status);
  const action = isApproved ? 'overwrite' : 'amend';

  // Plain arithmetic on three values that are already in scope — no useMemo.
  // Wrapping it defeated the React Compiler ("existing memoization could not be
  // preserved"), which is a worse outcome than the nothing it was saving.
  const difference = (() => {
    if (spec?.kind !== 'money') return null;
    const a = Number(currentText);
    const b = Number(newValue);
    if (!Number.isFinite(a) || !Number.isFinite(b) || newValue.trim() === '') return null;
    return b - a;
  })();

  async function submit() {
    if (!spec) return;
    try {
      await mutation.mutateAsync({
        path: `/api/finance/tickets/${ticket.id}/amend`,
        body: {
          action,
          field: fieldKey,
          newValue: newValue.trim(),
          reason: reason.trim(),
          ...(action === 'overwrite' ? { confirmOverwrite: confirmed } : {}),
        },
      });
      toast.success(`${ticket.referenceNo} corrected`);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The correction could not be applied');
    }
  }

  const blocked =
    mutation.isPending ||
    !spec ||
    newValue.trim() === '' ||
    reason.trim().length < 3 ||
    (action === 'overwrite' && !confirmed);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {action === 'overwrite' ? 'Overwrite' : 'Amend'} {ticket.referenceNo}
          </DialogTitle>
          <DialogDescription>
            Recorded against {ticket.queryNo} in the audit trail, with the original value, the new
            value and your reason.
          </DialogDescription>
        </DialogHeader>

        {fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing on this record can be changed directly.
          </p>
        ) : (
          <div className="space-y-4">
            {isApproved && (
              <div className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <p>
                  <span className="font-semibold">Warning:</span> you are about to modify an approved
                  financial record. This action will be recorded in the audit trail.
                </p>
              </div>
            )}

            <div className="space-y-1">
              <Label htmlFor="amend-field">Field</Label>
              <select
                id="amend-field"
                value={fieldKey}
                onChange={(e) => {
                  setFieldKey(e.target.value);
                  setNewValue('');
                }}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
              {spec?.movesLedger && (
                <p className="text-xs text-muted-foreground">
                  This figure is in the cash book. Correcting it posts a reversal of the original
                  voucher and a corrected entry beside it — the original stays visible.
                </p>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Original value</Label>
                <Input value={currentText || '—'} readOnly className="bg-muted tabular-nums" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="amend-value">New value</Label>
                <Input
                  id="amend-value"
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  inputMode={spec?.kind === 'money' ? 'decimal' : 'text'}
                  className="tabular-nums"
                  autoFocus
                />
              </div>
            </div>

            {difference !== null && difference !== 0 && (
              <p className="text-sm">
                <span className="text-muted-foreground">Difference: </span>
                <span className={difference < 0 ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'}>
                  {difference > 0 ? '+' : '−'} {format(Math.abs(difference))}
                </span>
              </p>
            )}

            <div className="space-y-1">
              <Label htmlFor="amend-reason">Reason</Label>
              <Textarea
                id="amend-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="e.g. Incorrect branch collection entered"
              />
            </div>

            {action === 'overwrite' && (
              <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  I understand this modifies an approved financial record, and that it will be
                  recorded in the audit trail against {ticket.queryNo}.
                </span>
              </label>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={action === 'overwrite' ? 'destructive' : 'default'}
            disabled={blocked}
            onClick={() => void submit()}
          >
            {mutation.isPending ? 'Applying…' : action === 'overwrite' ? 'Overwrite record' : 'Apply amendment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Delete the referenced record (§10) — soft, always
// ---------------------------------------------------------------------------

function DeleteRecordDialog({
  ticket,
  onClose,
  onDone,
}: {
  ticket: FinanceTicket;
  onClose: () => void;
  onDone: () => void;
}) {
  const mutation = useFinanceMutation();
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  async function submit() {
    try {
      await mutation.mutateAsync({
        path: `/api/finance/tickets/${ticket.id}/record`,
        method: 'DELETE',
        body: { reason: reason.trim(), confirmDelete: true },
      });
      toast.success(`${ticket.referenceNo} deleted`);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The record could not be deleted');
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>Delete {ticket.referenceNo}?</DialogTitle>
          <DialogDescription>
            The record is removed from the books but kept on file — it stays readable to an Admin,
            stamped with your name, your reason and {ticket.queryNo}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <p>
              <span className="font-semibold">Warning:</span> you are about to modify an approved
              financial record. This action will be recorded in the audit trail.
              {ticket.referenceType === 'ledger_entry' && (
                <>
                  {' '}
                  This is a posted voucher: deleting it recomputes the running balance on every later
                  entry. To correct a wrong figure without that, cancel and use Amend instead — it
                  posts a reversal and a corrected entry, and the original stays visible.
                </>
              )}
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="del-reason">Reason</Label>
            <Textarea
              id="del-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Why this record should not be in the books"
              autoFocus
            />
          </div>

          <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            <span>I confirm this financial record should be deleted.</span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={mutation.isPending || reason.trim().length < 3 || !confirmed}
            onClick={() => void submit()}
          >
            {mutation.isPending ? 'Deleting…' : 'Delete record'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Move the query along (§8)
// ---------------------------------------------------------------------------

function StatusDialog({
  ticket,
  target,
  onClose,
  onDone,
}: {
  ticket: FinanceTicket;
  target: FinanceTicketStatus;
  onClose: () => void;
  onDone: () => void;
}) {
  const mutation = useFinanceMutation();
  const [response, setResponse] = useState('');
  const [note, setNote] = useState('');

  const terminal = target === 'resolved' || target === 'rejected';
  const label = FINANCE_TICKET_STATUS_LABELS[target];

  async function submit() {
    try {
      await mutation.mutateAsync({
        path: `/api/finance/tickets/${ticket.id}/status`,
        method: 'PATCH',
        body: {
          status: target,
          ...(response.trim() ? { adminResponse: response.trim() } : {}),
          ...(note.trim() ? { resolutionNote: note.trim() } : {}),
        },
      });
      toast.success(`${ticket.queryNo} — ${label}`);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The query could not be updated');
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {label} — {ticket.queryNo}
          </DialogTitle>
          <DialogDescription>
            {target === 'under_review'
              ? 'Marks the query as being investigated. The raiser sees the change.'
              : target === 'waiting_for_information'
                ? 'Asks the raiser for more. Their next message puts it back under review automatically.'
                : target === 'closed'
                  ? 'Files the query. Nothing further can be added to it.'
                  : 'Your response goes back to whoever raised it. A query is not reopened — a further problem with the same record is a new query.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="st-response">
              Admin response{terminal ? '' : ' (optional)'}
            </Label>
            <Textarea
              id="st-response"
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              rows={3}
              placeholder={
                target === 'waiting_for_information'
                  ? 'What do you need from them?'
                  : 'What you found, or what was done'
              }
              autoFocus
            />
          </div>

          {terminal && (
            <div className="space-y-1">
              <Label htmlFor="st-note">Resolution details (optional)</Label>
              <Textarea
                id="st-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                placeholder="Any further detail for the record"
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant={target === 'rejected' ? 'destructive' : 'default'}
            disabled={mutation.isPending || (terminal && !response.trim() && !note.trim())}
            onClick={() => void submit()}
          >
            {mutation.isPending ? 'Saving…' : label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// The View popup itself (§5)
// ---------------------------------------------------------------------------

export function FinanceQueryDetailDialog({
  ticketId,
  onClose,
}: {
  ticketId: string;
  onClose: () => void;
}) {
  const abilities = useHelpDeskAbilities();
  const { data: ticket, isLoading, refetch } = useFinanceTicket(ticketId);
  const [amending, setAmending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [statusTarget, setStatusTarget] = useState<FinanceTicketStatus | null>(null);

  const live = (ticket as (FinanceTicket & { liveRecord?: Record<string, unknown> | null }) | undefined)
    ?.liveRecord;

  const canTouchRecord =
    abilities.admin &&
    Boolean(ticket?.referenceType) &&
    Boolean(ticket?.referenceId) &&
    !ticket?.deletedAt;

  const recordDeleted = Boolean(live?.['deletedAt']);

  return (
    <>
      <Dialog open onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto md:max-w-3xl">
          {isLoading || !ticket ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading query…
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{ticket.queryNo}</span>
                  <QueryStatusBadge status={ticket.status} />
                  <QueryPriorityBadge priority={ticket.priority} />
                  {ticket.deletedAt && <Badge variant="destructive">Deleted</Badge>}
                </DialogTitle>
                <DialogDescription>{ticket.subject}</DialogDescription>
              </DialogHeader>

              <div className="space-y-6">
                {/* ---- Query Information ---- */}
                <section className="space-y-3">
                  <h4 className="text-sm font-semibold">Query Information</h4>
                  <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <Field label="Date &amp; time">{formatQueryDate(ticket.createdAt)}</Field>
                    <Field label="Finance user">{ticket.raisedByName || '—'}</Field>
                    <Field label="Query type">{FINANCE_QUERY_TYPE_LABELS[ticket.queryType]}</Field>
                    <Field label="Reference ID">{ticket.referenceNo || '—'}</Field>
                    <Field label="Ledger / Voucher ID">{ticket.voucherRef || '—'}</Field>
                    <Field label="Record type">
                      {ticket.referenceType
                        ? FINANCE_TICKET_REFERENCE_LABELS[ticket.referenceType]
                        : '—'}
                    </Field>
                    {ticket.assignedToName && (
                      <Field label="Assigned to">{ticket.assignedToName}</Field>
                    )}
                  </dl>

                  <div>
                    <p className="text-xs text-muted-foreground">Description</p>
                    <p className="whitespace-pre-wrap text-sm">{ticket.message}</p>
                  </div>

                  <AttachmentGallery
                    attachments={ticket.attachments}
                    title="Attachment"
                    emptyText="No attachments"
                  />
                </section>

                <Separator />

                {/* ---- The record it is about ---- */}
                {ticket.referenceNo && (
                  <section className="space-y-3">
                    <h4 className="text-sm font-semibold">Referenced record</h4>
                    <RecordFigures
                      record={ticket.referenceSnapshot}
                      heading={`As raised · ${ticket.referenceNo}`}
                    />
                    {/* Admin-only, and only worth showing when it says something
                        the snapshot does not: the live row after a correction, or
                        the fact that the record has since been deleted. */}
                    {abilities.admin && live && (
                      <RecordFigures record={live} heading={`Now · ${ticket.referenceNo}`} />
                    )}
                    {!abilities.admin && (
                      <p className="text-xs text-muted-foreground">
                        These are the figures as they stood when you raised the query. Only an Admin
                        can change them.
                      </p>
                    )}
                  </section>
                )}

                {/* ---- Admin Response ---- */}
                {(ticket.adminResponse || ticket.resolutionNote || ticket.resolvedAt) && (
                  <>
                    <Separator />
                    <section className="space-y-2">
                      <h4 className="flex items-center gap-2 text-sm font-semibold">
                        <ShieldCheck className="h-4 w-4" /> Admin Response
                      </h4>
                      {ticket.adminResponse && (
                        <p className="whitespace-pre-wrap rounded-md bg-muted/60 px-3 py-2 text-sm">
                          {ticket.adminResponse}
                        </p>
                      )}
                      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                        <Field label="Admin">
                          {ticket.respondedByName || ticket.resolvedByName || '—'}
                        </Field>
                        <Field label="Responded">
                          {formatQueryDate(ticket.respondedAt ?? ticket.resolvedAt)}
                        </Field>
                        <Field label="Status">{FINANCE_TICKET_STATUS_LABELS[ticket.status]}</Field>
                      </dl>
                      {ticket.resolutionNote && (
                        <div>
                          <p className="text-xs text-muted-foreground">Resolution details</p>
                          <p className="whitespace-pre-wrap text-sm">{ticket.resolutionNote}</p>
                        </div>
                      )}
                    </section>
                  </>
                )}

                {/* ---- What was actually changed (§12) ---- */}
                {(ticket.amendments?.length ?? 0) > 0 && (
                  <>
                    <Separator />
                    <section className="space-y-2">
                      <h4 className="text-sm font-semibold">Corrections made under this query</h4>
                      <ul className="space-y-2">
                        {ticket.amendments!.map((a) => (
                          <li key={a.id} className="rounded-lg border p-3 text-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="font-medium">
                                <Badge variant="outline" className="mr-2">
                                  {FINANCE_AMENDMENT_ACTION_LABELS[a.action]}
                                </Badge>
                                {a.referenceNo} · {a.field}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {a.adminName} · {formatQueryDate(a.createdAt)}
                              </span>
                            </div>
                            <p className="mt-1 tabular-nums">
                              <span className="text-muted-foreground">{a.originalValue ?? '—'}</span>
                              {' → '}
                              <span className="font-medium">{a.newValue ?? '—'}</span>
                              {a.difference !== null && a.difference !== 0 && (
                                <span
                                  className={
                                    a.difference < 0
                                      ? 'ml-2 text-destructive'
                                      : 'ml-2 text-emerald-600 dark:text-emerald-400'
                                  }
                                >
                                  ({a.difference > 0 ? '+' : '−'}
                                  {Math.abs(a.difference).toLocaleString('en-PK', {
                                    minimumFractionDigits: 2,
                                    maximumFractionDigits: 2,
                                  })}
                                  )
                                </span>
                              )}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">Reason: {a.reason}</p>
                          </li>
                        ))}
                      </ul>
                    </section>
                  </>
                )}

                <Separator />

                <Conversation ticket={ticket} onPosted={() => void refetch()} />
              </div>

              {/* ---- Admin actions (§14). Absent entirely for a Finance user. ---- */}
              <DialogFooter className="flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between">
                {abilities.admin ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={!canTouchRecord || recordDeleted}
                        title={
                          !canTouchRecord
                            ? 'This query names no finance record'
                            : recordDeleted
                              ? 'That record has already been deleted'
                              : undefined
                        }
                        onClick={() => setAmending(true)}
                      >
                        Amend
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={!canTouchRecord || recordDeleted}
                        onClick={() => setDeleting(true)}
                      >
                        <Trash2 className="mr-1 h-4 w-4" /> Delete record
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {NEXT_STATUSES[ticket.status].map((s) => (
                        <Button
                          key={s}
                          size="sm"
                          variant={s === 'rejected' ? 'destructive' : s === 'resolved' ? 'default' : 'secondary'}
                          disabled={Boolean(ticket.deletedAt)}
                          onClick={() => setStatusTarget(s)}
                        >
                          {FINANCE_TICKET_STATUS_LABELS[s]}
                        </Button>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Only an Admin can change the financial record behind this query. Add anything
                    useful to the conversation above.
                  </p>
                )}
                <Button variant="ghost" onClick={onClose}>
                  Close
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {ticket && amending && (
        <AmendDialog
          ticket={ticket}
          live={live}
          onClose={() => setAmending(false)}
          onDone={() => {
            setAmending(false);
            void refetch();
          }}
        />
      )}
      {ticket && deleting && (
        <DeleteRecordDialog
          ticket={ticket}
          onClose={() => setDeleting(false)}
          onDone={() => {
            setDeleting(false);
            void refetch();
          }}
        />
      )}
      {ticket && statusTarget && (
        <StatusDialog
          ticket={ticket}
          target={statusTarget}
          onClose={() => setStatusTarget(null)}
          onDone={() => {
            setStatusTarget(null);
            void refetch();
          }}
        />
      )}
    </>
  );
}
