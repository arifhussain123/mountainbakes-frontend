'use client';

import { useEffect, useMemo, useState } from 'react';
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
  ArchiveRestore,
  Copy,
  FileEdit,
  History,
  Loader2,
  MessageSquare,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  UserCog,
  Wand2,
} from 'lucide-react';
import {
  FINANCE_AMENDABLE_FIELDS,
  FINANCE_AMENDMENT_ACTION_LABELS,
  FINANCE_RESOLUTION_TYPES,
  FINANCE_RESOLUTION_TYPE_LABELS,
  FINANCE_TICKET_REFERENCE_LABELS,
  FINANCE_TICKET_REOPENABLE_STATUSES,
  FINANCE_TICKET_STATUS_LABELS,
  FINANCE_TICKET_TRANSITIONS,
  FINANCE_TICKET_VERSION_ACTION_LABELS,
  financeHelpDeskCan,
  isFinanceRecordAmendable,
  isFinanceTicketTerminal,
  type Attachment,
  type FinanceAmendableField,
  type FinanceResolutionType,
  type FinanceTicket,
  type FinanceTicketAuditEntry,
  type FinanceTicketMessage,
  type FinanceTicketStatus,
  type FinanceTicketVersion,
} from '@mb/shared';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { useBranches } from '@/lib/queries';
import {
  useFinanceMutation,
  useFinanceTicket,
  useFinanceTicketHistory,
} from '@/lib/finance';
import { useMoney } from './finance-ui';
import { QueryFeedForm, feedChangeLabels, feedDiff, feedFromTicket, feedToPayload, type FeedState } from './QueryFeedForm';
import {
  QueryPriorityBadge,
  QueryStatusBadge,
  RecordFigures,
  formatQueryDate,
  useHelpDeskAbilities,
} from './help-desk-ui';

/**
 * One query, opened.
 *
 * For an ADMIN this is the brief's feeding form (§4): the same fields the
 * raiser filled, editable in place, with Save Changes / Amend / Resolve /
 * Delete / Restore / Recreate / View History along the bottom. There is no
 * separate edit screen and no per-field popup — the form IS the record.
 *
 * For the RAISER it is the same form read-only (or editable, while it is still
 * their draft), the Admin's response, and the conversation.
 *
 * Every button here calls an endpoint that re-decides the permission from the
 * JWT. Hiding a button is courtesy; the API is the boundary.
 *
 * The body is keyed on `ticket.id:ticket.version` so that a saved change — or
 * one made by another admin, arriving through refetch — resets the form to the
 * row as it now stands rather than leaving stale edits over a newer version.
 */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium">{children}</dd>
    </div>
  );
}

const selectClass = 'h-11 w-full rounded-md border bg-background px-2 text-sm md:h-9';

// ---------------------------------------------------------------------------
// Audit History (§5, §7) — the chronological trail
// ---------------------------------------------------------------------------

const AUDIT_ACTION_STYLES: Record<string, string> = {
  created: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  submitted: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  resolved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  deleted: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  restored: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  recreated: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  amended: 'bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300',
  reopened: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-300',
  reopen_requested: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-300',
  amend: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  overwrite: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  edit: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
};

