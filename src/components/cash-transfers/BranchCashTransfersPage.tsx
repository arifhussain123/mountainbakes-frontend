'use client';

import { useEffect, useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import {
  CASH_TRANSFER_METHODS,
  CASH_TRANSFER_STATUSES,
  type CashTransfer,
  type CashTransferMethod,
  type CashTransferSortKey,
  type CashTransferStatus,
  type FilterConfig,
} from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranchCashTransfers } from '@/lib/queries';
import { DataTable } from '@/components/shared/DataTable';
import { Pagination } from '@/components/data-engine/Pagination';
import { ActiveFilters, FilterBar } from '@/components/data-engine';
import { sortStateToTanstack, tanstackToSortState } from '@/lib/data-engine/sortConversion';
import { useListQueryState } from '@/lib/data-engine/useListQueryState';
import { ExpandableText } from '@/components/shared/ExpandableText';
import { AttachmentGallery } from '@/components/shared/AttachmentGallery';
import { Button } from '@/components/ui/button';
import { formatDate, formatTime } from '@/utils/date';
import { formatCurrency } from '@/utils/currency';
import { Banknote, Eye, MessageSquareWarning, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { CashDepositModal } from './CashDepositModal';
import { CashTransferDetailsDialog } from './CashTransferDetailsDialog';
import {
  BranchTransferQueriesPanel,
  RaiseTransferQueryDialog,
  TransferQueryDialog,
} from './TransferQueryDialogs';
import {
  CashTransferStatusBadge,
  cashTransferStatusLabel,
  lockReason,
  methodLabel,
} from './cashTransferShared';

/**
 * Branch → Cash Deposits: every handover this branch has recorded, and what
 * Finance decided about each.
 *
 * THE COUNTERPART OF Discounts, and built to read as the same page: one row per
 * transfer, a View that opens the full record with the photo, and the same
 * filter bar, table and pager. What is deliberately missing is Change and
 * Delete — a transfer is a claim that money moved, evidenced by one photo of
 * one handover, and the record is final from the moment it is submitted. A
 * wrong one is rejected by Finance (with a reason shown here) and raised again,
 * or — once it is in — the branch raises a Query on its Transfer ID and the
 * Admin corrects or deletes it from the Help Desk (TransferQueryDialogs.tsx).
 *
 * READS ITS OWN ENDPOINT. `GET /api/cash-transfers` scopes to the caller's
 * branch off the JWT; Finance's `/api/finance/cash-transfers` is a different
 * router that 403s a branch role. A branch can only ever see its own rows,
 * and the server decides that, not this page.
 */

const col = createColumnHelper<CashTransfer>();

export function BranchCashTransfersPage() {
  const { token } = useAuth();
  const list = useListQueryState({ syncUrl: true, filterKeys: ['status', 'paymentMethod', 'businessDate'] });
  const filters = useMemo<FilterConfig[]>(
    () => [
      {
        key: 'status', label: 'Status', type: 'select', placement: 'bar',
        options: CASH_TRANSFER_STATUSES.map((s) => ({ value: s, label: cashTransferStatusLabel(s) })),
      },
      {
        key: 'paymentMethod', label: 'Payment Method', type: 'select', placement: 'bar',
        options: CASH_TRANSFER_METHODS.map((m) => ({ value: m, label: methodLabel(m) })),
      },
      { key: 'businessDate', label: 'Date', type: 'date-range', placement: 'bar' },
    ],
    [],
  );
  const transfersQ = useBranchCashTransfers(token, {
    status: (list.getFilter('status')?.value as CashTransferStatus | undefined) ?? null,
    paymentMethod: (list.getFilter('paymentMethod')?.value as CashTransferMethod | undefined) ?? null,
    search: list.state.search || undefined,
    from: list.getFilter('businessDate', 'gte')?.value as string | undefined,
    to: list.getFilter('businessDate', 'lte')?.value as string | undefined,
    limit: list.state.pageSize,
    offset: (list.state.page - 1) * list.state.pageSize,
    sortBy: (list.state.sort?.key as CashTransferSortKey | undefined) ?? null,
    sortDir: list.state.sort?.direction,
  });

  const [viewRow, setViewRow] = useState<CashTransfer | null>(null);
  const [queryRow, setQueryRow] = useState<CashTransfer | null>(null);
  const [openQueryId, setOpenQueryId] = useState<string | null>(null);
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositOpenedOnce, setDepositOpenedOnce] = useState(false);

  const rows = transfersQ.data?.transfers ?? [];
  const total = transfersQ.data?.total ?? 0;

  useEffect(() => {
    if (transfersQ.isError) toast.error('Could not load cash transfers');
  }, [transfersQ.isError]);

  function openDeposit() {
    setDepositOpenedOnce(true);
    setDepositOpen(true);
  }

  const columns = [
    col.accessor('transferNo', {
      header: 'Transfer ID',
      meta: { mobile: 'title' },
      cell: (i) => <span className="font-mono font-medium">{i.getValue()}</span>,
    }),
    col.accessor((t) => `${t.date} ${formatDate(t.date)}`, {
      id: 'date',
      header: 'Date',
      meta: { mobile: 'subtitle' },
      cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.date)}</span>,
    }),
    col.accessor('createdAt', {
      header: 'Time',
      meta: { align: 'center' },
      cell: (i) => <span className="whitespace-nowrap tabular-nums text-muted-foreground">{formatTime(i.getValue())}</span>,
    }),
    col.accessor('amount', {
      header: 'Amount',
      meta: { align: 'center' },
      cell: (i) => <span className="font-semibold tabular-nums">{formatCurrency(i.getValue())}</span>,
    }),
    col.accessor('paymentMethod', {
      header: 'Payment Method',
      meta: { align: 'center', mobileLabel: 'Method' },
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
    col.display({
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setViewRow(row.original)}>
            <Eye className="mr-1.5 h-4 w-4" /> View
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setQueryRow(row.original)} title="Raise a query with Admin on this transfer">
            <MessageSquareWarning className="mr-1.5 h-4 w-4" /> Query
          </Button>
          <span className="text-xs text-muted-foreground" title={lockReason(row.original)}>
            {row.original.status === 'pending' ? 'Submitted' : 'Final'}
          </span>
        </div>
      ),
    }),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Cash Transfer Details</h2>
          <p className="text-sm text-muted-foreground">
            Cash, Easypaisa and bank money this branch handed to the company · last 90 days ·
            {' '}Finance approves each transfer and posts the receipt
          </p>
        </div>
        <Button onClick={openDeposit}>
          <Plus className="mr-1.5 h-4 w-4" /> Cash Deposit
        </Button>
      </div>

      <FilterBar list={list} filters={filters} searchable={false} />
      <ActiveFilters filters={list.activeFilters} configs={filters} onRemove={list.clearFilter} onClearAll={list.clearAll} />

      <DataTable
        columns={columns}
        data={rows}
        loading={transfersQ.isLoading}
        searchPlaceholder="Search transfer ID, voucher or note…"
        pager={false}
        sortable
        manual={{
          page: list.state.page,
          pageSize: list.state.pageSize,
          total,
          onPageChange: list.setPage,
          search: list.state.search,
          onSearchChange: list.setSearch,
          sorting: sortStateToTanstack(list.state.sort),
          onSortingChange: (next) => list.setSort(tanstackToSortState(next)),
        }}
        empty={
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Banknote className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">No cash transfers found.</p>
            <p className="text-sm text-muted-foreground">
              Record one with the Cash Deposit button here or on the New Orders page.
            </p>
          </div>
        }
      />

      <Pagination
        page={list.state.page}
        pageSize={list.state.pageSize}
        total={total}
        onPageChange={list.setPage}
        onPageSizeChange={list.setPageSize}
        loading={transfersQ.isLoading}
      />

      <BranchTransferQueriesPanel onOpen={setOpenQueryId} />

      <CashTransferDetailsDialog transfer={viewRow} open={!!viewRow} onClose={() => setViewRow(null)} />

      <RaiseTransferQueryDialog
        transfer={queryRow}
        open={!!queryRow}
        onClose={() => setQueryRow(null)}
        onRaised={(t) => setOpenQueryId(t.id)}
      />
      <TransferQueryDialog ticketId={openQueryId} open={!!openQueryId} onClose={() => setOpenQueryId(null)} />

      <CashDepositModal open={depositOpen} onOpenChange={setDepositOpen} openedOnce={depositOpenedOnce} />
    </div>
  );
}
