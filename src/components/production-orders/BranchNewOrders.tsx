'use client';

import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { BranchProductionOrder } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import {
  useCancelProductionOrder,
  useProducts,
  useProductionOrders,
  useStock,
  useSubmitProductionOrder,
} from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable } from '@/components/shared/DataTable';
import { Eye, Plus, Trash2 } from 'lucide-react';
import { liveItems, livePackingItems } from '@/utils/demandLines';
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

// Production-order statuses are pending/awaiting_verification/approved/rejected
// today; the extra labels are supported so the pill still renders correctly if
// the lifecycle is extended later.
const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  awaiting_verification: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  verified: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
  preparing: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  ready: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  delivered: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  cancelled: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
};

const STATUS_LABELS: Record<string, string> = {
  awaiting_verification: 'Awaiting Verification',
  verified: 'Verified — Awaiting Approval',
  // Called "Deleted" on screen, not "Cancelled": this is the outcome of the
  // Delete button, and 'cancelled' is only what the API happens to call it.
  cancelled: 'Deleted',
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground'}`}>
      {STATUS_LABELS[status] ?? status}
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
  const [deleting, setDeleting] = useState<BranchProductionOrder | null>(null);
  const [deleteReason, setDeleteReason] = useState('');

  // Products/stock load lazily on first open; both are cached across reopens.
  const productsQ = useProducts(token, { isActive: true, enabled: openedOnce });
  const stockQ = useStock(token, { enabled: openedOnce });
  const ordersQ = useProductionOrders(token);
  const submitMut = useSubmitProductionOrder(token);
  const cancelMut = useCancelProductionOrder(token);

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

  function openDelete(order: BranchProductionOrder) {
    setDeleting(order);
    setDeleteReason('');
  }

  async function submitDelete() {
    if (!deleting) return;
    try {
      await cancelMut.mutateAsync({ id: deleting.id, reason: deleteReason.trim() });
      toast.success(`Demand ${deleting.demandNumber} deleted`);
      setDeleting(null);
      setDeleteReason('');
    } catch (err) {
      // Most likely a 409: Production reviewed it between the table rendering
      // and the button being pressed. The list has already been invalidated by
      // then, so the row repaints out of 'pending' on its own.
      toast.error(err instanceof Error ? err.message : 'Failed to delete the demand');
    }
  }

  // One row per demand submission (matching how Production sees the same list) —
  // items are shown via the View dialog, not flattened into extra rows. Once a
  // demand is approved its items are locked (Production owns quantity edits), so
  // there is nothing here for the branch to change, only to inspect.
  const columns = [
    col.accessor('date', { header: 'Date', cell: (i) => <span className="text-sm">{i.getValue()}</span> }),
    col.accessor('time', { header: 'Time', cell: (i) => <span className="text-sm tabular-nums text-muted-foreground">{i.getValue()}</span> }),
    // The date the branch ASKED for, next to the date it asked ON. Blank on
    // demands raised before the field existed — rendered '—' rather than falling
    // back to `date`, which would show a delivery commitment nobody made.
    col.accessor((o) => o.requiredDate ?? '', {
      id: 'requiredDate',
      header: 'Required Date',
      cell: (i) => {
        const v = i.getValue<string>();
        return v ? (
          <span className="text-sm font-medium tabular-nums">{v}</span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        );
      },
    }),
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
        // Counts only lines with a quantity behind them, so the number here
        // agrees with what the View dialog actually lists. A line Production
        // reviewed down to zero is not an item on this demand any more.
        const count = liveItems(o.items).length + livePackingItems(o.packingItems).length;
        return <span className="text-sm text-muted-foreground">{count} item{count === 1 ? '' : 's'}</span>;
      },
    }),
    col.accessor('status', { header: 'Status', meta: { mobile: 'badge' }, cell: (i) => <StatusPill status={i.getValue()} /> }),
    // The reason the demand was deleted, shown against the row it belongs to.
    // The column is always present rather than conditional on the page holding a
    // deleted demand — a column that appears and disappears as the last seven
    // days roll over reshuffles every other column's width with it.
    col.accessor((o) => o.cancelReason ?? '', {
      id: 'reason',
      header: 'Reason',
      meta: { mobileFull: true },
      cell: (i) =>
        i.getValue() ? (
          <span className="text-sm text-muted-foreground">{i.getValue()}</span>
        ) : (
          <span className="text-sm text-muted-foreground/50">—</span>
        ),
    }),
    col.display({
      id: 'actions',
      header: '',
      cell: (i) => {
        const o = i.row.original;
        return (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => openView(o)}>
              <Eye className="mr-1.5 h-4 w-4" /> View
            </Button>
            {/* Only while Production has not reviewed it. Past 'pending' the
                goods are out of the door — and past verification stock has
                already moved — so there is nothing left to take back. */}
            {o.status === 'pending' && (
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => openDelete(o)}
              >
                <Trash2 className="mr-1.5 h-4 w-4" /> Delete
              </Button>
            )}
          </div>
        );
      },
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

      {/* Demand detail — read-only, except an 'awaiting_verification' order,
          where the branch checks physical items and verifies. */}
      <BranchOrderDetail open={viewOpen} onOpenChange={setViewOpen} order={viewOrder} token={token} />

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

      {/* Delete a demand Production has not started on. The reason is mandatory
          — Production is planning against this demand from the moment it lands,
          so it leaves their summary with an explanation attached rather than
          silently. */}
      <Dialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Demand</DialogTitle>
          </DialogHeader>
          {deleting && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                <span className="font-mono font-medium text-foreground">{deleting.demandNumber}</span>
                {' · '}
                {deleting.date} {deleting.time}
                {' · '}
                {(() => {
                  const n = liveItems(deleting.items).length + livePackingItems(deleting.packingItems).length;
                  return `${n} item${n === 1 ? '' : 's'}`;
                })()}
              </p>
              <div className="space-y-1">
                <Label>Reason</Label>
                <Textarea
                  value={deleteReason}
                  onChange={(e) => setDeleteReason(e.target.value)}
                  placeholder="Production sees this on the demand."
                />
              </div>
              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setDeleting(null)}>
                  Keep Demand
                </Button>
                <Button
                  className="flex-1"
                  variant="destructive"
                  disabled={deleteReason.trim().length < 3 || cancelMut.isPending}
                  onClick={submitDelete}
                >
                  {cancelMut.isPending ? 'Deleting…' : 'Delete Demand'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Fab onClick={openModal} icon={Plus} label="New production order" />
    </div>
  );
}
