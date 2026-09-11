'use client';

/**
 * Data Engine — the whole list, from configuration.
 *
 *   <GenericDataTable
 *     resource="orders"
 *     columns={columns}
 *     filters={[{ key: 'status', label: 'Status', type: 'select', options }]}
 *     searchPlaceholder="Search orders, customers…"
 *     syncUrl
 *   />
 *
 * Composes the list state (URL-synced), the resource query, the filter bar and
 * drawer, the active-filter chips, the sortable table and the pager. The page
 * supplies columns, filter configuration and any fixed scope; everything else
 * — debouncing, page reset, request races, loading and empty states, export —
 * is handled here once.
 *
 * Existing pages keep their column definitions unchanged: this renders the
 * same `DataTable` with the same `ColumnDef`s and mobile card hints.
 */
import { useEffect, useMemo } from 'react';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import type { FilterConfig, FilterOption, FilterValue, PageSize, PaginatedResponse, SortState } from '@mb/shared';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { useListQueryState, type ListQueryStateApi } from '@/lib/data-engine/useListQueryState';
import { useResourceList, type CacheProfile } from '@/lib/data-engine/useResource';
import { cn } from '@/lib/utils';
import { ActiveFilters } from './ActiveFilters';
import { ExportMenu } from './ExportMenu';
import { FilterBar } from './FilterBar';
import { Pagination } from './Pagination';

export interface GenericDataTableProps<TData> {
  /** A name from the server's resource registry. */
  resource: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<TData, any>[];
  /** Filter controls to offer. Keys must be filterable on the resource. */
  filters?: FilterConfig[];
  /** Runtime option lists for select filters, keyed by filter key. */
  filterOptions?: Record<string, FilterOption[]>;
  /** Filters always applied and never shown — a page's fixed scope (e.g. status=delivered). */
  fixedFilters?: FilterValue[];
  /** Starting filters a person may change or clear. */
  defaultFilters?: FilterValue[];
  defaultSort?: SortState | null;
  defaultPageSize?: PageSize;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Mirror state into the URL. Default true. */
  syncUrl?: boolean;
  /** URL key prefix when two lists share one page. */
  namespace?: string;
  /** Latest selectable day for date filters (today's business date). */
  maxDate?: string;
  cache?: CacheProfile;
  exportable?: boolean;
  exportFileName?: string;
  /** Right-hand toolbar slot. */
  actions?: React.ReactNode;
  /** Left of the search field. */
  leading?: React.ReactNode;
  empty?: React.ReactNode;
  emptyTitle?: string;
  mobileLayout?: 'cards' | 'table';
  columnVisibility?: Record<string, boolean>;
  /** Bump to force a refetch (after a write elsewhere on the page). */
  refreshKey?: number;
  /** Called with each page as it arrives — for headings like "1,245 orders". */
  onPage?: (page: PaginatedResponse<TData>) => void;
  /** Access to the list state, for a page that renders its own controls alongside. */
  onList?: (list: ListQueryStateApi) => void;
  /**
   * A list state owned by the page (from `useListQueryState`), for a page
   * that also feeds the same filters to `useResourceAggregate` for its cards.
   * When given, the `default*`, `syncUrl` and `namespace` props are ignored.
   */
  list?: ListQueryStateApi;
  className?: string;
}

export function GenericDataTable<TData>({
  resource,
  columns,
  filters = [],
  filterOptions,
  fixedFilters,
  defaultFilters,
  defaultSort,
  defaultPageSize,
  searchable = true,
  searchPlaceholder,
  syncUrl = true,
  namespace,
  maxDate,
  cache,
  exportable = true,
  exportFileName,
  actions,
  leading,
  empty,
  emptyTitle = 'No results found',
  mobileLayout,
  columnVisibility,
  refreshKey,
  onPage,
  onList,
  list: externalList,
  className,
}: GenericDataTableProps<TData>) {
  const filterKeys = useMemo(() => filters.map((f) => f.key), [filters]);
  const internalList = useListQueryState({
    syncUrl,
    namespace,
    filterKeys,
    defaults: { pageSize: defaultPageSize, sort: defaultSort ?? null, filters: defaultFilters },
  });
  const list = externalList ?? internalList;

  const query = useResourceList<TData>(resource, list.state, { fixedFilters, cache });
  const page = query.data;

  useEffect(() => {
    if (page && onPage) onPage(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => {
    if (onList) onList(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.state]);

  // A write elsewhere on the page: refetch this view.
  useEffect(() => {
    if (refreshKey) void query.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // The set shrank under the pager (a filter removed rows, a record was
  // deleted): fall back to the last page that exists.
  useEffect(() => {
    if (page && page.total > 0 && list.state.page > page.totalPages) list.setPage(page.totalPages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.totalPages, page?.total]);

  const sorting: SortingState = list.state.sort ? [{ id: list.state.sort.key, desc: list.state.sort.direction === 'desc' }] : [];
  const onSortingChange = (next: SortingState) => {
    const first = next[0];
    list.setSort(first ? { key: first.id, direction: first.desc ? 'desc' : 'asc' } : defaultSort ?? null);
  };

  const rows = page?.data ?? [];
  const total = page?.total ?? 0;
  const loading = query.isPending;
  const refreshing = query.isFetching && !query.isPending;

  const emptyNode =
    empty ??
    (query.isError ? (
      <EmptyState
        title="Couldn’t load this list"
        description={query.error instanceof Error ? query.error.message : 'Please try again.'}
        className="border-0"
      />
    ) : (
      <EmptyState
        title={emptyTitle}
        description={list.hasActiveFilters ? 'Try a different search or clear the filters.' : undefined}
        className="border-0"
      />
    ));

  return (
    <div className={cn('space-y-4', className)}>
      <FilterBar
        list={list}
        filters={filters}
        options={filterOptions}
        searchable={searchable}
        searchPlaceholder={searchPlaceholder}
        maxDate={maxDate}
        leading={leading}
        actions={
          actions || exportable ? (
            <>
              {actions}
              {exportable && (
                <ExportMenu
                  resource={resource}
                  state={list.state}
                  fixedFilters={fixedFilters}
                  pageCount={rows.length}
                  total={total}
                  fileName={exportFileName}
                />
              )}
            </>
          ) : undefined
        }
      />

      <ActiveFilters
        filters={list.activeFilters}
        configs={filters}
        options={filterOptions}
        search={list.state.search}
        onRemove={list.clearFilter}
        onClearSearch={() => list.setSearch('')}
        onClearAll={list.clearAll}
      />

      <div className={cn(refreshing && 'opacity-70 transition-opacity')} aria-busy={refreshing || loading}>
        <DataTable
          columns={columns}
          data={rows}
          loading={loading}
          toolbar={false}
          pager={false}
          sortable
          mobileLayout={mobileLayout}
          columnVisibility={columnVisibility}
          empty={emptyNode}
          manual={{
            page: list.state.page,
            pageSize: list.state.pageSize,
            total,
            onPageChange: list.setPage,
            search: list.state.search,
            onSearchChange: list.setSearch,
            sorting,
            onSortingChange,
          }}
        />
      </div>

      <Pagination
        page={list.state.page}
        pageSize={list.state.pageSize}
        total={total}
        onPageChange={list.setPage}
        onPageSizeChange={list.setPageSize}
        loading={refreshing}
      />
    </div>
  );
}
