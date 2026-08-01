'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import type { Order } from '@mb/shared';
import { formatDistanceToNow } from 'date-fns';

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
  preparing: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  ready: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  delivered: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
};

export function RecentOrdersTable({ branchId }: { branchId?: string }) {
  const { token } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    const qs = branchId ? `?branchId=${branchId}&limit=8` : '?limit=8';
    apiCall<{ orders: Order[] }>(`/api/orders${qs}`, {}, token)
      .then((r) => setOrders(r.orders))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [token, branchId]);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Recent Orders</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {/* Phone cards. Progressive column hiding got this table from six columns
            to four, but four still overflows 360px — so below `md` the same rows
            render as cards instead. */}
        <div className="space-y-3 p-4 md:hidden">
          {loading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-2 rounded-lg border p-3">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            ))
          ) : orders.length === 0 ? (
            <EmptyState title="No orders yet" description="New orders will appear here as they come in." />
          ) : (
            orders.map((o) => (
              <div key={o.id} className="rounded-lg border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{o.customerName}</p>
                    <p className="font-mono text-xs text-muted-foreground">{o.orderNumber}</p>
                  </div>
                  <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${STATUS_COLORS[o.status] || ''}`}>
                    {o.status}
                  </span>
                </div>
                <div className="mt-2 flex items-baseline justify-between text-xs">
                  <span className="text-muted-foreground">
                    {o.createdAt ? formatDistanceToNow(new Date(o.createdAt), { addSuffix: true }) : ''}
                  </span>
                  <span className="font-semibold tabular-nums">Rs.{o.grandTotal?.toLocaleString()}</span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Order</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Customer</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden sm:table-cell">Branch</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Total</th>
                <th className="text-center px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide">Status</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hidden md:table-cell">Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 6 }).map((_, j) => (
                      <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                    ))}
                  </tr>
                ))
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-muted-foreground">No orders yet</td>
                </tr>
              ) : (
                orders.map((o) => (
                  <tr key={o.id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-mono text-xs font-medium">{o.orderNumber}</td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="font-medium">{o.customerName}</p>
                        <p className="text-xs text-muted-foreground">{o.customerPhone}</p>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">{o.branchName}</td>
                    <td className="px-4 py-3 text-right font-medium">Rs.{o.grandTotal?.toLocaleString()}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium capitalize ${STATUS_COLORS[o.status] || ''}`}>
                        {o.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground text-xs hidden md:table-cell">
                      {o.createdAt ? formatDistanceToNow(new Date(o.createdAt), { addSuffix: true }) : ''}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
