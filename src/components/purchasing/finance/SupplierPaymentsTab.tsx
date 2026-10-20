'use client';

import { useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { Check, Eye, ReceiptText, Undo2, X } from 'lucide-react';
import { DEFAULT_PAGE_SIZE, type PageSize, type SupplierPayment } from '@mb/shared';
import { useDebounce } from '@/hooks/useDebounce';
import { useSupplierPayments } from '@/lib/supplierPayments';
import { DataTable } from '@/components/shared/DataTable';
import { Pagination } from '@/components/data-engine/Pagination';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FilterBar, FilterField, type SelectOption } from '@/components/finance/finance-actions';
import { Money, StatusBadge } from '@/components/finance/finance-ui';
import { formatDate, formatDateTime } from '@/utils/date';
import { ApprovePaymentDialog, PaymentDetailsDialog, PaymentReasonDialog } from './SupplierPaymentDialogs';
import { LabeledFilterSelect, PAYMENT_STATUS_OPTIONS, paymentMethodLabel } from './supplierPaymentShared';

const col = createColumnHelper<SupplierPayment>();

/**
 * The payment queue. Opens on what is waiting (pending approval), filtered
 * and paged on the server. Approve / Reject on a pending row, Reverse on a
 * posted one — and only for a role that may approve: a view-only finance role
 * (Accountant, Auditor, a Super Admin without the write grant) sees the same
 * rows and the same View, no decision buttons.
 */
