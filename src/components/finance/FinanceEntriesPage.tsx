'use client';

import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import {
  EDITABLE_DOC_STATUSES,
  FINANCE_ACCOUNT_LABELS,
  FINANCE_PAYMENT_METHOD_LABELS,
  type FilterConfig,
  type FinanceTransaction,
} from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranches } from '@/lib/queries';
import { useFinanceEntries, useLedgerHeads } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable } from '@/components/shared/DataTable';
import { Pagination } from '@/components/data-engine/Pagination';
import { FilterBar, ActiveFilters } from '@/components/data-engine';
import { useListQueryState } from '@/lib/data-engine/useListQueryState';
import { AttachmentGallery } from '@/components/shared/AttachmentGallery';
import { FinancePageHeader, Money, ReadOnlyNotice, StatusBadge, useFinanceAbilities } from './finance-ui';
import { DocumentActions } from './finance-actions';
import { FinanceEntryForm } from './FinanceEntryForm';
import { Eye, Pencil, Plus } from 'lucide-react';

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
const BASE_PATH = '/api/finance/income/entries';

export function FinanceEntriesPage() {
  const { token } = useAuth();
  const abilities = useFinanceAbilities();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<FinanceTransaction | null>(null);
  const [viewing, setViewing] = useState<FinanceTransaction | null>(null);

  const list = useListQueryState({
    syncUrl: true,
    filterKeys: ['status', 'type', 'ledgerHeadId', 'branchId', 'businessDate'],
  });

  const branchesQ = useBranches(token ?? '');
  const headsQ = useLedgerHeads(true);

  const filters = useMemo<FilterConfig[]>(
    () => [
      {
        key: 'status', label: 'Status', type: 'select', placement: 'bar',
        options: [
          { value: 'pending', label: 'Pending Approval' },
          { value: 'draft', label: 'Draft' },
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
    from: list.getFilter('businessDate', 'gte')?.value as string | undefined,
    to: list.getFilter('businessDate', 'lte')?.value as string | undefined,
    search: list.state.search || undefined,
    limit: list.state.pageSize,
    offset: (list.state.page - 1) * list.state.pageSize,
  });

  const rows = data?.entries ?? [];
  const total = data?.total ?? 0;

  const columns = [
    col.accessor('txnNo', {
      header: 'Entry No',
      meta: { mobile: 'subtitle' },
      cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue()}</span>,
    }),
    col.accessor('businessDate', { header: 'Date', cell: (i) => <span className="text-sm">{i.getValue()}</span> }),
    col.accessor('ledgerHeadName', {
      header: 'Ledger Head',
      meta: { mobile: 'title' },
      cell: (i) => (
        <span className="font-medium">
          {i.getValue()}
          <span
            className={
              i.row.original.txnType === 'income'
                ? 'ml-2 text-xs font-normal text-emerald-600 dark:text-emerald-400'
                : 'ml-2 text-xs font-normal text-red-600 dark:text-red-400'
            }
          >
            {i.row.original.txnType}
          </span>
        </span>
      ),
    }),
    // Free text, so it is capped and clipped to one line. TableCell is
    // `whitespace-nowrap`: without a ceiling a long entry is laid out as one
    // unbroken line, table-auto takes the width it needs off the columns beside
    // it, and the outer wrapper is `overflow-hidden` — so the text reads as
    // though it has spilled across Amount / Method / Status. The whole value is
    // on hover and in the View dialog. Capped from `md:` up only — the phone
    // card is a <dd>, not a table cell, so there it wraps in full as before.
    col.accessor('description', {
      header: 'Description',
      meta: { mobileFull: true },
      cell: (i) => {
        const v = i.getValue();
        return v ? <span title={v} className="block break-words text-sm md:max-w-[18rem] md:truncate">{v}</span> : null;
      },
    }),
    col.accessor('branchName', {
      header: 'Branch',
      cell: (i) => <span className="text-sm text-muted-foreground">{i.getValue() ?? 'Company-wide'}</span>,
    }),
    // Capped and clipped for the same reason as Description above — this is the
    // column that actually broke the row, because a note is the longest free
    // text on the page.
    col.accessor('notes', {
      header: 'Notes',
      meta: { mobileFull: true },
      cell: (i) => {
        const v = i.getValue();
        return v ? <span title={v} className="block break-words text-sm text-muted-foreground md:max-w-[16rem] md:truncate">{v}</span> : null;
      },
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
    col.accessor('status', {
      header: 'Status',
      meta: { mobile: 'badge' },
      cell: (i) => <StatusBadge status={i.getValue()} />,
    }),
    col.display({
      id: 'actions',
      header: '',
      cell: (i) => {
        const row = i.row.original;
        return (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon-sm" aria-label="View" onClick={() => setViewing(row)}>
              <Eye className="h-3.5 w-3.5" />
            </Button>
            {EDITABLE_DOC_STATUSES.includes(row.status) && abilities.create && (
              <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => setEditing(row)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            <DocumentActions doc={row} basePath={BASE_PATH} abilities={abilities} label={row.txnNo} />
          </div>
        );
      },
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
        manual={{
          page: list.state.page,
          pageSize: list.state.pageSize,
          total,
          onPageChange: list.setPage,
          search: list.state.search,
          onSearchChange: list.setSearch,
        }}
      />
      <Pagination
        page={list.state.page}
        pageSize={list.state.pageSize}
        total={total}
        onPageChange={list.setPage}
        onPageSizeChange={list.setPageSize}
        loading={isLoading}
      />

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>New income or expense entry</DialogTitle>
          </DialogHeader>
          <FinanceEntryForm onSuccess={() => setCreating(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit {editing?.txnNo}</DialogTitle>
          </DialogHeader>
          {editing && <FinanceEntryForm entry={editing} onSuccess={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewing?.txnNo}</DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <StatusBadge status={viewing.status} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Date</p>
                  <p className="font-medium">{viewing.businessDate}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Type</p>
                  <p className="font-medium capitalize">{viewing.txnType}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Ledger Head</p>
                  <p className="font-medium">{viewing.ledgerHeadName}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Description</p>
                  <p className="font-medium">{viewing.description}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Amount</p>
                  <Money
                    value={viewing.amount}
                    className={
                      viewing.txnType === 'income'
                        ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                        : 'font-semibold text-red-600 dark:text-red-400'
                    }
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Payment Method</p>
                  <p className="font-medium">{FINANCE_PAYMENT_METHOD_LABELS[viewing.paymentMethod] ?? viewing.paymentMethod}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Account</p>
                  <p className="font-medium">{FINANCE_ACCOUNT_LABELS[viewing.account]}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Branch</p>
                  <p className="font-medium">{viewing.branchName ?? 'Company-wide'}</p>
                </div>
                {viewing.referenceNo && (
                  <div>
                    <p className="text-xs text-muted-foreground">Reference</p>
                    <p className="font-medium">{viewing.referenceNo}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground">Created By</p>
                  <p className="font-medium">{viewing.createdByName ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Approved By</p>
                  <p className="font-medium">{viewing.approvedByName ?? '—'}</p>
                </div>
                {viewing.status === 'rejected' && viewing.rejectionReason && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">Rejection Reason</p>
                    <p className="font-medium whitespace-pre-wrap break-words">{viewing.rejectionReason}</p>
                  </div>
                )}
                {viewing.notes?.trim() && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">Notes</p>
                    <p className="font-medium whitespace-pre-wrap break-words">{viewing.notes.trim()}</p>
                  </div>
                )}
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Photo</p>
                  <AttachmentGallery
                    attachments={viewing.attachments}
                    title={`${viewing.txnNo} receipt`}
                    emptyText="No photo — this entry predates the requirement."
                    className="mt-1"
                  />
                </div>
              </div>

              <Button variant="outline" className="w-full" onClick={() => setViewing(null)}>
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
