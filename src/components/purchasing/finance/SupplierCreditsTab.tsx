'use client';

import { useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { Gavel, HandCoins } from 'lucide-react';
import { DEFAULT_PAGE_SIZE, type PageSize, type SupplierCredit } from '@mb/shared';
import { useSupplierCredits } from '@/lib/supplierPayments';
import { DataTable } from '@/components/shared/DataTable';
import { Pagination } from '@/components/data-engine/Pagination';
import { EmptyState } from '@/components/shared/EmptyState';
import { ExpandableText } from '@/components/shared/ExpandableText';
import { Button } from '@/components/ui/button';
import { FilterBar, FilterField, type SelectOption } from '@/components/finance/finance-actions';
import { Money } from '@/components/finance/finance-ui';
import { formatDate, formatDateTime } from '@/utils/date';
import { CreditDecisionDialog } from './SupplierPaymentDialogs';
import { CREDIT_STATUS_OPTIONS, CreditStatusBadge, LabeledFilterSelect } from './supplierPaymentShared';

const col = createColumnHelper<SupplierCredit>();

/**
 * Supplier credit Production asked for when a bill is to be paid later.
 * Finance approves all or part of the request (it becomes an open liability
 * that supplier payments repay) or rejects it with a reason.
 */
export function SupplierCreditsTab({ canDecide, suppliers }: { canDecide: boolean; suppliers: SelectOption[] }) {
  const [status, setStatus] = useState<string>('pending_approval');
  const [supplierId, setSupplierId] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);
  const [deciding, setDeciding] = useState<SupplierCredit | null>(null);

  const { data, isLoading, isError, error, refetch } = useSupplierCredits({
    status: status || undefined,
    supplierId: supplierId || undefined,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  const rows = data?.credits ?? [];
  const total = data?.total ?? 0;

  const columns = [
    col.accessor('creditNo', {
      header: 'Credit',
      meta: { mobile: 'title' },
      cell: (i) => <span className="font-mono font-medium">{i.getValue()}</span>,
    }),
    col.accessor((c) => c.supplierName ?? '', {
      id: 'supplier',
      header: 'Supplier',
      meta: { mobile: 'subtitle' },
      cell: ({ row }) => <span className="font-medium">{row.original.supplierName ?? '—'}</span>,
    }),
    col.accessor((c) => c.demandNo ?? '', {
      id: 'demand',
      header: 'Demand',
      cell: ({ row }) => <span className="font-mono text-xs">{row.original.demandNo ?? '—'}</span>,
    }),
    col.accessor('requestedAmount', {
      header: 'Requested',
      meta: { align: 'right' },
      cell: (i) => <Money value={i.getValue()} />,
    }),
    col.accessor((c) => c.approvedAmount ?? 0, {
      id: 'approved',
      header: 'Approved',
      meta: { align: 'right' },
      cell: ({ row }) => (row.original.approvedAmount === null ? <span className="text-muted-foreground">—</span> : <Money value={row.original.approvedAmount} />),
    }),
    col.accessor('outstanding', {
      header: 'Outstanding',
      meta: { align: 'right' },
      cell: (i) => <Money value={i.getValue()} blankZero className="font-semibold" />,
    }),
    col.accessor((c) => c.terms ?? '', {
      id: 'terms',
      header: 'Terms / Due',
      meta: { mobileFull: true },
      cell: ({ row }) => (
        <div className="text-xs">
          {row.original.terms ? <ExpandableText text={row.original.terms} /> : <span className="text-muted-foreground">—</span>}
          {row.original.dueDate && <p className="text-muted-foreground">Due {formatDate(row.original.dueDate)}</p>}
        </div>
      ),
    }),
    col.accessor('requestedAt', {
      header: 'Requested',
      id: 'requestedAt',
      cell: ({ row }) => (
        <div className="text-xs">
          <p>{row.original.requestedByName ?? '—'}</p>
          <p className="whitespace-nowrap text-muted-foreground">{formatDateTime(row.original.requestedAt)}</p>
        </div>
      ),
    }),
    col.accessor((c) => c.decisionReason ?? '', {
      id: 'decision',
      header: 'Decision',
      meta: { mobileFull: true },
      cell: ({ row }) =>
        row.original.decidedAt ? (
          <div className="text-xs">
            <p>
              {row.original.decidedByName ?? '—'} · {formatDateTime(row.original.decidedAt)}
            </p>
            {row.original.decisionReason && <ExpandableText text={row.original.decisionReason} className="text-muted-foreground" />}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    }),
    col.accessor('status', {
      header: 'Status',
      meta: { mobile: 'badge' },
      cell: (i) => <CreditStatusBadge status={i.getValue()} />,
    }),
    col.display({
      id: 'actions',
      header: 'Action',
      cell: ({ row }) =>
        canDecide && row.original.status === 'pending_approval' ? (
          <Button variant="ghost" size="sm" onClick={() => setDeciding(row.original)}>
            <Gavel className="mr-1.5 h-4 w-4" /> Decide
          </Button>
        ) : null,
    }),
  ];

  return (
    <div className="space-y-4">
      <FilterBar>
        <FilterField label="Status">
          <LabeledFilterSelect value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={CREDIT_STATUS_OPTIONS} allLabel="All statuses" />
        </FilterField>
        <FilterField label="Supplier" className="min-w-[12rem] flex-1 space-y-1 sm:flex-none">
          <LabeledFilterSelect value={supplierId} onChange={(v) => { setSupplierId(v); setPage(1); }} options={suppliers} allLabel="All suppliers" />
        </FilterField>
      </FilterBar>

      {isError ? (
        <EmptyState
          title="Could not load supplier credit"
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
            manual={{ page, pageSize, total, search: '', onSearchChange: () => {}, onPageChange: setPage }}
            empty={
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <HandCoins className="h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">No supplier credit found.</p>
                <p className="text-sm text-muted-foreground">
                  {status === 'pending_approval' && !supplierId ? 'No credit request is waiting for a decision.' : 'Nothing matches these filters.'}
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

      <CreditDecisionDialog credit={deciding} onClose={() => setDeciding(null)} />
    </div>
  );
}
