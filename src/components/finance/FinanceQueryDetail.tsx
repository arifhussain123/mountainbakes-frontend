'use client';

import { useEffect, useState } from 'react';
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
  Pencil,
  RotateCcw,
  Send,
  ShieldCheck,
  Trash2,
  UserCog,
} from 'lucide-react';
import {
  FINANCE_AMENDABLE_FIELDS,
  FINANCE_AMENDMENT_ACTION_LABELS,
  FINANCE_QUERY_PRIORITIES,
  FINANCE_QUERY_PRIORITY_LABELS,
  FINANCE_QUERY_TYPES,
  FINANCE_QUERY_TYPE_LABELS,
  FINANCE_RESOLUTION_TYPES,
  FINANCE_RESOLUTION_TYPE_LABELS,
  FINANCE_TICKET_REFERENCE_LABELS,
  FINANCE_TICKET_STATUS_LABELS,
  financeHelpDeskCan,
  type Attachment,
  type FinanceAmendableField,
  type FinanceQueryPriority,
  type FinanceQueryType,
  type FinanceResolutionType,
  type FinanceTicket,
  type FinanceTicketMessage,
  type FinanceTicketStatus,
} from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
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
  under_review: ['waiting_for_finance', 'resolved', 'rejected'],
  waiting_for_finance: ['under_review', 'resolved', 'rejected'],
  reopened: ['under_review', 'waiting_for_finance', 'resolved', 'rejected'],
  resolved: ['closed'],
  rejected: ['closed'],
  closed: [],
};

/**
 * Reopen is NOT in the table above, for the same reason it is not in
 * FINANCE_TICKET_TRANSITIONS on the API: it is not a status move, it is the undo
 * of one, and it goes to its own endpoint so the resolution it overturns is
 * archived in the same write that clears it. It gets its own button.
 */
