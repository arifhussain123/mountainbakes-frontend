'use client';

import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import {
  FINANCE_PAYMENT_METHOD_LABELS,
  type FilterConfig,
  type FinanceTransaction,
  type SortState,
} from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranches } from '@/lib/queries';
import { useFinanceEntries, useFinanceEntrySubmitters } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable } from '@/components/shared/DataTable';
import { Pagination } from '@/components/data-engine/Pagination';
import { FilterBar, ActiveFilters } from '@/components/data-engine';
import { sortStateToTanstack, tanstackToSortState } from '@/lib/data-engine/sortConversion';
import { useListQueryState } from '@/lib/data-engine/useListQueryState';
import { ExpandableText } from '@/components/shared/ExpandableText';
import { formatDateTime } from '@/utils/date';
import { FinancePageHeader, Money, StatusBadge, useFinanceAbilities } from './finance-ui';
import { FinanceEntryForm } from './FinanceEntryForm';
import { EntryDecisionButtons, FinanceEntryDetails } from './FinanceEntryDetails';
import { Eye } from 'lucide-react';

/**
 * Pending Approvals — the accountants' Income & Expense entries waiting for a
 * Finance Admin decision, oldest submission first.
 *
 * The same documents and the same API as Income & Expense (one place to fix an
 * approval bug); this screen is the queue's view of them: who sent each one and
 * when, filterable by submitter. Approve / Reject sit on the row after View.
 *
 * With no Status chosen it shows what is waiting. "All statuses" sends no
 * status at all, so an approver can look back at what they decided.
 */

const col = createColumnHelper<FinanceTransaction>();
const PENDING = 'pending_approval';
const ALL = 'all';

