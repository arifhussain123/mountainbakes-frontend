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
    col.accessor('productName', { header: 'Product', cell: (i) => <span className="font-medium">{i.getValue()}</span> }),
    col.accessor('preparedToday', { header: 'Prepared Today', cell: (i) => <span className="tabular-nums">{i.getValue()}</span> }),
    col.accessor('totalStock', { header: 'Total Stock', cell: (i) => <span className="tabular-nums">{i.getValue()}</span> }),
    col.accessor('approvedQty', { header: 'Approved Qty', cell: (i) => <span className="tabular-nums">{i.getValue()}</span> }),
    col.accessor('soldToday', { header: 'Sold', cell: (i) => <span className="tabular-nums">{i.getValue()}</span> }),
    col.accessor('balance', {
      header: 'Balance',
      cell: (i) => <span className={`font-semibold tabular-nums ${i.getValue() < 0 ? 'text-red-500' : ''}`}>{i.getValue()}</span>,
    }),
    col.accessor('returned', { header: 'Returned', cell: (i) => <span className="tabular-nums text-muted-foreground">{i.getValue()}</span> }),
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
