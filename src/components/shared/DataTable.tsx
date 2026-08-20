'use client';

import {
  useReactTable,
  getCoreRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  flexRender,
  type ColumnDef,
  type SortingState,
  type Table as TanstackTable,
} from '@tanstack/react-table';
import { useState } from 'react';
import {
  Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronLeft, ChevronRight, Search, Download } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { EmptyState } from './EmptyState';
import { alignClass, bucketCells, mobileLabel } from './table-meta';

interface DataTableProps<TData> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<TData, any>[];
  data: TData[];
  loading?: boolean;
  searchPlaceholder?: string;
  onExport?: () => void;
  actions?: React.ReactNode;
  pageSize?: number;
  /**
   * Columns to hide, e.g. `{ search: false }`.
   *
   * The global filter only matches values it can reach through a column accessor,
   * so making a field searchable without displaying it means adding a column and
   * hiding it here.
   */
  columnVisibility?: Record<string, boolean>;
  /** Shown when there are no rows after filtering. Defaults to a plain EmptyState. */
  empty?: React.ReactNode;
  /**
   * How rows render below `md`.
   *
   * `'cards'` (the default) turns each row into a card, routing cells by the
   * `meta.mobile` annotations on the column defs — see `table-meta.ts`.
   * `'table'` keeps the horizontally-scrolling table at every width, which is
   * the right call for a wide numeric ledger whose columns only mean something
   * side by side.
   */
  mobileLayout?: 'cards' | 'table';
}

