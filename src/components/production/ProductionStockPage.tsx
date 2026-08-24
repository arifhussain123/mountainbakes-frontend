'use client';

import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { businessDateStr, type ProductionStockRow } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useProducts, useProductionOrders, useProductionStock, usePrepareProducts } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable } from '@/components/shared/DataTable';
import { Plus, FileSpreadsheet } from 'lucide-react';
import { formatDate } from '@/utils/date';
import { waitingDemandByProduct } from '@/utils/demandLines';
import { PrepareProductsModal } from './PrepareProductsModal';
import { PreparedDetailExportModal } from './PreparedDetailExportModal';

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

  /**
   * What the branches are still waiting on, per product.
   *
   * TODAY ONLY, and the two columns it feeds are hidden on any other date.
   * The rest of this table is a snapshot of one business day and can be wound
   * back to read a closed one; the demand queue has no history — it is whatever
   * is unverified right now. Subtracting today's queue from a balance that
   * closed last Tuesday would produce a figure describing no moment that ever
   * existed, so the columns simply are not there to misread.
   */
  const ordersQ = useProductionOrders(token, { enabled: Boolean(token) && isToday });
  const waitingByProduct = useMemo(
    () => waitingDemandByProduct(ordersQ.data ?? []),
    [ordersQ.data],
  );
  // Distinguishes "no demand" from "not fetched yet" — a 0 stated before the
  // orders land would show After Demand equal to Balance and quietly say the
  // pool is clear when it may not be.
  const waitingLoaded = ordersQ.data !== undefined;
  const prepareMut = usePrepareProducts(token);
  const [modalOpen, setModalOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // What today already holds per product, so the prepare form can show its
  // entries as the ADDITIONS they are (+5 → 30) rather than as a fresh total.
  // The table is date-scoped, but the form only opens on today (see below), so
  // these figures are always the ones a save will add to.
  const preparedTodayById = useMemo(
    () => Object.fromEntries((stockQ.data ?? []).map((r) => [r.productId, r.preparedToday])),
    [stockQ.data],
  );

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
    // Placed immediately after Balance so the sum reads left to right —
    // Balance − Waiting Demand = After Demand. Returned and Adjustment keep
    // their order behind it; they explain how the day got here, while these two
    // say where it is going.
    //
    // Both are `display` columns: neither figure is on ProductionStockRow. The
    // demand comes from the live order queue, which is not day-scoped and so
    // could not sensibly be served alongside a date's pool figures.
    ...(isToday
      ? [
          col.display({
            id: 'waitingDemand',
            header: 'Waiting Demand',
            meta: { align: 'center' },
            cell: ({ row }) => {
              if (!waitingLoaded) return <span className="tabular-nums text-muted-foreground">—</span>;
              const qty = waitingByProduct.get(row.original.productId) ?? 0;
              return qty > 0 ? (
                <span className="font-medium tabular-nums text-primary">{qty}</span>
              ) : (
                <span className="tabular-nums text-muted-foreground">—</span>
              );
            },
          }),
          col.display({
            id: 'afterDemand',
            header: 'After Demand',
            meta: { align: 'center' },
            cell: ({ row }) => {
              if (!waitingLoaded) return <span className="tabular-nums text-muted-foreground">—</span>;
              const after = row.original.balance - (waitingByProduct.get(row.original.productId) ?? 0);
              // Negative is production still to do before the waiting demands
              // can go out — the same red, and the same meaning, as the Balance
              // Stock column on the Demand Summary.
              return (
                <span className={`font-semibold tabular-nums ${after < 0 ? 'text-red-500' : ''}`}>{after}</span>
              );
            },
          }),
        ]
      : []),
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
          {/* Unlike the table, which can only ever show one day, this export spans
              a From/To window — so it stays available whichever day is on screen. */}
          <Button variant="outline" className="h-9" onClick={() => setExportOpen(true)}>
            <FileSpreadsheet className="mr-1 h-4 w-4" /> Prepared Detail
          </Button>
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

      <PreparedDetailExportModal
        open={exportOpen}
        onOpenChange={setExportOpen}
        token={token}
        defaultDate={date}
      />

      <PrepareProductsModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        products={productsQ.data ?? []}
        loadingProducts={productsQ.isLoading}
        submit={prepareMut.mutateAsync}
        submitting={prepareMut.isPending}
        preparedTodayById={preparedTodayById}
      />
    </div>
  );
}