function AuditHistory({ entries }: { entries: FinanceTicketAuditEntry[] }) {
  if (!entries.length) return null;
  return (
    <section className="space-y-2">
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        <History className="h-4 w-4" /> Audit History
        <Badge variant="outline">{entries.length}</Badge>
      </h4>
      <ol className="ml-1 space-y-3 border-l pl-4">
        {entries.map((e) => (
          <li key={e.id} className="relative">
            <span
              className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-border ring-2 ring-background"
              aria-hidden
            />
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Badge variant="secondary" className={cn('text-[10px]', AUDIT_ACTION_STYLES[e.action] ?? '')}>
                {e.summary}
              </Badge>
              {e.source === 'record' && (
                <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                  Record
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {formatQueryDate(e.at)} · {e.actorName}
              </span>
            </div>
            {e.changes.length > 0 && (
              <ul className="mt-1 space-y-0.5">
                {e.changes.map((c, i) => (
                  <li key={`${e.id}-${i}`} className="text-sm">
                    <span className="text-muted-foreground">{c.field}: </span>
                    {c.from !== null && (
                      <>
                        <span className="tabular-nums text-muted-foreground line-through decoration-muted-foreground/50">
                          {c.from}
                        </span>
                        <span className="text-muted-foreground"> → </span>
                      </>
                    )}
                    <span className="font-medium tabular-nums">{c.to ?? '—'}</span>
                  </li>
                ))}
              </ul>
            )}
            {e.reason && <p className="mt-1 text-xs text-muted-foreground">Reason: {e.reason}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------------------------------------------------------------------
// View History (§7) — the versions, lazily loaded
// ---------------------------------------------------------------------------

function HistoryDialog({ ticket, onClose }: { ticket: FinanceTicket; onClose: () => void }) {
  const { data: versions, isLoading, error } = useFinanceTicketHistory(ticket.id, true);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto md:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <History className="h-4 w-4" /> Version History
            <span className="font-mono text-sm font-normal">{ticket.queryNo}</span>
          </DialogTitle>
          <DialogDescription>
            Every version this query has been through, newest first. Nothing here can be edited or
            removed.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">{error instanceof Error ? error.message : 'Could not load the history'}</p>
        ) : !versions?.length ? (
          <p className="text-sm text-muted-foreground">No versions recorded.</p>
        ) : (
          <ol className="space-y-3">
            {versions.map((v: FinanceTicketVersion) => (
              <li key={v.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="font-mono">
                      v{v.version}
                    </Badge>
                    <Badge variant="secondary" className={cn('text-[10px]', AUDIT_ACTION_STYLES[v.action] ?? '')}>
                      {FINANCE_TICKET_VERSION_ACTION_LABELS[v.action] ?? v.action}
                    </Badge>
                    {v.version === ticket.version && (
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                        Current
                      </Badge>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {v.changedByName}
                    {v.changedByRole ? ` · ${v.changedByRole.replace(/_/g, ' ')}` : ''} ·{' '}
                    {formatQueryDate(v.changedAt)}
                  </span>
                </div>

                {v.changes.length > 0 ? (
                  <table className="mt-2 w-full text-sm">
                    <tbody>
                      {v.changes.map((c, i) => (
                        <tr key={`${v.id}-${i}`} className="align-top">
                          <td className="w-1/3 py-0.5 pr-2 text-muted-foreground">{c.label}</td>
                          <td className="py-0.5 tabular-nums">
                            {c.old !== null && (
                              <>
                                <span className="text-muted-foreground line-through decoration-muted-foreground/50">
                                  {c.old}
                                </span>
                                <span className="text-muted-foreground"> → </span>
                              </>
                            )}
                            <span className="font-medium">{c.new ?? '—'}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {v.version === 1 ? 'The query as it was created.' : 'No field changed in this version.'}
                  </p>
                )}
                {v.reason && <p className="mt-2 text-xs text-muted-foreground">Reason: {v.reason}</p>}
              </li>
            ))}
          </ol>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Conversation
// ---------------------------------------------------------------------------

function Conversation({ ticket, onPosted }: { ticket: FinanceTicket; onPosted: () => void }) {
  const abilities = useHelpDeskAbilities();
  const mutation = useFinanceMutation();
  const [body, setBody] = useState('');
  const [photos, setPhotos] = useState<Attachment[]>([]);

  const messages = ticket.messages ?? [];
  const closed = ticket.status === 'closed' || ticket.status === 'draft' || Boolean(ticket.deletedAt);

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
              className={m.authorSide === 'admin' ? 'rounded-lg border border-primary/30 bg-primary/5 p-3' : 'rounded-lg border p-3'}
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
            : ticket.status === 'draft'
              ? 'The conversation starts once the query is submitted.'
              : 'This query is closed. Raise a new query for anything further.'}
        </p>
      ) : (
        <div className="space-y-2 rounded-lg border p-3">
          <Label htmlFor="hd-reply">{abilities.admin ? 'Reply to the raiser' : 'Add information'}</Label>
          <Textarea
            id="hd-reply"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder={abilities.admin ? 'What you found, or what you need from them' : 'Anything that helps the Admin investigate'}
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
              {mutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Send className="mr-1 h-4 w-4" />}
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
// Reason dialog — Save Changes, Amend, Recreate, Restore all confirm through it
// ---------------------------------------------------------------------------

function ReasonDialog({
  title,
  description,
  confirmLabel,
  variant = 'default',
  changes,
  warning,
  placeholder,
  pending,
  onConfirm,
  onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  variant?: 'default' | 'destructive' | 'secondary';
  /** Field labels being changed — printed so the admin confirms what, not just why. */
  changes?: string[];
  warning?: string;
  placeholder?: string;
  pending: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {warning && (
            <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <p>{warning}</p>
            </div>
          )}
          {changes && changes.length > 0 && (
            <div className="rounded-md bg-muted/60 px-3 py-2 text-sm">
              <p className="text-xs text-muted-foreground">Changing</p>
              <p>{changes.join(', ')}</p>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="rd-reason">Reason</Label>
            <Textarea
              id="rd-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder={placeholder ?? 'Kept with the previous values in the version history'}
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant={variant} disabled={pending || reason.trim().length < 3} onClick={() => onConfirm(reason.trim())}>
            {pending ? 'Saving…' : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Correct the RECORD behind the query (migration 94) — unchanged in substance
// ---------------------------------------------------------------------------

function AmendRecordDialog({
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

  const fields: FinanceAmendableField[] = ticket.referenceType ? (FINANCE_AMENDABLE_FIELDS[ticket.referenceType] ?? []) : [];

  const [fieldKey, setFieldKey] = useState(fields[0]?.key ?? '');
  const [newValue, setNewValue] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);

  const spec = fields.find((f) => f.key === fieldKey);
  const current = live?.[fieldKey];
  const currentText = current === undefined || current === null ? '' : String(current);

  const status = String(live?.['status'] ?? '');
  const isApproved = ['approved', 'posted', 'locked'].includes(status);
  const action = isApproved ? 'overwrite' : 'amend';

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
    mutation.isPending || !spec || newValue.trim() === '' || reason.trim().length < 3 || (action === 'overwrite' && !confirmed);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {action === 'overwrite' ? 'Overwrite' : 'Correct'} {ticket.referenceNo}
          </DialogTitle>
          <DialogDescription>
            This changes the FINANCIAL RECORD, not the query. It is recorded against {ticket.queryNo} with
            the original value, the new value and your reason.
          </DialogDescription>
        </DialogHeader>

        {fields.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing on this record can be changed directly.</p>
        ) : (
          <div className="space-y-4">
            {isApproved && (
              <div className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <p>
                  <span className="font-semibold">Warning:</span> you are about to modify an approved financial
                  record. This action will be recorded in the audit trail.
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
                className={selectClass}
              >
                {fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.label}
                  </option>
                ))}
              </select>
              {spec?.movesLedger && (
                <p className="text-xs text-muted-foreground">
                  This figure is in the cash book. Correcting it posts a reversal of the original voucher and a
                  corrected entry beside it — the original stays visible.
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
                <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
                <span>
                  I understand this modifies an approved financial record, and that it will be recorded in the
                  audit trail against {ticket.queryNo}.
                </span>
              </label>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={action === 'overwrite' ? 'destructive' : 'default'} disabled={blocked} onClick={() => void submit()}>
            {mutation.isPending ? 'Applying…' : action === 'overwrite' ? 'Overwrite record' : 'Apply correction'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteRecordDialog({ ticket, onClose, onDone }: { ticket: FinanceTicket; onClose: () => void; onDone: () => void }) {
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
            The record is removed from the books but kept on file — it stays readable to an Admin, stamped
            with your name, your reason and {ticket.queryNo}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <p>
              <span className="font-semibold">Warning:</span> you are about to modify an approved financial record.
              This action will be recorded in the audit trail.
              {ticket.referenceType === 'ledger_entry' && (
                <>
                  {' '}
                  This is a posted voucher: deleting it recomputes the running balance on every later entry. To
                  correct a wrong figure without that, cancel and use Correct record instead.
                </>
              )}
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="del-reason">Reason</Label>
            <Textarea id="del-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} autoFocus />
          </div>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
            <span>I confirm this financial record should be deleted.</span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={mutation.isPending || reason.trim().length < 3 || !confirmed} onClick={() => void submit()}>
            {mutation.isPending ? 'Deleting…' : 'Delete record'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Status (§10) — resolve / reject / review / wait / close
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
  const [response, setResponse] = useState(ticket.adminResponse ?? '');
  const [note, setNote] = useState(ticket.resolutionNote ?? '');
  const [amount, setAmount] = useState(ticket.resolutionAmount === null ? '' : String(ticket.resolutionAmount));
  const [resolutionType, setResolutionType] = useState<FinanceResolutionType>(target === 'rejected' ? 'rejected' : 'fixed');

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
          ...(response.trim() && response.trim() !== (ticket.adminResponse ?? '') ? { adminResponse: response.trim() } : {}),
          ...(note.trim() && note.trim() !== (ticket.resolutionNote ?? '') ? { resolutionNote: note.trim() } : {}),
          ...(terminal ? { resolutionAmount: amount.trim() === '' ? null : Number(amount) } : {}),
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
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="st-resolution-type">Resolution type</Label>
                <select
                  id="st-resolution-type"
                  value={resolutionType}
                  onChange={(e) => setResolutionType(e.target.value as FinanceResolutionType)}
                  className={selectClass}
                >
                  {FINANCE_RESOLUTION_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {FINANCE_RESOLUTION_TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="st-amount">Resolution amount</Label>
                <Input
                  id="st-amount"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                  inputMode="decimal"
                  placeholder="Optional — the correct figure"
                  className="tabular-nums"
                />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="st-response">Admin response{terminal ? '' : ' (optional)'}</Label>
            <Textarea
              id="st-response"
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              rows={3}
              placeholder={target === 'waiting_for_finance' ? 'What do you need from them?' : 'What you found, or what was done'}
              autoFocus
            />
          </div>

          {terminal && (
            <div className="space-y-1">
              <Label htmlFor="st-note">Resolution details (optional)</Label>
              <Textarea id="st-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Any further detail for the record" />
            </div>
          )}
          {terminal && (
            <p className="text-xs text-muted-foreground">
              A resolution amount is a statement on the query. It does not change any expense, income, sale,
              payment or ledger entry — use Correct record for that.
            </p>
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
// Assign
// ---------------------------------------------------------------------------

function AssignDialog({ ticket, onClose, onDone }: { ticket: FinanceTicket; onClose: () => void; onDone: () => void }) {
  const { token } = useAuth();
  const mutation = useFinanceMutation();
  const [admins, setAdmins] = useState<{ id: string; label: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignedTo, setAssignedTo] = useState<string>(ticket.assignedTo ?? '');

  useEffect(() => {
    let cancelled = false;
    apiCall<{ users: { id: string; name?: string; email: string; role: string; active?: boolean }[] }>('/api/users', {}, token)
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
          <DialogDescription>Only an Admin can action a Help Desk query, so only Admins appear here.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="as-admin">Assigned admin</Label>
          <select id="as-admin" value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} disabled={loading} className={selectClass}>
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
          <Button disabled={mutation.isPending || loading || assignedTo === (ticket.assignedTo ?? '')} onClick={() => void submit()}>
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Delete the QUERY (§8) — soft, with reason
// ---------------------------------------------------------------------------

function DeleteQueryDialog({ ticket, onClose, onDone }: { ticket: FinanceTicket; onClose: () => void; onDone: () => void }) {
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
                The query is marked deleted and leaves the desk. It is not erased: it stays under Deleted
                Queries, keeps its history, and can be restored.
              </p>
              <p className="text-muted-foreground">
                The financial record this query is about is <strong>not</strong> touched.
              </p>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="dq-reason">Reason</Label>
            <Textarea id="dq-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Why is this query being removed from the desk?" autoFocus />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1 h-4 w-4" />
            <span>I want to delete this query.</span>
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={mutation.isPending || reason.trim().length < 3 || !confirmed} onClick={() => void submit()}>
            {mutation.isPending ? 'Deleting…' : 'Delete query'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Reopen (§10)
// ---------------------------------------------------------------------------

function ReopenDialog({ ticket, isAdmin, onClose, onDone }: { ticket: FinanceTicket; isAdmin: boolean; onClose: () => void; onDone: () => void }) {
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
              {ticket.resolutionType ? ` · ${FINANCE_RESOLUTION_TYPE_LABELS[ticket.resolutionType]}` : ''}
            </p>
            <p className="mt-1 whitespace-pre-wrap">{ticket.adminResponse ?? ticket.resolutionNote}</p>
          </div>
        )}
        <div className="space-y-1">
          <Label htmlFor="ro-reason">Reason</Label>
          <Textarea id="ro-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="What is still wrong with this?" autoFocus />
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={mutation.isPending || reason.trim().length < 3} onClick={() => void submit()}>
            {mutation.isPending ? 'Sending…' : isAdmin ? 'Reopen query' : 'Request reopen'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Admin Response (§11) — editable for an Admin, read-only for the raiser
// ---------------------------------------------------------------------------

function ResponsePanel({ ticket, isAdmin, onSaved }: { ticket: FinanceTicket; isAdmin: boolean; onSaved: () => void }) {
  const mutation = useFinanceMutation();
  const { format: money } = useMoney();
  const [response, setResponse] = useState(ticket.adminResponse ?? '');
  const [resolution, setResolution] = useState(ticket.resolutionNote ?? '');
  const [amount, setAmount] = useState(ticket.resolutionAmount === null ? '' : String(ticket.resolutionAmount));
  const [internal, setInternal] = useState(ticket.internalNote ?? '');

  const editable = isAdmin && !ticket.deletedAt && ticket.status !== 'draft';

  const changed =
    response.trim() !== (ticket.adminResponse ?? '') ||
    resolution.trim() !== (ticket.resolutionNote ?? '') ||
    (amount.trim() === '' ? null : Number(amount)) !== ticket.resolutionAmount ||
    internal.trim() !== (ticket.internalNote ?? '');

  async function save() {
    try {
      await mutation.mutateAsync({
        path: `/api/finance/tickets/${ticket.id}/response`,
        body: {
          ...(response.trim() !== (ticket.adminResponse ?? '') ? { adminResponse: response.trim() } : {}),
          ...(resolution.trim() !== (ticket.resolutionNote ?? '') ? { resolutionNote: resolution.trim() } : {}),
          ...((amount.trim() === '' ? null : Number(amount)) !== ticket.resolutionAmount
            ? { resolutionAmount: amount.trim() === '' ? null : Number(amount) }
            : {}),
          ...(internal.trim() !== (ticket.internalNote ?? '') ? { internalNote: internal.trim() } : {}),
        },
      });
      toast.success(`${ticket.queryNo} — response saved`);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The response could not be saved');
    }
  }

  const hasAnything = ticket.adminResponse || ticket.resolutionNote || ticket.resolutionAmount !== null || ticket.resolvedAt;
  if (!editable && !hasAnything) return null;

  return (
    <section className="space-y-3">
      <h4 className="flex items-center gap-2 text-sm font-semibold">
        <ShieldCheck className="h-4 w-4" /> Admin Response
      </h4>

      {editable ? (
        <div className="space-y-3 rounded-lg border p-3">
          <div className="space-y-1">
            <Label htmlFor="rp-response">Admin response</Label>
            <Textarea id="rp-response" value={response} onChange={(e) => setResponse(e.target.value)} rows={3} placeholder="What you found, or what was done. The raiser reads this." />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="rp-resolution">Resolution</Label>
              <Textarea id="rp-resolution" value={resolution} onChange={(e) => setResolution(e.target.value)} rows={2} placeholder="Optional — the closing detail" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="rp-amount">Resolution amount</Label>
              <Input
                id="rp-amount"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                inputMode="decimal"
                placeholder="Optional — the correct figure"
                className="tabular-nums"
              />
              <p className="text-xs text-muted-foreground">A statement on the query. It changes no financial record.</p>
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="rp-internal">Internal notes</Label>
            <Textarea id="rp-internal" value={internal} onChange={(e) => setInternal(e.target.value)} rows={2} placeholder="Admin-only. The raiser never receives this field." className="border-dashed" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {ticket.respondedByName && (
                <span>
                  Responded by {ticket.respondedByName} · {formatQueryDate(ticket.respondedAt)}
                </span>
              )}
              {ticket.resolvedByName && (
                <span>
                  Resolved by {ticket.resolvedByName} · {formatQueryDate(ticket.resolvedAt)}
                  {ticket.resolutionType ? ` · ${FINANCE_RESOLUTION_TYPE_LABELS[ticket.resolutionType]}` : ''}
                </span>
              )}
            </dl>
            <Button size="sm" variant="secondary" disabled={mutation.isPending || !changed} onClick={() => void save()}>
              {mutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}
              Save response
            </Button>
          </div>
        </div>
      ) : (
        <>
          {ticket.adminResponse && (
            <p className="whitespace-pre-wrap rounded-md bg-muted/60 px-3 py-2 text-sm">{ticket.adminResponse}</p>
          )}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Admin">{ticket.respondedByName || ticket.resolvedByName || '—'}</Field>
            <Field label="Responded">{formatQueryDate(ticket.respondedAt ?? ticket.resolvedAt)}</Field>
            <Field label="Status">{FINANCE_TICKET_STATUS_LABELS[ticket.status]}</Field>
            {ticket.resolutionType && <Field label="Resolution type">{FINANCE_RESOLUTION_TYPE_LABELS[ticket.resolutionType]}</Field>}
            {ticket.resolutionAmount !== null && <Field label="Resolution amount">{money(ticket.resolutionAmount)}</Field>}
            {ticket.resolvedAt && <Field label="Resolved">{formatQueryDate(ticket.resolvedAt)}</Field>}
          </dl>
          {ticket.resolutionNote && (
            <div>
              <p className="text-xs text-muted-foreground">Resolution details</p>
              <p className="whitespace-pre-wrap text-sm">{ticket.resolutionNote}</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// The body — mounted once the query is loaded, keyed on its version
// ---------------------------------------------------------------------------

type Pending =
  | { kind: 'save' }
  | { kind: 'amend' }
  | { kind: 'recreate' }
  | { kind: 'restore' }
  | { kind: 'assign' }
  | { kind: 'deleteQuery' }
  | { kind: 'deleteRecord' }
  | { kind: 'correctRecord' }
  | { kind: 'reopen' }
  | { kind: 'history' }
  | { kind: 'status'; target: FinanceTicketStatus };

function QueryDetailBody({
  ticket,
  live,
  onClose,
  onRefetch,
  onOpenOther,
}: {
  ticket: FinanceTicket;
  live: Record<string, unknown> | null | undefined;
  onClose: () => void;
  onRefetch: () => void;
  onOpenOther?: (id: string) => void;
}) {
  const abilities = useHelpDeskAbilities();
  const { user, token } = useAuth();
  const mutation = useFinanceMutation();
  const { data: branches = [] } = useBranches(token ?? '', { enabled: Boolean(token) });

  const base = useMemo(() => feedFromTicket(ticket), [ticket]);
  const [feed, setFeed] = useState<FeedState>(base);
  const [draftPhotos, setDraftPhotos] = useState<Attachment[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);

  const diff = useMemo(() => feedDiff(base, feed), [base, feed]);
  const dirty = Object.keys(diff).length > 0;

  const queryDeleted = Boolean(ticket.deletedAt);
  const isDraft = ticket.status === 'draft';
  const ownDraft = isDraft && ticket.raisedBy === user?.uid;
  const terminal = isFinanceTicketTerminal(ticket.status);

  // Who may FEED the form right now. An Admin on a live (or terminal) query;
  // the raiser on their own draft. A deleted query is read-only until restored.
  const adminFeeds = abilities.admin && !queryDeleted && !isDraft;
  const canFeed = adminFeeds || ownDraft;

  const canTouchRecord =
    abilities.admin && Boolean(ticket.referenceType) && Boolean(ticket.referenceId) && isFinanceRecordAmendable(ticket.referenceType) && !queryDeleted;
  const referenceIsInformational = Boolean(ticket.referenceType) && !isFinanceRecordAmendable(ticket.referenceType);
  const recordDeleted = Boolean(live?.['deletedAt']);

  const reopenable = (FINANCE_TICKET_REOPENABLE_STATUSES as readonly FinanceTicketStatus[]).includes(ticket.status);
  const canReopen = abilities.admin && reopenable && !queryDeleted;
  const canRequestReopen = !abilities.admin && reopenable && !queryDeleted && ticket.raisedBy === user?.uid;

  const nextStatuses = queryDeleted || isDraft ? [] : FINANCE_TICKET_TRANSITIONS[ticket.status];

  function done() {
    setPending(null);
    onRefetch();
  }

  async function run<T = unknown>(path: string, method: string, body: unknown, success: string): Promise<T | null> {
    try {
      const result = (await mutation.mutateAsync({ path, method, body })) as T;
      toast.success(success);
      return result;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The change could not be saved');
      return null;
    }
  }

  async function saveChanges(reason: string) {
    const ok = await run(`/api/finance/tickets/${ticket.id}`, 'PATCH', { ...diff, reason }, `${ticket.queryNo} updated`);
    if (ok) done();
  }

  async function amend(reason: string) {
    const ok = await run(`/api/finance/tickets/${ticket.id}/amend-query`, 'POST', { ...diff, reason }, `${ticket.queryNo} amended`);
    if (ok) done();
  }

  async function recreate(reason: string) {
    const result = await run<{ ticket: FinanceTicket }>(
      `/api/finance/tickets/${ticket.id}/recreate`,
      'POST',
      { ...diff, reason },
      'Query recreated',
    );
    if (result) {
      setPending(null);
      toast.success(`${result.ticket.queryNo} created from ${ticket.queryNo}`);
      if (onOpenOther) onOpenOther(result.ticket.id);
      else onRefetch();
    }
  }

  async function restore(reason: string) {
    const ok = await run(`/api/finance/tickets/${ticket.id}/restore`, 'POST', { reason }, `${ticket.queryNo} restored`);
    if (ok) done();
  }

  async function saveDraft() {
    const ok = await run(
      `/api/finance/tickets/${ticket.id}/draft`,
      'PATCH',
      { ...feedToPayload(feed), attachmentIds: draftPhotos.map((p) => p.id) },
      'Draft saved',
    );
    if (ok) {
      setDraftPhotos([]);
      onRefetch();
    }
  }

  async function submitDraft() {
    if (dirty || draftPhotos.length) {
      const saved = await run(
        `/api/finance/tickets/${ticket.id}/draft`,
        'PATCH',
        { ...feedToPayload(feed), attachmentIds: draftPhotos.map((p) => p.id) },
        'Draft saved',
      );
      if (!saved) return;
    }
    const ok = await run(`/api/finance/tickets/${ticket.id}/submit`, 'POST', undefined, `${ticket.queryNo} sent to the Admin`);
    if (ok) {
      setDraftPhotos([]);
      onRefetch();
    }
  }

  const feedIncomplete = feed.subject.trim().length < 3 || feed.description.trim().length < 3;

  return (
    <>
      <DialogHeader>
        <DialogTitle className="flex flex-wrap items-center gap-2">
          <span className="font-mono">{ticket.queryNo}</span>
          {queryDeleted ? <Badge variant="destructive">Deleted</Badge> : <QueryStatusBadge status={ticket.status} />}
          <QueryPriorityBadge priority={ticket.priority} />
          <Badge variant="outline" className="font-mono text-[10px]">
            v{ticket.version}
          </Badge>
        </DialogTitle>
        <DialogDescription className="flex flex-wrap gap-x-3 gap-y-0.5">
          <span>
            {ticket.raisedByName || '—'} · {formatQueryDate(ticket.createdAt)}
          </span>
          {ticket.branchName && <span>· {ticket.branchName}</span>}
          {ticket.assignedToName && <span>· Assigned to {ticket.assignedToName}</span>}
          {ticket.recreatedFromQueryNo && <span>· Recreated from {ticket.recreatedFromQueryNo}</span>}
          {ticket.recreatedAsQueryNo && <span>· Recreated as {ticket.recreatedAsQueryNo}</span>}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-6">
        {queryDeleted && (
          <div className="flex gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <div>
              <p className="font-medium text-destructive">
                Deleted by {ticket.deletedByName ?? '—'} on {formatQueryDate(ticket.deletedAt)}
              </p>
              <p className="text-muted-foreground">Reason: {ticket.deleteReason ?? '—'}</p>
              {abilities.admin && <p className="mt-1 text-xs text-muted-foreground">Restore it to edit or answer it again.</p>}
            </div>
          </div>
        )}
        {ticket.restoredAt && !queryDeleted && (
          <p className="rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            Restored by {ticket.restoredByName ?? '—'} on {formatQueryDate(ticket.restoredAt)} — {ticket.restoreReason}
          </p>
        )}
        {ticket.amendedAt && (
          <p className="rounded-md bg-teal-50 px-3 py-2 text-xs text-teal-800 dark:bg-teal-950/40 dark:text-teal-300">
            Amended {ticket.amendCount}× — last by {ticket.amendedByName ?? '—'} on {formatQueryDate(ticket.amendedAt)}. Every
            version is in View History.
          </p>
        )}

        {/* ---- The feeding form (§4) ---- */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold">Query</h4>
            {canFeed && dirty && (
              <span className="text-xs text-amber-700 dark:text-amber-400">
                Unsaved: {feedChangeLabels(diff).join(', ')}
              </span>
            )}
          </div>
          <QueryFeedForm value={feed} onChange={setFeed} branches={branches} readOnly={!canFeed} idPrefix={`qd-${ticket.id.slice(0, 8)}`} />

          {ownDraft ? (
            <PhotoCapture entity="finance_ticket" value={draftPhotos} onChange={setDraftPhotos} label="Add attachments" hint="Optional" />
          ) : null}
          <AttachmentGallery attachments={ticket.attachments} title="Attachments" emptyText="No attachments" />
          {!canFeed && !abilities.admin && !isDraft && (
            <p className="text-xs text-muted-foreground">Submitted queries are changed only by an Admin. Add anything further in the conversation below.</p>
          )}
        </section>

        {/* ---- The record it is about ---- */}
        {ticket.referenceNo && (
          <>
            <Separator />
            <section className="space-y-3">
              <h4 className="text-sm font-semibold">Referenced record</h4>
              <RecordFigures record={ticket.referenceSnapshot} heading={`As raised · ${ticket.referenceNo}`} />
              {abilities.admin && live && <RecordFigures record={live} heading={`Now · ${ticket.referenceNo}`} />}
              {!abilities.admin && (
                <p className="text-xs text-muted-foreground">
                  These are the figures as they stood when the query was raised. Only an Admin can change them.
                </p>
              )}
              {abilities.admin && referenceIsInformational && (
                <p className="flex items-start gap-2 rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    Shown for reference. A {FINANCE_TICKET_REFERENCE_LABELS[ticket.referenceType!].toLowerCase()} is corrected in the
                    Support Center, where its line items, totals and branch stock are reconciled together.
                  </span>
                </p>
              )}
              {abilities.admin && (
                <p className="text-xs text-muted-foreground">
                  Changing the Amount on the query above never changes this record. Use Correct record for that.
                </p>
              )}
            </section>
          </>
        )}

        {/* ---- Admin Response (§11) ---- */}
        {!isDraft && (
          <>
            <Separator />
            <ResponsePanel key={`${ticket.id}:${ticket.version}`} ticket={ticket} isAdmin={abilities.admin} onSaved={onRefetch} />
          </>
        )}

        {/* ---- Previous resolutions ---- */}
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
                        {r.resolutionType && <Badge variant="outline">{FINANCE_RESOLUTION_TYPE_LABELS[r.resolutionType]}</Badge>}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {r.resolvedByName ?? '—'} · {formatQueryDate(r.resolvedAt)}
                      </span>
                    </div>
                    {(r.adminResponse || r.resolutionNote) && <p className="mt-2 whitespace-pre-wrap">{r.adminResponse ?? r.resolutionNote}</p>}
                    <p className="mt-2 text-xs text-muted-foreground">
                      Reopened by {r.reopenedByName} on {formatQueryDate(r.reopenedAt)} — {r.reopenReason}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        {/* ---- Corrections made to the BOOKS under this query ---- */}
        {(ticket.amendments?.length ?? 0) > 0 && (
          <>
            <Separator />
            <section className="space-y-2">
              <h4 className="text-sm font-semibold">Corrections made to the record under this query</h4>
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
                        <span className={a.difference < 0 ? 'ml-2 text-destructive' : 'ml-2 text-emerald-600 dark:text-emerald-400'}>
                          ({a.difference > 0 ? '+' : '−'}
                          {Math.abs(a.difference).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})
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

        {(ticket.auditTrail?.length ?? 0) > 0 && (
          <>
            <Separator />
            <AuditHistory entries={ticket.auditTrail!} />
          </>
        )}

        <Separator />
        <Conversation ticket={ticket} onPosted={onRefetch} />
      </div>

      {/* ---- Actions ---- */}
      <DialogFooter className="sticky bottom-0 -mx-6 -mb-6 mt-2 flex-col items-stretch gap-2 border-t bg-background px-6 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        {ownDraft ? (
          <>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" disabled={mutation.isPending || (!dirty && !draftPhotos.length) || feedIncomplete} onClick={() => void saveDraft()}>
                <FileEdit className="mr-1 h-4 w-4" /> Save Draft
              </Button>
              <Button size="sm" disabled={mutation.isPending || feedIncomplete} onClick={() => void submitDraft()}>
                <Send className="mr-1 h-4 w-4" /> Submit Query
              </Button>
            </div>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </>
        ) : abilities.admin ? (
          <>
            <div className="flex flex-wrap gap-2">
              {queryDeleted ? (
                <Button size="sm" onClick={() => setPending({ kind: 'restore' })}>
                  <ArchiveRestore className="mr-1 h-4 w-4" /> Restore
                </Button>
              ) : (
                <>
                  <Button
                    size="sm"
                    disabled={!adminFeeds || !dirty || feedIncomplete || mutation.isPending}
                    onClick={() => setPending({ kind: 'save' })}
                    title={!dirty ? 'Change a field above first' : undefined}
                  >
                    <Save className="mr-1 h-4 w-4" /> Save Changes
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!adminFeeds || terminal || feedIncomplete || mutation.isPending}
                    onClick={() => setPending({ kind: 'amend' })}
                    title={terminal ? 'Reopen the query to amend it' : 'Save the form as a new AMENDED version, with a reason'}
                  >
                    <Wand2 className="mr-1 h-4 w-4" /> Amend
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={Boolean(ticket.recreatedAsId) || feedIncomplete || mutation.isPending}
                    onClick={() => setPending({ kind: 'recreate' })}
                    title={ticket.recreatedAsId ? `Already recreated as ${ticket.recreatedAsQueryNo}` : 'Copy this query into a new Query ID'}
                  >
                    <Copy className="mr-1 h-4 w-4" /> Recreate
                  </Button>
                  <Button size="sm" variant="secondary" disabled={!adminFeeds} onClick={() => setPending({ kind: 'assign' })}>
                    <UserCog className="mr-1 h-4 w-4" /> Assign
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={!canTouchRecord || recordDeleted}
                    title={
                      referenceIsInformational
                        ? `A ${FINANCE_TICKET_REFERENCE_LABELS[ticket.referenceType!].toLowerCase()} is corrected in the Support Center, not here`
                        : !canTouchRecord
                          ? 'This query names no finance record'
                          : recordDeleted
                            ? 'That record has already been deleted'
                            : 'Change the financial record behind this query'
                    }
                    onClick={() => setPending({ kind: 'correctRecord' })}
                  >
                    Correct record
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" disabled={!canTouchRecord || recordDeleted} onClick={() => setPending({ kind: 'deleteRecord' })}>
                    <Trash2 className="mr-1 h-4 w-4" /> Delete record
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" disabled={isDraft} onClick={() => setPending({ kind: 'deleteQuery' })}>
                    <Trash2 className="mr-1 h-4 w-4" /> Delete
                  </Button>
                </>
              )}
              <Button size="sm" variant="outline" onClick={() => setPending({ kind: 'history' })}>
                <History className="mr-1 h-4 w-4" /> View History
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {canReopen && (
                <Button size="sm" variant="secondary" onClick={() => setPending({ kind: 'reopen' })}>
                  <RotateCcw className="mr-1 h-4 w-4" /> Reopen
                </Button>
              )}
              {nextStatuses.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={s === 'rejected' ? 'destructive' : s === 'resolved' ? 'default' : 'secondary'}
                  onClick={() => setPending({ kind: 'status', target: s })}
                >
                  {s === 'resolved' ? 'Resolve' : s === 'rejected' ? 'Reject' : s === 'closed' ? 'Close query' : FINANCE_TICKET_STATUS_LABELS[s]}
                </Button>
              ))}
              <Button variant="ghost" onClick={onClose}>
                Close
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setPending({ kind: 'history' })}>
                <History className="mr-1 h-4 w-4" /> View History
              </Button>
              {canRequestReopen && (
                <Button size="sm" variant="secondary" onClick={() => setPending({ kind: 'reopen' })}>
                  <RotateCcw className="mr-1 h-4 w-4" /> Request reopen
                </Button>
              )}
            </div>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </>
        )}
      </DialogFooter>

      {pending?.kind === 'save' && (
        <ReasonDialog
          title={`Save changes — ${ticket.queryNo}`}
          description="Changes the query, not the financial record behind it. The previous values are kept as a version and the raiser is told why."
          confirmLabel="Save changes"
          changes={feedChangeLabels(diff)}
          pending={mutation.isPending}
          onConfirm={(r) => void saveChanges(r)}
          onClose={() => setPending(null)}
        />
      )}
      {pending?.kind === 'amend' && (
        <ReasonDialog
          title={`Amend — ${ticket.queryNo}`}
          description="Saves the form as a new version, marks the query AMENDED and keeps every previous version. Nothing on the books changes."
          confirmLabel="Amend query"
          variant="secondary"
          changes={dirty ? feedChangeLabels(diff) : undefined}
          warning={dirty ? undefined : 'No field on the form has changed. The amendment will still be recorded as a version with your reason.'}
          placeholder="e.g. Corrected transaction amount"
          pending={mutation.isPending}
          onConfirm={(r) => void amend(r)}
          onClose={() => setPending(null)}
        />
      )}
      {pending?.kind === 'recreate' && (
        <ReasonDialog
          title={`Recreate — ${ticket.queryNo}`}
          description="Creates a NEW query under a new Query ID with the form as it stands now. This query is left as it is and both point at each other. The old Query ID is never reused."
          confirmLabel="Recreate query"
          variant="secondary"
          changes={dirty ? feedChangeLabels(diff) : undefined}
          placeholder="Why the original needs to be submitted again"
          pending={mutation.isPending}
          onConfirm={(r) => void recreate(r)}
          onClose={() => setPending(null)}
        />
      )}
      {pending?.kind === 'restore' && (
        <ReasonDialog
          title={`Restore — ${ticket.queryNo}`}
          description="Brings the query back to the desk exactly as it was when it was deleted, with its status and history."
          confirmLabel="Restore query"
          pending={mutation.isPending}
          onConfirm={(r) => void restore(r)}
          onClose={() => setPending(null)}
        />
      )}
      {pending?.kind === 'history' && <HistoryDialog ticket={ticket} onClose={() => setPending(null)} />}
      {pending?.kind === 'correctRecord' && <AmendRecordDialog ticket={ticket} live={live} onClose={() => setPending(null)} onDone={done} />}
      {pending?.kind === 'deleteRecord' && <DeleteRecordDialog ticket={ticket} onClose={() => setPending(null)} onDone={done} />}
      {pending?.kind === 'assign' && <AssignDialog ticket={ticket} onClose={() => setPending(null)} onDone={done} />}
      {pending?.kind === 'deleteQuery' && <DeleteQueryDialog ticket={ticket} onClose={() => setPending(null)} onDone={done} />}
      {pending?.kind === 'reopen' && <ReopenDialog ticket={ticket} isAdmin={abilities.admin} onClose={() => setPending(null)} onDone={done} />}
      {pending?.kind === 'status' && <StatusDialog ticket={ticket} target={pending.target} onClose={() => setPending(null)} onDone={done} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// The dialog
// ---------------------------------------------------------------------------

export function FinanceQueryDetailDialog({
  ticketId,
  onClose,
  onOpenOther,
}: {
  ticketId: string;
  onClose: () => void;
  /** Recreate opens the NEW query in place of this one. */
  onOpenOther?: (id: string) => void;
}) {
  const { data: ticket, isLoading, error, refetch } = useFinanceTicket(ticketId);
  const live = (ticket as (FinanceTicket & { liveRecord?: Record<string, unknown> | null }) | undefined)?.liveRecord;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto md:max-w-4xl">
        {isLoading || (!ticket && !error) ? (
          <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading query…
          </div>
        ) : !ticket ? (
          <div className="space-y-3 py-6">
            <p className="text-sm text-destructive">{error instanceof Error ? error.message : 'Could not load the query'}</p>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        ) : (
          <QueryDetailBody
            key={`${ticket.id}:${ticket.version}:${ticket.updatedAt}`}
            ticket={ticket}
            live={live}
            onClose={onClose}
            onRefetch={() => void refetch()}
            onOpenOther={onOpenOther}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
