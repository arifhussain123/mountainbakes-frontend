/**
 * Data Engine — generic filter, search, sort, pagination and export UI.
 *
 * Pages use `GenericDataTable` for the whole thing, or compose the pieces
 * with `useListQueryState` + `useResourceList` when they need their own layout.
 */
export { GenericDataTable, type GenericDataTableProps } from './GenericDataTable';
export { FilterBar, type FilterBarProps } from './FilterBar';
export { FilterDrawer, type FilterDrawerProps } from './FilterDrawer';
export { ActiveFilters, ClearFilters, type ActiveFiltersProps } from './ActiveFilters';
export { Pagination, pageWindow, type PaginationProps } from './Pagination';
export { ExportMenu, type ExportMenuProps } from './ExportMenu';
export {
  FilterControl,
  GenericSearch,
  GenericTextFilter,
  GenericSelectFilter,
  GenericMultiSelectFilter,
  GenericBooleanFilter,
  GenericDateFilter,
  GenericDateRangeFilter,
  GenericNumberFilter,
  GenericNumberRangeFilter,
  type FilterControlProps,
  type GenericSearchProps,
} from './filters';
/** `SortableTable` is `DataTable` with `sortable` — one component, so headings and cards never diverge. */
export { DataTable as SortableTable } from '@/components/shared/DataTable';
