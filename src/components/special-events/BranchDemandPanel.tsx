'use client';

import { useState } from 'react';
import { Check, Inbox, X } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { useAuth } from '@/hooks/useAuth';
import { useEventConsolidatedDemand, useEventDemands, useReviewEventDemand } from '@/lib/queries';
import { formatDateTime } from '@/utils/date';
import type { EventBranchDemand, EventDemandStatus } from '@mb/shared';
import { cn } from '@/lib/utils';

/**
 * Every branch's advance demand for one event, plus the consolidated
 * product-wise roll-up Production actually plans against.
 *
 * The two live together because they are the same data at two altitudes, and
 * flipping between "who has submitted" and "how many cakes in total" is the main
 * thing an admin does on this tab.
 */

const DEMAND_STATUS_STYLES: Record<EventDemandStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-muted text-muted-foreground' },
  submitted: { label: 'Submitted', className: 'bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
  approved: { label: 'Approved', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
  rejected: { label: 'Rejected', className: 'bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300' },
  fulfilled: { label: 'Fulfilled', className: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
};

export function DemandStatusBadge({ status }: { status: EventDemandStatus }) {
  const style = DEMAND_STATUS_STYLES[status] ?? DEMAND_STATUS_STYLES.draft;
  return (
    <Badge variant="outline" className={cn('border-transparent', style.className)}>
      {style.label}
    </Badge>
  );
}

export function BranchDemandPanel({
  eventId,
  canReview,
}: {
  eventId: string;
  /** super_admin and production_user may approve/reject. */
  canReview: boolean;
}) {
  const { token } = useAuth();
  const demandsQ = useEventDemands(token, eventId);
  const reviewDemand = useReviewEventDemand(token);
  const [busyId, setBusyId] = useState<string | null>(null);

  const demands = demandsQ.data ?? [];

  async function review(demand: EventBranchDemand, status: 'approved' | 'rejected') {
    setBusyId(demand.id);
    try {
      await reviewDemand.mutateAsync({ demandId: demand.id, status });
      toast.success(status === 'approved' ? 'Demand approved' : 'Demand rejected');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to review demand');
    } finally {
      setBusyId(null);
    }
  }

  if (demandsQ.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  if (demands.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No branch demand yet"
        description="Branches submit their advance demand from the Events screen. Reminders go out automatically once scheduled."
      />
    );
  }

  return (
    <div className="space-y-3">
      {demands.map((demand) => (
        <Card key={demand.id}>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium">{demand.branchName || 'Branch'}</p>
                <p className="text-xs text-muted-foreground">
                  {demand.submittedAt
                    ? `Submitted ${formatDateTime(demand.submittedAt)}${demand.submittedByName ? ` by ${demand.submittedByName}` : ''}`
                    : 'Not submitted yet'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <DemandStatusBadge status={demand.status} />
                {canReview && demand.status === 'submitted' && (
                  <div className="flex gap-1 [&_button]:min-h-11 md:[&_button]:min-h-8">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === demand.id}
                      onClick={() => review(demand, 'approved')}
                    >
                      <Check className="mr-1 h-4 w-4" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === demand.id}
                      onClick={() => review(demand, 'rejected')}
                    >
                      <X className="mr-1 h-4 w-4" /> Reject
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {demand.expectedCustomers !== null && (
              <p className="mt-2 text-sm text-muted-foreground">
                Expected customers: <span className="tabular-nums">{demand.expectedCustomers}</span>
              </p>
            )}
            {demand.notes && <p className="mt-1 text-sm text-muted-foreground">{demand.notes}</p>}

            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-80 text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="py-1 pr-2 font-medium">Product</th>
                    <th className="py-1 pr-2 text-right font-medium">Requested</th>
                    <th className="py-1 text-right font-medium">Approved</th>
                  </tr>
                </thead>
                <tbody>
                  {demand.items.map((item) => (
                    <tr key={item.id} className="border-b last:border-0">
                      <td className="py-1.5 pr-2">{item.productName}</td>
                      <td className="py-1.5 pr-2 text-right tabular-nums">{item.qty}</td>
                      <td className="py-1.5 text-right tabular-nums">
                        {item.approvedQty === null ? '—' : item.approvedQty}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {demand.reviewRemarks && (
              <p className="mt-2 text-xs text-muted-foreground">Review note: {demand.reviewRemarks}</p>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/** Product-wise roll-up across every submitted branch demand. */
export function ConsolidatedDemandPanel({ eventId }: { eventId: string }) {
  const { token } = useAuth();
  const consolidatedQ = useEventConsolidatedDemand(token, eventId);

  const rows = consolidatedQ.data?.rows ?? [];
  const branchesIncluded = consolidatedQ.data?.branchesIncluded ?? 0;

  if (consolidatedQ.isLoading) return <Skeleton className="h-48 w-full" />;

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="Nothing to consolidate yet"
        description="Once branches submit their advance demand it is rolled up here, product by product."
      />
    );
  }

  const totalRequested = rows.reduce((sum, r) => sum + r.requestedQty, 0);
  const totalApproved = rows.reduce((sum, r) => sum + r.approvedQty, 0);

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-heading text-sm font-semibold">Consolidated Demand</h3>
          <p className="text-xs text-muted-foreground">
            {branchesIncluded} branch{branchesIncluded === 1 ? '' : 'es'} · {rows.length} product
            {rows.length === 1 ? '' : 's'}
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-96 text-sm">
            <thead>
              <tr className="border-b text-left text-xs text-muted-foreground">
                <th className="py-2 pr-2 font-medium">Product</th>
                <th className="py-2 pr-2 text-right font-medium">Branches</th>
                <th className="py-2 pr-2 text-right font-medium">Requested</th>
                <th className="py-2 text-right font-medium">Approved</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.productId ?? row.productName} className="border-b last:border-0">
                  <td className="py-2 pr-2">{row.productName}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{row.branchCount}</td>
                  <td className="py-2 pr-2 text-right tabular-nums">{row.requestedQty}</td>
                  <td className="py-2 text-right tabular-nums">{row.approvedQty}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="py-2 pr-2">Total</td>
                <td className="py-2 pr-2" />
                <td className="py-2 pr-2 text-right tabular-nums">{totalRequested}</td>
                <td className="py-2 text-right tabular-nums">{totalApproved}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
