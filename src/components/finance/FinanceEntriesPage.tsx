'use client';

import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import {
  FINANCE_PAYMENT_METHODS,
  FINANCE_PAYMENT_METHOD_LABELS,
  type FilterConfig,
  type FinanceTransaction,
  type SortState,
} from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranches } from '@/lib/queries';
import { useFinanceEntries, useLedgerHeads } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable } from '@/components/shared/DataTable';
import { Pagination } from '@/components/data-engine/Pagination';
import { FilterBar, ActiveFilters } from '@/components/data-engine';
import { sortStateToTanstack, tanstackToSortState } from '@/lib/data-engine/sortConversion';
import { useListQueryState } from '@/lib/data-engine/useListQueryState';
import { ExpandableText } from '@/components/shared/ExpandableText';
import { formatDate } from '@/utils/date';
import { FinancePageHeader, Money, ReadOnlyNotice, StatusBadge, useFinanceAbilities } from './finance-ui';
import { FinanceEntryForm } from './FinanceEntryForm';
import { EntryDecisionButtons, FinanceEntryDetails } from './FinanceEntryDetails';
import { Eye, Plus } from 'lucide-react';

/**
 * Manual income and expense entries — everything that does not arrive from a
 * branch closing, a payslip or a partner withdrawal.
 *
 * Income and expense share one screen because they share one document type: the
 * ledger head decides which side of the books a row lands on, and splitting them
 * into two near-identical pages would mean two places to fix an approval bug.
 * The Type filter is there for anyone who wants them apart.
 */

const col = createColumnHelper<FinanceTransaction>();

