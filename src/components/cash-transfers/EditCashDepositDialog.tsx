'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { CashTransfer } from '@mb/shared';
import { useFinanceMutation } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AttachmentGallery } from '@/components/shared/AttachmentGallery';
import { formatDate } from '@/utils/date';
import { CashDepositFormFields, depositDraftError, depositFigures, shortBranch, type CashDepositDraft } from './cashTransferShared';

/**
 * Accounts corrects a branch's deposit before submitting it for approval.
 *
 * Only a deposit still with Accounts opens here; once submitted, Finance Admin
 * approves or rejects it as it stands. The figures and the note change; the
 * branch, the date and the branch's slip photo do not — the photo is what the
 * figures are checked against. Saving keeps the deposit with Accounts: sending
 * it on is its own step (Submit for Approval).
 */

const draftOf = (t: CashTransfer): CashDepositDraft => {
  const v = (n: number) => (n > 0 ? String(n) : '');
  return { cash: v(t.cashAmount), easypaisa: v(t.easypaisaAmount), bank: v(t.bankAmount), fuel: v(t.fuelCharges) };
};

export function EditCashDepositDialog({
  transfer,
  onClose,
}: {
  /** The deposit with Accounts; null closes the dialog. */
  transfer: CashTransfer | null;
  onClose: () => void;
}) {
  return (
    <Dialog open={transfer !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="overflow-y-auto md:max-w-lg">
        {/* Keyed by the deposit, so reopening starts from its saved figures. */}
        {transfer && <EditForm key={transfer.id} transfer={transfer} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function EditForm({ transfer, onClose }: { transfer: CashTransfer; onClose: () => void }) {
  const mut = useFinanceMutation<{ transfer: CashTransfer }>();
  const [draft, setDraft] = useState<CashDepositDraft>(() => draftOf(transfer));
  const [note, setNote] = useState(transfer.note ?? '');

  const figures = depositFigures(draft);
  // The branch's photo stays on the deposit and counts towards the requirement.
  const problem = depositDraftError(draft, transfer.attachments.length);

  async function save() {
    if (problem) {
      toast.error(problem);
      return;
    }
    try {
      await mut.mutateAsync({
        path: `/api/finance/cash-transfers/${transfer.id}`,
        method: 'PUT',
        body: {
          cashAmount: figures.cashAmount,
          easypaisaAmount: figures.easypaisaAmount,
          bankAmount: figures.bankAmount,
          fuelCharges: figures.fuelCharges,
          totalAmount: figures.total,
          note: note.trim() || undefined,
        },
      });
      toast.success(`${transfer.transferNo} saved — submit it for approval when ready.`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save this deposit');
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit {transfer.transferNo}</DialogTitle>
        <DialogDescription>
          {shortBranch(transfer.branchName)} · {formatDate(transfer.date)} — the branch and date stay as they are.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 text-sm">
        <CashDepositFormFields
          idPrefix="accounts-edit"
          draft={draft}
          onDraftChange={setDraft}
          note={note}
          onNoteChange={setNote}
          disabled={mut.isPending}
        />

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">Branch&apos;s payment picture</p>
          <AttachmentGallery
            attachments={transfer.attachments}
            size="sm"
            title={`${transfer.transferNo} payment picture`}
            emptyText="No picture on this deposit."
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={mut.isPending}>
          Cancel
        </Button>
        <Button onClick={() => void save()} disabled={mut.isPending || problem !== null}>
          {mut.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogFooter>
    </>
  );
}
