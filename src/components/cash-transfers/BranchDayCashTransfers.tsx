'use client';

import { useState } from 'react';
import type { CashTransfer } from '@mb/shared';
import { useFinanceCashTransfers } from '@/lib/finance';
import { Skeleton } from '@/components/ui/skeleton';
import { formatCurrency } from '@/utils/currency';
import { CashTransferDetailsDialog } from './CashTransferDetailsDialog';
import { CashTransferStatusBadge, methodLabel } from './cashTransferShared';

/**
 * The cash transfers a branch recorded on one business day — the read-only
 * link between Branch Income and the handovers behind it.
 *
 * NOT a second income record. Branch Income approves the day's takings off
 * the closing report; a cash transfer is the physical money arriving, booked
 * once, as its own RV- receipt, when Finance approves it. This section lets
 * Finance trace Income → Cash Transfer → Branch → Photo → Voucher on one
 * screen without either record depending on the other.
 */
export function BranchDayCashTransfers({ branchId, date }: { branchId: string; date: string }) {
  const q = useFinanceCashTransfers({ branchId, from: date, to: date, limit: 50, sortBy: 'createdAt', sortDir: 'asc' });
  const [viewRow, setViewRow] = useState<CashTransfer | null>(null);
  const rows = q.data?.transfers ?? [];
  const approvedTotal = rows.filter((t) => t.status === 'approved').reduce((a, t) => a + t.amount, 0);

  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <p className="text-xs text-muted-foreground">Cash transfers this day</p>
        {rows.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Approved: <span className="font-medium text-foreground">{formatCurrency(approvedTotal)}</span>
          </p>
        )}
      </div>
      {q.isLoading ? (
        <Skeleton className="h-8 w-full" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">None recorded.</p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {rows.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => setViewRow(t)}
                className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-2.5 py-1.5 text-left hover:bg-muted/50"
              >
                <span className="font-mono text-xs">{t.transferNo}</span>
                <span className="font-semibold tabular-nums">{formatCurrency(t.amount)}</span>
                <span className="text-muted-foreground">{methodLabel(t.paymentMethod)}</span>
                {t.voucherNo && <span className="font-mono text-xs text-muted-foreground">{t.voucherNo}</span>}
                <CashTransferStatusBadge status={t.status} className="ml-auto" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <CashTransferDetailsDialog transfer={viewRow} open={!!viewRow} onClose={() => setViewRow(null)} />
    </div>
  );
}
