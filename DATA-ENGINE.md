# Data Engine — generic filter, search, sort, pagination and export (client)

The server side is documented in `../mountainbakes-server/DATA-ENGINE.md`
(`GET /api/data/:resource`). This file covers what a page does.

Code: `src/lib/data-engine/` (state + hooks) and `src/components/data-engine/`
(UI). Wire types: `src/shared/types/data-engine.types.ts` (`@mb/shared`).

## The one-liner

```tsx
<GenericDataTable<Order>
  resource="orders"                       // a name from the server registry
  columns={columns}                       // the page's existing TanStack ColumnDefs
  filters={[
    { key: 'status',    label: 'Status',  type: 'select', options, placement: 'bar' },
    { key: 'createdAt', label: 'Date',    type: 'date-range', placement: 'bar' },
    { key: 'branchId',  label: 'Branch',  type: 'select' },          // goes in the drawer
    { key: 'grandTotal',label: 'Total',   type: 'number-range' },
  ]}
  filterOptions={{ branchId: branches.map(b => ({ value: b.id, label: b.name })) }}
  defaultSort={{ key: 'createdAt', direction: 'desc' }}
  fixedFilters={[{ key: 'status', op: 'eq', value: 'delivered' }]}   // a page's fixed scope, never shown
  searchPlaceholder="Search orders, customers…"
  maxDate={businessDateStr()}
  onPage={(page) => setTotal(page.total)}
/>
```

That renders, from configuration: a debounced search box, the first two
filters inline on desktop (all filters in a drawer on a phone), active-filter
chips with per-chip ×, Clear, the sortable table (click a heading), the pager
with 20 / 50 / 100 and an Export menu (current page or every filtered row, as
Excel or CSV — always the same filter conditions as the table).

Filter types: `text search select multi-select date date-range number
number-range boolean`. `key` must be a filterable field of the resource; the
server rejects anything else with a 400 that names the field.

## State and URL

`useListQueryState()` owns `{ page, pageSize, search, filters, sort }`. Any
change to search, filters, sort or page size lands on page 1. With `syncUrl`
(the default in `GenericDataTable`) the state is mirrored into the address bar
in the same shape the API reads (`?status=delivered&createdAt.gte=2026-09-01&page=2`),
so refresh, back/forward and shared links reproduce the view. It uses
`window.history` rather than `useSearchParams` because this is a static export
and Next demands a Suspense boundary around every `useSearchParams` consumer.

Only keys the list owns (`page pageSize search sort` + its filter keys) are
rewritten; `?new=1` and the like survive. Two lists on one page use
`namespace`.

## Data hooks — `src/lib/data-engine/useResource.ts`

| hook | what |
|---|---|
| `useResourceList(resource, state, { fixedFilters, cache })` | one page; `placeholderData: keepPreviousData` so paging never flashes empty |
| `useResourceAggregate(resource, state, { metrics, groupBy })` | totals over the SAME filtered set — for cards above the table |
| `useResourceMeta(resource)` | what the server allows |
| `useInvalidateResource()` | `invalidate('orders')` after a write refetches every cached page/sort/filter of it |
| `exportResource(...)` | the download; `ExportMenu` wraps it |

Keys come from `qk.data / qk.dataAggregate / qk.dataMeta`, prefixed
`['data', resource]`. Race protection is structural — a different filter is a
different key — and the fetch is given TanStack's AbortSignal.

Cache profile: `cache="static"` (5 min) for reference data such as products,
customers, users; the default is the app's 15 s `LIVE_STALE_TIME`. Note the
dashboard's refresh tick refetches every ACTIVE query regardless of staleTime,
so a generic list open on screen refetches at that cadence like every other
hook — which is why search is debounced and keys are stable.

## A page with its own total card

Own the state, hand it to both:

```tsx
const list = useListQueryState({ syncUrl: true, filterKeys: KEYS, defaults: { filters: [...] } });
const totals = useResourceAggregate('expenses', list.state, { metrics: ['sum:amount', 'count'] });
<GenericDataTable resource="expenses" list={list} … />
```

Until database migration 108 is applied, only `count` aggregates work and the
others answer 501 — show a dash, not a wrong number.

## Pieces, if the one-liner does not fit

`FilterBar`, `FilterDrawer`, `ActiveFilters`, `ClearFilters`, `GenericSearch`,
`GenericSelectFilter`, `GenericMultiSelectFilter`, `GenericDateFilter`,
`GenericDateRangeFilter`, `GenericNumberFilter`, `GenericNumberRangeFilter`,
`GenericBooleanFilter`, `FilterControl` (dispatch on type), `Pagination`,
`ExportMenu`, and `DataTable` with `sortable` + `manual.sorting` (exported as
`SortableTable`). All from `@/components/data-engine`.

`DataTable` gained three opt-in props — `sortable`, `toolbar={false}`,
`pager={false}` — and `manual.sorting / onSortingChange`. Every existing call
site is unchanged.

## Pages on the engine

Orders (`OrdersPage`, admin + branch + production), Sales (`SalesPage`), Shop
Expenses, Customers, Users (All Users tab), Products (Products tab), Production
Orders (`ProductionOrdersPage`). Their column definitions are the ones they
had; what changed is where filtering happens.

Sales and Production Orders each also render a separate, non-generic summary
card above their `GenericDataTable` list — Sales' Daily Summary and Production
Orders' Demand Summary — that fetches and reduces its own dataset client-side.
That's deliberate, not a leftover of an incomplete migration: Sales' card must
reconcile exactly with the closing report, and Production Orders' card
consolidates a rolling window of demand separately from the paginated list
below it. Neither reads through the data-engine list itself.

Not migrated, on purpose: Finance Help Desk and Login History (already
server-paged on their own endpoints), Support Center (2 100 lines, embeds the
Help Desk).
