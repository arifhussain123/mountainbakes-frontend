import type { SortingState } from '@tanstack/react-table';
import type { SortState } from '@mb/shared';

/**
 * Bridges TanStack's `SortingState` (what `DataTable`'s `manual.sorting` /
 * `onSortingChange` speak) and this app's own `SortState` (what every list
 * hook's `sortBy`/`sortDir` — or `sort: {key, direction}` — params speak).
 *
 * Single-column only, matching every sortable table in the app
 * (`enableMultiSort: false` in `DataTable`): there is at most one active sort
 * at a time, so the arrays TanStack deals in always have 0 or 1 entries here.
 */
export function sortStateToTanstack(sort: SortState | null | undefined): SortingState {
  return sort ? [{ id: sort.key, desc: sort.direction === 'desc' }] : [];
}

export function tanstackToSortState(next: SortingState, fallback: SortState | null = null): SortState | null {
  const first = next[0];
  return first ? { key: first.id, direction: first.desc ? 'desc' : 'asc' } : fallback;
}
