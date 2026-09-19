'use client';

import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import { TableHead } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { alignClass } from './table-meta';

export interface SortableHeaderCellProps {
  /** Whether this column can be sorted at all — renders plain text when false. */
  canSort: boolean;
  /** Current sort state for this column, mirroring TanStack's `Column.getIsSorted()`. */
  sorted: false | 'asc' | 'desc';
  /**
   * Cycles the sort state. Omitted (and ignored) when `canSort` is false.
   *
   * Typed with TanStack's own `(event: unknown) => void` shape — it is handed
   * `Column.getToggleSortingHandler()` directly in `DataTable`, and a plain
   * `() => void` closure (from `useTableSort`, for the hand-rolled tables)
   * satisfies this just as well, since a callback may always ignore an
   * argument its caller offers.
   */
  onToggle?: (event: unknown) => void;
  align?: 'left' | 'center' | 'right';
  className?: string;
  children: React.ReactNode;
}

/**
 * One `<th>`, click-to-sort when `canSort`.
 *
 * Extracted from `DataTable`'s header row so the same markup — the
 * `aria-sort` attribute, the button, the asc/desc/unsorted icon — can be
 * reused by tables that have no TanStack `Column` object at all (see
 * `useTableSort`), instead of a second hand-rolled sort UI drifting from
 * this one.
 */
export function SortableHeaderCell({ canSort, sorted, onToggle, align, className, children }: SortableHeaderCellProps) {
  return (
    <TableHead
      className={cn('font-semibold text-xs uppercase tracking-wide', alignClass(align), className)}
      aria-sort={canSort ? (sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none') : undefined}
    >
      {canSort ? (
        <button
          type="button"
          onClick={onToggle}
          className={cn(
            'inline-flex items-center gap-1 -mx-1 px-1 rounded hover:text-foreground',
            sorted ? 'text-foreground' : 'text-muted-foreground',
          )}
        >
          {children}
          {sorted === 'asc' ? (
            <ArrowUp className="h-3 w-3" />
          ) : sorted === 'desc' ? (
            <ArrowDown className="h-3 w-3" />
          ) : (
            <ArrowUpDown className="h-3 w-3 opacity-50" />
          )}
        </button>
      ) : (
        children
      )}
    </TableHead>
  );
}
