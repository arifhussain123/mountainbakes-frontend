'use client';

import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import type { BranchProductionOrder } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { useProductionOrders, useReviewProductionOrder, useMarkPrinted } from '@/lib/queries';import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/shared/DataTable';
import { Eye } from 'lucide-react';
import { OrderPrintPreview, slipReference } from './OrderPrintPreview';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
};

const short = (name: string) => name.replace('Mountain Bakes ', '');
const col = createColumnHelper<BranchProductionOrder>();

export function ProductionOrdersPage() {
  const { token } = useAuth();
  const { settings } = useSettings();
  const ordersQ = useProductionOrders(token);
  const reviewMut = useReviewProductionOrder(token);
  const printedMut = useMarkPrinted(token);

  const [selected, setSelected] = useState<BranchProductionOrder | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const orders = useMemo(() => ordersQ.data ?? [], [ordersQ.data]);
  const pending = useMemo(() => orders.filter((o) => o.status === 'pending'), [orders]);

  // Demand summary pivots: Product × Branch and Packing Material × Branch, both
  // from pending demands only.
  //
  // Two pivots rather than one: a packing material is not something the factory
  // bakes, and it has no unit price or amount, so mixing it into the Product column
  // would misstate the production plan. They share one `branches` list so the two
  // tables line up column-for-column.
  //
  // `qty` is the requested quantity — correct here because these are WAITING orders,
  // where nothing has been approved yet and `approvedQty` is still null.
  const demand = useMemo(() => {
    const branches = new Set<string>();
    const products = new Map<string, { productName: string; total: number; byBranch: Record<string, number> }>();
    const packing = new Map<string, { materialName: string; total: number; byBranch: Record<string, number> }>();

    for (const o of pending) {
      const branch = short(o.branchName);
      branches.add(branch);

      for (const it of o.items) {
        let row = products.get(it.productId);
        if (!row) { row = { productName: it.productName, total: 0, byBranch: {} }; products.set(it.productId, row); }
        row.total += it.qty;
        row.byBranch[branch] = (row.byBranch[branch] ?? 0) + it.qty;
      }

      // Optional and absent on every demand created before the packing module.
      for (const it of o.packingItems ?? []) {
        let row = packing.get(it.packingMaterialId);
        if (!row) { row = { materialName: it.materialName, total: 0, byBranch: {} }; packing.set(it.packingMaterialId, row); }
        row.total += it.qty;
        row.byBranch[branch] = (row.byBranch[branch] ?? 0) + it.qty;
      }
    }

    return {
      branches: [...branches].sort(),
      rows: [...products.values()].sort((a, b) => b.total - a.total),
      packingRows: [...packing.values()].sort((a, b) => b.total - a.total),
    };
  }, [pending]);

  function openOrder(order: BranchProductionOrder) {
    setSelected(order);
    setModalOpen(true);
  }

  const columns = [
    col.accessor('demandNumber', { header: 'ID', cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue()}</span> }),
    col.display({ id: 'ref', header: 'Order #', cell: ({ row }) => <span className="font-mono text-xs">{slipReference(row.original)}</span> }),
    col.accessor('date', { header: 'Date', cell: (i) => <span className="text-sm">{i.getValue()}</span> }),
    col.accessor('time', { header: 'Time', cell: (i) => <span className="text-sm tabular-nums text-muted-foreground">{i.getValue()}</span> }),
    col.accessor('branchName', { header: 'Branch', cell: (i) => <span className="font-medium">{short(i.getValue())}</span> }),
    col.accessor('createdByName', { header: 'Requested By', cell: (i) => <span className="text-sm text-muted-foreground">{i.getValue()}</span> }),
    col.accessor('status', {
      header: 'Status',
      cell: (i) => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[i.getValue()] ?? 'bg-muted text-muted-foreground'}`}>
          {i.getValue()}
        </span>
      ),
    }),
    col.display({
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <Button size="sm" variant="outline" className="h-8" onClick={() => openOrder(row.original)}>
          <Eye className="mr-1 h-3.5 w-3.5" /> View
        </Button>
      ),
    }),
    // Hidden, search-only. The global filter can only match what a column accessor
    // exposes, so this is what lets someone find a demand by a product OR packing
    // material name without adding either as a visible column.
    col.accessor(
      (o) =>
        [...o.items.map((i) => i.productName), ...(o.packingItems ?? []).map((p) => p.materialName)].join(' '),
      { id: 'contents', header: '' },
    ),
  ];

  return (
    <div className="space-y-6">
      {/* Demand summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Demand Summary — Waiting Orders</CardTitle>
        </CardHeader>
        <CardContent>
          {demand.rows.length === 0 && demand.packingRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No waiting demands right now.</p>
          ) : (
            <>
              {/* Labelled only when there is a second pivot to tell it apart from. */}
              {demand.packingRows.length > 0 && (
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Products</h3>
              )}

              {/* Desktop pivot table */}
              <div className="hidden overflow-x-auto rounded-lg border md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 text-left">
                      <th className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">Product</th>
                      <th className="px-3 py-2 text-right text-xs uppercase tracking-wide text-muted-foreground">Total Demand</th>
                      {demand.branches.map((b) => (
                        <th key={b} className="px-3 py-2 text-right text-xs uppercase tracking-wide text-muted-foreground">{b}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {demand.rows.map((r) => (
                      <tr key={r.productName} className="border-t">
                        <td className="px-3 py-2 font-medium">{r.productName}</td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums text-primary">{r.total}</td>
                        {demand.branches.map((b) => (
                          <td key={b} className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.byBranch[b] ?? '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="space-y-3 md:hidden">
                {demand.rows.map((r) => (
                  <div key={r.productName} className="rounded-lg border bg-card p-3">
                    <div className="flex items-center justify-between">
                      <p className="font-medium">{r.productName}</p>
                      <span className="font-bold tabular-nums text-primary">{r.total}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {demand.branches.map((b) => (
                        <span key={b}>{b}: <span className="font-medium text-foreground">{r.byBranch[b] ?? 0}</span></span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Packing materials — same pivot, its own table. Absent entirely when
                  no waiting demand asked for any, so an ordinary day is unchanged. */}
              {demand.packingRows.length > 0 && (
                <>
                  <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Packing Materials
                  </h3>

                  <div className="hidden overflow-x-auto rounded-lg border md:block">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50 text-left">
                          <th className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">Packing Material</th>
                          <th className="px-3 py-2 text-right text-xs uppercase tracking-wide text-muted-foreground">Total Demand</th>
                          {demand.branches.map((b) => (
                            <th key={b} className="px-3 py-2 text-right text-xs uppercase tracking-wide text-muted-foreground">{b}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {demand.packingRows.map((r) => (
                          <tr key={r.materialName} className="border-t">
                            <td className="px-3 py-2 font-medium">{r.materialName}</td>
                            <td className="px-3 py-2 text-right font-bold tabular-nums text-primary">{r.total}</td>
                            {demand.branches.map((b) => (
                              <td key={b} className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.byBranch[b] ?? '—'}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="space-y-3 md:hidden">
                    {demand.packingRows.map((r) => (
                      <div key={r.materialName} className="rounded-lg border bg-card p-3">
                        <div className="flex items-center justify-between">
                          <p className="font-medium">{r.materialName}</p>
                          <span className="font-bold tabular-nums text-primary">{r.total}</span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          {demand.branches.map((b) => (
                            <span key={b}>{b}: <span className="font-medium text-foreground">{r.byBranch[b] ?? 0}</span></span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Orders list */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Orders</h2>
        <DataTable
          columns={columns}
          data={orders}
          loading={ordersQ.isLoading}
          searchPlaceholder="Search orders, products, packing materials…"
          columnVisibility={{ contents: false }}
        />
      </div>

      <OrderPrintPreview
        open={modalOpen}
        onOpenChange={setModalOpen}
        order={selected}
        settings={settings}
        token={token}
        review={reviewMut.mutateAsync}
        reviewing={reviewMut.isPending}
        markPrinted={printedMut.mutateAsync}
      />
    </div>
  );
}
