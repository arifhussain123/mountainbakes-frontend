'use client';

import type { ReactNode } from 'react';
import type { CashTransfer } from '@mb/shared';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { AttachmentGallery } from '@/components/shared/AttachmentGallery';
import { formatDate, formatDateTime, formatTime } from '@/utils/date';
import { formatCurrency } from '@/utils/currency';
import { CashTransferStatusBadge, methodLabel, shortBranch } from './cashTransferShared';

/**
 * The full record of one cash transfer — ONE component for the four places it
 * is read: the branch list, the branch popup, Finance's board and the Daily
 * Ledger. `footer` is where a caller puts its own actions (Finance's Approve /
 * Reject); everything else is the same record read the same way.
 *
 * The photo is shown at the larger gallery size on purpose. Finance's whole
 * decision is whether the slip says what the form says, and a thumbnail is
 * not something a figure can be read off.
 */
export function CashTransferDetailsDialog({
  transfer,
  loading = false,
  open,
  onClose,
  footer,
}: {
  transfer: CashTransfer | null | undefined;
  /** True while a by-id fetch is in flight (the Daily Ledger opens by sourceId). */
  loading?: boolean;
  open: boolean;
  onClose: () => void;
  /** Extra actions rendered before Close. */
  footer?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cash Transfer Details</DialogTitle>
          {transfer && (
            <DialogDescription>
              {transfer.transferNo} · {shortBranch(transfer.branchName)}
            </DialogDescription>
          )}
        </DialogHeader>

        {loading && !transfer ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        ) : transfer ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
            {transfer.deletedAt && (
              <dd className="col-span-2 rounded-md border border-red-200 bg-red-50 p-2.5 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                <span className="font-semibold">Deleted</span> through the Finance Help Desk
                {transfer.deletedQueryNo ? ` (${transfer.deletedQueryNo})` : ''}
                {transfer.deletedByName ? ` by ${transfer.deletedByName}` : ''} on {formatDateTime(transfer.deletedAt)}.
                {transfer.deleteReason ? ` Reason: ${transfer.deleteReason}` : ''}
              </dd>
            )}
            <dt className="text-muted-foreground">Transfer ID</dt>
            <dd className="text-right font-mono font-medium">{transfer.transferNo}</dd>

            <dt className="text-muted-foreground">Voucher No</dt>
            <dd className="text-right font-mono">{transfer.voucherNo ?? '—'}</dd>

            <dt className="text-muted-foreground">Date</dt>
            <dd className="text-right">{formatDate(transfer.date)}</dd>

            <dt className="text-muted-foreground">Time</dt>
            <dd className="text-right tabular-nums">{formatTime(transfer.createdAt)}</dd>

            <dt className="text-muted-foreground">Branch</dt>
            <dd className="text-right font-medium">{shortBranch(transfer.branchName)}</dd>

            <dt className="text-muted-foreground">Amount</dt>
            <dd className="text-right text-base font-semibold tabular-nums">{formatCurrency(transfer.amount)}</dd>

            <dt className="text-muted-foreground">Payment Method</dt>
            <dd className="text-right">{methodLabel(transfer.paymentMethod)}</dd>

            <dt className="text-muted-foreground">Status</dt>
            <dd className="text-right">
              <CashTransferStatusBadge status={transfer.status} />
            </dd>

            <dt className="text-muted-foreground">Submitted by</dt>
            <dd className="truncate text-right">{transfer.createdByName || '—'}</dd>

            <dt className="text-muted-foreground">Submitted at</dt>
            <dd className="text-right">{formatDateTime(transfer.createdAt)}</dd>

            {transfer.status === 'approved' && (
              <>
                <dt className="text-muted-foreground">Approved by</dt>
                <dd className="truncate text-right">{transfer.approvedByName || '—'}</dd>
                <dt className="text-muted-foreground">Approved at</dt>
                <dd className="text-right">{transfer.approvedAt ? formatDateTime(transfer.approvedAt) : '—'}</dd>
              </>
            )}
            {transfer.status === 'rejected' && (
              <>
                <dt className="text-muted-foreground">Rejected by</dt>
                <dd className="truncate text-right">{transfer.approvedByName || '—'}</dd>
                <dt className="text-muted-foreground">Rejected at</dt>
                <dd className="text-right">{transfer.approvedAt ? formatDateTime(transfer.approvedAt) : '—'}</dd>
              </>
            )}

            <dt className="col-span-2 pt-1 text-muted-foreground">Note</dt>
            <dd className="col-span-2 rounded-md bg-muted/40 p-2.5 whitespace-pre-wrap break-words">{transfer.note || '—'}</dd>

            {transfer.approvalNote && (
              <>
                <dt className="col-span-2 pt-1 text-muted-foreground">Finance&apos;s note</dt>
                <dd className="col-span-2 rounded-md bg-muted/40 p-2.5 whitespace-pre-wrap break-words">{transfer.approvalNote}</dd>
              </>
            )}
            {transfer.rejectionReason && (
              <>
                <dt className="col-span-2 pt-1 text-muted-foreground">Rejection reason</dt>
                <dd className="col-span-2 rounded-md border border-red-200 bg-red-50 p-2.5 whitespace-pre-wrap break-words text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                  {transfer.rejectionReason}
                </dd>
              </>
            )}

            <dt className="col-span-2 pt-1 text-muted-foreground">Payment picture</dt>
            <dd className="col-span-2">
              <AttachmentGallery
                attachments={transfer.attachments}
                size="sm"
                title={`${transfer.transferNo} payment picture`}
                emptyText="No picture on this transfer."
              />
            </dd>
          </dl>
        ) : (
          <p className="py-4 text-center text-sm text-muted-foreground">This transfer could not be loaded.</p>
        )}

        <DialogFooter>
          {footer}
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
