'use client';

import { useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import type { ProductionExpense } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { useProductionExpenses, useProductionExpenseSummary } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatCard } from '@/components/shared/StatCard';
import { DataTable } from '@/components/shared/DataTable';
import { ProductionExpenseForm } from './ProductionExpenseForm';
import dynamic from 'next/dynamic';
import { Plus, CalendarDays, CalendarRange, Calendar, TrendingUp } from 'lucide-react';
import { PAYMENT_METHOD_LABELS } from '@/utils/constants';

const col = createColumnHelper<ProductionExpense>();

// Charts pull in recharts; load lazily on the client to keep the initial bundle lean.
const ExpenseTrendChart = dynamic(() => import('./ProductionCharts').then((m) => m.ExpenseTrendChart), { ssr: false });
const ExpenseCategoryChart = dynamic(() => import('./ProductionCharts').then((m) => m.ExpenseCategoryChart), { ssr: false });

export function ProductionExpensesPage() {
  const { token } = useAuth();
  const { settings } = useSettings();
  const cur = settings?.currencySymbol || 'Rs.';

  const expensesQ = useProductionExpenses(token);
  const summaryQ = useProductionExpenseSummary(token);
  const [open, setOpen] = useState(false);

  const s = summaryQ.data;
  const money = (n: number) => `${cur}${n.toLocaleString()}`;

  const columns = [
    col.accessor('expenseNumber', { header: 'ID', meta: { mobile: 'subtitle' }, cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue()}</span> }),
    col.accessor('date', { header: 'Date', cell: (i) => <span className="text-sm">{i.getValue()}</span> }),
    col.accessor('category', { header: 'Category', meta: { mobile: 'title' }, cell: (i) => <span className="font-medium">{i.getValue()}</span> }),
    col.accessor('description', { header: 'Description', meta: { mobileFull: true }, cell: (i) => <span>{i.getValue()}</span> }),
    col.accessor('paymentMethod', { header: 'Payment', cell: (i) => <span>{PAYMENT_METHOD_LABELS[i.getValue()] ?? i.getValue()}</span> }),
    col.accessor('supplier', { header: 'Supplier', cell: (i) => <span className="text-muted-foreground">{i.getValue() || '—'}</span> }),
    col.accessor('amount', { header: 'Amount', cell: (i) => <span className="font-semibold">{money(i.getValue() || 0)}</span> }),
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Production Expenses</h2>
          <p className="text-sm text-muted-foreground">Last 30 days</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> New Expense
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Today" value={money(s?.today ?? 0)} icon={CalendarDays} color="orange" loading={summaryQ.isLoading} />
        <StatCard title="This Week" value={money(s?.weekly ?? 0)} icon={CalendarRange} color="blue" loading={summaryQ.isLoading} />
        <StatCard title="This Month" value={money(s?.monthly ?? 0)} icon={Calendar} color="brown" loading={summaryQ.isLoading} />
        <StatCard title="This Year" value={money(s?.yearly ?? 0)} icon={TrendingUp} color="green" loading={summaryQ.isLoading} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ExpenseTrendChart data={s?.trend ?? []} loading={summaryQ.isLoading} currency={cur} />
        <ExpenseCategoryChart data={s?.byCategory ?? []} loading={summaryQ.isLoading} currency={cur} />
      </div>

      <DataTable columns={columns} data={expensesQ.data ?? []} loading={expensesQ.isLoading} searchPlaceholder="Search expenses…" />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="md:max-w-lg">
          <DialogHeader><DialogTitle>New Production Expense</DialogTitle></DialogHeader>
          <ProductionExpenseForm onSuccess={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
