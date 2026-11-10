'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  FINANCE_ACCOUNT_LABELS,
  FINANCE_PAYMENT_METHOD_LABELS,
  type FinanceTransaction,
} from '@mb/shared';
import { useFinanceEntry, useFinanceMutation } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AttachmentGallery } from '@/components/shared/AttachmentGallery';
import { ConfirmDialog } from '@/components/purchasing/parts';
import { formatDateTime } from '@/utils/date';
import { Money, StatusBadge, type FinanceAbilities } from './finance-ui';
import { RejectDialog } from './finance-actions';
import { SUBMITTED_MESSAGE } from './FinanceEntryForm';
import { Check, CheckCircle2, Clock, Pencil, Send, Undo2 } from 'lucide-react';

/**
 * One Income & Expense entry, and what can be done with it now.
 *
 * The actions follow the status, and the server enforces the same rules:
 *   draft            — Edit, Submit for Approval (the Accountant only)
 *   pending_approval — for an approver this IS the approval popup: the complete
 *                      entry, an optional note, Approve and post / Edit / Return
 *                      (the row's Approve opens it); the next pending entry
 *                      opens after each decision
 *   rejected         — shown as RETURNED: the remarks first, then Edit and Correct, Resubmit
 *                      (the Accountant only; the list opens it straight in the form)
 *   posted / locked  — who approved it, the voucher, the ledger posting
 *
 * Reads the entry fresh by id, so a decision taken in another tab shows here
 * rather than the row as it was when the list loaded.
 */

const BASE = '/api/finance/income/entries';

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="font-medium break-words">{children}</div>
    </div>
  );
}

/**
 * The entry to open after one has been dealt with: the next row on the page in
 * `status` (a draft for the Accountant, a pending entry for the approver),
 * wrapping round to the top. Null when there is none left on the page.
 */
/** The queue an entry belongs to: the approver's pending pile, or the Accountant's drafts. */
export function queueOf(entry: FinanceTransaction): FinanceTransaction['status'] {
  return entry.status === 'pending_approval' ? 'pending_approval' : 'draft';
}

export function nextInQueue(
  rows: FinanceTransaction[],
  currentId: string,
  status: FinanceTransaction['status'],
): FinanceTransaction | null {
  const at = rows.findIndex((r) => r.id === currentId);
  const ordered = at < 0 ? rows : [...rows.slice(at + 1), ...rows.slice(0, at)];
  return ordered.find((r) => r.id !== currentId && r.status === status) ?? null;
}

