'use client';

import { useState } from 'react';
import type { SortState } from '@mb/shared';

export interface UseTableSortOptions {
  /** Where the cycle lands on a third click of the same column. Default: no sort. */
  defaultSort?: SortState | null;
  /**
   * Present when this table's sort is server-driven (a `manual` `DataTable`
   * table would call this "manual"). Omit for a table that sorts an
   * already-loaded array in the browser — see {@link applyClientSort}.
   */
  manual?: {
    sort: SortState | null;
    onSortChange: (sort: SortState | null) => void;
  };
}

export interface UseTableSortApi {
  sort: SortState | null;
  /** Column → asc → desc → `defaultSort` (or unsorted), matching every other sortable header in the app. */
  toggle: (key: string) => void;
  isSorted: (key: string) => false | 'asc' | 'desc';
  /**
   * Sorts an already-loaded array by the current `sort` state. For the
   * client-side hand-rolled tables only — a server-driven table's rows are
   * already in sorted order from the API.
   */
  applyClientSort: <T>(rows: T[], accessors: Record<string, (row: T) => string | number | null>) => T[];
}

function compareValues(a: string | number | null, b: string | number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // nulls last, both directions — the sort below flips this for desc
  if (b == null) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
}

/**
 * Click-to-sort state for the hand-rolled `<table>` pages that don't render
 * through `DataTable` (no TanStack `Column` object to lean on). Mirrors
 * `DataTable`'s single-column cycle so every sortable header in the app
 * behaves identically regardless of which markup renders it.
 */
export function useTableSort({ defaultSort = null, manual }: UseTableSortOptions): UseTableSortApi {
  const [localSort, setLocalSort] = useState<SortState | null>(defaultSort);
  const sort = manual ? manual.sort : localSort;
  const setSort = manual ? manual.onSortChange : setLocalSort;

  const toggle = (key: string) => {
    if (!sort || sort.key !== key) return setSort({ key, direction: 'asc' });
    if (sort.direction === 'asc') return setSort({ key, direction: 'desc' });
    setSort(defaultSort);
  };

  const isSorted = (key: string): false | 'asc' | 'desc' => (sort?.key === key ? sort.direction : false);

  const applyClientSort = <T,>(rows: T[], accessors: Record<string, (row: T) => string | number | null>): T[] => {
    if (!sort) return rows;
    const accessor = accessors[sort.key];
    if (!accessor) return rows;
    const dir = sort.direction === 'desc' ? -1 : 1;
    // A stable copy: Array.prototype.sort is stable per spec (Node 12+/all
    // evergreen browsers), so equal keys keep their original relative order.
    return [...rows].sort((a, b) => dir * compareValues(accessor(a), accessor(b)));
  };

  return { sort, toggle, isSorted, applyClientSort };
}
