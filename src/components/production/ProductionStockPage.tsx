'use client';

import { useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import type { ProductionStockRow } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useProducts, useProductionStock, usePrepareProducts } from '@/lib/queries';import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/shared/DataTable';
import { Plus } from 'lucide-react';
import { PrepareProductsModal } from './PrepareProductsModal';

const col = createColumnHelper<ProductionStockRow>();

export function ProductionStockPage() {
  const { token } = useAuth();
  const stockQ = useProductionStock(token);
  const productsQ = useProducts(token, { isActive: true });
  const prepareMut = usePrepareProducts(token);
  const [modalOpen, setModalOpen] = useState(false);

  const columns = [
    // The STK-###### the Help Desk needs to raise a query against this item —
    // same column, same place as the branch Stock page. It is searchable through
    // the DataTable's filter, so an ID from a ticket finds its row here.
    col.accessor('stockCode', { header: 'ID', meta: { mobile: 'subtitle' }, cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue()}</span> }),
    col.accessor('productName', { header: 'Product', meta: { mobile: 'title' }, cell: (i) => <span className="font-medium">{i.getValue()}</span> }),
    col.accessor('preparedToday', { header: 'Prepared Today', meta: { align: 'center' }, cell: (i) => <span className="tabular-nums">{i.getValue()}</span> }),
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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Production Stock</h2>
          <p className="text-sm text-muted-foreground">Central production pool — today</p>
        </div>
        <Button onClick={() => setModalOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> Today&apos;s Prepared Products
        </Button>
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