export function FinanceEntryDetails({
  entry: initial,
  abilities,
  onEdit,
  onClose,
  onDone,
  queueLeft = 0,
}: {
  entry: FinanceTransaction;
  abilities: FinanceAbilities;
  /** Open the entry form on this entry (Edit / Edit and Correct). */
  onEdit: (entry: FinanceTransaction) => void;
  onClose: () => void;
  /** Called after Submit, Approve or Return went through — the page opens the next one. */
  onDone?: (entry: FinanceTransaction) => void;
  /** How many more entries wait in the same queue on this page (shown as a hint). */
  queueLeft?: number;
}) {
  const fresh = useFinanceEntry(initial.id);
  const entry = fresh.data ?? initial;

  const submitMut = useFinanceMutation();
  const [confirm, setConfirm] = useState<'submit' | null>(null);

  const isIncome = entry.txnType === 'income';
  const posted = entry.status === 'posted' || entry.status === 'locked' || entry.status === 'approved';
  /** This viewer can act on it here (submit it, or approve/return it). */
  const actionable =
    ((entry.status === 'draft' || entry.status === 'rejected') && abilities.review) ||
    (entry.status === 'pending_approval' && abilities.approve);

  async function submit() {
    try {
      await submitMut.mutateAsync({ path: `${BASE}/${entry.id}/submit`, body: {} });
      toast.success(SUBMITTED_MESSAGE);
      setConfirm(null);
      onDone?.(entry);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not submit this entry');
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={entry.status} returned />
        {entry.revision > 1 && <span className="text-xs text-muted-foreground">Revision {entry.revision}</span>}
      </div>

      {entry.status === 'rejected' && (
        <div className="flex items-start gap-2.5 rounded-lg border border-orange-200 bg-orange-50 p-3 dark:border-orange-900 dark:bg-orange-950/40">
          <Undo2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-orange-600 dark:text-orange-400" />
          <div className="min-w-0 space-y-1">
            <p className="font-semibold text-orange-900 dark:text-orange-200">Returned to the Accountant — remarks</p>
            <p className="whitespace-pre-wrap break-words text-orange-900 dark:text-orange-200">
              {entry.rejectionReason ?? 'No remarks were given.'}
            </p>
            <p className="text-xs text-orange-800/80 dark:text-orange-300/80">
              Returned by {entry.rejectedByName ?? '—'}
              {entry.rejectedAt ? ` · ${formatDateTime(entry.rejectedAt)}` : ''}
            </p>
          </div>
        </div>
      )}

      {entry.status === 'pending_approval' && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
          <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-amber-900 dark:text-amber-200">
            Awaiting Finance Admin approval — submitted by {entry.submittedByName ?? '—'}
            {entry.submittedAt ? ` on ${formatDateTime(entry.submittedAt)}` : ''}. While it is under review only an
            approver can edit it.
          </p>
        </div>
      )}

      {posted && (
        <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/40">
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
          <div className="min-w-0 text-emerald-900 dark:text-emerald-200">
            <p>
              Approved by {entry.approvedByName ?? '—'}
              {entry.approvedAt ? ` on ${formatDateTime(entry.approvedAt)}` : ''} and posted to the Daily Ledger
              {entry.voucherNo ? (
                <>
                  {' '}as <span className="font-mono font-semibold">{entry.voucherNo}</span>
                </>
              ) : null}
              .
            </p>
            {entry.approvalNote && <p className="mt-1 whitespace-pre-wrap break-words">“{entry.approvalNote}”</p>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <Field label="Type">
          <span className="capitalize">{entry.txnType}</span>
        </Field>
        <Field label="Date">{entry.businessDate}</Field>
        <Field label="Ledger Head">{entry.ledgerHeadName}</Field>
        <Field label="Branch">{entry.branchName ?? 'Company-wide'}</Field>
        <Field label="Description" wide>
          {entry.description}
        </Field>
        <Field label="Amount">
          <Money
            value={entry.amount}
            className={
              isIncome
                ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                : 'font-semibold text-red-600 dark:text-red-400'
            }
          />
        </Field>
        <Field label="Payment Method">{FINANCE_PAYMENT_METHOD_LABELS[entry.paymentMethod] ?? entry.paymentMethod}</Field>
        <Field label="Account">{FINANCE_ACCOUNT_LABELS[entry.account]}</Field>
        {entry.referenceNo && <Field label="Reference">{entry.referenceNo}</Field>}
        {posted && (
          <Field label="Voucher">
            <span className="font-mono">{entry.voucherNo ?? '—'}</span>
          </Field>
        )}
        {entry.notes?.trim() && (
          <Field label="Notes" wide>
            <span className="whitespace-pre-wrap">{entry.notes.trim()}</span>
          </Field>
        )}
        <div className="col-span-2">
          <p className="text-xs text-muted-foreground">Photo</p>
          <AttachmentGallery
            attachments={entry.attachments}
            title={`${entry.txnNo} receipt`}
            emptyText="No photo — this entry predates the requirement."
            className="mt-1"
          />
        </div>
      </div>


      {queueLeft > 0 && onDone && actionable && (
        <p className="border-t pt-3 text-xs text-muted-foreground">
          {queueLeft} more{' '}
          {entry.status === 'pending_approval'
            ? `${queueLeft === 1 ? 'entry' : 'entries'} waiting for approval`
            : queueLeft === 1 ? 'draft' : 'drafts'}{' '}
          on this page — the next one opens when you are done with this.
        </p>
      )}

      <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:flex-wrap">
        {entry.status === 'draft' && abilities.review && (
          <>
            <Button variant="outline" className="flex-1" onClick={() => onEdit(entry)}>
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </Button>
            <Button className="flex-1" onClick={() => setConfirm('submit')}>
              <Send className="h-3.5 w-3.5" />
              Submit for Approval
            </Button>
          </>
        )}
        {entry.status === 'pending_approval' && abilities.approve && (
          <EntryDecisionButtons entry={entry} abilities={abilities} onEdit={onEdit} onDone={() => onDone?.(entry)} fill />
        )}
        {entry.status === 'rejected' && abilities.review && (
          <>
            <Button variant="outline" className="flex-1" onClick={() => onEdit(entry)}>
              <Pencil className="h-3.5 w-3.5" />
              Edit and Correct
            </Button>
            <Button className="flex-1" onClick={() => setConfirm('submit')}>
              <Send className="h-3.5 w-3.5" />
              Resubmit for Approval
            </Button>
          </>
        )}
        <Button variant="outline" className="flex-1" onClick={onClose}>
          Close
        </Button>
      </div>

      <ConfirmDialog
        open={confirm === 'submit'}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={entry.status === 'rejected' ? `Resubmit ${entry.txnNo}?` : `Submit ${entry.txnNo}?`}
        description={
          entry.status === 'rejected'
            ? 'It goes back to the Finance Admin approval queue as the next revision. It cannot be edited while it is under review.'
            : 'It goes to the Finance Admin approval queue. It cannot be edited while it is under review, and it reaches the Daily Ledger only when approved.'
        }
        confirmLabel={entry.status === 'rejected' ? 'Resubmit' : 'Submit'}
        pending={submitMut.isPending}
        onConfirm={() => void submit()}
      />
    </div>
  );
}

/**
 * The approver's decisions on a pending entry, and the author's Edit.
 *
 * ON A TABLE ROW (compact): Approve does not post from the row — it opens the
 * complete entry (`onReview`), because an approver should see everything,
 * photo included, before it reaches the ledger. Edit and Return work in place.
 *
 * IN THE ENTRY WINDOW (`fill`): the window is the confirmation, so the note and
 * "Approve and post" sit right here and post in one press. There is no Reject:
 * Return is the same request, and every refused entry is meant to come back
 * corrected.
 *
 * For the Accountant on a draft or returned entry: Edit.
 */
export function EntryDecisionButtons({
  entry,
  abilities,
  onEdit,
  onReview,
  onDone,
  fill = false,
}: {
  entry: FinanceTransaction;
  abilities: FinanceAbilities;
  /** Open the entry form on this entry. Without it no Edit button is shown. */
  onEdit?: (entry: FinanceTransaction) => void;
  /** Row only: open the complete entry to approve it there. */
  onReview?: (entry: FinanceTransaction) => void;
  /** Called after Approve or Return went through. */
  onDone?: () => void;
  /** Full-size controls for the entry window's footer, instead of compact row buttons. */
  fill?: boolean;
}) {
  const size = fill ? 'default' : 'sm';
  const cls = fill ? 'flex-1' : undefined;
  const approveMut = useFinanceMutation();
  const [returning, setReturning] = useState(false);
  const [approvalNote, setApprovalNote] = useState('');

  const authorCanEdit = (entry.status === 'draft' || entry.status === 'rejected') && abilities.review;
  if (entry.status !== 'pending_approval' || !abilities.approve) {
    if (!authorCanEdit || !onEdit) return null;
    return (
      <Button variant="outline" size="sm" onClick={() => onEdit(entry)}>
        <Pencil className="h-3.5 w-3.5" />
        Edit
      </Button>
    );
  }

  const isIncome = entry.txnType === 'income';

  async function approve() {
    try {
      await approveMut.mutateAsync({
        path: `${BASE}/${entry.id}/approve`,
        body: { notes: approvalNote.trim() || undefined },
      });
      toast.success(`${entry.txnNo} approved and posted to the Daily Ledger`);
      setApprovalNote('');
      onDone?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not approve this entry');
    }
  }

  return (
    <>
      {fill && (
        <div className="w-full basis-full space-y-2 rounded-lg border bg-muted/40 p-3">
          <p>
            Approving posts <Money value={entry.amount} className="font-semibold" /> to the Daily Ledger under{' '}
            <b>{entry.ledgerHeadName}</b> on {entry.businessDate} and issues its {isIncome ? 'RV-' : 'PV-'} voucher. A
            posted entry can only be changed by a reversal.
          </p>
          <div className="space-y-1">
            <Label htmlFor={`approval-note-${entry.id}`}>Note (optional)</Label>
            <Textarea
              id={`approval-note-${entry.id}`}
              rows={2}
              maxLength={500}
              value={approvalNote}
              onChange={(e) => setApprovalNote(e.target.value)}
              placeholder="e.g. Checked against the bill"
            />
          </div>
        </div>
      )}
      {(fill || onReview) && (
        <Button
          size={size}
          className={cls}
          disabled={approveMut.isPending}
          onClick={() => (fill ? void approve() : onReview?.(entry))}
        >
          <Check className="h-3.5 w-3.5" />
          {fill ? (approveMut.isPending ? 'Approving…' : 'Approve and post') : 'Approve'}
        </Button>
      )}
      {onEdit && (
        <Button variant="outline" size={size} className={cls} disabled={approveMut.isPending} onClick={() => onEdit(entry)}>
          <Pencil className="h-3.5 w-3.5" />
          Edit
        </Button>
      )}
      <Button variant="outline" size={size} className={cls} disabled={approveMut.isPending} onClick={() => setReturning(true)}>
        <Undo2 className="h-3.5 w-3.5" />
        Return
      </Button>

      <RejectDialog
        open={returning}
        onOpenChange={setReturning}
        path={`${BASE}/${entry.id}/reject`}
        label={entry.txnNo}
        verb="return"
        onDone={onDone}
      />
    </>
  );
}
