'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { OrdersPage } from './OrdersPage';
import { OrderForm } from './OrderForm';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function BranchOrdersPage() {
  const searchParams = useSearchParams();
  const [showForm, setShowForm] = useState(searchParams.get('new') === '1');
  const [refreshKey, setRefreshKey] = useState(0);

  function handleOrderSuccess() {
    setShowForm(false);
    setRefreshKey((k) => k + 1);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold">Branch Orders</h2>
          <p className="text-sm text-muted-foreground">Manage your branch orders</p>
        </div>
        <Button onClick={() => setShowForm(true)}>+ New Order</Button>
      </div>

      <OrdersPage refreshKey={refreshKey} />

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="md:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create New Order</DialogTitle>
          </DialogHeader>
          <OrderForm onSuccess={handleOrderSuccess} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
