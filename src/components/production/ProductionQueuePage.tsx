'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { useProductionQueue, type ProductionQueueOrder } from '@/lib/queries';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/shared/StatCard';
import { Clock, ChefHat, CheckCircle, ShoppingCart } from 'lucide-react';
import type { OrderStatus } from '@mb/shared';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';

const STATUS_NEXT: Partial<Record<OrderStatus, OrderStatus>> = {
  pending: 'preparing',
  preparing: 'ready',
  ready: 'delivered',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'border-l-yellow-400',
  preparing: 'border-l-blue-400',
  ready: 'border-l-green-400',
};

export function ProductionQueuePage() {
  const { token } = useAuth();
  const { data, isLoading } = useProductionQueue(token ?? '');
  const [updating, setUpdating] = useState<string | null>(null);

  async function advanceStatus(order: ProductionQueueOrder) {
    const next = STATUS_NEXT[order.status];
    if (!next || !token) return;

    setUpdating(order.id);
    try {
      await apiCall(`/api/production/${order.id}/status`, { method: 'PUT', body: JSON.stringify({ status: next }) }, token);
      toast.success(`Order ${order.orderNumber} â†’ ${next}`);
    } catch {
      toast.error('Failed to update status');
    } finally {
      setUpdating(null);
    }
  }

  const byBranch = Object.entries(data?.queue ?? {}).map(([branchId, orders]) => ({
    branchId,
    name: orders[0]?.branchName ?? branchId,
    orders,
  }));

  const stats = data?.stats ?? { waitingCount: 0, preparingCount: 0, readyCount: 0, totalActive: 0 };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Waiting" value={stats.waitingCount} icon={Clock} color="orange" />
        <StatCard title="Preparing" value={stats.preparingCount} icon={ChefHat} color="blue" />
        <StatCard title="Ready" value={stats.readyCount} icon={CheckCircle} color="green" />
        <StatCard title="Total Active" value={stats.totalActive} icon={ShoppingCart} color="brown" />
      </div>

      {/* Live indicator — reflects the query's own state; the app's 2-second
          refresh tick keeps it current, no bespoke interval or subscription. */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span className={`w-2 h-2 rounded-full ${data && !isLoading ? 'bg-green-500' : 'bg-gray-400'}`} />
        {data && !isLoading ? 'Live' : 'Loading…'}
      </div>

      {/* Branch columns */}
      {byBranch.length === 0 ? (
        <Card className="py-16 text-center">
          <CardContent>
            <CheckCircle className="h-12 w-12 mx-auto text-green-500 mb-3" />
            <p className="text-lg font-semibold">All clear!</p>
            <p className="text-muted-foreground text-sm">No pending orders at the moment.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {byBranch.map((branch) => (
            <div key={branch.branchId} className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-sm">{branch.name.replace('Mountain Bakes ', '')}</h3>
                <Badge variant="outline" className="text-xs">{branch.orders.length}</Badge>
              </div>
              <div className="space-y-2">
                {branch.orders.map((order) => (
                  <Card
                    key={order.id}
                    className={`border-l-4 ${STATUS_COLORS[order.status] || 'border-l-gray-200'}`}
                  >
                    <CardContent className="p-3 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-xs font-bold">{order.orderNumber}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium capitalize
                          ${order.status === 'pending' ? 'bg-yellow-100 text-yellow-800' :
                            order.status === 'preparing' ? 'bg-blue-100 text-blue-800' :
                            'bg-green-100 text-green-800'}`}>
                          {order.status}
                        </span>
                      </div>
                      <p className="text-xs font-medium">{order.customerName}</p>
                      <div className="space-y-0.5">
                        {order.items.map((item, i) => (
                          <p key={i} className="text-xs text-muted-foreground">
                            {item.qty}Ã— {item.productName}
                          </p>
                        ))}
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {order.createdAt ? formatDistanceToNow(new Date(order.createdAt), { addSuffix: true }) : ''}
                      </p>
                      {STATUS_NEXT[order.status] && (
                        <Button
                          size="sm"
                          className="w-full h-7 text-xs capitalize"
                          onClick={() => advanceStatus(order)}
                          disabled={updating === order.id}
                          variant={order.status === 'ready' ? 'default' : 'outline'}
                        >
                          {updating === order.id ? 'Updatingâ€¦' : `Mark ${STATUS_NEXT[order.status]}`}
                        </Button>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
