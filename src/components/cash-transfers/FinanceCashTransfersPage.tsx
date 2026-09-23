'use client';

import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import {
  CASH_TRANSFER_METHODS,
  CASH_TRANSFER_STATUSES,
  type CashTransfer,
  type FilterConfig,
} from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranches } from '@/lib/queries';
import { useFinanceCashTransfers } from '@/lib/finance';
import { DataTable } from '@/components/shared/DataTable';
import { Pagination } from '@/components/data-engine/Pagination';
import { ActiveFilters, FilterBar } from '@/components/data-engine';
import { sortStateToTanstack, tanstackToSortState } from '@/lib/data-engine/sortConversion';
import { useListQueryState } from '@/lib/data-engine/useListQueryState';
import { ExpandableText } from '@/components/shared/ExpandableText';
import { AttachmentGallery } from '@/components/shared/AttachmentGallery';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { formatDate, formatDateTime } from '@/utils/date';
import { formatCurrency } from '@/utils/currency';
import { Banknote, Check, Eye, RotateCcw, X } from 'lucide-react';
import { FinancePageHeader, ReadOnlyNotice, useFinanceAbilities } from '@/components/finance/finance-ui';
import { CashTransferDetailsDialog } from './CashTransferDetailsDialog';
import { ApproveCashTransferDialog, RejectCashTransferDialog } from './CashTransferDecisionDialogs';
import {
  CashTransferStatusBadge,
  cashTransferStatusLabel,
  methodLabel,
  shortBranch,
} from './cashTransferShared';

/**
 * Finance → Cash Transfers: the queue of money branches say they handed over.
 *
 * READ THIS ALONGSIDE ProductionDiscountsPage — same board, same View-then-
 * decide flow. Where it differs is what a decision DOES: approving a transfer
 * posts an RV- receipt to the Daily Ledger in the same database transaction
 * that marks it approved, so the book and the record cannot disagree. The
 * confirmation copy says so.
 *
 * THE DECISION IS TAKEN FROM THE RECORD, with the photo at reading size. The
 * whole question is whether the slip says what the form says; a thumbnail in a
 * row is not something a figure can be read off. Approve / Reject are also
 * offered on a pending row for the operator who has already looked.
 *
 * Server-filtered and server-paginated: the query narrows to the chosen
 * branch, status, method and date range, and pages what is left. A pending
 * queue is fetched WHOLE (no date window) so an old handover is not missed.
 */

const col = createColumnHelper<CashTransfer>();

