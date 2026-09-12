'use client';

import { useMemo } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useAuth } from '@/hooks/useAuth';
import { useBranches, usePackingMaterials, usePackingUsage } from '@/lib/queries';
import { DataTable } from '@/components/shared/DataTable';
import { Pagination } from '@/components/data-engine/Pagination';
import { ActiveFilters, FilterBar } from '@/components/data-engine';
import { useListQueryState } from '@/lib/data-engine/useListQueryState';
import { businessDateStr } from '@mb/shared';
import type { FilterConfig, PackingMaterialUsageRow } from '@mb/shared';

const col = createColumnHelper<PackingMaterialUsageRow>();

/** First day of the current month, as a plain YYYY-MM-DD business date. */
function monthStart(): string {
  const today = businessDateStr();
  return `${today.slice(0, 7)}-01`;
}

/**
 * Daily Packing Material Usage.
 *
 * Delivered is DERIVED server-side, not stored: approving a demand is what sends
 * it, so Delivered equals Approved on approved orders and 0 on pending/rejected
 * ones. That is why a pending demand shows a Requested figure with 0 in the other
 * two columns rather than looking like a shortfall.
 */
export function PackingUsageReport() {
  const { token, user } = useAuth();
  const isBranchManager = user?.role === 'branch_manager';

  const list = useListQueryState({
    syncUrl: true,
    filterKeys: ['businessDate', 'branchId', 'packingMaterialId'],
    defaults: { filters: [{ key: 'businessDate', op: 'gte', value: monthStart() }, { key: 'businessDate', op: 'lte', value: businessDateStr() }] },
  });

  // A branch manager is scoped server-side, so the branch filter is admin-only.
  const branchesQ = useBranches(token, { enabled: !isBranchManager });
  const materialsQ = usePackingMaterials(token, { includeInactive: true });

  const filters = useMemo<FilterConfig[]>(
    () => [
      { key: 'businessDate', label: 'Date', type: 'date-range', placement: 'bar' },
      ...(isBranchManager ? [] : [{ key: 'branchId', label: 'Branch', type: 'select' as const, placement: 'bar' as const, options: (branchesQ.data ?? []).map((b) => ({ value: b.id, label: b.name })) }]),
      { key: 'packingMaterialId', label: 'Packing Material', type: 'select', options: (materialsQ.data ?? []).map((m) => ({ value: m.id, label: m.materialName })) },
    ],
    [isBranchManager, branchesQ.data, materialsQ.data],
  );

  const usageQ = usePackingUsage(token, {
    from: list.getFilter('businessDate', 'gte')?.value as string | undefined,
    to: list.getFilter('businessDate', 'lte')?.value as string | undefined,
    branchId: (list.getFilter('branchId')?.value as string | undefined) ?? null,
    packingMaterialId: (list.getFilter('packingMaterialId')?.value as string | undefined) ?? null,
    page: list.state.page,
    pageSize: list.state.pageSize,
  });
  const rows = useMemo(() => usageQ.data?.usage ?? [], [usageQ.data]);
  // Summed server-side over the WHOLE filtered range, not just this page.
  const totals = usageQ.data?.totals ?? { requested: 0, approved: 0, delivered: 0 };
  const pagination = usageQ.data?.pagination;

  const columns = [
    col.accessor('date', { header: 'Date', cell: (i) => <span className="text-sm tabular-nums">{i.getValue()}</span> }),
    col.accessor('materialName', {
      header: 'Packing Material',
      meta: { mobile: 'title' },
      cell: (i) => <span className="font-medium">{i.getValue()}</span>,
    }),
    col.accessor('branchName', {
      header: 'Branch',
      meta: { mobile: 'subtitle' },
      cell: (i) => <span className="text-sm text-muted-foreground">{i.getValue()}</span>,
    }),
    col.accessor('requestedQty', {
      header: 'Requested Qty',
      cell: (i) => <span className="tabular-nums">{i.getValue().toLocaleString()}</span>,
    }),
    col.accessor('approvedQty', {
      header: 'Approved Qty',
      cell: (i) => <span className="font-semibold tabular-nums">{i.getValue().toLocaleString()}</span>,
    }),
    col.accessor('deliveredQty', {
      header: 'Delivered Qty',
      cell: (i) => <span className="tabular-nums">{i.getValue().toLocaleString()}</span>,
    }),
  ];

  return (
    <div className="space-y-4">
      <FilterBar list={list} filters={filters} searchable={false} />
      <ActiveFilters filters={list.activeFilters} configs={filters} onRemove={list.clearFilter} onClearAll={list.clearAll} />

      <DataTable
        columns={columns}
        data={rows}
        loading={usageQ.isLoading}
        // No client-side search: `rows` is one server page, so filtering it in
        // memory would hide matches sitting on other pages. The Branch/Material
        // filters above already narrow the same fields a free-text box would.
        toolbar={false}
        pager={false}
        manual={{ page: list.state.page, pageSize: list.state.pageSize, total: pagination?.total ?? 0, onPageChange: list.setPage, search: '', onSearchChange: () => {} }}
      />
      <Pagination
        page={list.state.page}
        pageSize={list.state.pageSize}
        total={pagination?.total ?? 0}
        onPageChange={list.setPage}
        onPageSizeChange={list.setPageSize}
        loading={usageQ.isLoading}
      />

      {/* Range totals */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">Total Requested</p>
          <p className="text-lg font-bold tabular-nums">{totals.requested.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">Total Approved</p>
          <p className="text-lg font-bold tabular-nums">{totals.approved.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border border-primary/30 bg-primary/10 p-3">
          <p className="text-xs text-primary">Total Delivered</p>
          <p className="text-lg font-bold tabular-nums text-primary">{totals.delivered.toLocaleString()}</p>
        </div>
      </div>
    </div>
  );
}
