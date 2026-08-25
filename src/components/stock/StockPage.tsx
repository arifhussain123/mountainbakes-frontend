'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useProductionOrders, useStockRows } from '@/lib/queries';
import { useStockRealtime } from '@/hooks/useStockRealtime';
import { type StockRow, businessDateStr } from '@mb/shared';
import { DataTable } from '@/components/shared/DataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ClipboardCheck, RotateCcw } from 'lucide-react';
import { createColumnHelper, type Table as TanstackTable } from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import { waitingDemandByProduct } from '@/utils/demandLines';
import { ReturnItemsModal } from './ReturnItemsModal';
import { StockCheckModal } from './StockCheckModal';

const col = createColumnHelper<StockRow>();

export function StockPage() {
  const { token, user } = useAuth();
  const [returnOpen, setReturnOpen] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);

  // Which business day the table is showing. Defaults to today, which is the
  // only day the page used to have — every figure below is day-scoped
  // (computeStockRows sums stock_history for ONE business date), so the page was
  // already answering a question about a specific day without letting anyone
  // choose which.
  const [date, setDate] = useState(businessDateStr());
  const isToday = date === businessDateStr();

  // On TanStack Query (per the project convention) rather than a one-shot fetch,
  // so an invalidation can reach it — that is what makes the page pick up stock
  // moved elsewhere: a Production approval, or an admin correcting a Help Desk
  // query. `useStockRealtime` fires those invalidations off the notifications
  // stream; the ReturnItemsModal reuses the same refetch after saving.
  const { data: rows = [], isPending, error, refetch } = useStockRows(token ?? '', { date });
  useStockRealtime();

  /**
   * What this branch has ordered and not yet counted in.
   *
   * THE SIGN IS THE OPPOSITE OF THE PRODUCTION PAGES, and that is the whole
   * reason these columns are named differently. The same unverified demand that
   * the central pool still OWES is stock this branch is still OWED: it leaves
   * the pool and arrives here, both at the moment the branch verifies
   * (migration 58). So Production subtracts it from its balance and a branch
   * ADDS it — Balance + Waiting Demand = Expected Balance, what will be on the
   * shelf once everything on the way has been counted in.
   *
   * No branchId is passed: GET /api/production-orders scopes a branch role to
   * its own branch server-side, so this cannot show another branch's demand
   * even if someone asked it to.
   */
  const ordersQ = useProductionOrders(token ?? '', { enabled: Boolean(token) && isToday });
  const incomingByProduct = useMemo(
    () => waitingDemandByProduct(ordersQ.data ?? []),
    [ordersQ.data],
  );
  // "Not fetched yet" must not render as 0 — an Expected Balance equal to
  // Balance would say nothing is on the way, which is the opposite of unknown.
  const incomingLoaded = ordersQ.data !== undefined;

  // Adjustment is its OWN column. It briefly folded into New Stock / Returned by
  // sign, but that was only ever a workaround for a bug underneath: a return
  // accepted by Production wrote stock_history.type = 'adjustment' instead of
  // 'return', so the Returned column read 0 and the fold was what made the row
  // look right. That is fixed at the source now — a return is typed 'return'
  // whoever recorded it — so 'adjustment' means an admin correction and nothing
  // else, and folding it would disguise a correction as new stock or a return.
  //
  // The figure is DAY-SCOPED: computeStockRows sums stock_history for this
  // business date only, so a correction shows here on the day it is made and the
  // column reads 0 again tomorrow. Its effect is not lost — it is inside the
  // balance that becomes tomorrow's Opening.
  /**
   * Column totals for the footer row.
   *
   * Summed over the FILTERED rows, not the current page: `getRowModel()` is one
   * page, so on a catalogue that spans pages the total would change as you page
   * through and read like a bug. Filtered means the total follows the search box
   * — search "cake" and Balance is the cakes' balance — which is what someone
   * typing in that box wants to know.
   *
   * The totals reconcile the same way each row does:
   * opening + new − sold − returned + adjustment = balance.
   */
  const total = (table: TanstackTable<StockRow>, key: keyof StockRow) =>
    table.getFilteredRowModel().rows.reduce((sum, r) => sum + (Number(r.original[key]) || 0), 0);

  /** A footer figure, styled to match its column's cells. */
  const totalCell = (value: number, tone?: string, sign?: 'minus' | 'signed') => {
    if (!value) return <span className="tabular-nums font-semibold">0</span>;
    const text = sign === 'minus' ? `-${value.toLocaleString()}`
      : sign === 'signed' ? (value > 0 ? `+${value.toLocaleString()}` : value.toLocaleString())
      : value.toLocaleString();
    return <span className={cn('tabular-nums font-semibold', tone)}>{text}</span>;
  };

  const columns = [
    col.accessor('stockCode', {
      header: 'ID',
      meta: { mobile: 'subtitle' },
      cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue()}</span>,
      // Labels the totals row. Lives on the ID column rather than Product so it
      // sits at the far left where a total is looked for.
      footer: () => <span className="text-xs font-semibold uppercase tracking-wide">Total</span>,
    }),
    // The remaining columns are the day's ledger for this product. As a card they
    // become a label:value grid, which reads like the receipt it describes.
    // A discontinued product is listed while it still holds stock or moved today
    // — the units are on the shelf and inside the balance, so leaving it out is
    // what used to make this page's total disagree with the dashboard's
    // Remaining Stock. Badged, because "why is this still here" is the first
    // question it raises.
    col.accessor('productName', {
      header: 'Product',
      meta: { mobile: 'title' },
      cell: (i) => (
        <span className="font-medium">
          {i.getValue()}
          {!i.row.original.isActive && (
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              Discontinued
            </span>
          )}
        </span>
      ),
    }),
    // Every figure in the ledger is centred under its heading (meta.align), which
    // moves the heading with it — a class on the cell alone would leave the two
    // pointing at different places. `tabular-nums` keeps the digits on a fixed
    // width so a centred column of numbers still lines up rather than jittering
    // with each row's digit count.
    col.accessor('opening', {
      header: 'Opening Stock',
      meta: { align: 'center' },
      cell: (i) => <span className="tabular-nums">{i.getValue()}</span>,
      footer: (p) => totalCell(total(p.table, 'opening')),
    }),
    col.accessor('newQty', {
      header: 'New Stock',
      meta: { align: 'center' },
      cell: (i) => <span className="tabular-nums text-emerald-600 dark:text-emerald-400">{i.getValue() ? `+${i.getValue()}` : 0}</span>,
      footer: (p) => totalCell(total(p.table, 'newQty'), 'text-emerald-600 dark:text-emerald-400', 'signed'),
    }),
    col.accessor('sold', {
      header: 'Sold',
      meta: { align: 'center' },
      cell: (i) => <span className="tabular-nums text-red-600 dark:text-red-400">{i.getValue() ? `-${i.getValue()}` : 0}</span>,
      footer: (p) => totalCell(total(p.table, 'sold'), 'text-red-600 dark:text-red-400', 'minus'),
    }),
    col.accessor('returned', {
      header: 'Returned',
      meta: { align: 'center' },
      cell: (i) => <span className="tabular-nums text-amber-600 dark:text-amber-400">{i.getValue() ? `-${i.getValue()}` : 0}</span>,
      footer: (p) => totalCell(total(p.table, 'returned'), 'text-amber-600 dark:text-amber-400', 'minus'),
    }),
    // Signed, unlike Sold/Returned: an admin correction can go either way, and
    // without it the row does not add up to Balance.
    col.accessor('adjustment', {
      header: 'Adjustment',
      meta: { align: 'center' },
      cell: (i) => {
        const v = i.getValue();
        if (!v) return <span className="tabular-nums">0</span>;
        return <span className="tabular-nums text-sky-600 dark:text-sky-400">{v > 0 ? `+${v}` : v}</span>;
      },
      footer: (p) => totalCell(total(p.table, 'adjustment'), 'text-sky-600 dark:text-sky-400', 'signed'),
    }),
    col.accessor('balance', {
      header: 'Balance',
      meta: { align: 'center' },
      cell: (i) => <span className={cn('font-semibold tabular-nums', i.getValue() < 0 && 'text-destructive')}>{i.getValue()}</span>,
      footer: (p) => {
        const v = total(p.table, 'balance');
        return <span className={cn('font-semibold tabular-nums', v < 0 && 'text-destructive')}>{v.toLocaleString()}</span>;
      },
    }),
    // Behind Balance so the sum reads left to right: Balance + Waiting Demand =
    // Expected Balance. Rendered in the same emerald and the same `+N` form as
    // New Stock, because that is what this becomes — these units land in that
    // column on the day the branch verifies them.
    //
    // TODAY ONLY. Every other figure in this row is the ledger for one business
    // date and the page can be wound back to a closed one; what is unverified is
    // only ever "now". Adding today's incoming to last Tuesday's closing balance
    // would state a figure describing no moment that ever existed, so the
    // columns are absent on any other date and the query is not even run.
    //
    // Both are `display` columns: neither figure is on StockRow, and the demand
    // behind them is not day-scoped, so it could not be served alongside one.
    ...(isToday
      ? [
          col.display({
            id: 'waitingDemand',
            header: 'Waiting Demand',
            meta: { align: 'center' },
            cell: ({ row }) => {
              if (!incomingLoaded) return <span className="tabular-nums text-muted-foreground">—</span>;
              const qty = incomingByProduct.get(row.original.productId) ?? 0;
              return (
                <span className="tabular-nums text-emerald-600 dark:text-emerald-400">
                  {qty ? `+${qty}` : 0}
                </span>
              );
            },
            footer: (p) => {
              if (!incomingLoaded) return <span className="tabular-nums font-semibold">—</span>;
              const v = p.table
                .getFilteredRowModel()
                .rows.reduce((sum, r) => sum + (incomingByProduct.get(r.original.productId) ?? 0), 0);
              return totalCell(v, 'text-emerald-600 dark:text-emerald-400', 'signed');
            },
          }),
          col.display({
            id: 'expectedBalance',
            header: 'Expected Balance',
            meta: { align: 'center' },
            cell: ({ row }) => {
              if (!incomingLoaded) return <span className="tabular-nums text-muted-foreground">—</span>;
              const v = row.original.balance + (incomingByProduct.get(row.original.productId) ?? 0);
              return <span className={cn('font-semibold tabular-nums', v < 0 && 'text-destructive')}>{v}</span>;
            },
            footer: (p) => {
              if (!incomingLoaded) return <span className="tabular-nums font-semibold">—</span>;
              const v = p.table
                .getFilteredRowModel()
                .rows.reduce(
                  (sum, r) => sum + r.original.balance + (incomingByProduct.get(r.original.productId) ?? 0),
                  0,
                );
              return <span className={cn('font-semibold tabular-nums', v < 0 && 'text-destructive')}>{v.toLocaleString()}</span>;
            },
          }),
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="order-2 flex flex-wrap gap-2 sm:order-1">
          {/* Both act on LIVE stock — a return moves units now, and a stock check
              diffs a physical count against the current balance. Neither means
              anything against a past day's figures, and Return Items in
              particular would validate today's shelf against last week's
              numbers. So they are disabled off-today rather than left to fail
              confusingly at save. */}
          <Button onClick={() => setReturnOpen(true)} disabled={!isToday}>
            <RotateCcw className="h-4 w-4 mr-1.5" /> Return Items
          </Button>
          <Button onClick={() => setCheckOpen(true)} disabled={!isToday}>
            <ClipboardCheck className="h-4 w-4 mr-1.5" /> Stock Check
          </Button>
        </div>
        <div className="order-1 sm:order-2 sm:text-right">
          <h2 className="text-lg font-semibold">Stock</h2>
          <p className="text-sm text-muted-foreground">
            {isToday
              ? `${date} · opening carries over from yesterday, new stock lands when you verify a delivery, waiting demand is what Production has yet to hand over, adjustments are admin corrections made today and clear tomorrow`
              : `${date} · a past business day, read-only. Balances are that day's closing figures, not today's. Adjustments show on the day they were made.`}
          </p>
        </div>
      </div>

      {/* The server refuses a date it cannot derive — anything over a year back,
          since every balance is walked out of today's live figure. Without this
          the refusal read as an empty table, which is indistinguishable from a
          day on which nothing happened. */}
      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
          <p className="text-sm font-medium text-destructive">Couldn&apos;t load stock for {date}.</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {error instanceof Error ? error.message : 'The request failed. Please try again.'}
          </p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>Retry</Button>
        </div>
      )}

      <DataTable
        columns={columns}
        data={rows}
        loading={isPending}
        searchPlaceholder="Search products…"
        pageSize={50}
        // Ahead of the search box, because it scopes what the search then filters
        // WITHIN: pick the day first, find the product second.
        leading={
          <div className="flex items-center gap-2">
            <Label htmlFor="stock-date" className="whitespace-nowrap text-xs text-muted-foreground">
              Date
            </Label>
            <Input
              id="stock-date"
              type="date"
              value={date}
              // No future days: computeStockRows would be asked for a date it
              // cannot derive and answers 400.
              max={businessDateStr()}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="h-11 w-40 md:h-9"
            />
          </div>
        }
      />

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
