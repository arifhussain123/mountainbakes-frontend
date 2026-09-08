'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useBranches } from '@/lib/queries';
import { GenericDataTable } from '@/components/data-engine';
import { useInvalidateResource } from '@/lib/data-engine/useResource';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CustomerForm } from './CustomerForm';
import type { Customer, FilterConfig } from '@mb/shared';
import { createColumnHelper } from '@tanstack/react-table';
import { Pencil } from 'lucide-react';

const col = createColumnHelper<Customer>();

/**
 * Customers — searched, sorted and paged in the database through the Data
 * Engine (`resource="customers"`). A branch account is scoped to its own
 * customers by the API; the Branch filter is only offered to an admin.
 */
export function CustomersPage() {
  const { token, user } = useAuth();
  const invalidate = useInvalidateResource();
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [total, setTotal] = useState<number | null>(null);

  const isAdmin = user?.role === 'super_admin';
  const branchesQ = useBranches(token, { enabled: isAdmin });

  const filters = useMemo<FilterConfig[]>(
    () => [
      ...(isAdmin ? [{ key: 'branchId', label: 'Branch', type: 'select', placeholder: 'All Branches', placement: 'bar' } as FilterConfig] : []),
      { key: 'totalOrders', label: 'Orders', type: 'number-range' },
      { key: 'totalSpent', label: 'Total spent (Rs.)', type: 'number-range' },
      { key: 'createdAt', label: 'Customer since', type: 'date-range' },
    ],
    [isAdmin],
  );
  const filterOptions = useMemo(
    () => ({ branchId: (branchesQ.data ?? []).map((b) => ({ value: b.id, label: b.name })) }),
    [branchesQ.data],
  );

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
    col.accessor('phone', { header: 'Phone', enableSorting: false }),
    col.accessor('branchName', { header: 'Branch' }),
    col.accessor('address', {
      header: 'Address',
      enableSorting: false,
      meta: { mobileFull: true },
      cell: (info) => <span className="text-sm text-muted-foreground">{info.getValue() || '—'}</span>,
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
          <p className="text-sm text-muted-foreground">
            {total === null ? 'Loading…' : `${total.toLocaleString()} ${total === 1 ? 'customer' : 'customers'}`}
          </p>
        </div>
        <Button onClick={() => { setEditCustomer(null); setShowForm(true); }}>+ Add Customer</Button>
      </div>

      <GenericDataTable<Customer>
        resource="customers"
        columns={columns}
        filters={filters}
        filterOptions={filterOptions}
        defaultSort={{ key: 'createdAt', direction: 'desc' }}
        searchPlaceholder="Search name, phone, email…"
        cache="static"
        exportFileName="mountain-bakes-customers"
        onPage={(page) => setTotal(page.total)}
        emptyTitle="No customers yet"
      />

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle>{editCustomer ? 'Edit Customer' : 'Add Customer'}</DialogTitle>
          </DialogHeader>
          <CustomerForm
            customer={editCustomer}
            onSuccess={() => { setShowForm(false); void invalidate('customers'); }}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
