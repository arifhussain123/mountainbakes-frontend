'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useStockRows } from '@/lib/queries';
import { useStockRealtime } from '@/hooks/useStockRealtime';
import { type StockRow, businessDateStr } from '@mb/shared';
import { DataTable } from '@/components/shared/DataTable';
import { Button } from '@/components/ui/button';
import { RotateCcw } from 'lucide-react';
import { createColumnHelper } from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import { ReturnItemsModal } from './ReturnItemsModal';

const col = createColumnHelper<StockRow>();

export function StockPage() {
  const { token, user } = useAuth();
  const [returnOpen, setReturnOpen] = useState(false);

  // On TanStack Query (per the project convention) rather than a one-shot fetch,
  // so an invalidation can reach it — that is what makes the page pick up stock
  // moved elsewhere: a Production approval, or an admin correcting a Help Desk
  // query. `useStockRealtime` fires those invalidations off the notifications
  // stream; the ReturnItemsModal reuses the same refetch after saving.
  const { data: rows = [], isPending, refetch } = useStockRows(token ?? '');
  useStockRealtime();

  const columns = [
    col.accessor('stockCode', { header: 'ID', cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue()}</span> }),
    col.accessor('productName', { header: 'Product', cell: (i) => <span className="font-medium">{i.getValue()}</span> }),
    col.accessor('opening', { header: 'Opening Stock', cell: (i) => <span>{i.getValue()}</span> }),
    col.accessor('newQty', { header: 'New Stock', cell: (i) => <span className="text-emerald-600 dark:text-emerald-400">{i.getValue() ? `+${i.getValue()}` : 0}</span> }),
    col.accessor('sold', { header: 'Sold', cell: (i) => <span className="text-red-600 dark:text-red-400">{i.getValue() ? `-${i.getValue()}` : 0}</span> }),
    col.accessor('returned', { header: 'Returned', cell: (i) => <span className="text-amber-600 dark:text-amber-400">{i.getValue() ? `-${i.getValue()}` : 0}</span> }),
    // Signed, unlike Sold/Returned: an admin correction can go either way, and
    // without it the row does not add up to Balance.
    col.accessor('adjustment', {
      header: 'Adjustment',
      cell: (i) => {
        const v = i.getValue();
        if (!v) return <span>0</span>;
        return <span className="text-sky-600 dark:text-sky-400">{v > 0 ? `+${v}` : v}</span>;
      },
    }),
    col.accessor('balance', {
      header: 'Balance',
      cell: (i) => <span className={cn('font-semibold', i.getValue() < 0 && 'text-destructive')}>{i.getValue()}</span>,
    }),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <Button onClick={() => setReturnOpen(true)} className="order-2 sm:order-1">
          <RotateCcw className="h-4 w-4 mr-1.5" /> Return Items
        </Button>
        <div className="order-1 sm:order-2 sm:text-right">
          <h2 className="text-lg font-semibold">Stock</h2>
          <p className="text-sm text-muted-foreground">{businessDateStr()} · opening carries over from yesterday, new stock added after Production approval, adjustments are admin corrections</p>
        </div>
      </div>

      <DataTable columns={columns} data={rows} loading={isPending} searchPlaceholder="Search products…" pageSize={50} />

      <ReturnItemsModal
        open={returnOpen}
        onOpenChange={setReturnOpen}
        rows={rows}
        branchName={user?.branchName ?? ''}
        onSaved={refetch}
      />
    </div>
  );
}
