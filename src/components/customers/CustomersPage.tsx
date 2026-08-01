'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { DataTable } from '@/components/shared/DataTable';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CustomerForm } from './CustomerForm';
import type { Customer } from '@mb/shared';
import { createColumnHelper } from '@tanstack/react-table';
import { Pencil } from 'lucide-react';

const col = createColumnHelper<Customer>();

export function CustomersPage() {
  const { token } = useAuth();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [refreshKey, setRefreshKey] = useState(0);
  function load() { setRefreshKey((k) => k + 1); }

  useEffect(() => {
    if (!token) return;
    apiCall<{ customers: Customer[] }>('/api/customers', {}, token)
      .then((r) => setCustomers(r.customers))
      .finally(() => setLoading(false));
  }, [token, refreshKey]);

  const columns = [
    col.accessor('name', {
      header: 'Customer',
      // Cell already stacks name over email.
      meta: { mobile: 'title' },
      cell: (info) => (
        <div>
          <p className="font-medium">{info.getValue()}</p>
          <p className="text-xs text-muted-foreground">{info.row.original.email}</p>
        </div>
      ),
    }),
    col.accessor('phone', { header: 'Phone' }),
    col.accessor('branchName', { header: 'Branch' }),
    col.accessor('address', {
      header: 'Address',
      meta: { mobileFull: true },
      cell: (info) => <span className="text-sm text-muted-foreground">{info.getValue() || 'â€”'}</span>,
    }),
    col.accessor('totalOrders', {
      header: 'Orders',
      cell: (info) => <span className="font-medium">{info.getValue()}</span>,
    }),
    col.accessor('totalSpent', {
      header: 'Total Spent',
      cell: (info) => <span className="font-semibold">Rs.{(info.getValue() || 0).toLocaleString()}</span>,
    }),
    col.display({
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={() => { setEditCustomer(row.original); setShowForm(true); }}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      ),
    }),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Customers</h2>
          <p className="text-sm text-muted-foreground">{customers.length} customers</p>
        </div>
        <Button onClick={() => { setEditCustomer(null); setShowForm(true); }}>+ Add Customer</Button>
      </div>

      <DataTable columns={columns} data={customers} loading={loading} searchPlaceholder="Search customersâ€¦" />

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle>{editCustomer ? 'Edit Customer' : 'Add Customer'}</DialogTitle>
          </DialogHeader>
          <CustomerForm
            customer={editCustomer}
            onSuccess={() => { setShowForm(false); load(); }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
