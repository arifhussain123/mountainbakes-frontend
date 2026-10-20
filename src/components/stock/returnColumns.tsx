import type { ColumnHelper } from '@tanstack/react-table';
import type { ProductionReturn } from '@mb/shared';
import { formatCurrency } from '@/utils/currency';

/**
 * The columns both returns tables (Production → Product Returns and the branch's
 * Return Stock) share for what a return is worth: product code, unit price on
 * the return date, and the line amount. The server prices each row with the same
 * query the monthly summary sums (`returns-summary.service.ts`), so a row and the
 * total above it never disagree; nothing here multiplies anything.
 *
 * Not sortable: the list is sorted and paged on the server, which orders by the
 * return's own columns — sorting by a derived price would only reorder the page
 * in view and misstate the order of the whole list.
 */
const money = (n: number | null | undefined) => (n == null ? '—' : formatCurrency(n));

export function returnValueColumns(col: ColumnHelper<ProductionReturn>) {
  return [
    col.accessor((r) => r.productCode ?? '', {
      id: 'productCode',
      header: 'Code',
      enableSorting: false,
      meta: { mobileLabel: 'Code' },
      cell: ({ row }) => <span className="font-mono text-xs text-muted-foreground">{row.original.productCode || '—'}</span>,
    }),
    col.accessor((r) => r.unitPrice ?? null, {
      id: 'unitPrice',
      header: 'Unit Price',
      enableSorting: false,
      meta: { align: 'right' },
      cell: ({ row }) => <span className="whitespace-nowrap tabular-nums">{money(row.original.unitPrice)}</span>,
    }),
    col.accessor((r) => r.amount ?? null, {
      id: 'amount',
      header: 'Amount',
      enableSorting: false,
      meta: { align: 'right' },
      cell: ({ row }) => <span className="whitespace-nowrap font-semibold tabular-nums">{money(row.original.amount)}</span>,
    }),
  ];
}
