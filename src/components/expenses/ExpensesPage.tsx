'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { useBranches } from '@/lib/queries';
import type { Expense, FilterConfig } from '@mb/shared';
import { EXPENSE_CATEGORIES, businessDateStr, businessDaysAgoStr } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Fab } from '@/components/shared/Fab';
import { GenericDataTable } from '@/components/data-engine';
import { useListQueryState } from '@/lib/data-engine/useListQueryState';
import { useInvalidateResource, useResourceAggregate } from '@/lib/data-engine/useResource';
import { ExpenseForm } from './ExpenseForm';
import { ExpenseExportModal } from './ExpenseExportModal';
import { Plus, FileSpreadsheet } from 'lucide-react';
import { createColumnHelper } from '@tanstack/react-table';
import { PAYMENT_METHOD_LABELS } from '@/utils/constants';

const col = createColumnHelper<Expense>();

const FILTER_KEYS = ['businessDate', 'category', 'paymentMethod', 'branchId', 'amount'] as const;

const CATEGORY_OPTIONS = EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }));
const PAYMENT_OPTIONS = ['cash', 'easypaisa'].map((value) => ({ value, label: PAYMENT_METHOD_LABELS[value] ?? value }));

/**
 * Shop Expenses.
 *
 * Opens on the last seven business days, as before — but the window is now a
 * filter a person can widen, and the total card is computed in the database
 * over exactly the rows the filters select (`useResourceAggregate`), not by
 * adding up one page.
 */
export function ExpensesPage() {
  const { token, user } = useAuth();
  const { settings } = useSettings();
  const invalidate = useInvalidateResource();
  const [showForm, setShowForm] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [total, setTotal] = useState<number | null>(null);

  const cur = settings?.currencySymbol || 'Rs.';
  const isAdmin = user?.role === 'super_admin';
  const branchesQ = useBranches(token, { enabled: isAdmin });

  // One list state shared by the table and the total card, so the two can
  // never describe different rows.
  const list = useListQueryState({
    syncUrl: true,
    filterKeys: FILTER_KEYS,
    defaults: {
      sort: { key: 'createdAt', direction: 'desc' },
      filters: [{ key: 'businessDate', op: 'gte', value: businessDaysAgoStr(6) }],
    },
  });

  const filters = useMemo<FilterConfig[]>(
    () => [
      { key: 'businessDate', label: 'Date', type: 'date-range', placement: 'bar' },
      { key: 'category', label: 'Category', type: 'select', options: CATEGORY_OPTIONS, placeholder: 'All Categories', placement: 'bar' },
      { key: 'paymentMethod', label: 'Payment', type: 'select', options: PAYMENT_OPTIONS, placeholder: 'All' },
      ...(isAdmin ? [{ key: 'branchId', label: 'Branch', type: 'select', placeholder: 'All Branches' } as FilterConfig] : []),
      { key: 'amount', label: `Amount (${cur})`, type: 'number-range' },
    ],
    [isAdmin, cur],
  );
  const filterOptions = useMemo(
    () => ({ branchId: (branchesQ.data ?? []).map((b) => ({ value: b.id, label: b.name })) }),
    [branchesQ.data],
  );

  const totalsQ = useResourceAggregate('expenses', list.state, { metrics: ['sum:amount', 'count'] });
  const sum = totalsQ.data?.rows[0]?.values['sum:amount'] ?? null;

  const from = list.getFilter('businessDate', 'gte')?.value as string | undefined;
  const to = list.getFilter('businessDate', 'lte')?.value as string | undefined;
  const windowLabel =
    from && to ? `${from} to ${to}` : from ? `Since ${from}` : to ? `Up to ${to}` : 'All time';

  const columns = [
    col.accessor('expenseNumber', { header: 'ID', meta: { mobile: 'subtitle' }, cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue()}</span> }),
    col.accessor('date', { id: 'businessDate', header: 'Date', cell: (i) => <span className="text-sm">{i.getValue()}</span> }),
    col.accessor('category', { header: 'Category', meta: { mobile: 'title' }, cell: (i) => <span className="font-medium">{i.getValue()}</span> }),
    col.accessor('description', { header: 'Description', enableSorting: false, meta: { mobileFull: true }, cell: (i) => <span>{i.getValue()}</span> }),
    col.accessor('paymentMethod', { header: 'Payment', cell: (i) => <span>{PAYMENT_METHOD_LABELS[i.getValue()] ?? i.getValue()}</span> }),
    col.accessor('amount', { header: 'Amount', cell: (i) => <span className="font-semibold">{cur}{i.getValue()?.toLocaleString()}</span> }),
    col.accessor('remarks', { header: 'Remarks', enableSorting: false, meta: { mobileFull: true }, cell: (i) => <span className="text-muted-foreground">{i.getValue() || '—'}</span> }),
  ];

  function afterWrite() {
    setShowForm(false);
    void invalidate('expenses');
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Shop Expenses</h2>
          <p className="text-sm text-muted-foreground">
            {windowLabel}
            {total !== null && ` · ${total.toLocaleString()} ${total === 1 ? 'expense' : 'expenses'}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* The dated workbook export (Excel/CSV over a chosen window) stays
              as it was; the table's own Export menu below covers the filtered
              set. */}
          <Button variant="outline" size="sm" className="h-9" onClick={() => setShowExport(true)}>
            <FileSpreadsheet className="h-4 w-4 md:mr-1" />
            <span className="hidden md:inline">Export sheet</span>
          </Button>
          {/* Mobile gets this as a FAB instead — see the bottom of this component. */}
          <Button className="hidden md:inline-flex" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4 mr-1" /> Shop Expense
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <p className="text-sm font-medium text-muted-foreground">Total ({windowLabel.toLowerCase()})</p>
          <p className="text-xl font-bold text-primary" aria-busy={totalsQ.isFetching}>
            {sum !== null
              ? `${cur}${sum.toLocaleString()}`
              : totalsQ.isError
                ? '—'
                : '…'}
          </p>
        </CardContent>
      </Card>

      <GenericDataTable<Expense>
        resource="expenses"
        list={list}
        columns={columns}
        filters={filters}
        filterOptions={filterOptions}
        searchPlaceholder="Search expenses…"
        maxDate={businessDateStr()}
        exportFileName="mountain-bakes-expenses"
        onPage={(page) => setTotal(page.total)}
        emptyTitle="No expenses in this window"
      />

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="md:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Shop Expense</DialogTitle>
          </DialogHeader>
          <ExpenseForm onSuccess={afterWrite} />
        </DialogContent>
      </Dialog>

      <ExpenseExportModal open={showExport} onOpenChange={setShowExport} token={token ?? ''} />

      <Fab onClick={() => setShowForm(true)} icon={Plus} label="New shop expense" />
    </div>
  );
}
