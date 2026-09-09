'use client';

/**
 * Dashboard — Recent Orders, filterable and paged.
 *
 * Reads through the Data Engine (`resource="orders"`), not `/api/orders`. That
 * route never read `limit` — the `?limit=8` this card used to send did nothing,
 * so the dashboard downloaded every order the account could see and rendered
 * eight of them. Filtering, search, sort and paging now happen in Postgres.
 *
 * Three things a future reader will want to know:
 *
 *  - **Twenty rows, not eight.** `PAGE_SIZES` is [20, 50, 100] and the server
 *    refuses anything else (`data-engine/parseListQuery.ts`). Buying back a
 *    compact card would mean adding a size to a type mirrored byte-for-byte in
 *    the API repo plus a backend deploy, and it would put a `10 / page` option
 *    on every list in the app. The card shows twenty and links out instead.
 *  - **This card is now on the 1-second `AppRefreshProvider` tick.** The old
 *    version was a bare `useEffect` that fetched once per mount; a `useQuery`
 *    is an *active* query, and `refetchQueries` ignores `staleTime`. Each tick
 *    is an exact count plus one page — with `order_items` embedded by the
 *    registry's `select`, which this card does not render. The only lever is a
 *    key predicate in `useAppRefresh.tsx`, which is an app-wide decision and
 *    deliberately not taken here.
 *  - **Row scope is the API's, from the JWT.** The Branch filter below only
 *    appears for an admin; a branch account gets its own shop either way.
 */
import { useMemo } from 'react';
import Link from 'next/link';
import { createColumnHelper } from '@tanstack/react-table';
import { formatDistanceToNow } from 'date-fns';
import { ArrowRight } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useBranches } from '@/lib/queries';
import { GenericDataTable } from '@/components/data-engine';
import { ORDER_STATUS_OPTIONS, OrderStatusBadge } from '@/components/orders/OrderStatusBadge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { ROUTES } from '@/utils/routes';
import { cn } from '@/lib/utils';
import type { FilterConfig, FilterValue, Order } from '@mb/shared';
import { businessDateStr } from '@mb/shared';

const col = createColumnHelper<Order>();

// Hoisted: these cells close over nothing but their own `info`, so the column
// model does not need rebuilding on every render.
const columns = [
  col.accessor('orderNumber', {
    header: 'Order',
    meta: { mobile: 'subtitle' },
    cell: (info) => <span className="font-mono text-xs font-medium">{info.getValue()}</span>,
  }),
  col.accessor('customerName', {
    // Card heading on a phone: who the order is for reads better than its
    // number, which stays available as the subtitle.
    header: 'Customer',
    meta: { mobile: 'title' },
    cell: (info) => (
      <div>
        <p className="font-medium">{info.getValue()}</p>
        <p className="text-xs text-muted-foreground">{info.row.original.customerPhone}</p>
      </div>
    ),
  }),
  // Kept on the phone card. The caller with no fixed branch is the *admin*
  // dashboard, which is cross-branch by definition, and there the Branch filter
  // sits behind the drawer — hiding this would leave an admin on a phone with
  // no way to tell which shop an order belongs to.
  col.accessor('branchName', {
    header: 'Branch',
    cell: (info) => <span className="text-muted-foreground">{info.getValue()}</span>,
  }),
  col.accessor('grandTotal', {
    header: 'Total',
    meta: { align: 'right' },
    cell: (info) => <span className="font-medium tabular-nums">Rs.{info.getValue()?.toLocaleString()}</span>,
  }),
  col.accessor('status', {
    header: 'Status',
    meta: { mobile: 'badge', align: 'center' },
    cell: (info) => <OrderStatusBadge status={info.getValue()} />,
  }),
  col.accessor('createdAt', {
    header: 'Time',
    meta: { align: 'right' },
    cell: (info) => (
      <span className="text-xs text-muted-foreground">
        {info.getValue() ? formatDistanceToNow(new Date(info.getValue()), { addSuffix: true }) : ''}
      </span>
    ),
  }),
];

export function RecentOrdersTable({ branchId }: { branchId?: string }) {
  const { token, user } = useAuth();

  // A branch passed in is this card's fixed scope, so it gets no Branch filter
  // to contradict it.
  const isAdmin = user?.role === 'super_admin' && !branchId;
  const branchesQ = useBranches(token, { enabled: isAdmin });

  const fixedFilters = useMemo<FilterValue[] | undefined>(
    () => (branchId ? [{ key: 'branchId', op: 'eq', value: branchId }] : undefined),
    [branchId],
  );

  // Only Status earns a place on the bar — one `explicitBar` entry keeps the
  // toolbar to a single row. The date range is two date inputs wide and is the
  // filter a "recent" list needs least, so it goes to the drawer with Branch.
  const filters = useMemo<FilterConfig[]>(
    () => [
      { key: 'status', label: 'Status', type: 'select', placeholder: 'All Statuses', placement: 'bar' },
      { key: 'createdAt', label: 'Date', type: 'date-range' },
      ...(isAdmin ? [{ key: 'branchId', label: 'Branch', type: 'select', placeholder: 'All Branches' } as FilterConfig] : []),
    ],
    [isAdmin],
  );

  const filterOptions = useMemo(
    () => ({
      status: ORDER_STATUS_OPTIONS,
      branchId: (branchesQ.data ?? []).map((b) => ({ value: b.id, label: b.name })),
    }),
    [branchesQ.data],
  );

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-base">Recent Orders</CardTitle>
          {/* A styled Link, not a Button wrapping one: this Button is Base UI's,
              which has no `asChild`, and an anchor inside a <button> is invalid
              markup that breaks keyboard activation. */}
          <Link href={ROUTES.ORDERS} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'shrink-0')}>
            View all <ArrowRight className="ml-1.5 h-4 w-4" />
          </Link>
        </div>
      </CardHeader>
      {/* Edge-to-edge on a phone, inset on desktop — DataTable draws its own
          bordered panel, which would otherwise nest inside the Card's padding. */}
      <CardContent className="p-0 sm:px-4 sm:pb-4">
        <GenericDataTable<Order>
          resource="orders"
          columns={columns}
          filters={filters}
          filterOptions={filterOptions}
          fixedFilters={fixedFilters}
          defaultSort={{ key: 'createdAt', direction: 'desc' }}
          searchPlaceholder="Search orders, customers, phone…"
          maxDate={businessDateStr()}
          // The dashboard is a landing page, not a list view. Every setter here
          // pushes a history entry, so syncing would make Back walk through this
          // card's filter states instead of leaving the dashboard. Export is the
          // Orders page's job.
          syncUrl={false}
          exportable={false}
          emptyTitle="No orders yet"
        />
      </CardContent>
    </Card>
  );
}
