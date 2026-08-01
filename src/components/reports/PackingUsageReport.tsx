'use client';

import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useAuth } from '@/hooks/useAuth';
import { useBranches, usePackingMaterials, usePackingUsage } from '@/lib/queries';
import { DataTable } from '@/components/shared/DataTable';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { businessDateStr } from '@mb/shared';
import type { PackingMaterialUsageRow } from '@mb/shared';

const col = createColumnHelper<PackingMaterialUsageRow>();

/** Sentinel for "no filter" — a Select item cannot carry an empty string value. */
const ALL = '__all__';

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

  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(businessDateStr());
  const [branchId, setBranchId] = useState(ALL);
  const [materialId, setMaterialId] = useState(ALL);

  // A branch manager is scoped server-side, so the branch filter is admin-only.
  const branchesQ = useBranches(token, { enabled: !isBranchManager });
  const materialsQ = usePackingMaterials(token, { includeInactive: true });

  const usageQ = usePackingUsage(token, {
    from,
    to,
    branchId: branchId === ALL ? null : branchId,
    packingMaterialId: materialId === ALL ? null : materialId,
  });
  const rows = useMemo(() => usageQ.data ?? [], [usageQ.data]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (a, r) => ({
          requested: a.requested + r.requestedQty,
          approved: a.approved + r.approvedQty,
          delivered: a.delivered + r.deliveredQty,
        }),
        { requested: 0, approved: 0, delivered: 0 },
      ),
    [rows],
  );

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

  function resetFilters() {
    setFrom(monthStart());
    setTo(businessDateStr());
    setBranchId(ALL);
    setMaterialId(ALL);
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      {/* A grid below `sm` so each control gets a real width to fill — inside a
          shrink-to-fit flex item, `w-full` resolves against the item's own
          content width and the date inputs come out too narrow. */}
      <div className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap">
        <div className="space-y-1">
          <label htmlFor="pu-from" className="text-xs font-medium text-muted-foreground">From</label>
          <Input id="pu-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="h-9 w-full sm:w-40" />
        </div>
        <div className="space-y-1">
          <label htmlFor="pu-to" className="text-xs font-medium text-muted-foreground">To</label>
          <Input id="pu-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className="h-9 w-full sm:w-40" />
        </div>

        {!isBranchManager && (
          <div className="col-span-2 space-y-1 sm:col-auto">
            <label className="text-xs font-medium text-muted-foreground">Branch</label>
            <Select value={branchId} onValueChange={(v) => v && setBranchId(v)}>
              <SelectTrigger className="h-9 w-full sm:w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All branches</SelectItem>
                {(branchesQ.data ?? []).map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="col-span-2 space-y-1 sm:col-auto">
          <label className="text-xs font-medium text-muted-foreground">Packing Material</label>
          <Select value={materialId} onValueChange={(v) => v && setMaterialId(v)}>
            <SelectTrigger className="h-9 w-full sm:w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All materials</SelectItem>
              {(materialsQ.data ?? []).map((m) => (
                <SelectItem key={m.id} value={m.id}>{m.materialName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button variant="outline" className="col-span-2 h-9 sm:col-auto" onClick={resetFilters}>Reset</Button>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        loading={usageQ.isLoading}
        searchPlaceholder="Search packing materials…"
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
