'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useStockRows } from '@/lib/queries';
import { useStockRealtime } from '@/hooks/useStockRealtime';
import { type StockRow, businessDateStr } from '@mb/shared';
import { DataTable } from '@/components/shared/DataTable';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ClipboardCheck, RotateCcw } from 'lucide-react';
import { createColumnHelper, type Table as TanstackTable } from '@tanstack/react-table';
import { cn } from '@/lib/utils';
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
  const { data: rows = [], isPending, refetch } = useStockRows(token ?? '', { date });
  useStockRealtime();

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
              ? `${date} · opening carries over from yesterday, new stock added after Production approval, adjustments are admin corrections made today and clear tomorrow`
              : `${date} · a past business day, read-only. Adjustments show on the day they were made.`}
          </p>
        </div>
      </div>

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
