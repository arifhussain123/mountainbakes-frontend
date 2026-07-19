'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { DataTable } from '@/components/shared/DataTable';
import { OrderStatusBadge } from './OrderStatusBadge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import type { Order, OrderStatus } from '@mb/shared';
import { createColumnHelper } from '@tanstack/react-table';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { PAYMENT_METHOD_LABELS } from '@/utils/constants';

const col = createColumnHelper<Order>();

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All Statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'preparing', label: 'Preparing' },
  { value: 'ready', label: 'Ready' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
];

export function OrdersPage({ refreshKey }: { refreshKey?: number }) {
  const { token, user } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setError(null);
    const qs = statusFilter !== 'all' ? `?status=${statusFilter}` : '';
    apiCall<{ orders: Order[] }>(`/api/orders${qs}`, {}, token)
      .then((r) => setOrders(r.orders))
      .catch((err) => {
        console.error(err);
        setOrders([]);
        setError(err instanceof Error ? err.message : 'Failed to load orders');
      })
      .finally(() => setLoading(false));
  }, [token, statusFilter, refreshKey]);

  async function handleStatusChange(id: string, status: OrderStatus) {
    try {
      await apiCall(`/api/orders/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }, token);
      setOrders((prev) => prev.map((o) => o.id === id ? { ...o, status } : o));
      toast.success(`Order marked as ${status}`);
    } catch {
      toast.error('Failed to update status');
    }
  }

  async function handleExport() {
    try {
      const qs = statusFilter !== 'all' ? `?type=excel&status=${statusFilter}` : '?type=excel';
      const blob = await apiCall<Blob>(`/api/reports/export${qs}`, {}, token);
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
      cell: (info) => <span className="font-mono text-xs font-medium">{info.getValue()}</span>,
    }),
    col.accessor('customerName', {
      header: 'Customer',
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
      cell: (info) => <span>{info.getValue().length} item(s)</span>,
    }),
    col.accessor('grandTotal', {
      header: 'Total',
      cell: (info) => <span className="font-semibold">Rs.{info.getValue()?.toLocaleString()}</span>,
    }),
    col.accessor('paymentMethod', {
      header: 'Payment',
      cell: (info) => <span>{PAYMENT_METHOD_LABELS[info.getValue()] ?? info.getValue()}</span>,
    }),
    col.accessor('status', {
      header: 'Status',
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
                â†’ {next}
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
          <p className="text-sm text-muted-foreground">{orders.length} total orders</p>
        </div>
        {(user?.role === 'branch_manager' || user?.role === 'super_admin') && (
          <Button onClick={() => router.push(user.role === 'branch_manager' ? '/branch-orders?new=1' : '/orders/new')}>
            New Order
          </Button>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3">
          <p className="text-sm font-medium text-destructive">Couldn&rsquo;t load orders: {error}</p>
          <p className="text-xs text-muted-foreground">
            If the app isn&rsquo;t open at http://localhost:3000, the API may be blocking the request (CORS).
            Check the browser console for details.
          </p>
        </div>
      )}

      <DataTable
        columns={columns}
        data={orders}
        loading={loading}
        searchPlaceholder="Search orders, customersâ€¦"
        onExport={handleExport}
        actions={
          <Select value={statusFilter} onValueChange={(v) => v && setStatusFilter(v)}>
            <SelectTrigger className="h-9 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </div>
  );
}
