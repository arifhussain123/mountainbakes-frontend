'use client';

import { createColumnHelper } from '@tanstack/react-table';
import type { ProductionReturn } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useProductionReturns, useReviewReturn } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/shared/DataTable';
import { formatDate } from '@/utils/date';
import { Check, X } from 'lucide-react';
import { toast } from 'sonner';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  accepted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
};
const short = (name: string) => name.replace('Mountain Bakes ', '');

export function ProductionReturnsPage() {
  const { token } = useAuth();
  const returnsQ = useProductionReturns(token);
  const reviewMut = useReviewReturn(token);

  async function review(id: string, status: 'accepted' | 'rejected') {
    try {
      await reviewMut.mutateAsync({ id, status });
      toast.success(status === 'accepted' ? 'Return accepted — added back to production stock' : 'Return rejected');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to review return');
    }
  }

  const col = createColumnHelper<ProductionReturn>();
  const columns = [
    // The global filter only matches what it reaches through the accessor, so the
    // accessor carries both spellings — the ISO date and the displayed one — and
    // "15 Aug", "Aug 2026" and "2026-08-15" all find the row. Keeping the ISO date
    // first also leaves the value sorting chronologically.
    col.accessor((r) => `${r.date} ${formatDate(r.date)}`, {
      id: 'date',
      header: 'Return Date',
      cell: ({ row }) => <span className="text-sm whitespace-nowrap">{formatDate(row.original.date)}</span>,
    }),
    col.accessor('branchName', { header: 'Branch', meta: { mobile: 'subtitle' }, cell: (i) => <span className="font-medium">{short(i.getValue())}</span> }),
    col.accessor('productName', { header: 'Product', meta: { mobile: 'title' }, cell: (i) => <span>{i.getValue()}</span> }),
    col.accessor('qty', { header: 'Qty', cell: (i) => <span className="font-semibold tabular-nums">{i.getValue()}</span> }),
    col.accessor('reason', { header: 'Reason', meta: { mobileFull: true }, cell: (i) => <span className="text-muted-foreground">{i.getValue()}</span> }),
    col.accessor('status', {
      header: 'Status',
      meta: { mobile: 'badge' },
      cell: (i) => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[i.getValue()] ?? 'bg-muted'}`}>{i.getValue()}</span>
      ),
    }),
    col.display({
      id: 'actions',
      header: '',
      cell: ({ row }) => row.original.status === 'pending' ? (
        <div className="flex gap-1.5">
          <Button size="sm" className="h-8" onClick={() => review(row.original.id, 'accepted')} disabled={reviewMut.isPending}>
            <Check className="mr-1 h-3.5 w-3.5" /> Accept
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-red-600" onClick={() => review(row.original.id, 'rejected')} disabled={reviewMut.isPending}>
            <X className="mr-1 h-3.5 w-3.5" /> Reject
          </Button>
        </div>
      ) : <span className="text-xs text-muted-foreground">—</span>,
    }),
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Product Returns</h2>
        <p className="text-sm text-muted-foreground">Last 30 days</p>
      </div>

      <DataTable columns={columns} data={returnsQ.data ?? []} loading={returnsQ.isLoading} searchPlaceholder="Search returns…" />
    </div>
  );
}
