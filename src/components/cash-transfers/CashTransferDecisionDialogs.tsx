'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { CashTransfer, LedgerEntry } from '@mb/shared';
import { useFinanceMutation } from '@/lib/finance';
import { qk } from '@/lib/queryKeys';
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
import { CashDepositBreakdown, shortBranch } from './cashTransferShared';

/**
 * Finance's two decisions on a pending transfer, and the step before them:
 * Accounts submitting it for approval (ForwardCashTransferDialog). Shared by the Cash Transfers
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
            An RV- receipt is posted to the Daily Ledger for the amount below, under Company Share, with
            the branch&apos;s own photo. The transfer becomes final.
          </DialogDescription>
        </DialogHeader>

        {transfer && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md bg-muted/40 p-3 text-sm">
            <dt className="text-muted-foreground">Branch</dt>
            <dd className="text-right font-medium">{shortBranch(transfer.branchName)}</dd>
            <CashDepositBreakdown transfer={transfer} className="col-span-2 border-y py-1.5" />
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

/** Every page of the Cash Transfers board, whatever its filters (qk.financeCashTransfers). */
const CASH_TRANSFER_LISTS = ['finance', 'cashTransfers'] as const;
type CashTransferList = { transfers: CashTransfer[]; total: number };

/**
 * Accounts sends a deposit it has checked on to Finance Admin. After this the
 * deposit can no longer be edited here — Finance Admin approves or rejects it
 * as it stands.
 *
 * Instant: the dialog closes and the row moves to "awaiting approval" on the
 * click, from the cache, while the request runs behind it. Waiting on the
 * server (the write, the notices, the audit row) and then on the refetch of
 * every finance query made the button feel stuck. A refusal — say a 409
 * because someone else submitted it first — puts the cached rows back, shows
 * the server's sentence, and refetches the board.
 */
export function ForwardCashTransferDialog({
  transfer,
  onClose,
}: {
  transfer: CashTransfer | null;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const mut = useFinanceMutation<{ transfer: CashTransfer }>();

  function submit() {
    if (!transfer) return;
    const t = transfer;
    const forwardedAt = new Date().toISOString();
    const markForwarded = (row: CashTransfer): CashTransfer => (row.id === t.id ? { ...row, forwardedAt } : row);

    // A list fetch already in flight would land after this and undo the move.
    void queryClient.cancelQueries({ queryKey: CASH_TRANSFER_LISTS });
    const detailKey = qk.financeCashTransfer(t.id);
    const listsBefore = queryClient.getQueriesData<CashTransferList>({ queryKey: CASH_TRANSFER_LISTS });
    const detailBefore = queryClient.getQueryData<CashTransfer>(detailKey);
    queryClient.setQueriesData<CashTransferList>({ queryKey: CASH_TRANSFER_LISTS }, (old) =>
      old ? { ...old, transfers: old.transfers.map(markForwarded) } : old,
    );
    if (detailBefore) queryClient.setQueryData(detailKey, markForwarded(detailBefore));

    toast.success(`${t.transferNo} submitted for Finance Admin approval`);
    onClose();

    // mutateAsync rather than mutate's callbacks: those are dropped if the page
    // unmounts first, and the rollback must still happen.
    mut
      .mutateAsync({ path: `/api/finance/cash-transfers/${t.id}/forward`, method: 'PUT' })
      .catch((err: unknown) => {
        for (const [key, data] of listsBefore) queryClient.setQueryData(key, data);
        if (detailBefore) queryClient.setQueryData(detailKey, detailBefore);
        void queryClient.invalidateQueries({ queryKey: CASH_TRANSFER_LISTS });
        toast.error(err instanceof Error ? err.message : `Could not submit ${t.transferNo}`);
      });
  }

  return (
    <Dialog open={transfer !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>Submit for approval?</DialogTitle>
          <DialogDescription>
            Finance Admin will approve or reject this deposit as it stands. It can no longer be edited once
            submitted.
          </DialogDescription>
        </DialogHeader>

        {transfer && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md bg-muted/40 p-3 text-sm">
            <dt className="text-muted-foreground">Branch</dt>
            <dd className="text-right font-medium">{shortBranch(transfer.branchName)}</dd>
            <CashDepositBreakdown transfer={transfer} className="col-span-2 border-y py-1.5" />
            <dt className="text-muted-foreground">Transfer ID</dt>
            <dd className="text-right font-mono">{transfer.transferNo}</dd>
          </dl>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!transfer}>
            Submit for Approval
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