const REOPENABLE: readonly FinanceTicketStatus[] = ['resolved', 'rejected', 'closed'];

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
          {ticket.status === 'waiting_for_finance' && !abilities.admin && (
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
  // §11's Resolution Type. Defaulted to the one that matches the move being
  // made — a Reject is a rejection — so the common case is one click, and the
  // admin only has to think about it when it is a Duplicate or an Other.
  const [resolutionType, setResolutionType] = useState<FinanceResolutionType>(
    target === 'rejected' ? 'rejected' : 'fixed',
  );

  const terminal = target === 'resolved' || target === 'rejected';
  const label = FINANCE_TICKET_STATUS_LABELS[target];

  async function submit() {
    try {
      await mutation.mutateAsync({
        path: `/api/finance/tickets/${ticket.id}/status`,
        method: 'PATCH',
        body: {
          status: target,
          ...(terminal ? { resolutionType } : {}),
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
              : target === 'waiting_for_finance'
                ? 'Asks the raiser for more. Their next message puts it back under review automatically.'
                : target === 'closed'
                  ? 'Files the query. Nothing further can be added to it.'
                  : 'Your response goes back to whoever raised it. It can be reopened later, and the answer you give here is kept if it is.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {terminal && (
            <div className="space-y-1">
              <Label htmlFor="st-resolution-type">Resolution type</Label>
              <select
                id="st-resolution-type"
                value={resolutionType}
                onChange={(e) => setResolutionType(e.target.value as FinanceResolutionType)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {FINANCE_RESOLUTION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {FINANCE_RESOLUTION_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
          )}

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
                target === 'waiting_for_finance'
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
// Edit / Amend the QUERY itself (§6, §8)
// ---------------------------------------------------------------------------

/**
 * The admin changing the query — its subject, description, category, priority —
 * as distinct from AmendDialog below, which changes the RECORD the query is
 * about. Both are §6 controls and they are constantly confused, so they are two
 * dialogs with two verbs rather than one form with a mode.
 *
 * `reason` is mandatory whenever anything the RAISER can see changes (§8): the
 * previous values go to the audit trail either way, but a previous value with no
 * stated reason tells the next reader what the query used to say and nothing
 * about why it stopped saying it. The API re-checks this — the field is not
 * enforced by being marked required in the markup.
 *
 * The internal note is the one field here the raiser never sees, so an edit that
 * only touches it needs no reason and sends no notification. The API decides
 * that from the same rule; this form just stops demanding the field.
 */
function EditQueryDialog({
  ticket,
  onClose,
  onDone,
}: {
  ticket: FinanceTicket;
  onClose: () => void;
  onDone: () => void;
}) {
  const mutation = useFinanceMutation();
  const [subject, setSubject] = useState(ticket.subject);
  const [message, setMessage] = useState(ticket.message);
  const [queryType, setQueryType] = useState<FinanceQueryType>(ticket.queryType);
  const [priority, setPriority] = useState<FinanceQueryPriority>(ticket.priority);
  const [internalNote, setInternalNote] = useState(ticket.internalNote ?? '');
  const [reason, setReason] = useState('');

  const raiserVisibleChanged =
    subject.trim() !== ticket.subject ||
    message.trim() !== ticket.message ||
    queryType !== ticket.queryType ||
    priority !== ticket.priority;
  const noteChanged = internalNote.trim() !== (ticket.internalNote ?? '');
  const changed = raiserVisibleChanged || noteChanged;

  async function submit() {
    try {
      await mutation.mutateAsync({
        path: `/api/finance/tickets/${ticket.id}`,
        method: 'PATCH',
        body: {
          ...(subject.trim() !== ticket.subject ? { subject: subject.trim() } : {}),
          ...(message.trim() !== ticket.message ? { message: message.trim() } : {}),
          ...(queryType !== ticket.queryType ? { queryType } : {}),
          ...(priority !== ticket.priority ? { priority } : {}),
          ...(noteChanged ? { internalNote: internalNote.trim() } : {}),
          ...(reason.trim() ? { reason: reason.trim() } : {}),
        },
      });
      toast.success(`${ticket.queryNo} updated`);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The query could not be updated');
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto md:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {ticket.queryNo}</DialogTitle>
          <DialogDescription>
            Changes the query, not the financial record behind it — use Amend for that. Every
            previous value is kept in the audit history.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="eq-type">Category</Label>
              <select
                id="eq-type"
                value={queryType}
                onChange={(e) => setQueryType(e.target.value as FinanceQueryType)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {FINANCE_QUERY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {FINANCE_QUERY_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="eq-priority">Priority</Label>
              <select
                id="eq-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as FinanceQueryPriority)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {FINANCE_QUERY_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {FINANCE_QUERY_PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="eq-subject">Subject</Label>
            <Input id="eq-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label htmlFor="eq-message">Description</Label>
            <Textarea
              id="eq-message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="eq-note">Internal note</Label>
            <Textarea
              id="eq-note"
              value={internalNote}
              onChange={(e) => setInternalNote(e.target.value)}
              rows={2}
              placeholder="Admin-only. The raiser never sees this."
            />
          </div>

          {raiserVisibleChanged && (
            <div className="space-y-1">
              <Label htmlFor="eq-reason">Reason for the change</Label>
              <Input
                id="eq-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Recategorised — this is a salary query, not a ledger one"
              />
              <p className="text-xs text-muted-foreground">
                Required: the raiser is told their query changed, and this is what they are told.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              mutation.isPending ||
              !changed ||
              subject.trim().length < 3 ||
              message.trim().length < 3 ||
              (raiserVisibleChanged && !reason.trim())
            }
            onClick={() => void submit()}
          >
            {mutation.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Assign (§6's "change assigned user")
// ---------------------------------------------------------------------------

/**
 * Hands the query to an admin, or takes it.
 *
 * The list is `/api/users` filtered to the roles that can actually action a
 * query — the API refuses any other assignee outright, and offering a name it
 * will reject is a worse experience than not offering it. `/api/users` is itself
 * super_admin-only, which is the same audience as this dialog, so a Finance user
 * never reaches the fetch.
 */
function AssignDialog({
  ticket,
  onClose,
  onDone,
}: {
  ticket: FinanceTicket;
  onClose: () => void;
  onDone: () => void;
}) {
  const { token } = useAuth();
  const mutation = useFinanceMutation();
  const [admins, setAdmins] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignedTo, setAssignedTo] = useState<string>(ticket.assignedTo ?? '');

  useEffect(() => {
    let cancelled = false;
    apiCall<{ users: { id: string; name?: string; email: string; role: string; active?: boolean }[] }>(
      '/api/users',
      {},
      token,
    )
      .then((res) => {
        if (cancelled) return;
        setAdmins(
          (res.users ?? [])
            .filter((u) => financeHelpDeskCan(u.role, 'respond') && u.active !== false)
            .map((u) => ({ id: u.id, label: u.name || u.email })),
        );
      })
      .catch(() => {
        if (!cancelled) setAdmins([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function submit() {
    try {
      await mutation.mutateAsync({
        path: `/api/finance/tickets/${ticket.id}/assign`,
        method: 'PATCH',
        body: { assignedTo: assignedTo || null },
      });
      toast.success(assignedTo ? `${ticket.queryNo} assigned` : `${ticket.queryNo} unassigned`);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The query could not be assigned');
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>Assign {ticket.queryNo}</DialogTitle>
          <DialogDescription>
            Only an Admin can action a Help Desk query, so only Admins appear here.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <Label htmlFor="as-admin">Assigned admin</Label>
          <select
            id="as-admin"
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
            disabled={loading}
            className="h-9 w-full rounded-md border bg-background px-2 text-sm"
          >
            <option value="">Unassigned</option>
            {admins.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={mutation.isPending || loading || assignedTo === (ticket.assignedTo ?? '')}
            onClick={() => void submit()}
          >
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Delete the QUERY (§10) — soft, always
// ---------------------------------------------------------------------------

/**
 * Not the same button as "Delete record" below it, and the difference matters:
 * this removes the QUERY from the desk; that one deletes the finance record the
 * query is about. Deleting the query leaves the record untouched.
 *
 * Soft, like everything else here. The row is stamped, not removed, and stays
 * visible to an Admin through the queue's "include deleted" view — which is what
 * keeps `finance_amendments.ticket_id` (NOT NULL, ON DELETE RESTRICT) able to
 * trace every correction back to the query that justified it.
 */
function DeleteQueryDialog({
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
        path: `/api/finance/tickets/${ticket.id}`,
        method: 'DELETE',
        body: { reason: reason.trim(), confirmDelete: true },
      });
      toast.success(`${ticket.queryNo} deleted`);
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The query could not be deleted');
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>Delete query?</DialogTitle>
          <DialogDescription>
            <span className="font-mono">{ticket.queryNo}</span> — {ticket.subject}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="space-y-1">
              <p>
                The query is marked deleted and leaves the desk. It is not erased: an Admin can still
                read it, and any correction made under it keeps pointing at it.
              </p>
              <p className="text-muted-foreground">
                The financial record this query is about is <strong>not</strong> touched. To delete
                that, cancel and use Delete record instead.
              </p>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="dq-reason">Reason</Label>
            <Textarea
              id="dq-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Why is this query being removed from the desk?"
              autoFocus
            />
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <span>I want to delete this query.</span>
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
            {mutation.isPending ? 'Deleting…' : 'Delete query'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Reopen (§12)
// ---------------------------------------------------------------------------

/**
 *     RESOLVED  →  REOPENED  →  UNDER_REVIEW
 *
 * One dialog, two outcomes, and the copy says which is about to happen: an Admin
 * reopens the query; a Finance raiser records a REQUEST and the Admin decides.
 * The endpoint is the same for both and works it out from the JWT — this only
 * decides what to promise.
 *
 * The reason is required on both paths. The resolution being overturned is
 * archived intact, so the query keeps every answer it was ever given; without a
 * reason beside each one, that history says an answer was rejected and not why,
 * which is the half that matters when it is reopened a second time.
 */
function ReopenDialog({
  ticket,
  isAdmin,
  onClose,
  onDone,
}: {
  ticket: FinanceTicket;
  isAdmin: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const mutation = useFinanceMutation();
  const [reason, setReason] = useState('');

  async function submit() {
    try {
      await mutation.mutateAsync({
        path: `/api/finance/tickets/${ticket.id}/reopen`,
        method: 'POST',
        body: { reason: reason.trim() },
      });
      toast.success(isAdmin ? `${ticket.queryNo} reopened` : 'Reopen requested — the Admin has been notified');
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The query could not be reopened');
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isAdmin ? 'Reopen' : 'Request reopen'} — {ticket.queryNo}
          </DialogTitle>
          <DialogDescription>
            {isAdmin
              ? 'The query goes back to Reopened and can be answered again. The current resolution is kept in full and stays readable in the history.'
              : 'Asks the Admin to look at this again. The query stays as it is until they do.'}
          </DialogDescription>
        </DialogHeader>

        {(ticket.adminResponse || ticket.resolutionNote) && (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm">
            <p className="text-xs text-muted-foreground">
              The resolution being disputed
              {ticket.resolutionType
                ? ` · ${FINANCE_RESOLUTION_TYPE_LABELS[ticket.resolutionType]}`
                : ''}
            </p>
            <p className="mt-1 whitespace-pre-wrap">
              {ticket.adminResponse ?? ticket.resolutionNote}
            </p>
          </div>
        )}

        <div className="space-y-1">
          <Label htmlFor="ro-reason">Reason</Label>
          <Textarea
            id="ro-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="What is still wrong with this?"
            autoFocus
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={mutation.isPending || reason.trim().length < 3}
            onClick={() => void submit()}
          >
            {mutation.isPending
              ? 'Sending…'
              : isAdmin
                ? 'Reopen query'
                : 'Request reopen'}
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
  const { user } = useAuth();
  const { data: ticket, isLoading, refetch } = useFinanceTicket(ticketId);
  const [amending, setAmending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [deletingQuery, setDeletingQuery] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [statusTarget, setStatusTarget] = useState<FinanceTicketStatus | null>(null);

  const live = (ticket as (FinanceTicket & { liveRecord?: Record<string, unknown> | null }) | undefined)
    ?.liveRecord;

  const canTouchRecord =
    abilities.admin &&
    Boolean(ticket?.referenceType) &&
    Boolean(ticket?.referenceId) &&
    !ticket?.deletedAt;

  const recordDeleted = Boolean(live?.['deletedAt']);
  const queryDeleted = Boolean(ticket?.deletedAt);

  // §12. An admin reopens; the raiser asks. Both are offered only from a
  // terminal status, and never on a query that has been deleted — reopening a
  // deleted query would put a row the desk considers gone back on the queue.
  const terminal = ticket ? REOPENABLE.includes(ticket.status) : false;
  const canReopen = abilities.admin && terminal && !queryDeleted;
  const canRequestReopen =
    !abilities.admin && terminal && !queryDeleted && ticket?.raisedBy === user?.uid;

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
                        {ticket.resolutionType && (
                          <Field label="Resolution type">
                            {FINANCE_RESOLUTION_TYPE_LABELS[ticket.resolutionType]}
                          </Field>
                        )}
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

                {/* ---- Previous resolutions (§12) ----

                    Only rendered once a query has been reopened, because that is
                    the only way an entry gets here. Each one is an answer that
                    was given and then overturned, and it is shown WITH the
                    reason it was overturned — a history of rejected answers with
                    no reasons beside them says the desk got it wrong twice and
                    nothing about how. */}
                {ticket.resolutionHistory.length > 0 && (
                  <>
                    <Separator />
                    <section className="space-y-2">
                      <h4 className="flex items-center gap-2 text-sm font-semibold">
                        <RotateCcw className="h-4 w-4" /> Previous resolutions
                        <Badge variant="outline">{ticket.reopenCount} reopened</Badge>
                      </h4>
                      <ul className="space-y-2">
                        {ticket.resolutionHistory.map((r, i) => (
                          <li key={`${r.reopenedAt}-${i}`} className="rounded-lg border p-3 text-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="flex items-center gap-2">
                                <QueryStatusBadge status={r.status} />
                                {r.resolutionType && (
                                  <Badge variant="outline">
                                    {FINANCE_RESOLUTION_TYPE_LABELS[r.resolutionType]}
                                  </Badge>
                                )}
                              </span>
                              <span className="text-xs text-muted-foreground">
                                {r.resolvedByName ?? '—'} · {formatQueryDate(r.resolvedAt)}
                              </span>
                            </div>
                            {(r.adminResponse || r.resolutionNote) && (
                              <p className="mt-2 whitespace-pre-wrap">
                                {r.adminResponse ?? r.resolutionNote}
                              </p>
                            )}
                            <p className="mt-2 text-xs text-muted-foreground">
                              Reopened by {r.reopenedByName} on {formatQueryDate(r.reopenedAt)} —{' '}
                              {r.reopenReason}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </section>
                  </>
                )}

                {/* ---- Internal notes (§6) ----

                    Admin-only, and the API strips the field for everyone else
                    rather than trusting this condition — a note the raiser must
                    not read is not protected by a component that declines to
                    render it, since the row still crosses the wire. */}
                {abilities.admin && ticket.internalNote && (
                  <>
                    <Separator />
                    <section className="space-y-2">
                      <h4 className="text-sm font-semibold">Internal notes</h4>
                      <p className="whitespace-pre-wrap rounded-md border border-dashed px-3 py-2 text-sm">
                        {ticket.internalNote}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Admin-only. The raiser never receives this field.
                      </p>
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
                    {/* Two groups, deliberately: the left acts on the QUERY, the
                        right acts on the RECORD it is about. The two are
                        constantly confused — "Delete" means very different
                        things on each side — so they never sit in one row. */}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={queryDeleted}
                        onClick={() => setEditing(true)}
                      >
                        <Pencil className="mr-1 h-4 w-4" /> Edit
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={queryDeleted}
                        onClick={() => setAssigning(true)}
                      >
                        <UserCog className="mr-1 h-4 w-4" /> Assign
                      </Button>
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
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive"
                        disabled={queryDeleted}
                        onClick={() => setDeletingQuery(true)}
                      >
                        <Trash2 className="mr-1 h-4 w-4" /> Delete query
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {canReopen && (
                        <Button size="sm" variant="secondary" onClick={() => setReopening(true)}>
                          <RotateCcw className="mr-1 h-4 w-4" /> Reopen
                        </Button>
                      )}
                      {NEXT_STATUSES[ticket.status].map((s) => (
                        <Button
                          key={s}
                          size="sm"
                          variant={s === 'rejected' ? 'destructive' : s === 'resolved' ? 'default' : 'secondary'}
                          disabled={queryDeleted}
                          onClick={() => setStatusTarget(s)}
                        >
                          {FINANCE_TICKET_STATUS_LABELS[s]}
                        </Button>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Only an Admin can change the financial record behind this query. Add anything
                      useful to the conversation above.
                    </p>
                    {/* §12: the raiser may ASK. The same endpoint records a
                        request rather than performing the reopen, and says so. */}
                    {canRequestReopen && (
                      <Button size="sm" variant="secondary" onClick={() => setReopening(true)}>
                        <RotateCcw className="mr-1 h-4 w-4" /> Request reopen
                      </Button>
                    )}
                  </>
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
      {ticket && editing && (
        <EditQueryDialog
          ticket={ticket}
          onClose={() => setEditing(false)}
          onDone={() => {
            setEditing(false);
            void refetch();
          }}
        />
      )}
      {ticket && assigning && (
        <AssignDialog
          ticket={ticket}
          onClose={() => setAssigning(false)}
          onDone={() => {
            setAssigning(false);
            void refetch();
          }}
        />
      )}
      {ticket && deletingQuery && (
        <DeleteQueryDialog
          ticket={ticket}
          onClose={() => setDeletingQuery(false)}
          onDone={() => {
            setDeletingQuery(false);
            // The query has left the desk, so there is nothing left to show.
            onClose();
          }}
        />
      )}
      {ticket && reopening && (
        <ReopenDialog
          ticket={ticket}
          isAdmin={abilities.admin}
          onClose={() => setReopening(false)}
          onDone={() => {
            setReopening(false);
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
