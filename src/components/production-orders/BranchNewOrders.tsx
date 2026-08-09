'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { BranchProductionOrder } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useProducts, useProductionOrders, useStock, useSubmitProductionOrder } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/shared/DataTable';
import { Eye, Plus } from 'lucide-react';
import { createColumnHelper } from '@tanstack/react-table';
import { Fab } from '@/components/shared/Fab';
import { NewOrderModal } from './NewOrderModal';
import { BranchOrderDetail } from './BranchOrderDetail';

const col = createColumnHelper<BranchProductionOrder>();

/** Branch model has no `code` field — derive a short code from the branch name initials. */
function deriveBranchCode(name: string | null, branchId: string | null): string {
  if (name) {
    const initials = name.split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase();
    if (initials.length >= 2) return initials.slice(0, 4);
  }
  return (branchId ?? '').slice(0, 6).toUpperCase() || '—';
}

// Production-order statuses are pending/approved/rejected today; the extra labels are
// supported so the pill still renders correctly if the lifecycle is extended later.
const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  preparing: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  ready: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  delivered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground'}`}>
      {status}
    </span>
  );
}

/**
 * Self-contained "Production Orders" section: a "+ New Order" button that opens the
 * order-entry popup, with the branch's last-7-days order history below it. Server
 * state is served by TanStack Query (cached/deduped); the submit mutation refreshes
 * the history + stock caches on success.
 */
export function BranchNewOrders() {
  const { user, token } = useAuth();
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [openedOnce, setOpenedOnce] = useState(false);
  const [viewOrder, setViewOrder] = useState<BranchProductionOrder | null>(null);
  const [viewOpen, setViewOpen] = useState(false);

  // Products/stock load lazily on first open; both are cached across reopens.
  const productsQ = useProducts(token, { isActive: true, enabled: openedOnce });
  const stockQ = useStock(token, { enabled: openedOnce });
  const ordersQ = useProductionOrders(token);
  const submitMut = useSubmitProductionOrder(token);

  function openModal() {
    setOpenedOnce(true);
    setModalOpen(true);
    // Refresh current stock each open (products stay cached).
    qc.invalidateQueries({ queryKey: ['stock'] });
  }

  const historyRows = useMemo(() => ordersQ.data ?? [], [ordersQ.data]);

  function openView(order: BranchProductionOrder) {
    setViewOrder(order);
    setViewOpen(true);
  }

  // One row per demand submission (matching how Production sees the same list) —
  // items are shown via the View dialog, not flattened into extra rows. Once a
  // demand is approved its items are locked (Production owns quantity edits), so
  // there is nothing here for the branch to change, only to inspect.
  const columns = [
    col.accessor('date', { header: 'Date', cell: (i) => <span className="text-sm">{i.getValue()}</span> }),
    col.accessor('time', { header: 'Time', cell: (i) => <span className="text-sm tabular-nums text-muted-foreground">{i.getValue()}</span> }),
    col.accessor('demandNumber', {
      header: 'Demand #',
      meta: { mobile: 'title' },
      cell: (i) => <span className="font-mono font-medium">{i.getValue()}</span>,
    }),
    col.display({
      id: 'items',
      header: 'Items',
      cell: (i) => {
        const o = i.row.original;
        const count = o.items.length + (o.packingItems?.length ?? 0);
        return <span className="text-sm text-muted-foreground">{count} item{count === 1 ? '' : 's'}</span>;
      },
    }),
    col.accessor('status', { header: 'Status', meta: { mobile: 'badge' }, cell: (i) => <StatusPill status={i.getValue()} /> }),
    col.display({
      id: 'actions',
      header: '',
      cell: (i) => (
        <Button variant="ghost" size="sm" onClick={() => openView(i.row.original)}>
          <Eye className="mr-1.5 h-4 w-4" /> View
        </Button>
      ),
    }),
  ];

  const branchCode = deriveBranchCode(user?.branchName ?? null, user?.branchId ?? null);
  const userName = user?.displayName || user?.email || '—';

  return (
    <div className="space-y-4">
      {/* New Order button (top-left) + section heading */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Mobile gets this as the FAB at the bottom of this component. */}
        <Button size="lg" className="hidden md:inline-flex" onClick={openModal}>
          <Plus className="mr-1.5 h-4 w-4" /> New Order
        </Button>
        <div className="text-right">
          <h3 className="text-base font-semibold">Production Order History</h3>
          <p className="text-xs text-muted-foreground">Last 7 days</p>
        </div>
      </div>

      {/* Order history — one row per demand submission; open View for line items. */}
      <DataTable columns={columns} data={historyRows} loading={ordersQ.isLoading} searchPlaceholder="Search order history…" />

      {/* Read-only demand detail (products + packing materials) */}
      <BranchOrderDetail open={viewOpen} onOpenChange={setViewOpen} order={viewOrder} />

      {/* Order-entry popup */}
      <NewOrderModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        products={productsQ.data ?? []}
        stockById={stockQ.data ?? {}}
        stockLoaded={stockQ.isFetched}
        loadingProducts={productsQ.isLoading}
        branchId={user?.branchId ?? null}
        branchName={user?.branchName ?? ''}
        branchCode={branchCode}
        userName={userName}
        submit={(payload) => submitMut.mutateAsync(payload)}
        submitting={submitMut.isPending}
      />

      <Fab onClick={openModal} icon={Plus} label="New production order" />
    </div>
  );
}