export function FinanceCashTransfersPage() {
  const { token } = useAuth();
  const abilities = useFinanceAbilities();
  const list = useListQueryState({
    syncUrl: true,
    filterKeys: ['status', 'branchId', 'paymentMethod', 'businessDate'],
    defaults: { filters: [{ key: 'status', op: 'eq', value: 'pending' }] },
  });
  const branchesQ = useBranches(token);

  const filters = useMemo<FilterConfig[]>(
    () => [
      {
        key: 'status', label: 'Status', type: 'select', placement: 'bar',
        options: CASH_TRANSFER_STATUSES.map((s) => ({ value: s, label: cashTransferStatusLabel(s) })),
      },
      { key: 'branchId', label: 'Branch', type: 'select', placement: 'bar' },
      {
        key: 'paymentMethod', label: 'Payment Method', type: 'select', placement: 'bar',
        options: CASH_TRANSFER_METHODS.map((m) => ({ value: m, label: methodLabel(m) })),
      },
      { key: 'businessDate', label: 'Date', type: 'date-range', placement: 'bar' },
    ],
    [],
  );
  const filterOptions = useMemo(
    () => ({ branchId: (branchesQ.data ?? []).map((b) => ({ value: b.id, label: shortBranch(b.name) })) }),
    [branchesQ.data],
  );

  const query = {
    status: (list.getFilter('status')?.value as string | undefined) || undefined,
    branchId: (list.getFilter('branchId')?.value as string | undefined) || undefined,
    paymentMethod: (list.getFilter('paymentMethod')?.value as string | undefined) || undefined,
    from: (list.getFilter('businessDate', 'gte')?.value as string | undefined) || undefined,
    to: (list.getFilter('businessDate', 'lte')?.value as string | undefined) || undefined,
    search: list.state.search.trim() || undefined,
    sortBy: list.state.sort?.key,
    sortDir: list.state.sort?.direction,
    limit: list.state.pageSize,
    offset: (list.state.page - 1) * list.state.pageSize,
  };
  const { data, isLoading, isError, error, refetch } = useFinanceCashTransfers(query);

  const [viewRow, setViewRow] = useState<CashTransfer | null>(null);
  const [approving, setApproving] = useState<CashTransfer | null>(null);
  const [rejecting, setRejecting] = useState<CashTransfer | null>(null);

  const rows = data?.transfers ?? [];
  const total = data?.total ?? 0;
  const canDecide = abilities.approve;

  const columns = [
    col.accessor('transferNo', {
      header: 'Transfer ID',
      meta: { mobile: 'title' },
      cell: (i) => <span className="font-mono font-medium">{i.getValue()}</span>,
    }),
    col.accessor((t) => `${t.date} ${formatDate(t.date)}`, {
      id: 'date',
      header: 'Date',
      cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.date)}</span>,
    }),
    col.accessor('branchName', {
      header: 'Branch',
      meta: { mobile: 'subtitle' },
      cell: (i) => <span className="font-medium">{shortBranch(i.getValue())}</span>,
    }),
    col.accessor('amount', {
      header: 'Amount',
      meta: { align: 'center' },
      cell: (i) => <span className="font-semibold tabular-nums">{formatCurrency(i.getValue())}</span>,
    }),
    col.accessor('paymentMethod', {
      header: 'Method',
      meta: { align: 'center' },
      cell: (i) => <span className="whitespace-nowrap">{methodLabel(i.getValue())}</span>,
    }),
    col.accessor((t) => t.note ?? '', {
      id: 'note',
      header: 'Note',
      enableSorting: false,
      meta: { mobileFull: true },
      cell: ({ row }) => row.original.note ? <ExpandableText text={row.original.note} className="text-muted-foreground" /> : <span className="text-muted-foreground">—</span>,
    }),
    col.display({
      id: 'photo',
      header: 'Photo',
      enableSorting: false,
      meta: { mobileLabel: 'Photo' },
      cell: ({ row }) => (
        <AttachmentGallery attachments={row.original.attachments} size="xs" title={`${row.original.transferNo} payment picture`} />
      ),
    }),
    col.accessor((t) => t.voucherNo ?? '', {
      id: 'voucherNo',
      header: 'Voucher',
      meta: { mobileLabel: 'Voucher' },
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.voucherNo ?? '—'}</span>,
    }),
    col.accessor('status', {
      header: 'Status',
      meta: { mobile: 'badge' },
      cell: (i) => <CashTransferStatusBadge status={i.getValue()} />,
    }),
    col.accessor('createdAt', {
      header: 'Submitted',
      meta: { mobileLabel: 'Submitted' },
      cell: (i) => <span className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(i.getValue())}</span>,
    }),
    col.display({
      id: 'actions',
      header: 'Action',
      enableSorting: false,
      cell: ({ row }) => {
        const t = row.original;
        return (
          <div className="flex flex-wrap items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setViewRow(t)}>
              <Eye className="mr-1.5 h-4 w-4" /> View
            </Button>
            {t.status === 'pending' && canDecide && (
              <>
                <Button variant="ghost" size="sm" className="text-emerald-700 hover:text-emerald-700" onClick={() => setApproving(t)}>
                  <Check className="mr-1.5 h-4 w-4" /> Approve
                </Button>
                <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-600" onClick={() => setRejecting(t)}>
                  <X className="mr-1.5 h-4 w-4" /> Reject
                </Button>
              </>
            )}
          </div>
        );
      },
    }),
  ];

  return (
    <div className="space-y-6">
      <FinancePageHeader
        title="Cash Transfer Details"
        description="Money branches handed to the company, with the photo of each slip. Approving posts an RV- receipt to the Daily Ledger."
        actions={
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            <RotateCcw className="h-3.5 w-3.5" />
            Refresh
          </Button>
        }
      />

      <ReadOnlyNotice abilities={abilities} />

      <FilterBar
        list={list}
        filters={filters}
        options={filterOptions}
        searchable
        searchPlaceholder="Transfer ID, voucher, branch or note…"
      />
      <ActiveFilters
        filters={list.activeFilters}
        configs={filters}
        options={filterOptions}
        search={list.state.search}
        onRemove={list.clearFilter}
        onClearSearch={() => list.setSearch('')}
        onClearAll={list.clearAll}
      />

      {isError ? (
        <EmptyState
          title="Could not load cash transfers"
          description={error instanceof Error ? error.message : 'Please try again.'}
          action={
            <Button variant="outline" onClick={() => void refetch()}>
              Retry
            </Button>
          }
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={rows}
            loading={isLoading}
            pager={false}
            sortable
            manual={{
              page: list.state.page,
              pageSize: list.state.pageSize,
              total,
              search: list.state.search,
              onSearchChange: list.setSearch,
              onPageChange: list.setPage,
              sorting: sortStateToTanstack(list.state.sort),
              onSortingChange: (next) => list.setSort(tanstackToSortState(next)),
            }}
            empty={
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <Banknote className="h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">No cash transfers found.</p>
                <p className="text-sm text-muted-foreground">Nothing matches these filters.</p>
              </div>
            }
          />
          <Pagination
            page={list.state.page}
            pageSize={list.state.pageSize}
            total={total}
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
            loading={isLoading}
          />
        </>
      )}

      <CashTransferDetailsDialog
        transfer={viewRow}
        open={!!viewRow}
        onClose={() => setViewRow(null)}
        footer={
          viewRow?.status === 'pending' && canDecide ? (
            <>
              <Button
                variant="outline"
                className="text-red-600 hover:text-red-600"
                onClick={() => { setRejecting(viewRow); setViewRow(null); }}
              >
                <X className="mr-1.5 h-4 w-4" /> Reject
              </Button>
              <Button onClick={() => { setApproving(viewRow); setViewRow(null); }}>
                <Check className="mr-1.5 h-4 w-4" /> Approve
              </Button>
            </>
          ) : null
        }
      />
      <ApproveCashTransferDialog transfer={approving} onClose={() => setApproving(null)} />
      <RejectCashTransferDialog transfer={rejecting} onClose={() => setRejecting(null)} />
    </div>
  );
}
