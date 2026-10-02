'use client';

import { RotateCcw } from 'lucide-react';
import { useLedgerSummary } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/EmptyState';
import { FinStat, Money } from './finance-ui';

/**
 * The Daily Ledger's top summary — Opening Balance, Total Amount Received,
 * Total Amount Expense and Balance, month-to-date as of `date`.
 *
 * A separate query from the table below it (`useLedger`): this one is always
 * month-to-date and ignores the table's own from/to/head/type/account/status/
 * search/amount filters, so paging or narrowing the table never moves these
 * four numbers — only the date and branch do, matching what `useLedgerSummary`
 * actually sends the server.
 */
export function LedgerSummaryCards({ date, branchId }: { date: string; branchId?: string }) {
  const { data, isLoading, isError, error, refetch } = useLedgerSummary({ date, branchId });

  if (isError) {
    return (
      <EmptyState
        className="py-6"
        title="Could not load the ledger summary"
        description={error instanceof Error ? error.message : 'Please try again.'}
        action={
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RotateCcw className="h-3.5 w-3.5" />
            Retry
          </Button>
        }
      />
    );
  }

  const money = (v: number | undefined) => <Money value={v} />;
  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      <FinStat label="Opening Balance" value={money(data?.openingBalance)} tone="neutral" loading={isLoading} />
      <FinStat label="Total Amount Received" value={money(data?.totalReceived)} tone="return" loading={isLoading} />
      <FinStat label="Total Amount Expense" value={money(data?.totalExpense)} tone="danger" loading={isLoading} />
      <FinStat label="Balance" value={money(data?.balance)} tone="share" loading={isLoading} inverse />
    </div>
  );
}