export function DataTable<TData>({
  columns,
  data,
  loading,
  searchPlaceholder = 'Search…',
  onExport,
  actions,
  pageSize = 20,
  columnVisibility,
  empty,
  mobileLayout = 'cards',
}: DataTableProps<TData>) {
  const [globalFilter, setGlobalFilter] = useState('');
  const [sorting, setSorting] = useState<SortingState>([]);

  const table = useReactTable({
    data,
    columns,
    state: { globalFilter, sorting, ...(columnVisibility ? { columnVisibility } : {}) },
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    initialState: { pagination: { pageSize } },
  });

  const cards = mobileLayout === 'cards';
  const emptyHint = globalFilter ? 'Try a different search term.' : undefined;

  /**
   * Whether any visible column asked for a totals row.
   *
   * A footer is handed the whole `table`, so what it sums is the footer's own
   * choice — but the useful choice is `getFilteredRowModel()`, NOT
   * `getRowModel()`. `getRowModel()` is the CURRENT PAGE, so on a paginated
   * table it would show a total that changes as you page through, which reads
   * exactly like a bug. Filtered rows means the total tracks the search box —
   * search "cake" and the total is the cakes — which is what someone typing in
   * that box is asking for.
   */
  const hasFooter = table.getAllLeafColumns().some((c) => c.getIsVisible() && c.columnDef.footer != null);

  return (
    <div className="space-y-4">
      {/* Toolbar — stacks on a phone so the search field gets the full width. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-9 h-11 md:h-9"
          />
        </div>
        {(actions || onExport) && (
          <div className="flex w-full items-center gap-2 sm:w-auto">
            {actions}
            {onExport && (
              <Button variant="outline" size="sm" onClick={onExport} className="h-11 flex-1 md:h-9 sm:flex-none">
                <Download className="h-3.5 w-3.5 mr-1.5" />
                Export
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Desktop table. Markup unchanged — only the visibility wrapper is new.
          `print-table-wrap` forces this branch onto paper regardless of how the
          `md:` breakpoint resolves against the print page box. */}
      <div
        className={cn(
          'rounded-lg border bg-card overflow-hidden',
          cards && 'hidden md:block print-table-wrap'
        )}
      >
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="bg-muted/50 hover:bg-muted/50">
                {hg.headers.map((h) => (
                  <TableHead
                    key={h.id}
                    className={cn(
                      'font-semibold text-xs uppercase tracking-wide text-muted-foreground',
                      alignClass(h.column.columnDef.meta?.align),
                    )}
                  >
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  {columns.map((_, j) => (
                    <TableCell key={j}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : table.getRowModel().rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="p-0">
                  {empty ?? (
                    <EmptyState title="No results found" description={emptyHint} className="border-0" />
                  )}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id} className="hover:bg-muted/30 transition-colors">
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id} className={alignClass(cell.column.columnDef.meta?.align)}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>

          {/* Totals row. Rendered only when a column actually defines `footer`,
              so every existing table is untouched.
              A footer sums whatever it is given — see the note on `hasFooter`
              below for WHICH rows that is, because the honest answer is not
              "all of them" once a search box and pagination are in play. */}
          {hasFooter && !loading && table.getRowModel().rows.length > 0 && (
            <TableFooter>
              {table.getFooterGroups().map((fg) => (
                <TableRow key={fg.id} className="hover:bg-transparent">
                  {fg.headers.map((h) => (
                    <TableCell
                      key={h.id}
                      className={cn('font-semibold', alignClass(h.column.columnDef.meta?.align))}
                    >
                      {h.isPlaceholder ? null : flexRender(h.column.columnDef.footer, h.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableFooter>
          )}
        </Table>
      </div>

      {/* Phone cards.
          A CSS branch rather than a `useIsMobile()` branch on purpose: the hook
          returns false on the server and on the first client render, so a JS
          branch would flash the wrong layout — and `display:none` keeps the
          inactive branch out of the tab order and the accessibility tree. */}
      {cards && (
        <div className="md:hidden no-print">
          <DataTableCards
            table={table}
            loading={loading}
            empty={empty ?? <EmptyState title="No results found" description={emptyHint} />}
            showFooter={hasFooter}
          />
        </div>
      )}

      {/* Pagination */}
      <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>
          {table.getFilteredRowModel().rows.length} total
          {globalFilter && ` (filtered from ${data.length})`}
        </span>
        <div className="flex items-center gap-2">
          <span>Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}</span>
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 md:h-7 md:w-7"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 md:h-7 md:w-7"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label="Next page"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The phone rendering of the same rows: one card each, cells routed into slots
 * by their `meta.mobile` role.
 *
 * Un-annotated tables still read correctly — `bucketCells` promotes the first
 * cell to the title and detects the actions column by id.
 */
function DataTableCards<TData>({
  table,
  loading,
  empty,
  showFooter,
}: {
  table: TanstackTable<TData>;
  loading?: boolean;
  empty: React.ReactNode;
  /** Append a totals card mirroring the desktop `<tfoot>`. */
  showFooter?: boolean;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2 rounded-lg border bg-card p-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>
    );
  }

  const rows = table.getRowModel().rows;
  if (rows.length === 0) return <>{empty}</>;

  return (
    <div className="space-y-3">
      {rows.map((row) => {
        const { title, subtitle, badges, fields, actions } = bucketCells(row);
        return (
          <div key={row.id} className="rounded-lg border bg-card p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {title && (
                  <div className="font-medium">
                    {flexRender(title.column.columnDef.cell, title.getContext())}
                  </div>
                )}
                {subtitle && (
                  <div className="text-xs text-muted-foreground">
                    {flexRender(subtitle.column.columnDef.cell, subtitle.getContext())}
                  </div>
                )}
              </div>
              {badges.length > 0 && (
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                  {badges.map((c) => (
                    <span key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</span>
                  ))}
                </div>
              )}
            </div>

            {fields.length > 0 && (
              <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
                {fields.map((c) => {
                  // Full-width fields carry prose (notes, remarks, an issue
                  // description), so they stack and read left-to-right. Narrow
                  // fields are short values that line up better right-aligned
                  // against their label.
                  const full = c.column.columnDef.meta?.mobileFull;
                  return (
                    <div
                      key={c.id}
                      className={cn(
                        'flex gap-2',
                        full
                          ? 'col-span-2 flex-col items-start gap-0.5'
                          : 'items-baseline justify-between'
                      )}
                    >
                      <dt className="shrink-0 text-muted-foreground">{mobileLabel(c)}</dt>
                      <dd
                        className={cn(
                          'min-w-0 font-medium',
                          full ? 'w-full text-left' : 'text-right tabular-nums'
                        )}
                      >
                        {flexRender(c.column.columnDef.cell, c.getContext())}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            )}

            {actions && (
              // Touch targets, centrally. `min-height` has no competing declaration
              // from the `h-8`/`size-8` on the icon buttons inside, and this
              // descendant selector outranks those single-class utilities anyway —
              // so every actions column reaches 44px without touching a call site.
              <div className="mt-3 flex flex-wrap items-center justify-end gap-1 border-t pt-2.5 [&_button]:min-h-11 [&_button]:min-w-11 [&_svg]:size-4.5">
                {flexRender(actions.column.columnDef.cell, actions.getContext())}
              </div>
            )}
          </div>
        );
      })}

      {/* Totals, mirroring the desktop <tfoot>. Without this the phone layout
          would be the one place the total is missing — and a phone is where a
          branch manager actually reads this table.

          Only FIGURE columns are listed. A column with no footer (the product
          name) would render an empty label:value pair, and an identity column
          whose footer is just the row's label ("Total" on the ID column, which
          the desktop <tfoot> needs at its far left) would render as
          "ID: Total" — noise in a list that is meant to be numbers. Identity
          columns are exactly the ones bucketed as the card's title/subtitle, so
          that annotation is what filters them. */}
      {showFooter && (
        <div className="rounded-lg border bg-muted/50 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Total</p>
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
            {table.getFooterGroups().flatMap((fg) =>
              fg.headers
                .filter((h) => {
                  if (h.isPlaceholder || h.column.columnDef.footer == null) return false;
                  const slot = h.column.columnDef.meta?.mobile;
                  return slot !== 'title' && slot !== 'subtitle';
                })
                .map((h) => (
                  <div key={h.id} className="flex items-baseline justify-between gap-2">
                    <dt className="shrink-0 text-muted-foreground">
                      {flexRender(h.column.columnDef.header, h.getContext())}
                    </dt>
                    <dd className="min-w-0 text-right font-semibold tabular-nums">
                      {flexRender(h.column.columnDef.footer, h.getContext())}
                    </dd>
                  </div>
                )),
            )}
          </dl>
        </div>
      )}
    </div>
  );
}
