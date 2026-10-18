'use client';

import type { ProductionReturnStatus } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranchReturnsSummary } from '@/lib/queries';
import { useStockRealtime } from '@/hooks/useStockRealtime';
import { MonthlyReturnsSummary } from '@/components/stock/MonthlyReturnsSummary';

/**
 * Branch → Return Stock: the month-to-date summary of what this branch has sent
 * back to production.
 *
 * READS ITS OWN ENDPOINT, not Production's. `/api/production-returns` is the
 * Production board — every branch's returns, behind a `super_admin` +
 * `production_user` router that 403s a branch role — so this page is served by
 * `GET /api/stock/returns/summary`, which scopes to the caller's branch off the
 * JWT.
 *
 * Summary only: the item-wise returns table (and its View / Change / Delete /
 * Resubmit actions) was removed from this page at the owner's request.
 */

/**
 * The status wording, which is not just the status capitalised: `pending` and
 * `returned` say who the return is waiting on, which is what the operator needs.
 */
const STATUS_LABELS: Record<ProductionReturnStatus, string> = {
  pending: 'Awaiting Production',
  accepted: 'Approved',
  rejected: 'Rejected',
  returned: 'Sent Back to Fix',
};

export function BranchReturnStockPage() {
  const { token } = useAuth();
  // This branch's month to date — the server reads the branch off the JWT.
  // Under the ['stock'] prefix, so the realtime hook below refreshes it.
  const summaryQ = useBranchReturnsSummary(token);

  // A return moves stock, so the same notification stream that refreshes the
  // Stock page refreshes this summary.
  useStockRealtime();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Return Stock</h2>
          <p className="text-sm text-muted-foreground">
            Stock this branch has sent back to production this month
          </p>
        </div>
      </div>

      <MonthlyReturnsSummary
        summary={summaryQ.data}
        isLoading={summaryQ.isPending}
        isError={summaryQ.isError}
        isFetching={summaryQ.isFetching}
        error={summaryQ.error}
        onRetry={() => void summaryQ.refetch()}
        statusLabels={STATUS_LABELS}
      />
    </div>
  );
}
