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
import { DocumentHistory } from './DocumentHistory';
import { SUBMITTED_MESSAGE } from './FinanceEntryForm';
import { Check, CheckCircle2, Clock, Pencil, Send, X, XCircle } from 'lucide-react';

/**
 * One Income & Expense entry, and what can be done with it now.
 *
 * The actions follow the status, and the server enforces the same rules:
 *   draft            — Edit, Submit for Approval (its author's side)
 *   pending_approval — locked to edits; Approve / Reject sit on the table row
 *                      (EntryDecisionButtons), not here
 *   rejected         — the remarks first, then Edit and Correct, Resubmit
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

export function FinanceEntryDetails({
  entry: initial,
  abilities,
  onEdit,
  onClose,
}: {
  entry: FinanceTransaction;
  abilities: FinanceAbilities;
  /** Open the entry form on this entry (Edit / Edit and Correct). */
  onEdit: (entry: FinanceTransaction) => void;
  onClose: () => void;
}) {
  const fresh = useFinanceEntry(initial.id);
  const entry = fresh.data ?? initial;

  const submitMut = useFinanceMutation();
  const [confirm, setConfirm] = useState<'submit' | null>(null);

  const isIncome = entry.txnType === 'income';
  const posted = entry.status === 'posted' || entry.status === 'locked' || entry.status === 'approved';

  async function submit() {
    try {
      await submitMut.mutateAsync({ path: `${BASE}/${entry.id}/submit`, body: {} });
      toast.success(SUBMITTED_MESSAGE);
      setConfirm(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not submit this entry');
    }
  }

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={entry.status} />
        {entry.revision > 1 && <span className="text-xs text-muted-foreground">Revision {entry.revision}</span>}
      </div>

      {entry.status === 'rejected' && (
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40">
          <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600 dark:text-red-400" />
          <div className="min-w-0 space-y-1">
            <p className="font-semibold text-red-900 dark:text-red-200">Finance Admin remarks</p>
            <p className="whitespace-pre-wrap break-words text-red-900 dark:text-red-200">
              {entry.rejectionReason ?? 'No remarks were given.'}
            </p>
            <p className="text-xs text-red-800/80 dark:text-red-300/80">
              Rejected by {entry.rejectedByName ?? '—'}
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
            {entry.submittedAt ? ` on ${formatDateTime(entry.submittedAt)}` : ''}. It cannot be edited while it is
            under review.
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
        <Field label="Created By">
          {entry.createdByName ?? '—'}
          <span className="block text-xs font-normal text-muted-foreground">{formatDateTime(entry.createdAt)}</span>
        </Field>
        <Field label="Submitted By">
          {entry.submittedByName ?? '—'}
          {entry.submittedAt && (
            <span className="block text-xs font-normal text-muted-foreground">{formatDateTime(entry.submittedAt)}</span>
          )}
        </Field>
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

      <DocumentHistory type="finance_transaction" id={entry.id} path={`${BASE}/${entry.id}`} className="border-t pt-3" />

      <div className="flex flex-col gap-2 border-t pt-3 sm:flex-row sm:flex-wrap">
        {entry.status === 'draft' && abilities.create && (
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
        {entry.status === 'rejected' && abilities.create && (
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
 * Approve / Reject for a pending entry, on its table row beside View. The same
 * confirmations the details dialog used to carry: approving asks first (with
 * an optional note) because it posts to the ledger, rejecting asks for remarks.
 */
export function EntryDecisionButtons({
  entry,
  abilities,
}: {
  entry: FinanceTransaction;
  abilities: FinanceAbilities;
}) {
  const approveMut = useFinanceMutation();
  const [confirming, setConfirming] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [approvalNote, setApprovalNote] = useState('');

  if (entry.status !== 'pending_approval' || !abilities.approve) return null;

  const isIncome = entry.txnType === 'income';

  async function approve() {
    try {
      await approveMut.mutateAsync({
        path: `${BASE}/${entry.id}/approve`,
        body: { notes: approvalNote.trim() || undefined },
      });
      toast.success(`${entry.txnNo} approved and posted to the Daily Ledger`);
      setConfirming(false);
      setApprovalNote('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not approve this entry');
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setConfirming(true)}>
        <Check className="h-3.5 w-3.5" />
        Approve
      </Button>
      <Button variant="destructive" size="sm" onClick={() => setRejecting(true)}>
        <X className="h-3.5 w-3.5" />
        Reject
      </Button>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Approve ${entry.txnNo}?`}
        description={
          <>
            This posts <Money value={entry.amount} className="font-semibold" /> to the Daily Ledger under{' '}
            {entry.ledgerHeadName} on {entry.businessDate} and issues its {isIncome ? 'RV-' : 'PV-'} voucher. A posted
            entry can only be changed by a reversal.
          </>
        }
        confirmLabel="Approve and post"
        pending={approveMut.isPending}
        onConfirm={() => void approve()}
      >
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
      </ConfirmDialog>

      <RejectDialog open={rejecting} onOpenChange={setRejecting} path={`${BASE}/${entry.id}/reject`} label={entry.txnNo} />
    </>
  );
}
