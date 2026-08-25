'use client';

import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { businessDateStr, type ProductionStockRow } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useProducts, useProductionOrders, useProductionStock, usePrepareProducts } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Plus, FileSpreadsheet, PackageOpen } from 'lucide-react';
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
  /**
   * The products this DAY is about.
   *
   * The API still returns every product carrying a running pool balance —
   * deliberately, because the Demand Summary and the counter-sale check key a map
   * off this same response and read a missing product as zero stock. Dropping
   * rows server-side would tell those screens a product carried over from
   * yesterday has none.
   *
   * The page cannot show them, though. Every column here is now the day alone, so
   * a product that merely holds pool balance renders as a row of zeroes — and
   * `production_stock.balance` is never reset, so before long that is most of the
   * catalogue, burying the handful of lines that actually moved. Filtering here
   * keeps both true: the response stays complete, the sheet stays the day's.
   */
  const dayRows = useMemo(
    () =>
      (stockQ.data ?? []).filter(
        (r) =>
          r.preparedToday !== 0 ||
          r.returned !== 0 ||
          r.approvedQty !== 0 ||
          r.soldToday !== 0 ||
          r.adjustment !== 0,
      ),
    [stockQ.data],
  );

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
    // THE WHOLE ROW IS THE DAY, with no opening balance anywhere in it.
    //
    // The pool used to carry yesterday forward: Total Stock was on-hand-now plus
    // what had left today, and Balance was the running pool total. On a product
    // whose pool sat negative, that reported the units made this morning as a
    // negative — the floor prepared 50 and the sheet said -50. The bakery bakes
    // fresh daily, so the day is read on its own and newly prepared stock lands
    // on the positive figure it actually is.
    //
    // Total Stock and Balance are NOT columns here. Both are still derived and
    // still served — After Demand below is built on `dayBalance`, and the Demand
    // Summary reads it too — they are simply not what this sheet is for. It lists
    // the movements: what was made, what came back, what went out, what was sold.
    //
    //     dayBalance = (prepared + returned) − approved − sold + adjustment
    col.accessor('preparedToday', { header: 'Prepared', meta: { align: 'center' }, cell: (i) => <span className="tabular-nums text-emerald-600 dark:text-emerald-400">{i.getValue()}</span> }),
    col.accessor('returned', { header: 'Returned', meta: { align: 'center' }, cell: (i) => <span className="tabular-nums text-muted-foreground">{i.getValue()}</span> }),
    col.accessor('approvedQty', { header: 'Approved Qty', meta: { align: 'center' }, cell: (i) => <span className="tabular-nums">{i.getValue()}</span> }),
    col.accessor('soldToday', { header: 'Sold', meta: { align: 'center' }, cell: (i) => <span className="tabular-nums">{i.getValue()}</span> }),
    // What is still owed, and what the day comes to once it has gone out.
    // Adjustment keeps its place behind them: it explains how the day got here,
    // while these two say where it is going.
    //
    // After Demand still reads today's balance − waiting demand. The balance
    // itself is no longer a column, so this is where that figure surfaces — as
    // the forward number it was always the more useful half of.
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
              const after = row.original.dayBalance - (waitingByProduct.get(row.original.productId) ?? 0);
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
    // Signed, and its own column: an admin correction can go either way, and
    // folding it into Prepared or Returned would report a correction as one of
    // them. Day-scoped like the rest of this row — it reads 0 tomorrow.
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
            Central production pool — {isToday ? 'today' : formatDate(date)} · this day only,
            with nothing carried over from yesterday. A negative balance is production
            still to do.
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

      {/* The API returns only products that carry a figure, so an empty table means
          the pool is untouched for this day rather than "nothing matched". Passed
          ONLY when the data itself is empty: with rows present, an empty table is a
          search miss and DataTable's own "No results found" is the right message. */}
      <DataTable
        columns={columns}
        data={dayRows}
        loading={stockQ.isLoading}
        searchPlaceholder="Search products…"
        empty={
          dayRows.length === 0 ? (
            <EmptyState
              icon={PackageOpen}
              title={isToday ? 'Nothing in the pool yet today' : `No stock movement on ${formatDate(date)}`}
              description={
                isToday
                  ? 'Products appear here once they are prepared, returned into the pool, sent out or sold today.'
                  : 'Nothing was prepared, returned, sent out or sold on this day.'
              }
              action={
                isToday ? (
                  <Button onClick={() => setModalOpen(true)}>
                    <Plus className="mr-1 h-4 w-4" /> Today&apos;s Prepared Products
                  </Button>
                ) : undefined
              }
            />
          ) : undefined
        }
      />

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
