'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { CashTransfer } from '@mb/shared';
import { useFinanceCashTransfers } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { AttachmentGallery } from '@/components/shared/AttachmentGallery';
import { formatDate } from '@/utils/date';
import { formatCurrency } from '@/utils/currency';
import { ROUTES } from '@/utils/routes';
import { Banknote, Check, Eye, X } from 'lucide-react';
import { CashTransferDetailsDialog } from './CashTransferDetailsDialog';
import { ApproveCashTransferDialog, RejectCashTransferDialog } from './CashTransferDecisionDialogs';
import { methodLabel, shortBranch } from './cashTransferShared';

/**
 * The Daily Ledger's view of what is WAITING to enter the book.
 *
 * The ledger itself holds only posted vouchers — a pending transfer has no
 * RV- number yet and cannot be a row in it. This panel sits above the book
 * and lists the handovers Finance has not decided, with the same View /
 * Approve / Reject the Cash Transfers page offers, so the person reading the
 * cash book can clear the queue without leaving it. Renders nothing when the
 * queue is empty; a permanently visible empty box would be noise on the one
 * screen Finance reads most.
 */
const PANEL_LIMIT = 10;

export function PendingCashTransfersPanel({ canDecide }: { canDecide: boolean }) {
  const { data, isLoading } = useFinanceCashTransfers({ status: 'pending', limit: PANEL_LIMIT, sortBy: 'createdAt', sortDir: 'asc' });
  const [viewRow, setViewRow] = useState<CashTransfer | null>(null);
  const [approving, setApproving] = useState<CashTransfer | null>(null);
  const [rejecting, setRejecting] = useState<CashTransfer | null>(null);

  const rows = data?.transfers ?? [];
  const total = data?.total ?? 0;
  if (isLoading || rows.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/30">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Banknote className="h-4 w-4 text-amber-700 dark:text-amber-400" />
          Cash transfers awaiting approval
          <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-900 dark:text-amber-100">
            {total}
          </span>
        </p>
        <Link href={ROUTES.FINANCE_CASH_TRANSFERS} className="text-xs font-medium text-primary hover:underline">
          Open Cash Transfers
        </Link>
      </div>

      <ul className="divide-y divide-amber-200/70 dark:divide-amber-900/70">
        {rows.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2 text-sm">
            <span className="font-mono text-xs">{t.transferNo}</span>
            <span className="font-medium">{shortBranch(t.branchName)}</span>
            <span className="font-semibold tabular-nums">{formatCurrency(t.amount)}</span>
            <span className="text-muted-foreground">{methodLabel(t.paymentMethod)} · {formatDate(t.date)}</span>
            <AttachmentGallery attachments={t.attachments} size="xs" title={`${t.transferNo} payment picture`} />
            <span className="ml-auto flex flex-wrap gap-1">
              <Button variant="ghost" size="sm" onClick={() => setViewRow(t)}>
                <Eye className="mr-1.5 h-4 w-4" /> View
              </Button>
              {canDecide && (
                <>
                  <Button variant="ghost" size="sm" className="text-emerald-700 hover:text-emerald-700" onClick={() => setApproving(t)}>
                    <Check className="mr-1.5 h-4 w-4" /> Approve
                  </Button>
                  <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-600" onClick={() => setRejecting(t)}>
                    <X className="mr-1.5 h-4 w-4" /> Reject
                  </Button>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>
      {total > rows.length && (
        <p className="mt-1 text-xs text-muted-foreground">Showing the oldest {rows.length} of {total}.</p>
      )}

      <CashTransferDetailsDialog
        transfer={viewRow}
        open={!!viewRow}
        onClose={() => setViewRow(null)}
        footer={
          canDecide && viewRow ? (
            <>
              <Button variant="outline" className="text-red-600 hover:text-red-600" onClick={() => { setRejecting(viewRow); setViewRow(null); }}>
                <X className="mr-1.5 h-4 w-4" /> Reject
              </Button>
              <Button onClick={() => { setApproving(viewRow); setViewRow(null); }}>
                <Check className="mr-1.5 h-4 w-4" /> Approve
              </Button>
            </>
          ) : null
        }
      />
      <ApproveCashTransferDialog transfer={approving} onClose={() => setApproving(null)} />
      <RejectCashTransferDialog transfer={rejecting} onClose={() => setRejecting(null)} />
    </div>
  );
}
