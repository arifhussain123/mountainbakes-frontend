'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useStockRows } from '@/lib/queries';
import { useStockRealtime } from '@/hooks/useStockRealtime';
import { type StockRow, businessDateStr } from '@mb/shared';
import { DataTable } from '@/components/shared/DataTable';
import { Button } from '@/components/ui/button';
import { ClipboardCheck, RotateCcw } from 'lucide-react';
import { createColumnHelper } from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import { ReturnItemsModal } from './ReturnItemsModal';
import { StockCheckModal } from './StockCheckModal';

const col = createColumnHelper<StockRow>();

export function StockPage() {
  const { token, user } = useAuth();
  const [returnOpen, setReturnOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);

  // On TanStack Query (per the project convention) rather than a one-shot fetch,
  // so an invalidation can reach it — that is what makes the page pick up stock
  // moved elsewhere: a Production approval, or an admin correcting a Help Desk
  // query. `useStockRealtime` fires those invalidations off the notifications
  // stream; the ReturnItemsModal reuses the same refetch after saving.
  const { data: rows = [], isPending, refetch } = useStockRows(token ?? '');
  useStockRealtime();

  // No Adjustment column on this table: a branch reads its day as stock in and
  // stock out, and a separate signed "correction" line was one concept too many.
  // The correction is never pending — `applyStockMovement` writes the delta to
  // the persisted balance the moment it is made, so Balance already has it out
  // (or in). All that is left is keeping the visible row reconcilable, so each
  // signed adjustment folds into the column that already carries its direction:
  // stock taken away reads as Returned, stock put back as New Stock. Only the
  // display moves — `rows` keeps the raw figures for the modals below, and the
  // admin Support Center still reports Adjustment on its own line.
  const tableRows = useMemo(
    () =>
      rows.map((r) =>
        r.adjustment === 0
          ? r
          : {
              ...r,
              newQty: r.newQty + Math.max(r.adjustment, 0),
              returned: r.returned + Math.max(-r.adjustment, 0),
              adjustment: 0,
            },
      ),
    [rows],
  );

  const columns = [
    col.accessor('stockCode', { header: 'ID', meta: { mobile: 'subtitle' }, cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue()}</span> }),
    // The remaining columns are the day's ledger for this product. As a card they
    // become a label:value grid, which reads like the receipt it describes.
    col.accessor('productName', { header: 'Product', meta: { mobile: 'title' }, cell: (i) => <span className="font-medium">{i.getValue()}</span> }),
    // Every figure in the ledger is centred under its heading (meta.align), which
    // moves the heading with it — a class on the cell alone would leave the two
    // pointing at different places. `tabular-nums` keeps the digits on a fixed
    // width so a centred column of numbers still lines up rather than jittering
    // with each row's digit count.
    col.accessor('opening', {
      header: 'Opening Stock',
      meta: { align: 'center' },
      cell: (i) => <span className="tabular-nums">{i.getValue()}</span>,
    }),
    col.accessor('newQty', {
      header: 'New Stock',
      meta: { align: 'center' },
      cell: (i) => <span className="tabular-nums text-emerald-600 dark:text-emerald-400">{i.getValue() ? `+${i.getValue()}` : 0}</span>,
    }),
    col.accessor('sold', {
      header: 'Sold',
      meta: { align: 'center' },
      cell: (i) => <span className="tabular-nums text-red-600 dark:text-red-400">{i.getValue() ? `-${i.getValue()}` : 0}</span>,
    }),
    col.accessor('returned', {
      header: 'Returned',
      meta: { align: 'center' },
      cell: (i) => <span className="tabular-nums text-amber-600 dark:text-amber-400">{i.getValue() ? `-${i.getValue()}` : 0}</span>,
    }),
    col.accessor('balance', {
      header: 'Balance',
      meta: { align: 'center' },
      cell: (i) => <span className={cn('font-semibold tabular-nums', i.getValue() < 0 && 'text-destructive')}>{i.getValue()}</span>,
    }),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="order-2 flex flex-wrap gap-2 sm:order-1">
          <Button onClick={() => setReturnOpen(true)}>
            <RotateCcw className="h-4 w-4 mr-1.5" /> Return Items
          </Button>
          {/* Read-only counterpart to Return Items: opens the same product list
              with a count box per row and diffs it against Balance. It writes
              nothing, so it needs no geofence gate and no refetch on close. */}
          <Button onClick={() => setCheckOpen(true)}>
            <ClipboardCheck className="h-4 w-4 mr-1.5" /> Stock Check
          </Button>
        </div>
        <div className="order-1 sm:order-2 sm:text-right">
          <h2 className="text-lg font-semibold">Stock</h2>
          <p className="text-sm text-muted-foreground">{businessDateStr()} · opening carries over from yesterday, new stock added after Production approval, admin corrections come off the balance and show under New Stock or Returned</p>
        </div>
      </div>

      <DataTable columns={columns} data={tableRows} loading={isPending} searchPlaceholder="Search products…" pageSize={50} />

      <ReturnItemsModal
        open={returnOpen}
        onOpenChange={setReturnOpen}
        rows={rows}
        branchName={user?.branchName ?? ''}
        onSaved={refetch}
      />

      <StockCheckModal
        open={checkOpen}
        onOpenChange={setCheckOpen}
        rows={rows}
        branchName={user?.branchName ?? ''}
      />
    </div>
  );
}