export function FinanceEntriesPage() {
  const { token } = useAuth();
  const abilities = useFinanceAbilities();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<FinanceTransaction | null>(null);
  const [viewing, setViewing] = useState<FinanceTransaction | null>(null);
  // null = the API's own default (businessDate desc) — no `sortBy` sent.
  const [sort, setSort] = useState<SortState | null>(null);

  const list = useListQueryState({
    syncUrl: true,
    filterKeys: ['status', 'type', 'ledgerHeadId', 'branchId', 'businessDate', 'paymentMethod', 'amount'],
  });

  const branchesQ = useBranches(token ?? '');
  const headsQ = useLedgerHeads(true);

  const filters = useMemo<FilterConfig[]>(
    () => [
      {
        key: 'status', label: 'Status', type: 'select', placement: 'bar',
        options: [
          { value: 'draft', label: 'Draft' },
          { value: 'pending_approval', label: 'Pending Approval' },
          { value: 'posted', label: 'Posted' },
          { value: 'locked', label: 'Locked' },
          { value: 'rejected', label: 'Rejected' },
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
      { key: 'ledgerHeadId', label: 'Ledger head', type: 'select' },
      { key: 'branchId', label: 'Branch', type: 'select' },
      {
        key: 'paymentMethod', label: 'Method', type: 'select',
        options: FINANCE_PAYMENT_METHODS.map((m) => ({ value: m, label: FINANCE_PAYMENT_METHOD_LABELS[m] ?? m })),
      },
      { key: 'amount', label: 'Amount', type: 'number-range' },
    ],
    [],
  );
  const filterOptions = useMemo(
    () => ({
      ledgerHeadId: (headsQ.data ?? []).map((h) => ({ value: h.id, label: h.name })),
      branchId: (branchesQ.data ?? []).map((b) => ({ value: b.id, label: b.name })),
    }),
    [headsQ.data, branchesQ.data],
  );

  const { data, isLoading } = useFinanceEntries({
    status: list.getFilter('status')?.value as string | undefined,
    type: list.getFilter('type')?.value as string | undefined,
    branchId: list.getFilter('branchId')?.value as string | undefined,
    ledgerHeadId: list.getFilter('ledgerHeadId')?.value as string | undefined,
    paymentMethod: list.getFilter('paymentMethod')?.value as string | undefined,
    from: list.getFilter('businessDate', 'gte')?.value as string | undefined,
    to: list.getFilter('businessDate', 'lte')?.value as string | undefined,
    minAmount: list.getFilter('amount', 'gte')?.value as string | undefined,
    maxAmount: list.getFilter('amount', 'lte')?.value as string | undefined,
    search: list.state.search || undefined,
    limit: list.state.pageSize,
    offset: (list.state.page - 1) * list.state.pageSize,
    sortBy: sort?.key,
    sortDir: sort?.direction,
  });

  const rows = data?.entries ?? [];
  const total = data?.total ?? 0;

  const columns = [
    // The PV-/RV- sits under the entry number once approval issues it.
    col.accessor('txnNo', {
      header: 'Entry No / Voucher',
      meta: { mobile: 'subtitle' },
      cell: (i) => (
        <span className="block">
          <span className="font-mono text-xs text-muted-foreground">
            {i.getValue()}
            {i.row.original.revision > 1 && <span className="ml-1 font-sans">· rev. {i.row.original.revision}</span>}
          </span>
          {i.row.original.voucherNo && (
            <span className="block font-mono text-xs font-semibold">{i.row.original.voucherNo}</span>
          )}
        </span>
      ),
    }),
    col.accessor('businessDate', { header: 'Date', cell: (i) => <span className="text-sm whitespace-nowrap">{i.getValue()}</span> }),
    col.accessor('ledgerHeadName', {
      header: 'Ledger Head',
      meta: { mobile: 'title' },
      cell: (i) => (
        <span className="block font-medium">
          {i.getValue()}
          <span
            className={
              i.row.original.txnType === 'income'
                ? 'block text-xs font-normal capitalize text-emerald-600 dark:text-emerald-400'
                : 'block text-xs font-normal capitalize text-red-600 dark:text-red-400'
            }
          >
            {i.row.original.txnType}
          </span>
        </span>
      ),
    }),
    // Free text, so it is capped and clipped rather than left to widen the
    // row. TableCell is `whitespace-nowrap`: without a ceiling a long entry is
    // laid out as one unbroken line and takes the width off the columns beside
    // it. The note, the longest free text on the page, reads under it.
    col.accessor('description', {
      header: 'Description / Notes',
      meta: { mobileFull: true },
      cell: (i) => (
        <span className="block md:max-w-[13rem]">
          <ExpandableText text={i.getValue()} lines={2} className="block whitespace-normal break-words text-sm" />
          {i.row.original.notes?.trim() && (
            <ExpandableText
              text={i.row.original.notes.trim()}
              lines={1}
              className="block whitespace-normal break-words text-xs text-muted-foreground"
            />
          )}
        </span>
      ),
    }),
    col.accessor('branchName', {
      header: 'Branch',
      cell: (i) => <span className="text-sm text-muted-foreground">{i.getValue() ?? 'Company-wide'}</span>,
    }),
    col.accessor('amount', {
      header: 'Amount / Method',
      cell: (i) => (
        <span className="block">
          <Money
            value={i.getValue()}
            className={
              i.row.original.txnType === 'income'
                ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                : 'font-semibold text-red-600 dark:text-red-400'
            }
          />
          <span className="block text-xs text-muted-foreground">
            {FINANCE_PAYMENT_METHOD_LABELS[i.row.original.paymentMethod] ?? i.row.original.paymentMethod}
          </span>
        </span>
      ),
    }),
    // The badge, and under it what the accountant needs from it: Finance
    // Admin's remarks on a rejected entry, when a pending one was sent.
    col.accessor('status', {
      header: 'Status / Remarks',
      meta: { mobile: 'badge' },
      cell: (i) => {
        const row = i.row.original;
        return (
          <span className="block space-y-1">
            <StatusBadge status={i.getValue()} />
            {row.status === 'rejected' && row.rejectionReason && (
              <ExpandableText
                text={row.rejectionReason}
                lines={2}
                className="block whitespace-normal break-words text-xs text-red-700 dark:text-red-300 md:max-w-[11rem]"
              />
            )}
            {row.status === 'pending_approval' && row.submittedAt && (
              <span className="block text-xs text-muted-foreground">
                Sent {formatDate(row.submittedAt)}
              </span>
            )}
          </span>
        );
      },
    }),
    // View, then Approve / Reject on a pending entry for an approver. Edit,
    // Submit, Edit and Correct and Resubmit live behind View.
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
  ];

  return (
    <div className="space-y-6">
      <FinancePageHeader
        title="Income & Expense Entries"
        description="Manual documents. Nothing here reaches the ledger until it is approved."
        actions={
          abilities.create && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" />
              New entry
            </Button>
          )
        }
      />

      <ReadOnlyNotice abilities={abilities} />

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

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>New income or expense entry</DialogTitle>
          </DialogHeader>
          <FinanceEntryForm onSuccess={() => setCreating(false)} />
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
    </div>
  );
}