export function SupplierPaymentsTab({ canDecide, suppliers }: { canDecide: boolean; suppliers: SelectOption[] }) {
  const [status, setStatus] = useState<string>('pending_approval');
  const [supplierId, setSupplierId] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const debounced = useDebounce(search.trim(), 300);

  const { data, isLoading, isError, error, refetch } = useSupplierPayments({
    status: status || undefined,
    supplierId: supplierId || undefined,
    search: debounced || undefined,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  const [viewing, setViewing] = useState<SupplierPayment | null>(null);
  const [approving, setApproving] = useState<SupplierPayment | null>(null);
  const [rejecting, setRejecting] = useState<SupplierPayment | null>(null);
  const [reversing, setReversing] = useState<SupplierPayment | null>(null);

  const rows = data?.payments ?? [];
  const total = data?.total ?? 0;

  const columns = [
    col.accessor('paymentNo', {
      header: 'Payment',
      meta: { mobile: 'title' },
      cell: (i) => <span className="font-mono font-medium">{i.getValue()}</span>,
    }),
    col.accessor((p) => p.supplierName ?? '', {
      id: 'supplier',
      header: 'Supplier',
      meta: { mobile: 'subtitle' },
      cell: ({ row }) => <span className="font-medium">{row.original.supplierName ?? '—'}</span>,
    }),
    col.accessor((p) => p.demandNo ?? '', {
      id: 'demand',
      header: 'Demand / Bill',
      cell: ({ row }) => (
        <div className="text-xs">
          <p className="font-mono">{row.original.demandNo ?? '—'}</p>
          <p className="text-muted-foreground">Bill {row.original.supplierBillNo ?? '—'}</p>
        </div>
      ),
    }),
    col.accessor('method', {
      header: 'Method',
      cell: ({ row }) => (
        <div className="text-xs">
          <p>{paymentMethodLabel(row.original.method, row.original.account)}</p>
          {row.original.referenceNo && <p className="font-mono text-muted-foreground">{row.original.referenceNo}</p>}
        </div>
      ),
    }),
    col.accessor('amount', {
      header: 'Amount',
      meta: { align: 'right' },
      cell: (i) => <Money value={i.getValue()} className="font-semibold" />,
    }),
    col.accessor('paidOn', {
      header: 'Paid on',
      cell: (i) => <span className="whitespace-nowrap">{formatDate(i.getValue())}</span>,
    }),
    col.accessor((p) => p.recordedByName ?? '', {
      id: 'recorded',
      header: 'Recorded',
      cell: ({ row }) => (
        <div className="text-xs">
          <p>{row.original.recordedByName ?? '—'}</p>
          <p className="whitespace-nowrap text-muted-foreground">{formatDateTime(row.original.recordedAt)}</p>
        </div>
      ),
    }),
    col.accessor((p) => p.voucherNo ?? '', {
      id: 'voucher',
      header: 'Voucher',
      cell: ({ row }) => (
        <div className="font-mono text-xs">
          <p>{row.original.voucherNo ?? '—'}</p>
          {row.original.reversalVoucherNo && <p className="text-red-600 dark:text-red-400">↺ {row.original.reversalVoucherNo}</p>}
        </div>
      ),
    }),
    col.accessor('status', {
      header: 'Status',
      meta: { mobile: 'badge' },
      cell: (i) => <StatusBadge status={i.getValue()} />,
    }),
    col.display({
      id: 'actions',
      header: 'Action',
      cell: ({ row }) => {
        const p = row.original;
        return (
          <div className="flex flex-wrap items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setViewing(p)}>
              <Eye className="mr-1.5 h-4 w-4" /> View
            </Button>
            {canDecide && p.status === 'pending_approval' && (
              <>
                <Button variant="ghost" size="sm" className="text-emerald-700 hover:text-emerald-700" onClick={() => setApproving(p)}>
                  <Check className="mr-1.5 h-4 w-4" /> Approve
                </Button>
                <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-600" onClick={() => setRejecting(p)}>
                  <X className="mr-1.5 h-4 w-4" /> Reject
                </Button>
              </>
            )}
            {canDecide && p.status === 'posted' && (
              <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-600" onClick={() => setReversing(p)}>
                <Undo2 className="mr-1.5 h-4 w-4" /> Reverse
              </Button>
            )}
          </div>
        );
      },
    }),
  ];

  return (
    <div className="space-y-4">
      <FilterBar>
        <FilterField label="Status">
          <LabeledFilterSelect
            value={status}
            onChange={(v) => { setStatus(v); setPage(1); }}
            options={PAYMENT_STATUS_OPTIONS}
            allLabel="All statuses"
          />
        </FilterField>
        <FilterField label="Supplier" className="min-w-[12rem] flex-1 space-y-1 sm:flex-none">
          <LabeledFilterSelect
            value={supplierId}
            onChange={(v) => { setSupplierId(v); setPage(1); }}
            options={suppliers}
            allLabel="All suppliers"
          />
        </FilterField>
        <FilterField label="Search" className="min-w-[14rem] flex-1 space-y-1">
          <Input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Payment no., reference or voucher…"
            className="h-11 md:h-9"
          />
        </FilterField>
      </FilterBar>

      {isError ? (
        <EmptyState
          title="Could not load supplier payments"
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
            toolbar={false}
            pager={false}
            dense
            manual={{ page, pageSize, total, search: debounced, onSearchChange: setSearch, onPageChange: setPage }}
            empty={
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <ReceiptText className="h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">No supplier payments found.</p>
                <p className="text-sm text-muted-foreground">
                  {status === 'pending_approval' && !supplierId && !debounced ? 'Nothing is waiting for approval.' : 'Nothing matches these filters.'}
                </p>
              </div>
            }
          />
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
            loading={isLoading}
          />
        </>
      )}

      <PaymentDetailsDialog
        payment={viewing}
        onClose={() => setViewing(null)}
        footer={
          canDecide && viewing?.status === 'pending_approval' ? (
            <>
              <Button variant="outline" className="text-red-600 hover:text-red-600" onClick={() => { setRejecting(viewing); setViewing(null); }}>
                <X className="mr-1.5 h-4 w-4" /> Reject
              </Button>
              <Button onClick={() => { setApproving(viewing); setViewing(null); }}>
                <Check className="mr-1.5 h-4 w-4" /> Approve
              </Button>
            </>
          ) : canDecide && viewing?.status === 'posted' ? (
            <Button variant="outline" className="text-red-600 hover:text-red-600" onClick={() => { setReversing(viewing); setViewing(null); }}>
              <Undo2 className="mr-1.5 h-4 w-4" /> Reverse
            </Button>
          ) : null
        }
      />
      <ApprovePaymentDialog payment={approving} onClose={() => setApproving(null)} />
      <PaymentReasonDialog kind="reject" payment={rejecting} onClose={() => setRejecting(null)} />
      <PaymentReasonDialog kind="reverse" payment={reversing} onClose={() => setReversing(null)} />
    </div>
  );
}
