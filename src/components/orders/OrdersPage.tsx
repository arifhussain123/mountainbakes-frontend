'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { useBranches } from '@/lib/queries';
import { GenericDataTable } from '@/components/data-engine';
import { useInvalidateResource } from '@/lib/data-engine/useResource';
import { OrderStatusBadge } from './OrderStatusBadge';
import { Button } from '@/components/ui/button';
import type { FilterConfig, Order, OrderStatus } from '@mb/shared';
import { businessDateStr } from '@mb/shared';
import { createColumnHelper } from '@tanstack/react-table';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { FileSpreadsheet } from 'lucide-react';
import { PAYMENT_METHOD_LABELS } from '@/utils/constants';

const col = createColumnHelper<Order>();

const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'preparing', label: 'Preparing' },
  { value: 'ready', label: 'Ready' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

const PAYMENT_OPTIONS = ['cash', 'easypaisa', 'foodpanda', 'bank_account', 'staff'].map((value) => ({
  value,
  label: PAYMENT_METHOD_LABELS[value] ?? value,
}));

/**
 * Orders — every branch's orders for an admin, the shop's own for a branch,
 * the kitchen queue for production.
 *
 * Reads through the Data Engine (`resource="orders"`): filtering, search, sort
 * and paging happen in the database, so the page downloads twenty rows, not
 * fourteen hundred. Who sees which rows is decided by the API from the JWT —
 * the Branch filter below only appears for an admin, and a branch account that
 * typed one into the URL would still get its own shop back.
 */
export function OrdersPage({ refreshKey }: { refreshKey?: number }) {
  const { token, user } = useAuth();
  const router = useRouter();
  const invalidate = useInvalidateResource();
  const [total, setTotal] = useState<number | null>(null);
  const [localRefresh, setLocalRefresh] = useState(0);

  const isAdmin = user?.role === 'super_admin';
  const branchesQ = useBranches(token, { enabled: isAdmin });

  const filters = useMemo<FilterConfig[]>(
    () => [
      { key: 'status', label: 'Status', type: 'select', placeholder: 'All Statuses', placement: 'bar' },
      { key: 'createdAt', label: 'Date', type: 'date-range', placement: 'bar' },
      { key: 'paymentMethod', label: 'Payment', type: 'select', options: PAYMENT_OPTIONS, placeholder: 'All Payments' },
      ...(isAdmin ? [{ key: 'branchId', label: 'Branch', type: 'select', placeholder: 'All Branches' } as FilterConfig] : []),
      { key: 'grandTotal', label: 'Total (Rs.)', type: 'number-range' },
    ],
    [isAdmin],
  );

  const filterOptions = useMemo(
    () => ({
      status: STATUS_OPTIONS,
      branchId: (branchesQ.data ?? []).map((b) => ({ value: b.id, label: b.name })),
    }),
    [branchesQ.data],
  );

  async function handleStatusChange(id: string, status: OrderStatus) {
    try {
      await apiCall(`/api/orders/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }, token);
      toast.success(`Order marked as ${status}`);
      void invalidate('orders');
      void invalidate('sales');
      setLocalRefresh((k) => k + 1);
    } catch {
      toast.error('Failed to update status');
    }
  }

  /** The legacy full-report workbook (`/api/reports/export`), kept as it was. */
  async function handleReport() {
    try {
      const blob = await apiCall<Blob>('/api/reports/export?type=excel', {}, token);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'orders-report.xlsx';
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Export failed');
    }
  }

  const columns = [
    col.accessor('orderNumber', {
      header: 'Order #',
      meta: { mobile: 'subtitle' },
      cell: (info) => <span className="font-mono text-xs font-medium">{info.getValue()}</span>,
    }),
    col.accessor('customerName', {
      // Card heading: who the order is for reads better than its number, which
      // stays available as the subtitle.
      header: 'Customer',
      meta: { mobile: 'title' },
      cell: (info) => (
        <div>
          <p className="font-medium">{info.getValue()}</p>
          <p className="text-xs text-muted-foreground">{info.row.original.customerPhone}</p>
        </div>
      ),
    }),
    col.accessor('branchName', { header: 'Branch' }),
    col.accessor('items', {
      header: 'Items',
      enableSorting: false,
      cell: (info) => <span>{(info.getValue() ?? []).length} item(s)</span>,
    }),
    col.accessor('grandTotal', {
      header: 'Total',
      cell: (info) => <span className="font-semibold">Rs.{info.getValue()?.toLocaleString()}</span>,
    }),
    col.accessor('paymentMethod', {
      header: 'Payment',
      enableSorting: false,
      cell: (info) => <span>{PAYMENT_METHOD_LABELS[info.getValue()] ?? info.getValue()}</span>,
    }),
    col.accessor('status', {
      header: 'Status',
      meta: { mobile: 'badge' },
      cell: (info) => <OrderStatusBadge status={info.getValue()} />,
    }),
    col.accessor('createdAt', {
      header: 'Time',
      cell: (info) => (
        <span className="text-xs text-muted-foreground">
          {info.getValue() ? formatDistanceToNow(new Date(info.getValue()), { addSuffix: true }) : ''}
        </span>
      ),
    }),
    col.display({
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const o = row.original;
        const nextStatus: Record<OrderStatus, OrderStatus | null> = {
          pending: 'preparing', preparing: 'ready', ready: 'delivered', delivered: null, cancelled: null,
        };
        const next = nextStatus[o.status];
        return (
          <div className="flex items-center gap-1">
            {next && user?.role !== 'production_user' && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs capitalize"
                onClick={() => handleStatusChange(o.id, next)}
              >
                → {next}
              </Button>
            )}
            {o.status !== 'cancelled' && o.status !== 'delivered' && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-destructive hover:text-destructive"
                onClick={() => handleStatusChange(o.id, 'cancelled')}
              >
                Cancel
              </Button>
            )}
          </div>
        );
      },
    }),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Orders</h2>
          <p className="text-sm text-muted-foreground">
            {total === null ? 'Loading…' : `${total.toLocaleString()} total orders`}
          </p>
        </div>
        {(user?.role === 'branch_manager' || user?.role === 'super_admin') && (
          <Button onClick={() => router.push(user.role === 'branch_manager' ? '/branch-orders?new=1' : '/orders/new')}>
            New Order
          </Button>
        )}
      </div>

      <GenericDataTable<Order>
        resource="orders"
        columns={columns}
        filters={filters}
        filterOptions={filterOptions}
        defaultSort={{ key: 'createdAt', direction: 'desc' }}
        searchPlaceholder="Search orders, customers, phone…"
        maxDate={businessDateStr()}
        exportFileName="mountain-bakes-orders"
        refreshKey={(refreshKey ?? 0) + localRefresh}
        onPage={(page) => setTotal(page.total)}
        emptyTitle="No orders found"
        actions={
          <Button variant="outline" size="sm" className="h-11 md:h-9" onClick={handleReport} title="Full orders report">
            <FileSpreadsheet className="h-3.5 w-3.5 md:mr-1.5" />
            <span className="ml-1.5 md:ml-0">Report</span>
          </Button>
        }
      />
    </div>
  );
}
