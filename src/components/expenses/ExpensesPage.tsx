'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { apiCall } from '@/utils/api';
import type { Expense } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable } from '@/components/shared/DataTable';
import { ExpenseForm } from './ExpenseForm';
import { Plus } from 'lucide-react';
import { createColumnHelper } from '@tanstack/react-table';
import { PAYMENT_METHOD_LABELS } from '@/utils/constants';

const col = createColumnHelper<Expense>();

export function ExpensesPage() {
  const { token } = useAuth();
  const { settings } = useSettings();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);

  const cur = settings?.currencySymbol || 'Rs.';

  function load() {
    if (!token) return;
    setLoading(true);
    apiCall<{ expenses: Expense[] }>('/api/expenses', {}, token)
      .then((r) => setExpenses(r.expenses ?? []))
      .catch(() => setExpenses([]))
      .finally(() => setLoading(false));
  }
  useEffect(load, [token]);

  const total = useMemo(() => expenses.reduce((s, e) => s + (e.amount || 0), 0), [expenses]);

  const columns = [
    col.accessor('expenseNumber', { header: 'ID', cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue()}</span> }),
    col.accessor('date', { header: 'Date', cell: (i) => <span className="text-sm">{i.getValue()}</span> }),
    col.accessor('category', { header: 'Category', cell: (i) => <span className="font-medium">{i.getValue()}</span> }),
    col.accessor('description', { header: 'Description', cell: (i) => <span>{i.getValue()}</span> }),
    col.accessor('paymentMethod', { header: 'Payment', cell: (i) => <span>{PAYMENT_METHOD_LABELS[i.getValue()] ?? i.getValue()}</span> }),
    col.accessor('amount', { header: 'Amount', cell: (i) => <span className="font-semibold">{cur}{i.getValue()?.toLocaleString()}</span> }),
    col.accessor('remarks', { header: 'Remarks', cell: (i) => <span className="text-muted-foreground">{i.getValue() || '—'}</span> }),
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Shop Expenses</h2>
          <p className="text-sm text-muted-foreground">Last 7 days</p>
        </div>
        <Button onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4 mr-1" /> Shop Expense
        </Button>
      </div>

      <DataTable columns={columns} data={expenses} loading={loading} searchPlaceholder="Search expenses…" />

      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <p className="text-sm font-medium text-muted-foreground">Total (last 7 days)</p>
          <p className="text-xl font-bold text-primary">{cur}{total.toLocaleString()}</p>
        </CardContent>
      </Card>

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Shop Expense</DialogTitle>
          </DialogHeader>
          <ExpenseForm onSuccess={() => { setShowForm(false); load(); }} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
