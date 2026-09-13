'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { useBranches } from '@/lib/queries';
import type { FilterConfig, FinanceQuery } from '@mb/shared';
import { FINANCE_QUERY_CATEGORIES, FINANCE_QUERY_TXN_TYPES } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Fab } from '@/components/shared/Fab';
import { GenericDataTable } from '@/components/data-engine';
import { useInvalidateResource } from '@/lib/data-engine/useResource';
import { FinanceQueryForm } from './FinanceQueryForm';
import { FinanceQueryDetailDialog } from './FinanceQueryDetailDialog';
import { apiCall } from '@/utils/api';
import { toast } from 'sonner';
import { createColumnHelper } from '@tanstack/react-table';
import { Plus, Eye, Pencil, Trash2 } from 'lucide-react';

const col = createColumnHelper<FinanceQuery>();

const TYPE_OPTIONS = FINANCE_QUERY_TXN_TYPES.map((t) => ({ value: t, label: t === 'income' ? 'Income' : 'Expense' }));
const CATEGORY_OPTIONS = FINANCE_QUERY_CATEGORIES.map((c) => ({ value: c, label: c }));

/**
 * Finance Query — a plain, standalone finance record (Date, Title, Amount,
 * Category, Branch, Income/Expense, Comment). Deliberately distinct from the
 * Finance Help Desk ticket queue and Finance Entries' approval workflow — see
 * frontend/.claude/ProjectMDFiles/chagneQuery.md for the brief this implements.
 *
 * A Finance Query IS the finance record: there is no separate line-item
 * table, so "Delete Data" (a row in this table) and "Delete Query" (from the
 * detail view) are the same delete call with two confirmation prompts.
 */
export function FinanceQueriesPage() {
  const { token, user } = useAuth();
  const { settings } = useSettings();
  const invalidate = useInvalidateResource();
  const isAdmin = user?.role === 'super_admin';

  const [showForm, setShowForm] = useState(false);
  const [editQuery, setEditQuery] = useState<FinanceQuery | null>(null);
  const [detailQuery, setDetailQuery] = useState<FinanceQuery | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  const cur = settings?.currencySymbol || 'Rs.';
  const branchesQ = useBranches(token ?? '');

  const filters = useMemo<FilterConfig[]>(
    () => [
      { key: 'businessDate', label: 'Date', type: 'date-range', placement: 'bar' },
      { key: 'category', label: 'Category', type: 'select', options: CATEGORY_OPTIONS, placeholder: 'All Categories', placement: 'bar' },
      { key: 'branchId', label: 'Branch', type: 'select', placeholder: 'All Branches' },
      { key: 'type', label: 'Type', type: 'select', options: TYPE_OPTIONS, placeholder: 'Income or Expense' },
      { key: 'amount', label: `Amount (${cur})`, type: 'number-range' },
    ],
    [cur],
  );
  const filterOptions = useMemo(
    () => ({ branchId: (branchesQ.data ?? []).map((b) => ({ value: b.id, label: b.name })) }),
    [branchesQ.data],
  );

  function afterWrite() {
    setShowForm(false);
    setEditQuery(null);
    void invalidate('financeQueries');
  }

  function openAdd() {
    setEditQuery(null);
    setShowForm(true);
  }

  function openEdit(q: FinanceQuery) {
    setDetailQuery(null);
    setEditQuery(q);
    setShowForm(true);
  }

  async function handleDelete(q: FinanceQuery, fromDetail: boolean) {
    const confirmed = fromDetail
      ? confirm('Delete Finance Query?\n\nThis will permanently delete this finance query and its associated data.')
      : confirm('Delete Finance Record?\n\nThis action will permanently delete this finance record.');
    if (!confirmed) return;
    try {
      await apiCall(`/api/finance-queries/${q.id}`, { method: 'DELETE' }, token);
      toast.success('Finance query deleted');
      setDetailQuery(null);
      void invalidate('financeQueries');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  const columns = [
    col.accessor('queryNo', { header: 'Query ID', meta: { mobile: 'subtitle' }, cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue()}</span> }),
    col.accessor('date', { id: 'businessDate', header: 'Date', cell: (i) => <span className="text-sm">{i.getValue()}</span> }),
    col.accessor('title', { header: 'Title', meta: { mobile: 'title' }, cell: (i) => <span className="font-medium">{i.getValue()}</span> }),
    col.accessor('amount', { header: 'Amount', cell: (i) => <span className="font-semibold">{cur}{i.getValue()?.toLocaleString()}</span> }),
    col.accessor('category', { header: 'Category' }),
    col.accessor('branchName', { header: 'Branch' }),
    col.accessor('type', {
      header: 'Type',
      meta: { mobile: 'badge' },
      cell: (i) => (
        <span className={i.getValue() === 'income' ? 'font-medium text-emerald-600' : 'font-medium text-destructive'}>
          {i.getValue() === 'income' ? 'Income' : 'Expense'}
        </span>
      ),
    }),
    col.accessor('comment', { header: 'Comment', enableSorting: false, meta: { mobileFull: true }, cell: (i) => <span className="text-muted-foreground">{i.getValue() || '—'}</span> }),
    col.display({
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" title="Show detail" onClick={() => setDetailQuery(row.original)}>
            <Eye className="h-3.5 w-3.5" />
          </Button>
          {isAdmin && (
            <>
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => openEdit(row.original)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive"
                title="Delete"
                onClick={() => handleDelete(row.original, false)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      ),
    }),
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Finance Query</h2>
          <p className="text-sm text-muted-foreground">
            {total === null ? 'Loading…' : `${total.toLocaleString()} ${total === 1 ? 'record' : 'records'}`}
          </p>
        </div>
        {isAdmin && (
          <Button className="hidden md:inline-flex" onClick={openAdd}>
            <Plus className="h-4 w-4 mr-1" /> Add Data
          </Button>
        )}
      </div>

      <GenericDataTable<FinanceQuery>
        resource="financeQueries"
        columns={columns}
        filters={filters}
        filterOptions={filterOptions}
        defaultSort={{ key: 'createdAt', direction: 'desc' }}
        searchPlaceholder="Search by Query ID or title…"
        exportFileName="finance-queries"
        onPage={(page) => setTotal(page.total)}
        emptyTitle="No finance queries yet"
      />

      <Dialog open={showForm} onOpenChange={(open) => { setShowForm(open); if (!open) setEditQuery(null); }}>
        <DialogContent className="md:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editQuery ? 'Edit Finance Record' : 'Add Finance Data'}</DialogTitle>
          </DialogHeader>
          <FinanceQueryForm query={editQuery} onSuccess={afterWrite} />
        </DialogContent>
      </Dialog>

      <FinanceQueryDetailDialog
        query={detailQuery}
        open={!!detailQuery}
        onOpenChange={(open) => { if (!open) setDetailQuery(null); }}
        isAdmin={isAdmin}
        onEdit={openEdit}
        onDelete={(q) => handleDelete(q, true)}
      />

      {isAdmin && <Fab onClick={openAdd} icon={Plus} label="Add finance data" />}
    </div>
  );
}
