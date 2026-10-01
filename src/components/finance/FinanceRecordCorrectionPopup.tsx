'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, X } from 'lucide-react';
import {
  FINANCE_AMENDABLE_FIELDS,
  FINANCE_QUERY_PRIORITY_LABELS,
  FINANCE_QUERY_TYPE_LABELS,
  FINANCE_TICKET_REFERENCE_LABELS,
  FINANCE_TICKET_REOPENABLE_STATUSES,
  FINANCE_TICKET_STATUS_LABELS,
  FINANCE_TICKET_TRANSITIONS,
  financeAmendableValue,
  isFinanceRecordAmendable,
  type FinanceAmendableField,
  type FinanceTicket,
  type FinanceTicketStatus,
  businessDateStr,
} from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { AttachmentGallery } from '@/components/shared/AttachmentGallery';
import { ApiError } from '@/utils/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import { useBranches } from '@/lib/queries';
import { useFinanceMutation, useFinanceTicket, useLedgerHeads } from '@/lib/finance';
import { useMoney } from './finance-ui';
import { QueryStatusBadge, formatQueryDate } from './help-desk-ui';
import {
  AssignDialog,
  DeleteQueryDialog,
  ReasonDialog,
  ReopenDialog,
  StatusDialog,
} from './FinanceQueryDetail';

/**
 * Change figures — the ADMIN's correction popup for the record behind a
 * Finance Query (design: "Desing File/Finance Query Correction.dc.html").
 *
 * One window, four views, switched in place rather than by stacking dialogs:
 *
 *   correct  where it opens: the linked record's correctable fields with
 *            "Was" and "Difference" under each, the rest of the record
 *            read-only, a Changes panel and an optional note
 *   success  what was corrected, the query and its status
 *   history  the query's audit trail — query events and record corrections
 *   query    the query as raised, read-only, with the linked record card
 *
 * Confirm-before-apply and delete-record are overlays inside the same window.
 *
 * Which fields are correctable is FINANCE_AMENDABLE_FIELDS, the mirror of what
 * the database accepts: for a voucher and a transaction that is every field but
 * the type (migration 130); for the other records, their figures. Anything else
 * about the record is shown but cannot be typed into, because no route may
 * change it. The correction
 * itself is POST /correct-record (migration 129): the record, the amendment
 * rows, the resolve and the query's version in one transaction, refused on a
 * concurrent change.
 */

type View = 'query' | 'correct' | 'success' | 'history';

type Pending =
  | { kind: 'restore' }
  | { kind: 'assign' }
  | { kind: 'deleteQuery' }
  | { kind: 'reopen' }
  | { kind: 'status'; target: FinanceTicketStatus };

type CorrectionResult = {
  applied: {
    field: string;
    label: string;
    originalValue: string | null;
    newValue: string | null;
    ledger?: { ledgerAmended?: boolean; reversalVoucherNo?: string; correctedVoucherNo?: string };
  }[];
  ticket: FinanceTicket;
};

type Change = { spec: FinanceAmendableField; from: string; to: string; difference: number | null };
type AppliedLine = { label: string; from: string; to: string; detail?: string };

const MONEY_INPUT = /^\d{1,12}(\.\d{1,2})?$/;
const paisa = (v: string) => Math.round(Number(v || 0) * 100);
/** Stable, so the prefilled values are not recomputed (and the form re-seeded) every render. */
const NO_FIELDS: FinanceAmendableField[] = [];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-09-30" → "30-Sep-2026", the Finance UI's date. */
function fmtDate(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? `${m[3]}-${MONTHS[Number(m[2]) - 1]}-${m[1]}` : v;
}
const titleCase = (v: string) => v.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** Read-only facts about the record, in the design's order; only those the row actually has. */
const RECORD_FACTS: { keys: string[]; label: string; kind: 'date' | 'text' | 'type' }[] = [
  { keys: ['entryDate', 'businessDate', 'paymentDate', 'transactionDate', 'transferDate'], label: 'Entry date', kind: 'date' },
  { keys: ['ledgerHeadName', 'category'], label: 'Category', kind: 'text' },
  { keys: ['ledgerHeadType', 'txnType'], label: 'Type', kind: 'type' },
  { keys: ['branchName'], label: 'Branch', kind: 'text' },
  { keys: ['employeeName', 'partnerName'], label: 'Paid to', kind: 'text' },
  { keys: ['paymentMethod'], label: 'Payment method', kind: 'type' },
  { keys: ['account'], label: 'Account', kind: 'type' },
  { keys: ['description', 'title'], label: 'Description', kind: 'text' },
  { keys: ['status'], label: 'Status', kind: 'type' },
];

const box = 'rounded-lg border bg-card';
const fieldLabel = 'text-xs font-semibold text-muted-foreground';
const sectionLabel = 'text-xs font-semibold uppercase tracking-wider text-muted-foreground';
const control =
  'h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50';

