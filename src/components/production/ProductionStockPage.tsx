'use client';

import { useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import type { ProductionStockRow } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useProducts, useProductionStock, usePrepareProducts } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable } from '@/components/shared/DataTable';
import { Plus } from 'lucide-react';
import { businessDateStr } from '@mb/shared';
import { formatDate } from '@/utils/date';
import { PrepareProductsModal } from './PrepareProductsModal';

const col = createColumnHelper<ProductionStockRow>();

export function ProductionStockPage() {
  const { token } = useAuth();
  const today = businessDateStr();
  // The pool's day-scoped figures (Prepared / Approved / Sold / Returned) are
  // only ever computed for one business date, so the page needs to say which —
  // and let it be moved back to read a closed day.
  const [date, setDate] = useState(today);
  const isToday = date === today;
  const stockQ = useProductionStock(token, date);
  const productsQ = useProducts(token, { isActive: true });
  const prepareMut = usePrepareProducts(token);
  const [modalOpen, setModalOpen] = useState(false);

  const columns = [
    // The STK-###### the Help Desk needs to raise a query against this item —
    // same column, same place as the branch Stock page. It is searchable through
    // the DataTable's filter, so an ID from a ticket finds its row here.
    col.accessor('stockCode', { header: 'ID', meta: { mobile: 'subtitle' }, cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue()}</span> }),
    col.accessor('productName', { header: 'Product', meta: { mobile: 'title' }, cell: (i) => <span className="font-medium">{i.getValue()}</span> }),
    // Opening first among the figures, as on the branch Stock page — the day's
    // movement is only readable against where the day started.
    col.accessor('opening', { header: 'Opening Stock', meta: { align: 'center' }, cell: (i) => <span className="tabular-nums">{i.getValue()}</span> }),
    col.accessor('preparedToday', { header: 'Prepared', meta: { align: 'center' }, cell: (i) => <span className="tabular-nums">{i.getValue()}</span> }),
    col.accessor('totalStock', { header: 'Total Stock', meta: { align: 'center' }, cell: (i) => <span className="tabular-nums">{i.getValue()}</span> }),
    col.accessor('approvedQty', { header: 'Approved Qty', meta: { align: 'center' }, cell: (i) => <span className="tabular-nums">{i.getValue()}</span> }),
    col.accessor('soldToday', { header: 'Sold', meta: { align: 'center' }, cell: (i) => <span className="tabular-nums">{i.getValue()}</span> }),
    col.accessor('balance', {
      header: 'Balance',
      meta: { align: 'center' },
      cell: (i) => <span className={`font-semibold tabular-nums ${i.getValue() < 0 ? 'text-red-500' : ''}`}>{i.getValue()}</span>,
    }),
    col.accessor('returned', { header: 'Returned', meta: { align: 'center' }, cell: (i) => <span className="tabular-nums text-muted-foreground">{i.getValue()}</span> }),
    // Signed, and its own column: an admin correction can go either way, and
    // folding it into Prepared or Returned would report a correction as one of
    // them. Day-scoped like the rest of this row — it reads 0 tomorrow, its
    // effect already inside Balance.
    col.accessor('adjustment', {
      header: 'Adjustment',
      meta: { align: 'center' },
      cell: (i) => {
        const v = i.getValue();
        if (!v) return <span className="tabular-nums">0</span>;
        return <span className="tabular-nums text-sky-600 dark:text-sky-400">{v > 0 ? `+${v}` : v}</span>;
      },
    }),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Production Stock</h2>
          <p className="text-sm text-muted-foreground">
            Central production pool — {isToday ? 'today' : formatDate(date)}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Date</label>
            <Input
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value || today)}
              className="h-9 w-full sm:w-40"
            />
          </div>
          {/* A prepare always books against the CURRENT business day (the server
              stamps it), so offering the button while a past day is on screen
              would save a figure the table cannot show. */}
          {isToday ? (
            <Button className="h-9" onClick={() => setModalOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> Today&apos;s Prepared Products
            </Button>
          ) : (
            <Button variant="outline" className="h-9" onClick={() => setDate(today)}>
              Back to today
            </Button>
          )}
        </div>
      </div>

      <DataTable columns={columns} data={stockQ.data ?? []} loading={stockQ.isLoading} searchPlaceholder="Search products…" />

      <PrepareProductsModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        products={productsQ.data ?? []}
        loadingProducts={productsQ.isLoading}
        submit={prepareMut.mutateAsync}
        submitting={prepareMut.isPending}
      />
    </div>
  );
}
