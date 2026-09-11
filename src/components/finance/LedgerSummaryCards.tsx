'use client';

import type { LucideIcon } from 'lucide-react';
import { ArrowDownRight, ArrowUpRight, RotateCcw, Scale, Wallet } from 'lucide-react';
import { useLedgerSummary } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils';
import { Money } from './finance-ui';

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

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <SummaryStat label="Opening Balance" value={data?.openingBalance} icon={Wallet} tone="slate" loading={isLoading} />
      <SummaryStat label="Total Amount Received" value={data?.totalReceived} icon={ArrowUpRight} tone="emerald" loading={isLoading} />
      <SummaryStat label="Total Amount Expense" value={data?.totalExpense} icon={ArrowDownRight} tone="red" loading={isLoading} />
      <SummaryStat label="Balance" value={data?.balance} icon={Scale} tone="primary" loading={isLoading} />
    </div>
  );
}

// ---------------------------------------------------------------------------

const TONES: Record<string, string> = {
  primary: 'bg-primary/10 text-primary',
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400',
  red: 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

function SummaryStat({
  label,
  value,
  icon: Icon,
  tone,
  loading,
}: {
  label: string;
  value: number | undefined;
  icon: LucideIcon;
  tone: keyof typeof TONES;
  loading?: boolean;
}) {
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            {loading ? (
              <Skeleton className="h-7 w-28" />
            ) : (
              <p className="text-2xl font-bold text-foreground">
                <Money value={value} />
              </p>
            )}
          </div>
          <div className={cn('flex-shrink-0 rounded-xl p-3', TONES[tone])}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