export function FinanceApprovalsPage() {
  const { token } = useAuth();
  const abilities = useFinanceAbilities();

  const [viewing, setViewing] = useState<FinanceTransaction | null>(null);
  const [editing, setEditing] = useState<FinanceTransaction | null>(null);
  // Oldest submission first: the queue is worked from the front.
  const [sort, setSort] = useState<SortState | null>({ key: 'submittedAt', direction: 'asc' });

  const list = useListQueryState({
    syncUrl: true,
    filterKeys: ['status', 'type', 'branchId', 'submittedBy', 'businessDate'],
  });

  const branchesQ = useBranches(token ?? '');
  const submittersQ = useFinanceEntrySubmitters();

  const filters = useMemo<FilterConfig[]>(
    () => [
      {
        key: 'status', label: 'Status', type: 'select', placement: 'bar',
        options: [
          { value: PENDING, label: 'Pending Approval' },
          { value: 'rejected', label: 'Rejected' },
          { value: 'posted', label: 'Approved (posted)' },
          { value: ALL, label: 'All statuses' },
        ],
      },
      { key: 'businessDate', label: 'Date', type: 'date-range', placement: 'bar' },
      {
        key: 'type', label: 'Type', type: 'select',
        options: [
          { value: 'income', label: 'Income' },
          { value: 'expense', label: 'Expense' },
        ],
      },
      { key: 'branchId', label: 'Branch', type: 'select' },
      { key: 'submittedBy', label: 'Submitted by', type: 'select' },
    ],
    [],
  );
  const filterOptions = useMemo(
    () => ({
      branchId: (branchesQ.data ?? []).map((b) => ({ value: b.id, label: b.name })),
      submittedBy: (submittersQ.data ?? []).map((u) => ({ value: u.id, label: u.name })),
    }),
    [branchesQ.data, submittersQ.data],
  );

  const chosenStatus = (list.getFilter('status')?.value as string | undefined) ?? PENDING;
  const { data, isLoading } = useFinanceEntries({
    status: chosenStatus === ALL ? undefined : chosenStatus,
    type: list.getFilter('type')?.value as string | undefined,
    branchId: list.getFilter('branchId')?.value as string | undefined,
    submittedBy: list.getFilter('submittedBy')?.value as string | undefined,
    from: list.getFilter('businessDate', 'gte')?.value as string | undefined,
    to: list.getFilter('businessDate', 'lte')?.value as string | undefined,
    search: list.state.search || undefined,
    limit: list.state.pageSize,
    offset: (list.state.page - 1) * list.state.pageSize,
    sortBy: sort?.key,
    sortDir: sort?.direction,
  });

  const rows = data?.entries ?? [];
  const total = data?.total ?? 0;

  const columns = [
    // First, as on Demand Record: the queue's actions stay on screen however
    // narrow the laptop, rather than past a horizontal scroll.
    col.display({
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: (i) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="View" onClick={() => setViewing(i.row.original)}>
            <Eye className="h-3.5 w-3.5" />
          </Button>
          <EntryDecisionButtons entry={i.row.original} abilities={abilities} />
        </div>
      ),
    }),
    col.accessor('txnNo', {
      header: 'Entry No / Type',
      meta: { mobile: 'subtitle' },
      cell: (i) => (
        <span className="block">
          <span className="font-mono text-xs text-muted-foreground">
            {i.getValue()}
            {i.row.original.revision > 1 && <span className="ml-1 font-sans">· rev. {i.row.original.revision}</span>}
          </span>
          {/* The transaction type, under its number: the side of the books at a glance. */}
          <span
            className={
              i.row.original.txnType === 'income'
                ? 'block text-xs font-medium capitalize text-emerald-600 dark:text-emerald-400'
                : 'block text-xs font-medium capitalize text-red-600 dark:text-red-400'
            }
          >
            {i.row.original.txnType}
          </span>
        </span>
      ),
    }),
    col.accessor('businessDate', { header: 'Date', cell: (i) => <span className="text-sm whitespace-nowrap">{i.getValue()}</span> }),
    col.accessor('ledgerHeadName', {
      header: 'Ledger Head',
      meta: { mobile: 'title' },
      cell: (i) => <span className="font-medium">{i.getValue()}</span>,
    }),
    col.accessor('description', {
      header: 'Description',
      meta: { mobileFull: true },
      cell: (i) => <ExpandableText text={i.getValue()} lines={2} className="text-sm md:max-w-[12rem]" />,
    }),
    col.accessor('branchName', {
      header: 'Branch',
      cell: (i) => <span className="text-sm text-muted-foreground">{i.getValue() ?? 'Company-wide'}</span>,
    }),
    col.accessor('amount', {
      header: 'Amount',
      cell: (i) => (
        <Money
          value={i.getValue()}
          className={
            i.row.original.txnType === 'income'
              ? 'font-semibold text-emerald-600 dark:text-emerald-400'
              : 'font-semibold text-red-600 dark:text-red-400'
          }
        />
      ),
    }),
    col.accessor('paymentMethod', {
      header: 'Method',
      cell: (i) => <span className="text-sm">{FINANCE_PAYMENT_METHOD_LABELS[i.getValue()] ?? i.getValue()}</span>,
    }),
    // Who and when in one cell, so the queue fits a laptop screen; sorts by when.
    col.accessor('submittedAt', {
      header: 'Submitted',
      cell: (i) => (
        <span className="block text-sm">
          {i.row.original.submittedByName ?? '—'}
          <span className="block whitespace-nowrap text-xs text-muted-foreground">
            {i.getValue() ? formatDateTime(i.getValue()) : '—'}
          </span>
        </span>
      ),
    }),
    col.accessor('status', {
      header: 'Status',
      meta: { mobile: 'badge' },
      cell: (i) => <StatusBadge status={i.getValue()} />,
    }),
  ];

  return (
    <div className="space-y-6">
      <FinancePageHeader
        title="Pending Approvals"
        description="Income & Expense entries submitted by accountants. Approving posts the entry to the Daily Ledger and issues its RV-/PV- voucher; rejecting sends it back with your remarks."
      />

      {!abilities.loading && !abilities.approve && (
        <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          You can see the queue, but approving and rejecting need a Finance Admin or Finance Manager account.
        </p>
      )}

      <FilterBar list={list} filters={filters} options={filterOptions} searchable={false} />
      <ActiveFilters
        filters={list.activeFilters}
        configs={filters}
        options={filterOptions}
        search={list.state.search}
        onRemove={list.clearFilter}
        onClearSearch={() => list.setSearch('')}
        onClearAll={list.clearAll}
      />

      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        searchPlaceholder="Search entries…"
        pager={false}
        dense
        sortable
        manual={{
          page: list.state.page,
          pageSize: list.state.pageSize,
          total,
          onPageChange: list.setPage,
          search: list.state.search,
          onSearchChange: list.setSearch,
          sorting: sortStateToTanstack(sort),
          onSortingChange: (next) => {
            setSort(tanstackToSortState(next));
            list.setPage(1);
          },
        }}
      />
      <Pagination
        page={list.state.page}
        pageSize={list.state.pageSize}
        total={total}
        onPageChange={list.setPage}
        onPageSizeChange={list.setPageSize}
        loading={isLoading}
        className="sticky bottom-0 z-10 -mx-4 -mb-4 border-t bg-background px-4 py-3 sm:-mx-6 sm:-mb-6 sm:px-6"
      />

      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewing?.txnNo}</DialogTitle>
          </DialogHeader>
          {viewing && (
            <FinanceEntryDetails
              entry={viewing}
              abilities={abilities}
              onEdit={(e) => {
                setViewing(null);
                setEditing(e);
              }}
              onClose={() => setViewing(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing?.status === 'rejected' ? `Correct ${editing.txnNo}` : `Edit ${editing?.txnNo}`}
            </DialogTitle>
          </DialogHeader>
          {editing && <FinanceEntryForm entry={editing} onSuccess={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
