'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { Attachment, CashTransfer } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useResubmitCashTransfer } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PhotoCapture } from '@/components/shared/PhotoCapture';
import { AttachmentGallery } from '@/components/shared/AttachmentGallery';
import { formatDate, formatDateTime } from '@/utils/date';
import { XCircle } from 'lucide-react';
import { CashDepositFormFields, depositDraftError, depositFigures, shortBranch, type CashDepositDraft } from './cashTransferShared';

/**
 * Correct a deposit Finance rejected, and send the same CT- back.
 *
 * Opens on the deposit as it was, with Finance's remarks on top — they are
 * what the correction answers. The branch and the date are shown, not
 * offered: a rejection does not move a deposit to another branch or day, and
 * the server would ignore them anyway. The slip photo already on it stays; a
 * new one is added beside it.
 */

const draftOf = (t: CashTransfer): CashDepositDraft => {
  const v = (n: number) => (n > 0 ? String(n) : '');
  return { cash: v(t.cashAmount), easypaisa: v(t.easypaisaAmount), bank: v(t.bankAmount), fuel: v(t.fuelCharges) };
};

/** A UUID where the platform offers one, a time-salted fallback where it does not (plain http). */
function newOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `ctr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function ResubmitCashDepositDialog({
  transfer,
  onClose,
}: {
  /** The rejected deposit; null closes the dialog. */
  transfer: CashTransfer | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={transfer !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="overflow-y-auto md:max-w-lg">
        {/* Keyed by the deposit, so reopening starts from its saved figures. */}
        {transfer && <ResubmitForm key={transfer.id} transfer={transfer} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function ResubmitForm({ transfer, onClose }: { transfer: CashTransfer; onClose: () => void }) {
  const { token } = useAuth();
  const mut = useResubmitCashTransfer(token ?? '');
  const [draft, setDraft] = useState<CashDepositDraft>(() => draftOf(transfer));
  const [note, setNote] = useState(transfer.note ?? '');
  const [photos, setPhotos] = useState<Attachment[]>([]);
  const [opId] = useState(newOperationId);

  const figures = depositFigures(draft);
  // The photo already on the deposit counts towards the requirement.
  const problem = depositDraftError(draft, transfer.attachments.length + photos.length);

  async function resubmit() {
    if (problem) {
      toast.error(problem);
      return;
    }
    try {
      await mut.mutateAsync({
        id: transfer.id,
        clientOperationId: opId,
        cashAmount: figures.cashAmount,
        easypaisaAmount: figures.easypaisaAmount,
        bankAmount: figures.bankAmount,
        fuelCharges: figures.fuelCharges,
        totalAmount: figures.total,
        note: note.trim() || undefined,
        attachmentIds: photos.map((p) => p.id),
      });
      toast.success(`${transfer.transferNo} sent back to Accounts for checking.`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not resubmit this deposit');
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Correct and resubmit {transfer.transferNo}</DialogTitle>
        <DialogDescription>
          {shortBranch(transfer.branchName)} · {formatDate(transfer.date)} — the branch and date stay as they are.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 text-sm">
        <div className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40">
          <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0 text-red-600 dark:text-red-400" />
          <div className="min-w-0 space-y-1">
            <p className="font-semibold text-red-900 dark:text-red-200">Finance remarks</p>
            <p className="whitespace-pre-wrap break-words text-red-900 dark:text-red-200">
              {transfer.rejectionReason ?? 'No remarks were given.'}
            </p>
            <p className="text-xs text-red-800/80 dark:text-red-300/80">
              {transfer.approvedByName ?? 'Finance'}
              {transfer.approvedAt ? ` · ${formatDateTime(transfer.approvedAt)}` : ''}
            </p>
          </div>
        </div>

        <CashDepositFormFields
          idPrefix="resubmit"
          draft={draft}
          onDraftChange={setDraft}
          note={note}
          onNoteChange={setNote}
          disabled={mut.isPending}
        />

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Payment picture on the deposit</p>
          <AttachmentGallery
            attachments={transfer.attachments}
            size="sm"
            title={`${transfer.transferNo} payment picture`}
            emptyText="No picture on this deposit."
          />
        </div>

        <PhotoCapture
          entity="cash_transfer"
          value={photos}
          onChange={setPhotos}
          label="New payment picture (optional)"
          max={1}
          crop
          captureLabel="Capture Picture"
          disabled={mut.isPending}
          hint="Add a clearer or corrected slip if Finance asked for one. The old picture stays on record."
        />
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={mut.isPending}>
          Cancel
        </Button>
        <Button onClick={() => void resubmit()} disabled={mut.isPending || problem !== null}>
          {mut.isPending ? 'Resubmitting…' : 'Resubmit for approval'}
        </Button>
      </DialogFooter>
    </>
  );
}