function FinanceRecordCorrectionPopup({
  ticket,
  live,
  onClose,
  onRefetch,
}: {
  ticket: FinanceTicket;
  live: Record<string, unknown> | null | undefined;
  onClose: () => void;
  onRefetch: () => Promise<unknown>;
}) {
  const { format } = useMoney();
  const { token } = useAuth();
  const { data: branches = [] } = useBranches(token ?? '', { enabled: Boolean(token) });
  const { data: heads = [] } = useLedgerHeads();
  const mutation = useFinanceMutation();
  const correctMutation = useFinanceMutation<CorrectionResult>();

  const [pending, setPending] = useState<Pending | null>(null);
  const [lastApplied, setLastApplied] = useState<AppliedLine[]>([]);

  const referenceType = ticket.referenceType;
  const queryDeleted = Boolean(ticket.deletedAt);
  const recordDeleted = Boolean(live?.['deletedAt']);
  const canTouchRecord =
    Boolean(referenceType) && Boolean(ticket.referenceId) && isFinanceRecordAmendable(referenceType) && !queryDeleted;
  const canCorrect = canTouchRecord && Boolean(live) && !recordDeleted;
  const canResolve = FINANCE_TICKET_TRANSITIONS[ticket.status].includes('resolved') && !queryDeleted;
  // Change figures opens on the form; a record that cannot be corrected opens on the query instead.
  const [view, setView] = useState<View>(canCorrect ? 'correct' : 'query');
  const [loadedAt] = useState(() => new Date().toISOString());

  // ---- Correct view state (kept here so the confirm overlay can read it) ----
  const fields = referenceType ? (FINANCE_AMENDABLE_FIELDS[referenceType] ?? NO_FIELDS) : NO_FIELDS;
  const current = useMemo(
    () =>
      referenceType
        ? (Object.fromEntries(fields.map((f) => [f.key, financeAmendableValue(referenceType, live, f.key)])) as Record<string, string>)
        : {},
    [fields, referenceType, live],
  );
  // The record's own names, for an id the lists do not carry (an inactive category).
  const currentHeadName = String(live?.['ledgerHeadName'] ?? '') || '—';
  const currentBranchName = String(live?.['branchName'] ?? '') || '—';
  const recordType = String(live?.['ledgerHeadType'] ?? live?.['txnType'] ?? '');
  // A correction keeps the entry on its side of the book: same-type categories only.
  const headOptions = heads.filter((h) => !recordType || h.type === recordType);
  const [draft, setDraft] = useState<Record<string, string>>(current);
  const [note, setNote] = useState('');
  const [resolve, setResolve] = useState(true);
  const [overwriteOk, setOverwriteOk] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloaded, setReloaded] = useState(false);
  // A newer record (after Reload latest, or any refetch) re-seeds the draft —
  // adjusted during render (react-hooks/set-state-in-effect).
  const [seededFrom, setSeededFrom] = useState(current);
  if (seededFrom !== current && view !== 'success') {
    setSeededFrom(current);
    setDraft(current);
  }

  // ---- Delete-record overlay ----
  const [deleting, setDeleting] = useState(false);
  const [deleteReason, setDeleteReason] = useState('');

  const recordStatus = String(live?.['status'] ?? '');
  const approved = ['approved', 'posted', 'locked'].includes(recordStatus);
  const invalid = fields.filter((f) => f.kind === 'money' && !MONEY_INPUT.test((draft[f.key] ?? '').trim())).map((f) => f.key);
  const changes: Change[] = fields.flatMap((spec): Change[] => {
    const from = current[spec.key] ?? '';
    const to = (draft[spec.key] ?? '').trim();
    if (spec.kind === 'money') {
      if (!MONEY_INPUT.test(to) || paisa(to) === paisa(from)) return [];
      return [{ spec, from, to, difference: (paisa(to) - paisa(from)) / 100 }];
    }
    return to === from.trim() ? [] : [{ spec, from, to, difference: null }];
  });
  const willResolve = resolve && canResolve;
  const applyDisabled =
    correctMutation.isPending || !canCorrect || changes.length === 0 || invalid.length > 0 || (approved && !overwriteOk);

  const shown = (spec: FinanceAmendableField | undefined, v: string | null) => {
    if (!spec) return v || '—';
    if (spec.kind === 'money') return format(Number(v || 0));
    if (spec.kind === 'select') return spec.options?.find((o) => o.value === v)?.label ?? (v ? titleCase(v) : '—');
    if (spec.kind === 'date') return v ? fmtDate(v) : '—';
    if (spec.kind === 'head') return heads.find((h) => h.id === v)?.name ?? (v === current[spec.key] ? currentHeadName : v) ?? '—';
    if (spec.kind === 'branch') return v ? (branches.find((b) => b.id === v)?.name ?? (v === current[spec.key] ? currentBranchName : v)) : 'Company-wide';
    return v ? `“${v}”` : '—';
  };
  /** The trail stores figures as plain numbers ("2500.00"); show them as money. */
  const asMoney = (v: string) => (/^-?\d+(\.\d+)?$/.test(v) ? format(Number(v)) : v);
  const signed = (d: number) => `${d > 0 ? '+' : '−'}${format(Math.abs(d))}`;

  function openCorrect() {
    setDraft(current);
    setNote('');
    setResolve(true);
    setOverwriteOk(false);
    setConflict(null);
    setError(null);
    setReloaded(false);
    setView('correct');
  }
  function cancelCorrect() {
    setDraft(current);
    setNote('');
    setConflict(null);
    setError(null);
    setReloaded(false);
    setView('query');
  }
  /** Cancel and × leave the popup; only the back link turns to the query. */
  function closeCorrect() {
    onClose();
  }

  async function reloadLatest() {
    setConflict(null);
    await onRefetch();
    setReloaded(true);
  }

  async function confirmApply() {
    setError(null);
    try {
      const res = await correctMutation.mutateAsync({
        path: `/api/finance/tickets/${ticket.id}/correct-record`,
        body: {
          edits: changes.map((c) => ({ field: c.spec.key, value: c.to, expected: c.from })),
          ...(note.trim() ? { note: note.trim() } : {}),
          resolve: willResolve,
          expectedVersion: ticket.version,
          ...(approved ? { confirmOverwrite: overwriteOk } : {}),
        },
      });
      setLastApplied(
        res.applied.map((a) => {
          const spec = fields.find((f) => f.key === a.field);
          return {
            label: a.label,
            from: shown(spec, a.originalValue),
            to: shown(spec, a.newValue),
            detail: a.ledger?.ledgerAmended
              ? `${a.ledger.reversalVoucherNo} reversal · ${a.ledger.correctedVoucherNo} corrected entry`
              : undefined,
          };
        }),
      );
      setConfirming(false);
      setNote('');
      setView('success');
      toast.success(
        willResolve ? `${ticket.referenceNo} corrected · ${ticket.queryNo} resolved` : `${ticket.referenceNo} corrected`,
      );
      void onRefetch();
    } catch (err) {
      setConfirming(false);
      if (err instanceof ApiError && err.status === 409 && (err.details as { code?: string } | undefined)?.code === 'conflict') {
        setConflict(err.message);
      } else if (err instanceof ApiError && err.status === 0) {
        setError('Couldn’t reach the server. Check your connection — nothing was saved.');
      } else if (err instanceof ApiError && err.status >= 500) {
        setError('Couldn’t save the correction. Nothing was changed. Try again, or contact support if it keeps happening.');
      } else {
        setError(err instanceof Error ? err.message : 'The correction could not be applied.');
      }
    }
  }

  async function deleteRecord() {
    try {
      await mutation.mutateAsync({
        path: `/api/finance/tickets/${ticket.id}/record`,
        method: 'DELETE',
        body: { reason: deleteReason.trim(), confirmDelete: true },
      });
      toast.success(`${ticket.referenceNo} deleted. ${ticket.queryNo} is kept open.`);
      setDeleting(false);
      setDeleteReason('');
      setView('query');
      void onRefetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The record could not be deleted');
    }
  }

  function done() {
    setPending(null);
    void onRefetch();
  }

  const reopenable = (FINANCE_TICKET_REOPENABLE_STATUSES as readonly FinanceTicketStatus[]).includes(ticket.status);
  const nextStatuses = queryDeleted ? [] : FINANCE_TICKET_TRANSITIONS[ticket.status];

  async function runReason(path: string, method: string, body: unknown, success: string): Promise<{ ticket?: FinanceTicket } | null> {
    try {
      const r = (await mutation.mutateAsync({ path, method, body })) as { ticket?: FinanceTicket };
      toast.success(success);
      return r;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The change could not be saved');
      return null;
    }
  }

  const typeLabel = referenceType ? FINANCE_TICKET_REFERENCE_LABELS[referenceType] : 'Record';

  // ---- Header ----
  const header = (
    <div className="flex flex-none items-start gap-3 border-b px-5 pb-3.5 pt-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {view === 'query' && <DialogTitle className="text-lg font-semibold">Finance Query</DialogTitle>}
        {view === 'correct' && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={cancelCorrect} className="font-mono text-sm text-primary hover:underline">
              ← {ticket.queryNo}
            </button>
            <DialogTitle className="text-lg font-semibold">
              Correct finance record — <span className="font-mono font-medium">{ticket.referenceNo}</span>
            </DialogTitle>
          </div>
        )}
        {view === 'success' && <DialogTitle className="text-lg font-semibold">Correction applied</DialogTitle>}
        {view === 'history' && (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setView('query')} className="font-mono text-sm text-primary hover:underline">
              ← {ticket.queryNo}
            </button>
            <DialogTitle className="text-lg font-semibold">Finance Query History</DialogTitle>
          </div>
        )}
        <DialogDescription className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {view === 'correct' ? (
            <span>
              {typeLabel}
              {live?.['branchName'] ? ` · ${String(live['branchName'])}` : ''} · loaded {formatQueryDate(loadedAt)}
            </span>
          ) : (
            <span className="font-mono">{ticket.queryNo}</span>
          )}
          {queryDeleted ? (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">Deleted</span>
          ) : (
            <QueryStatusBadge status={ticket.status} />
          )}
          <span>Priority: {FINANCE_QUERY_PRIORITY_LABELS[ticket.priority] ?? ticket.priority}</span>
          {ticket.assignedToName && <span>· Assigned to {ticket.assignedToName}</span>}
        </DialogDescription>
      </div>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="flex h-9 w-9 flex-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
      >
        <X className="h-5 w-5" />
      </button>
    </div>
  );

  // ---- Linked record card ----
  const recordRows = (() => {
    if (!live && !ticket.referenceSnapshot) return [];
    const rec = (live ?? ticket.referenceSnapshot) as Record<string, unknown>;
    const rows: { key: string; label: string; value: string }[] = [];
    if (referenceType) {
      for (const f of fields) {
        if (f.kind !== 'money') continue;
        const v = financeAmendableValue(referenceType, rec, f.key);
        rows.push({ key: f.key, label: f.label, value: format(Number(v || 0)) });
      }
    }
    const taken = new Set(fields.filter((f) => f.kind === 'money').map((f) => f.key));
    for (const fact of RECORD_FACTS) {
      const key = fact.keys.find((k) => !taken.has(k) && rec[k] !== null && rec[k] !== undefined && rec[k] !== '');
      if (!key) continue;
      const raw = String(rec[key]);
      rows.push({ key, label: fact.label, value: fact.kind === 'date' ? fmtDate(raw) : fact.kind === 'type' ? titleCase(raw) : raw });
    }
    return rows;
  })();
  const createdBy = String((live ?? ticket.referenceSnapshot)?.['createdByName'] ?? '') || null;
  const updatedAt = ((live ?? ticket.referenceSnapshot)?.['updatedAt'] ??
    (live ?? ticket.referenceSnapshot)?.['postedAt'] ??
    (live ?? ticket.referenceSnapshot)?.['createdAt']) as string | undefined;

  // What the record says that this desk may not change — shown, never typed into.
  const editableKeys = new Set([
    ...fields.map((f) => f.key),
    ...(fields.some((f) => f.kind === 'head') ? ['ledgerHeadName', 'category'] : []),
    ...(fields.some((f) => f.kind === 'branch') ? ['branchName'] : []),
  ]);
  const readOnlyRows = recordRows.filter((r) => !editableKeys.has(r.key));

  const queryRows: { label: string; value: string; mono?: boolean; wide?: boolean }[] = [
    { label: 'Subject', value: ticket.subject || '—' },
    { label: 'Query type', value: FINANCE_QUERY_TYPE_LABELS[ticket.queryType] ?? ticket.queryType },
    ...(ticket.amount === null || ticket.amount === undefined ? [] : [{ label: 'Amount', value: format(Number(ticket.amount)) }]),
    ...(ticket.branchName ? [{ label: 'Branch', value: ticket.branchName }] : []),
    ...(ticket.businessDate ? [{ label: 'Business date', value: fmtDate(ticket.businessDate) }] : []),
    ...(ticket.referenceNo ? [{ label: 'Reference ID', value: ticket.referenceNo, mono: true }] : []),
    { label: 'Raised by', value: `${ticket.raisedByName ?? '—'} · ${formatQueryDate(ticket.createdAt)}` },
    { label: 'Description', value: ticket.message || '—', wide: true },
    ...(ticket.remarks ? [{ label: 'Remarks', value: ticket.remarks, wide: true }] : []),
  ];

  // ---- Body per view ----
  let body: React.ReactNode;
  let footer: React.ReactNode;

  if (view === 'query') {
    body = (
      <div className="flex flex-col gap-5">
        {queryDeleted && (
          <div className="rounded-lg bg-destructive/10 px-3.5 py-3 text-sm text-destructive">
            Deleted by {ticket.deletedByName ?? '—'} on {formatQueryDate(ticket.deletedAt)} — {ticket.deleteReason ?? '—'}. Restore
            it to edit or answer it again.
          </div>
        )}

        <section className="flex flex-col gap-3">
          <span className={sectionLabel}>Query</span>
          <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,160px),1fr))] gap-x-4 gap-y-3">
            {queryRows.map((r) => (
              <div key={r.label} className={cn('flex min-w-0 flex-col gap-0.5', r.wide && 'col-span-full')}>
                <dt className="text-xs text-muted-foreground">{r.label}</dt>
                <dd className={cn('break-words text-sm font-medium', r.mono && 'font-mono', r.wide && 'whitespace-pre-wrap font-normal')}>{r.value}</dd>
              </div>
            ))}
          </dl>
          <AttachmentGallery attachments={ticket.attachments} title="Attachments" emptyText="No attachments" />
        </section>

        {ticket.referenceNo && (
          <section className="flex flex-col gap-3 rounded-lg border bg-muted/40 p-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex min-w-[180px] flex-1 flex-col gap-0.5">
                <span className={sectionLabel}>Linked record</span>
                <span className="text-[15px] font-semibold">
                  {typeLabel} · <span className="font-mono font-medium">{ticket.referenceNo}</span>
                </span>
              </div>
              {recordDeleted ? (
                <span className="rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive">Record deleted</span>
              ) : canCorrect ? (
                <Button className="h-10" onClick={openCorrect}>
                  Correct record
                </Button>
              ) : null}
            </div>
            {recordRows.length > 0 && (
              <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-x-4 gap-y-3">
                {recordRows.map((r) => (
                  <div key={r.label} className="flex min-w-0 flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">{r.label}</dt>
                    <dd className="break-words text-sm font-medium tabular-nums">{r.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            {(createdBy || updatedAt) && (
              <p className="text-xs text-muted-foreground">
                {createdBy ? `Created by ${createdBy}` : ''}
                {createdBy && updatedAt ? ' · ' : ''}
                {updatedAt ? `Last updated ${formatQueryDate(updatedAt)}` : ''}
              </p>
            )}
            {referenceType && !isFinanceRecordAmendable(referenceType) && (
              <p className="text-xs text-muted-foreground">
                A {typeLabel.toLowerCase()} is corrected in the Support Center, where its lines, totals and stock are reconciled
                together.
              </p>
            )}
          </section>
        )}
      </div>
    );

    const action = 'h-10 px-3';
    footer = (
      <div className="flex w-full flex-wrap gap-2">
        {canTouchRecord && !recordDeleted && (
          <Button variant="outline" className={cn(action, 'border-destructive/40 text-destructive hover:bg-destructive/10')} onClick={() => setDeleting(true)}>
            Delete record
          </Button>
        )}
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          {queryDeleted ? (
            <Button className={action} onClick={() => setPending({ kind: 'restore' })}>
              Restore
            </Button>
          ) : (
            <Button variant="outline" className={action} onClick={() => setPending({ kind: 'assign' })}>
              Assign
            </Button>
          )}
          <Button variant="outline" className={action} onClick={() => setView('history')}>
            View History
          </Button>
          {reopenable && !queryDeleted && (
            <Button variant="outline" className={action} onClick={() => setPending({ kind: 'reopen' })}>
              Reopen
            </Button>
          )}
          {nextStatuses.map((s) => (
            <Button
              key={s}
              variant="outline"
              className={cn(action, s === 'rejected' && 'text-destructive')}
              onClick={() => setPending({ kind: 'status', target: s })}
            >
              {s === 'under_review' ? 'In review' : s === 'resolved' ? 'Resolve without change' : s === 'rejected' ? 'Reject' : s === 'closed' ? 'Close query' : FINANCE_TICKET_STATUS_LABELS[s]}
            </Button>
          ))}
          {!queryDeleted && (
            <Button variant="ghost" className={cn(action, 'text-destructive')} onClick={() => setPending({ kind: 'deleteQuery' })}>
              Delete query
            </Button>
          )}
        </div>
      </div>
    );
  } else if (view === 'correct') {
    body = (
      <div className="flex flex-col gap-4">
        {conflict && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-amber-100 px-3.5 py-3 text-sm text-amber-900 dark:bg-amber-950/60 dark:text-amber-200">
            <span className="min-w-[200px] flex-1">{conflict}</span>
            <Button size="sm" variant="outline" className="h-9" onClick={() => void reloadLatest()}>
              Reload latest version
            </Button>
          </div>
        )}
        {error && <div className="rounded-lg bg-destructive/10 px-3.5 py-3 text-sm text-destructive">{error}</div>}
        {reloaded && !conflict && (
          <div className="rounded-lg bg-sky-100 px-3.5 py-3 text-sm text-sky-900 dark:bg-sky-950/60 dark:text-sky-200">
            Loaded the latest version of {ticket.referenceNo}. Your earlier edits were cleared; make your correction again.
          </div>
        )}
        {(referenceType === 'ledger_entry' || (referenceType === 'finance_transaction' && approved)) && (
          <p className="text-xs text-muted-foreground">
            Applying posts a reversal of the original voucher and one corrected entry carrying every change below; the
            original stays visible. The corrected entry is dated today unless you change the date. Type follows the
            category, so only {recordType || 'same-type'} categories are offered.
          </p>
        )}

        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-x-4 gap-y-3.5">
          {fields.map((spec) => {
            const id = `aq-${spec.key}`;
            const change = changes.find((c) => c.spec.key === spec.key);
            const bad = invalid.includes(spec.key);
            const set = (v: string) => {
              setDraft((d) => ({ ...d, [spec.key]: v }));
              setError(null);
            };
            return (
              <div key={spec.key} className={cn('flex flex-col gap-1.5', spec.kind === 'text' && 'col-span-full')}>
                <label htmlFor={id} className={cn(fieldLabel, 'flex items-center gap-2')}>
                  {spec.label}
                  {change && (
                    <span className="rounded bg-amber-100 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                      Edited
                    </span>
                  )}
                </label>
                {spec.kind === 'money' ? (
                  <div className={cn('flex h-10 items-center overflow-hidden rounded-md border border-input bg-background focus-within:ring-2 focus-within:ring-ring/50', bad && 'border-destructive')}>
                    <span className="flex h-full items-center border-r bg-muted px-2.5 text-sm text-muted-foreground">Rs.</span>
                    <input
                      id={id}
                      inputMode="decimal"
                      maxLength={16}
                      value={draft[spec.key] ?? ''}
                      onChange={(e) => set(e.target.value.replace(/[^\d.]/g, ''))}
                      aria-invalid={bad || undefined}
                      className="h-full min-w-0 flex-1 bg-transparent px-3 font-mono text-[15px] outline-none"
                    />
                  </div>
                ) : spec.kind === 'select' ? (
                  <select id={id} value={draft[spec.key] ?? ''} onChange={(e) => set(e.target.value)} className={control}>
                    {!(spec.options ?? []).some((o) => o.value === current[spec.key]) && (
                      <option value={current[spec.key] ?? ''}>{current[spec.key] ? titleCase(current[spec.key]!) : '—'}</option>
                    )}
                    {(spec.options ?? []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : spec.kind === 'date' ? (
                  <input id={id} type="date" max={businessDateStr()} value={draft[spec.key] ?? ''} onChange={(e) => set(e.target.value)} className={control} />
                ) : spec.kind === 'head' ? (
                  <select id={id} value={draft[spec.key] ?? ''} onChange={(e) => set(e.target.value)} className={control}>
                    {!headOptions.some((h) => h.id === current[spec.key]) && (
                      <option value={current[spec.key] ?? ''}>{currentHeadName}</option>
                    )}
                    {headOptions.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name}
                      </option>
                    ))}
                  </select>
                ) : spec.kind === 'branch' ? (
                  <select id={id} value={draft[spec.key] ?? ''} onChange={(e) => set(e.target.value)} className={control}>
                    <option value="">Company-wide</option>
                    {current[spec.key] && !branches.some((b) => b.id === current[spec.key]) && (
                      <option value={current[spec.key]}>{currentBranchName}</option>
                    )}
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input id={id} value={draft[spec.key] ?? ''} maxLength={500} onChange={(e) => set(e.target.value)} className={control} />
                )}
                {bad ? (
                  <span className="text-xs text-destructive">Enter an amount of 0 or more, up to 2 decimal places.</span>
                ) : spec.kind === 'money' ? (
                  <span className="flex flex-wrap gap-x-4 text-xs text-muted-foreground tabular-nums">
                    <span>
                      Was <span className="font-medium text-foreground">{shown(spec, current[spec.key] ?? '')}</span>
                    </span>
                    <span>
                      Difference{' '}
                      <span className="font-semibold text-foreground">{change?.difference ? signed(change.difference) : '—'}</span>
                    </span>
                  </span>
                ) : change ? (
                  <span className="text-xs text-muted-foreground">Was {shown(spec, change.from)}</span>
                ) : null}
              </div>
            );
          })}
        </div>

        {readOnlyRows.length > 0 && (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-x-4 gap-y-3.5">
            {readOnlyRows.map((r) => (
              <div key={r.label} className="flex min-w-0 flex-col gap-1.5">
                <span className={fieldLabel}>{r.label}</span>
                <span
                  title={`${r.label} cannot be changed on a ${typeLabel.toLowerCase()}`}
                  className="flex min-h-10 items-center break-words rounded-md border border-dashed bg-muted/50 px-3 py-2 text-sm text-muted-foreground"
                >
                  {r.value}
                </span>
              </div>
            ))}
          </div>
        )}

        <section className="flex flex-col gap-2.5 rounded-lg bg-muted/60 px-4 py-3.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className={sectionLabel}>Changes</span>
            <span className="text-xs text-muted-foreground">
              {changes.length === 0 ? 'None' : `${changes.length} field${changes.length === 1 ? '' : 's'}`}
            </span>
          </div>
          {changes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No changes detected.</p>
          ) : (
            changes.map((c) => (
              <div key={c.spec.key} className="grid grid-cols-[minmax(90px,140px)_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 text-sm">
                <span className="text-muted-foreground">{c.spec.label}</span>
                <span className="flex flex-wrap items-baseline gap-1.5 break-words tabular-nums">
                  <span className="text-muted-foreground line-through">{shown(c.spec, c.from)}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="font-semibold">{shown(c.spec, c.to)}</span>
                  {c.difference !== null && (
                    <span className="rounded bg-background px-1.5 py-px font-mono text-xs">{signed(c.difference)}</span>
                  )}
                </span>
              </div>
            ))
          )}
        </section>

        {approved && changes.length > 0 && (
          <label className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
            <input type="checkbox" checked={overwriteOk} onChange={(e) => setOverwriteOk(e.target.checked)} className="mt-0.5 h-[18px] w-[18px] accent-[var(--primary)]" />
            <span>
              {ticket.referenceNo} is an approved financial record. I understand this overwrites it, and that the change is
              recorded in the audit trail against {ticket.queryNo}.
            </span>
          </label>
        )}

        <div className="flex flex-col gap-1.5">
          <label htmlFor="aq-note" className={fieldLabel}>
            Note (optional)
          </label>
          <Textarea id="aq-note" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason for the correction" />
        </div>

        {canResolve ? (
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm">
            <input type="checkbox" checked={resolve} onChange={(e) => setResolve(e.target.checked)} className="h-[18px] w-[18px] accent-[var(--primary)]" />
            <span>Resolve {ticket.queryNo} when applied</span>
          </label>
        ) : (
          <p className="text-xs text-muted-foreground">
            {ticket.queryNo} is {FINANCE_TICKET_STATUS_LABELS[ticket.status]}, so the correction is applied without changing its status.
          </p>
        )}
      </div>
    );
    footer = (
      <div className="flex w-full flex-wrap items-center gap-2">
        <Button variant="outline" className="mr-auto h-11 border-destructive/40 text-destructive hover:bg-destructive/10" onClick={() => setDeleting(true)}>
          Delete record
        </Button>
        <Button variant="outline" className="h-11" onClick={closeCorrect}>
          Cancel
        </Button>
        <Button className="h-11 w-full sm:w-auto sm:max-w-60 sm:flex-[1_1_180px]" disabled={applyDisabled} onClick={() => { setError(null); setConfirming(true); }}>
          {willResolve ? 'Apply & Resolve' : 'Apply changes'}
        </Button>
      </div>
    );
  } else if (view === 'success') {
    body = (
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-emerald-100 text-xl font-bold text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
            ✓
          </span>
          <span className="flex flex-col">
            <span className="text-lg font-semibold">Finance record corrected</span>
            <span className="text-sm text-muted-foreground">
              {ticket.referenceNo} updated{ticket.status === 'resolved' ? ` and ${ticket.queryNo} resolved` : ''}.
            </span>
          </span>
        </div>
        <dl className="grid grid-cols-[minmax(80px,120px)_minmax(0,1fr)] gap-x-4 gap-y-3 text-sm">
          <dt className="text-muted-foreground">Record</dt>
          <dd className="font-mono">{ticket.referenceNo}</dd>
          <dt className="text-muted-foreground">Changes</dt>
          <dd className="flex flex-col gap-1 tabular-nums">
            {lastApplied.map((c) => (
              <span key={c.label}>
                {c.label} {c.from} → <strong>{c.to}</strong>
                {c.detail && <span className="block text-xs text-muted-foreground">{c.detail}</span>}
              </span>
            ))}
          </dd>
          <dt className="text-muted-foreground">Query</dt>
          <dd className="font-mono">{ticket.queryNo}</dd>
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            <QueryStatusBadge status={ticket.status} />
          </dd>
        </dl>
      </div>
    );
    footer = (
      <div className="flex w-full flex-wrap justify-end gap-2">
        <Button variant="outline" className="h-11" onClick={() => setView('history')}>
          View History
        </Button>
        <Button className="h-11" onClick={onClose}>
          Done
        </Button>
      </div>
    );
  } else {
    const entries = [...(ticket.auditTrail ?? [])].reverse();
    body =
      entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing recorded yet.</p>
      ) : (
        <ol className="flex flex-col">
          {entries.map((h) => (
            <li key={h.id} className="flex flex-col gap-2 border-b py-3.5 last:border-b-0">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-[15px] font-semibold">{h.summary}</span>
                {h.source === 'record' && (
                  <span className="rounded bg-muted px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Record</span>
                )}
                <span className="text-sm text-muted-foreground">
                  {h.actorName} · {formatQueryDate(h.at)}
                </span>
              </div>
              {h.changes.map((l, i) => (
                <div key={`${h.id}-${i}`} className="grid grid-cols-[minmax(90px,130px)_minmax(0,1fr)] gap-3 text-sm">
                  <span className="text-muted-foreground">{l.field}</span>
                  <span className="break-words tabular-nums">
                    {l.from !== null && <>{asMoney(l.from)} → </>}
                    <strong>{l.to === null ? '—' : asMoney(l.to)}</strong>
                  </span>
                </div>
              ))}
              {h.reason && (
                <div className="grid grid-cols-[minmax(90px,130px)_minmax(0,1fr)] gap-3 text-sm">
                  <span className="text-muted-foreground">Reason</span>
                  <span className="break-words">{h.reason}</span>
                </div>
              )}
            </li>
          ))}
        </ol>
      );
    footer = (
      <div className="flex w-full justify-end">
        <Button variant="outline" className="h-11" onClick={() => setView('query')}>
          Back to query
        </Button>
      </div>
    );
  }

  return (
    <>
      <Dialog open onOpenChange={(v) => !v && onClose()}>
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 md:max-h-[calc(100dvh-100px)] md:max-w-[760px] md:pb-0"
        >
          {header}
          <div className="min-h-0 flex-1 overflow-y-auto p-5">{body}</div>
          <div className="flex flex-none flex-wrap items-center gap-2 border-t bg-popover px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:pb-3">
            {footer}
          </div>

          {confirming && (
            <Overlay>
              <p className="text-[17px] font-semibold">
                {willResolve
                  ? `Apply changes to ${ticket.referenceNo} and resolve the query?`
                  : `Apply these changes to ${ticket.referenceNo}?`}
              </p>
              <div className="flex flex-col gap-1.5 text-sm tabular-nums">
                {changes.map((c) => (
                  <span key={c.spec.key}>
                    <span className="text-muted-foreground">{c.spec.label}</span> {shown(c.spec, c.from)} → <strong>{shown(c.spec, c.to)}</strong>
                  </span>
                ))}
              </div>
              {note.trim() && <p className="text-sm text-muted-foreground">Reason: {note.trim()}</p>}
              {willResolve && (
                <p className="text-xs text-muted-foreground">
                  The record is corrected and {ticket.queryNo} is resolved together — if either fails, neither happens.
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" className="h-11" disabled={correctMutation.isPending} onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
                <Button className="h-11" disabled={correctMutation.isPending} onClick={() => void confirmApply()}>
                  {correctMutation.isPending ? (
                    <>
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" /> Applying…
                    </>
                  ) : willResolve ? (
                    'Apply & Resolve'
                  ) : (
                    'Apply changes'
                  )}
                </Button>
              </div>
            </Overlay>
          )}

          {deleting && (
            <Overlay>
              <p className="text-[17px] font-semibold text-destructive">Delete {ticket.referenceNo}?</p>
              <p className="text-sm text-muted-foreground">
                The {typeLabel.toLowerCase()} is removed using the existing delete flow and kept on file for an Admin. Query{' '}
                {ticket.queryNo} is kept and stays open.
                {referenceType === 'ledger_entry' && ' Deleting a posted voucher recomputes the running balance on every later entry.'}
                {referenceType === 'cash_transfer' && ' If the deposit was approved, its RV- entries leave the Daily Ledger with it.'}
              </p>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="aq-del-reason" className={fieldLabel}>
                  Reason
                </label>
                <Textarea id="aq-del-reason" rows={2} value={deleteReason} onChange={(e) => setDeleteReason(e.target.value)} placeholder="Why this record is being deleted" autoFocus />
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" className="h-11" disabled={mutation.isPending} onClick={() => setDeleting(false)}>
                  Cancel
                </Button>
                <Button variant="destructive" className="h-11" disabled={mutation.isPending || deleteReason.trim().length < 3} onClick={() => void deleteRecord()}>
                  {mutation.isPending ? 'Deleting…' : 'Delete record'}
                </Button>
              </div>
            </Overlay>
          )}
        </DialogContent>
      </Dialog>

      {/* The query's own actions keep their existing dialogs and endpoints. */}
      {pending?.kind === 'restore' && (
        <ReasonDialog
          title={`Restore — ${ticket.queryNo}`}
          description="Brings the query back to the desk exactly as it was when it was deleted, with its status and history."
          confirmLabel="Restore query"
          pending={mutation.isPending}
          onConfirm={(r) =>
            void runReason(`/api/finance/tickets/${ticket.id}/restore`, 'POST', { reason: r }, `${ticket.queryNo} restored`).then((ok) => ok && done())
          }
          onClose={() => setPending(null)}
        />
      )}
      {pending?.kind === 'assign' && <AssignDialog ticket={ticket} onClose={() => setPending(null)} onDone={done} />}
      {pending?.kind === 'deleteQuery' && <DeleteQueryDialog ticket={ticket} onClose={() => setPending(null)} onDone={done} />}
      {pending?.kind === 'reopen' && <ReopenDialog ticket={ticket} isAdmin onClose={() => setPending(null)} onDone={done} />}
      {pending?.kind === 'status' && <StatusDialog ticket={ticket} target={pending.target} onClose={() => setPending(null)} onDone={done} />}
    </>
  );
}

/**
 * The row action. Loads the query itself, because the queue row carries no live
 * record and the correction is checked against that.
 */
export function ChangeFiguresDialog({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const { data: ticket, isLoading, error, refetch } = useFinanceTicket(ticketId);
  const live = (ticket as (FinanceTicket & { liveRecord?: Record<string, unknown> | null }) | undefined)?.liveRecord;

  if (!ticket) {
    return (
      <Dialog open onOpenChange={(v) => !v && onClose()}>
        <DialogContent className="md:max-w-sm">
          <DialogTitle>Change figures</DialogTitle>
          {isLoading || !error ? (
            <DialogDescription className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading record…
            </DialogDescription>
          ) : (
            <DialogDescription className="py-2 text-sm text-destructive">
              {error instanceof Error ? error.message : 'Could not load the query'}
            </DialogDescription>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  return <FinanceRecordCorrectionPopup ticket={ticket} live={live} onClose={onClose} onRefetch={() => refetch()} />;
}

/** A confirm panel over the popup itself — the design's in-window overlay. */
function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-foreground/40 p-4">
      <div role="alertdialog" className={cn(box, 'flex w-full max-w-[420px] flex-col gap-3.5 bg-popover p-5 shadow-2xl')}>
        {children}
      </div>
    </div>
  );
}
