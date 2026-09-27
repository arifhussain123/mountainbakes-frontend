'use client';

import { useFinanceCashTransfer } from '@/lib/finance';
import { CashTransferDetailsDialog } from './CashTransferDetailsDialog';

/**
 * The transfer behind a Daily Ledger voucher, opened by the row's `sourceId`.
 * Fetches on open; the dialog shows a skeleton until the record arrives.
 */
export function CashTransferById({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useFinanceCashTransfer(id);
  return (
    <CashTransferDetailsDialog
      transfer={q.data ?? null}
      loading={q.isLoading}
      open={id !== null}
      onClose={onClose}
    />
  );
}
