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
  useStockRows,
  useSubmitProductionOrder,
} from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable } from '@/components/shared/DataTable';
import { ExpandableText } from '@/components/shared/ExpandableText';
import { Eye, Package, Plus, Trash2 } from 'lucide-react';
import {
  fulfilledTotals,
  isVerified,
  liveItems,
  livePackingItems,
  requestedTotals,
} from '@/utils/demandLines';
import { createColumnHelper, type Table as TanstackTable } from '@tanstack/react-table';
import { cn } from '@/lib/utils';
import { Fab } from '@/components/shared/Fab';
import { NewOrderModal } from './NewOrderModal';
import { BranchOrderDetail } from './BranchOrderDetail';
import { DiscountModal } from './DiscountModal';
import { ReturnItemsModal } from '@/components/stock/ReturnItemsModal';

const col = createColumnHelper<BranchProductionOrder>();

/**
 * Sum a per-demand figure for the totals row.
 *
 * Over `getFilteredRowModel()`, not `getRowModel()`: the latter is ONE page, so
 * on a history that spans pages the total would change as you paged through and
 * read like a bug. Filtered means the total follows the search box, which is
 * what someone typing in it is asking about.
 */
function sumRows(
  table: TanstackTable<BranchProductionOrder>,
  pick: (o: BranchProductionOrder) => number,
): number {
  return table.getFilteredRowModel().rows.reduce((sum, r) => sum + pick(r.original), 0);
}

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
  /** The demand whose total is on screen. Null when the box is closed. */
  const [demandFor, setDemandFor] = useState<BranchProductionOrder | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountOpenedOnce, setDiscountOpenedOnce] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  /**
   * Whether the Return Items popup has ever been opened.
   *
   * Separate from `openedOnce`, which gates the New Order popup's data, because
   * the two popups want different things: the order form needs the product
   * catalogue, and the return form needs the stock ROWS (code, name, balance) it
   * validates a return against. Keeping the flags apart means opening one does
   * not fetch for the other, on a page most branches open to read the table and
   * nothing else.
   */
  const [returnOpenedOnce, setReturnOpenedOnce] = useState(false);

  // Products/stock load lazily on first open; both are cached across reopens.
  const productsQ = useProducts(token, { isActive: true, enabled: openedOnce });
  const stockQ = useStock(token, { enabled: openedOnce });
  const ordersQ = useProductionOrders(token);
  // TODAY's rows, deliberately undated: a return moves live stock, so validating
  // one against a past day's balances is the mistake the Stock page's own date
  // picker had to be guarded from. There is no date to pick here at all.
  const stockRowsQ = useStockRows(token, { enabled: returnOpenedOnce });
  const submitMut = useSubmitProductionOrder(token);
  const cancelMut = useCancelProductionOrder(token);

  function openModal() {
    setOpenedOnce(true);
    setModalOpen(true);
    // Refresh current stock each open (products stay cached).
    qc.invalidateQueries({ queryKey: ['stock'] });
  }

  function openDiscount() {
    setDiscountOpenedOnce(true);
    setDiscountOpen(true);
  }

  function openReturn() {
    setReturnOpenedOnce(true);
    setReturnOpen(true);
    // Same refresh-on-open as the order popup, and it matters more here: the
    // modal refuses a return larger than the balance, so a stale figure is the
    // difference between a clear error and a rejected save.
    qc.invalidateQueries({ queryKey: ['stock'] });
  }

  /**
   * The queue is split in two (§20).
   *
   * ACTIVE is what the branch still has to do something about: a demand it has
   * submitted and Production has not reviewed, or one Production has sent that
   * nobody has counted in yet. HISTORY is everything settled — verified, approved,
   * rejected, deleted.
   *
   * They were one list, and that was the bug: a demand verified last Tuesday sat
   * in the same table as this morning's delivery with nothing but a status pill
   * between them, so the branch re-read completed records as though they were
   * waiting on something. Splitting them means the active tab is a worklist that
   * empties, which is the only way "nothing to verify" is ever visible.
   *
   * Nothing is hidden or deleted — History holds every record it always did, and
   * the tab carries a count so it never looks empty.
   */
  const { activeRows, historyRows } = useMemo(() => {
    const all = ordersQ.data ?? [];
    const isActive = (o: BranchProductionOrder) =>
      o.status === 'pending' || o.status === 'awaiting_verification';
    return {
      activeRows: all.filter(isActive),
      historyRows: all.filter((o) => !isActive(o)),
    };
  }, [ordersQ.data]);

  /**
   * Which tab is showing. Starts on Active and STAYS wherever the branch put it —
   * deliberately not derived from `activeRows.length`, because a list that
   * empties while someone is reading it would yank them to another tab
   * mid-sentence. The badge is how an emptied queue announces itself.
   */
  const [tab, setTab] = useState<'active' | 'history'>('active');
  const rows = tab === 'active' ? activeRows : historyRows;

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
    col.accessor('date', {
      header: 'Date',
      cell: (i) => <span className="text-sm">{i.getValue()}</span>,
      // Labels the totals row, at the far left where a total is looked for.
      footer: () => <span className="text-xs font-semibold uppercase tracking-wide">Total</span>,
    }),
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
    // ── How much this demand is, twice ──────────────────────────────────────
    //
    // Asked vs counted, side by side. The first pair is the demand as RAISED and
    // never moves again; the second is what is on the way, and becomes the figure
    // counted at the door the moment the branch verifies (verification overwrites
    // the approved quantity with the count — see `fulfilledTotals`). Reading them
    // against each other is the whole point: the gap is what was cut, short-
    // delivered or found extra in the crate.
    //
    // Footers sum the FILTERED rows, not the page — a total that changed as you
    // paged through would read like a bug, and one that ignores the search box
    // would not answer what someone typing in it is asking.
    col.display({
      id: 'demandProducts',
      header: 'Products',
      meta: { align: 'center' },
      cell: (i) => <span className="tabular-nums">{requestedTotals(i.row.original).products}</span>,
      footer: (p) => (
        <span className="tabular-nums font-semibold">
          {sumRows(p.table, (o) => requestedTotals(o).products).toLocaleString()}
        </span>
      ),
    }),
    col.display({
      id: 'demandQty',
      header: 'Demand Qty',
      meta: { align: 'center' },
      cell: (i) => (
        <span className="font-medium tabular-nums">{requestedTotals(i.row.original).qty.toLocaleString()}</span>
      ),
      footer: (p) => (
        <span className="tabular-nums font-semibold">
          {sumRows(p.table, (o) => requestedTotals(o).qty).toLocaleString()}
        </span>
      ),
    }),
    // Both verified columns read '—' until the demand is counted in. A 0 there
    // would say "nothing arrived", which is a different statement from "nobody
    // has counted this yet" — and on a pending demand it is the wrong one.
    col.display({
      id: 'verifiedProducts',
      header: 'Verified Products',
      meta: { align: 'center' },
      cell: (i) => {
        const o = i.row.original;
        if (!isVerified(o)) return <span className="tabular-nums text-muted-foreground">—</span>;
        return <span className="tabular-nums">{fulfilledTotals(o).products}</span>;
      },
      footer: (p) => (
        <span className="tabular-nums font-semibold">
          {sumRows(p.table, (o) => (isVerified(o) ? fulfilledTotals(o).products : 0)).toLocaleString()}
        </span>
      ),
    }),
    col.display({
      id: 'verifiedQty',
      header: 'Verified Qty',
      meta: { align: 'center' },
      cell: (i) => {
        const o = i.row.original;
        if (!isVerified(o)) return <span className="tabular-nums text-muted-foreground">—</span>;
        const { qty } = fulfilledTotals(o);
        const asked = requestedTotals(o).qty;
        return (
          <span
            className={cn(
              'font-semibold tabular-nums',
              qty < asked && 'text-amber-600 dark:text-amber-400',
              qty > asked && 'text-emerald-600 dark:text-emerald-400',
            )}
          >
            {qty.toLocaleString()}
          </span>
        );
      },
      footer: (p) => (
        <span className="tabular-nums font-semibold">
          {sumRows(p.table, (o) => (isVerified(o) ? fulfilledTotals(o).qty : 0)).toLocaleString()}
        </span>
      ),
    }),
    // Packing materials are counted apart from products and always have been —
    // they are not stock and never reach a branch's stock ledger, so folding them
    // into a product total would state a quantity of nothing in particular.
    col.display({
      id: 'packing',
      header: 'Packing',
      meta: { align: 'center' },
      cell: (i) => {
        const n = livePackingItems(i.row.original.packingItems).length;
        return n ? (
          <span className="tabular-nums">{n}</span>
        ) : (
          <span className="tabular-nums text-muted-foreground">—</span>
        );
      },
      footer: (p) => (
        <span className="tabular-nums font-semibold">
          {sumRows(p.table, (o) => livePackingItems(o.packingItems).length).toLocaleString()}
        </span>
      ),
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
      cell: (i) => <ExpandableText text={i.getValue()} className="text-sm text-muted-foreground" />,
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
            {/* One number, deliberately. View opens the whole demand — every
                line, every quantity, the photos — which is more than someone
                glancing down the list wants when the question is just "how much
                is this one". */}
            <Button variant="ghost" size="sm" onClick={() => setDemandFor(o)}>
              <Package className="mr-1.5 h-4 w-4" /> Demand
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
      {/* New Order button (top-left) + section heading.

          RETURN ITEMS AND DISCOUNT ARE NOT HERE — they are in the New Order
          form's own header, reached by opening it. The branch is already inside
          that screen when it remembers there is stock to send back or money to
          claim, and both popups layer over it without disturbing a half-entered
          order. The two dialogs are still mounted HERE, at the bottom of this
          component: the page owns the stock rows the return form validates
          against, and being siblings of the order form rather than children of
          it is what lets them open over it. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Mobile gets this as the FAB at the bottom of this component. */}
        <Button size="lg" className="hidden md:inline-flex" onClick={openModal}>
          <Plus className="mr-1.5 h-4 w-4" /> New Order
        </Button>
        <div className="text-right">
          <h3 className="text-base font-semibold">Production Orders</h3>
          <p className="text-xs text-muted-foreground">Last 7 days</p>
        </div>
      </div>

      {/* Active vs History (§20). A completed demand is still one click away, it
          just stops competing for attention with the ones that need acting on. */}
      <div className="inline-flex rounded-lg border bg-muted/40 p-0.5">
        {([
          { key: 'active' as const, label: 'Needs action', count: activeRows.length },
          { key: 'history' as const, label: 'History', count: historyRows.length },
        ]).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              tab === t.key ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            <span
              className={cn(
                'ml-1.5 rounded-full px-1.5 py-0.5 text-xs tabular-nums',
                // Amber only on the ACTIVE tab, and only when it has something in
                // it: a count is a nudge, and a grey 0 is the message that there
                // is nothing to do.
                t.key === 'active' && t.count > 0
                  ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400'
                  : 'bg-muted text-muted-foreground',
              )}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* One row per demand submission; open View for line items. */}
      <DataTable
        columns={columns}
        data={rows}
        loading={ordersQ.isLoading}
        searchPlaceholder={tab === 'active' ? 'Search active demands…' : 'Search order history…'}
        empty={
          rows.length === 0 && !ordersQ.isLoading ? (
            <div className="py-12 text-center">
              <p className="text-sm font-medium">
                {tab === 'active' ? 'Nothing waiting on you' : 'No completed demands in the last 7 days'}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {tab === 'active'
                  ? 'Demands appear here while Production is reviewing them, and again when a delivery is ready to verify.'
                  : 'Verified, approved, rejected and deleted demands collect here.'}
              </p>
            </div>
          ) : undefined
        }
      />

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
        onOpenReturn={openReturn}
        onOpenDiscount={openDiscount}
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

      {/* Total-only demand box. Shows the quantity actually in play: the
          branch's ask until the delivery is counted in, and the counted figure
          after that — verification overwrites the approved quantity, so one
          number stays correct at every stage without needing a second. */}
      <Dialog open={!!demandFor} onOpenChange={(o) => !o && setDemandFor(null)}>
        <DialogContent className="md:max-w-xs">
          <DialogHeader>
            <DialogTitle className="font-mono text-base">{demandFor?.demandNumber}</DialogTitle>
          </DialogHeader>
          {demandFor && (
            <div className="py-2 text-center">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {isVerified(demandFor) ? 'Total verified' : 'Total demand'}
              </p>
              <p className="mt-1 text-4xl font-bold tabular-nums">
                {fulfilledTotals(demandFor).qty.toLocaleString()}
              </p>
            </div>
          )}
          <Button variant="outline" onClick={() => setDemandFor(null)}>Close</Button>
        </DialogContent>
      </Dialog>

      {/* Return Items — off the Stock page, opened from the New Order form's
          header. Loads today's stock rows on first open and validates every line
          against the balance. Mounted here rather than inside that form so the
          rows are fetched once by the page and so it can layer over it. */}
      <ReturnItemsModal
        open={returnOpen}
        onOpenChange={setReturnOpen}
        rows={stockRowsQ.data ?? []}
        branchName={user?.branchName ?? ''}
        // The modal saved a return, which moved branch stock — refetch the rows
        // it validates against so a second return in the same visit is checked
        // against the balance the first one left behind.
        onSaved={() => stockRowsQ.refetch()}
      />

      {/* Raise a discount claim, and manage the ones already raised. Fed the
          same order list the table above is showing, so the picker offers exactly
          what the branch can see. Branch → Discounts carries the same claims in
          full; the rules the two share live in `discountShared.tsx` so they
          cannot drift. */}
      <DiscountModal
        open={discountOpen}
        onOpenChange={setDiscountOpen}
        openedOnce={discountOpenedOnce}
        orders={ordersQ.data ?? []}
        loadingOrders={ordersQ.isLoading}
      />

      <Fab onClick={openModal} icon={Plus} label="New production order" />
    </div>
  );
}
