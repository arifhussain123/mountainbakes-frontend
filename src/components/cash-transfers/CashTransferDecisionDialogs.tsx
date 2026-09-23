'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { CashTransfer, LedgerEntry } from '@mb/shared';
import { useFinanceMutation } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatCurrency } from '@/utils/currency';
import { methodLabel, shortBranch } from './cashTransferShared';

/**
 * Finance's two decisions on a pending transfer. Shared by the Cash Transfers
 * board and the Daily Ledger's pending panel, so the two never word the same
 * decision differently.
 *
 * Both go through `useFinanceMutation`, whose success handler invalidates the
 * whole finance subtree — the ledger gains a voucher on approval, and the
 * dashboard, the day's closing and the audit trail all move with it.
 *
 * A lost race ("already approved by someone else", "the finance day is
 * closed") comes back as a 409 with the server's own sentence, which is shown
 * verbatim: it is the one message that tells the operator what actually
 * happened.
 */

export function ApproveCashTransferDialog({
  transfer,
  onClose,
}: {
  transfer: CashTransfer | null;
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const mut = useFinanceMutation<{ transfer: CashTransfer; ledgerEntry: LedgerEntry | null }>();

  function close() {
    if (mut.isPending) return;
    setNote('');
    onClose();
  }

  async function submit() {
    if (!transfer) return;
    try {
      const result = await mut.mutateAsync({
        path: `/api/finance/cash-transfers/${transfer.id}/approve`,
        method: 'PUT',
        body: note.trim() ? { note: note.trim() } : {},
      });
      toast.success(
        result.ledgerEntry
          ? `Approved — receipt ${result.ledgerEntry.voucherNo} posted to the Daily Ledger`
          : `Approved ${transfer.transferNo}`,
      );
      setNote('');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not approve this transfer');
    }
  }

  return (
    <Dialog open={transfer !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>Approve this cash transfer?</DialogTitle>
          <DialogDescription>
            An RV- receipt is posted to the Daily Ledger for the amount below, under Cash Received from Branch, with
            the branch&apos;s own photo. The transfer becomes final.
          </DialogDescription>
        </DialogHeader>

        {transfer && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md bg-muted/40 p-3 text-sm">
            <dt className="text-muted-foreground">Amount</dt>
            <dd className="text-right text-base font-semibold tabular-nums">{formatCurrency(transfer.amount)}</dd>
            <dt className="text-muted-foreground">Branch</dt>
            <dd className="text-right font-medium">{shortBranch(transfer.branchName)}</dd>
            <dt className="text-muted-foreground">Payment</dt>
            <dd className="text-right">{methodLabel(transfer.paymentMethod)}</dd>
            <dt className="text-muted-foreground">Transfer ID</dt>
            <dd className="text-right font-mono">{transfer.transferNo}</dd>
          </dl>
        )}

        <div className="space-y-1">
          <Label htmlFor="cash-transfer-approve-note">Note (optional)</Label>
          <Textarea
            id="cash-transfer-approve-note"
            rows={2}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Recorded on the transfer; the branch sees it."
            disabled={mut.isPending}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={mut.isPending || !transfer}>
            {mut.isPending ? 'Approving…' : 'Confirm Approval'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RejectCashTransferDialog({
  transfer,
  onClose,
}: {
  transfer: CashTransfer | null;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const mut = useFinanceMutation<{ transfer: CashTransfer }>();
  const reasonMissing = reason.trim().length < 3;

  function close() {
    if (mut.isPending) return;
    setReason('');
    onClose();
  }

  async function submit() {
    if (!transfer || reasonMissing) return;
    try {
      await mut.mutateAsync({
        path: `/api/finance/cash-transfers/${transfer.id}/reject`,
        method: 'PUT',
        body: { reason: reason.trim() },
      });
      toast.success(`Rejected ${transfer.transferNo} — the branch has been told why`);
      setReason('');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reject this transfer');
    }
  }

  return (
    <Dialog open={transfer !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>Reject Cash Transfer</DialogTitle>
          <DialogDescription>
            {transfer
              ? `${shortBranch(transfer.branchName)} is refused ${formatCurrency(transfer.amount)} (${transfer.transferNo}). Nothing is booked; the record and its photo are kept, and the branch sees your reason.`
              : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1">
          <Label htmlFor="cash-transfer-reject-reason">
            Rejection Reason <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id="cash-transfer-reject-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="What does not match — the amount, the slip, the date?"
            disabled={mut.isPending}
          />
          {reason !== '' && reasonMissing && <p className="text-xs text-destructive">Say why (at least 3 characters).</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={mut.isPending || reasonMissing || !transfer}>
            {mut.isPending ? 'Rejecting…' : 'Reject'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
