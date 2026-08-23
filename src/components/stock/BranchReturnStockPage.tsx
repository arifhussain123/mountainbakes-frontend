'use client';

import { useEffect, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import type { ProductionReturn } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import {
  useBranchReturns,
  useResubmitBranchReturn,
  useReviseBranchReturn,
  useWithdrawBranchReturn,
} from '@/lib/queries';
import { useStockRealtime } from '@/hooks/useStockRealtime';
import { DataTable } from '@/components/shared/DataTable';
import { GeofenceGate } from '@/components/geofence/GeofenceGate';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatDate, formatDateTime, formatTime } from '@/utils/date';
import { ApiError } from '@/utils/api';
import { cn } from '@/lib/utils';
import { Eye, Pencil, Send, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Branch → Return Stock: everything this branch has sent back to production.
 *
 * READS ITS OWN ENDPOINT, not Production's. `/api/production-returns` is the
 * Production board — every branch's returns, behind a `super_admin` +
 * `production_user` router that 403s a branch role — so this page is served by
 * `GET /api/stock/returns`, which scopes to the caller's branch off the JWT.
 *
 * WHEN THE ACTIONS ARE OFFERED — the approval rule this page exists to show.
 * A branch return is no longer auto-approved. Raising one takes the units off
 * the branch balance and files the record `pending`; the central pool is
 * credited only when Production approves it. That gap is the editable window:
 *
 *   pending / returned   Change, Delete and (sent-back only) Resubmit
 *   accepted / rejected  nothing — Production has decided and the row is final
 *
 * `isCorrectable` below mirrors the server's rule in `branch-returns.service.ts`
 * exactly, and adds nothing to it:
 *
 *   - the branch raised it (`source === 'branch'`) — a Production-recorded return
 *     is Production's record and is corrected on their screen;
 *   - Production has not decided yet (`pending`, or `returned` — handed back to
 *     be corrected, which is still open).
 *
 * Change is still not a draft edit even while open: the branch half of the
 * movement has already happened, so saving a new quantity moves the difference
 * on or off the shelf, and Delete puts every unit back.
 *
 * The client copy of that rule only decides which buttons render. The server
 * re-decides every request and answers a stale tab with a 409 naming the reason,
 * which is surfaced verbatim rather than replaced with a generic failure — the
 * message ("Production has approved this return…", "2026-08-21 has been
 * closed…") is the whole value of the refusal.
 */

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  accepted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  returned: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400',
};

/**
 * The badge wording, which is not just the status capitalised.
 *
 * `returned` would render as "Returned" on a page where every row is a return —
 * saying nothing, and reading as "done" when it means the opposite. The label
 * says who the row is waiting on instead, which is the only thing the operator
 * scanning this column needs from it. `pending` gets the same treatment for the
 * same reason: "Awaiting Production" is what "pending" means here.
 */
const STATUS_LABELS: Record<string, string> = {
  pending: 'Awaiting Production',
  accepted: 'Approved',
  rejected: 'Rejected',
  returned: 'Sent Back to Fix',
};

const statusLabel = (s: string) => STATUS_LABELS[s] ?? s;

/**
 * The short reference shown in the ID column.
 *
 * The id is a uuid, which is unreadable at a glance and far too wide for a table
 * that also has to fit on a phone. The first segment is enough to match a row
 * against the one open in the View dialog, which prints the id in full — it is a
 * label to read out, not a key to type.
 */
function shortRef(id: string): string {
  return id.split('-')[0]?.toUpperCase() ?? id.slice(0, 8).toUpperCase();
}

/** See the module comment — this is the client half of the server's rule. */
function isCorrectable(r: ProductionReturn): boolean {
  return r.source === 'branch' && (r.status === 'pending' || r.status === 'returned');
}

/** Why a row cannot be corrected, phrased for a tooltip. */
function lockReason(r: ProductionReturn): string {
  if (r.source !== 'branch') return 'Recorded by Production — change it on their Returns screen.';
  if (r.status === 'accepted') return 'Production has approved this return, so it can no longer be changed or deleted.';
  if (r.status === 'rejected') return 'Production rejected this return and the stock is back on your balance.';
  return 'This return can no longer be changed.';
}

const col = createColumnHelper<ProductionReturn>();

export function BranchReturnStockPage() {
  const { token } = useAuth();
  const returnsQ = useBranchReturns(token);
  const reviseMut = useReviseBranchReturn(token);
  const withdrawMut = useWithdrawBranchReturn(token);
  const resubmitMut = useResubmitBranchReturn(token);

  // A return moves stock, so the same notification stream that refreshes the
  // Stock page refreshes this list — `qk.branchReturns` sits under the ['stock']
  // prefix precisely so this one hook covers it.
  useStockRealtime();

  const [viewRow, setViewRow] = useState<ProductionReturn | null>(null);
  const [editRow, setEditRow] = useState<ProductionReturn | null>(null);
  const [deleteRow, setDeleteRow] = useState<ProductionReturn | null>(null);
  const [editQty, setEditQty] = useState('');
  const [editReason, setEditReason] = useState('');

  const rows = returnsQ.data ?? [];

  useEffect(() => {
    if (returnsQ.isError) toast.error('Could not load returns');
  }, [returnsQ.isError]);

  function openEdit(r: ProductionReturn) {
    setEditRow(r);
    setEditQty(String(r.qty));
    setEditReason(r.reason ?? '');
  }

  /** The API's own message is the useful one — see the module comment. */
  function fail(err: unknown, fallback: string) {
    toast.error(err instanceof ApiError || err instanceof Error ? err.message : fallback);
  }

  async function submitEdit() {
    if (!editRow) return;
    const qty = Number(editQty);
    try {
      await reviseMut.mutateAsync({ id: editRow.id, qty, reason: editReason.trim() });
      const moved = qty - editRow.qty;
      toast.success(
        moved > 0
          ? `Return updated — ${moved} more ${editRow.productName} sent back`
          : `Return updated — ${-moved} × ${editRow.productName} back in branch stock`,
      );
      setEditRow(null);
    } catch (err) {
      fail(err, 'Could not update the return');
    }
  }

  async function submitDelete() {
    if (!deleteRow) return;
    try {
      await withdrawMut.mutateAsync(deleteRow.id);
      toast.success(`Return withdrawn — ${deleteRow.qty} × ${deleteRow.productName} back in branch stock`);
      setDeleteRow(null);
    } catch (err) {
      fail(err, 'Could not withdraw the return');
    }
  }

  /**
   * Send a handed-back return to Production again as it stands.
   *
   * No confirmation dialog, unlike Change and Delete, and no GeofenceGate: those
   * two move units and are worth stopping someone over, while this moves none —
   * it only puts the row back on Production's queue. A misfire is undone by
   * changing or deleting the row, which are both still available.
   */
  async function resubmit(r: ProductionReturn) {
    try {
      await resubmitMut.mutateAsync(r.id);
      toast.success(`Sent back to production — ${r.qty} × ${r.productName} awaiting review`);
    } catch (err) {
      fail(err, 'Could not resubmit the return');
    }
  }

  const columns = [
    col.accessor('id', {
      header: 'ID',
      meta: { mobileLabel: 'Ref' },
      cell: (i) => <span className="font-mono text-xs text-muted-foreground">{shortRef(i.getValue())}</span>,
    }),
    // The accessor carries the ISO date AND the rendered one so the global filter
    // matches "21 Aug", "Aug 2026" and "2026-08-21" alike, and the ISO-first order
    // keeps the column sorting chronologically. Same trick as the Production board.
    col.accessor((r) => `${r.date} ${formatDate(r.date)}`, {
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
    // Null until Production decides — which now includes every branch return, so
    // this column is a dash for anything still open. It used to be stamped with
    // the branch user who raised the return, because the raise path reviewed
    // itself; it means what it says now.
    col.accessor((r) => r.reviewedAt ?? '', {
      id: 'reviewedAt',
      header: 'Reviewed',
      meta: { align: 'center', mobileLabel: 'Reviewed' },
      cell: ({ row }) => (
        <span className="whitespace-nowrap tabular-nums text-muted-foreground">
          {row.original.reviewedAt ? formatTime(row.original.reviewedAt) : '—'}
        </span>
      ),
    }),
    col.accessor('productName', {
      header: 'Product',
      meta: { mobile: 'title' },
      cell: (i) => <span className="font-medium">{i.getValue()}</span>,
    }),
    col.accessor('qty', {
      header: 'Qty',
      meta: { align: 'center' },
      cell: (i) => <span className="font-semibold tabular-nums">{i.getValue()}</span>,
    }),
    col.accessor('status', {
      header: 'Status',
      meta: { mobile: 'badge' },
      cell: (i) => (
        <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', STATUS_STYLES[i.getValue()] ?? 'bg-muted')}>
          {statusLabel(i.getValue())}
        </span>
      ),
    }),
    col.display({
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const r = row.original;
        const editable = isCorrectable(r);
        return (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setViewRow(r)}>
              <Eye className="mr-1.5 h-4 w-4" /> View
            </Button>
            {editable ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
                  <Pencil className="mr-1.5 h-4 w-4" /> Change
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setDeleteRow(r)}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" /> Delete
                </Button>
                {/* Only on a row Production handed back. On a `pending` one it
                    would resend a return that is already in their queue, which
                    the server refuses anyway — this is the button not being
                    there rather than the click failing. */}
                {r.status === 'returned' && (
                  <Button variant="ghost" size="sm" onClick={() => resubmit(r)} disabled={resubmitMut.isPending}>
                    <Send className="mr-1.5 h-4 w-4" /> Resubmit
                  </Button>
                )}
              </>
            ) : (
              // A disabled button would say "you may do this, later"; the row is
              // final, so it says why instead — and stays readable on a phone,
              // where there is no hover to reveal a tooltip.
              <span className="text-xs text-muted-foreground" title={lockReason(r)}>
                Final
              </span>
            )}
          </div>
        );
      },
    }),
  ];

  const parsedQty = Number(editQty);
  const qtyValid = Number.isInteger(parsedQty) && parsedQty > 0;
  const qtyChanged = !!editRow && parsedQty !== editRow.qty;
  const reasonChanged = !!editRow && editReason.trim() !== (editRow.reason ?? '');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Return Stock</h2>
          <p className="text-sm text-muted-foreground">
            Stock this branch has sent back to production · last 90 days ·
            {' '}change or delete a return until production reviews it
          </p>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        loading={returnsQ.isLoading}
        searchPlaceholder="Search returns…"
        empty={
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <Undo2 className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">Nothing returned yet</p>
            <p className="text-sm text-muted-foreground">
              Returns are raised from the Stock page with the Return Items button.
            </p>
          </div>
        }
      />

      {/* ── View ────────────────────────────────────────────────────────────
          Read-only, so deliberately NOT behind GeofenceGate — being out of area
          stops transactions, not looking things up. */}
      <Dialog open={!!viewRow} onOpenChange={(o) => !o && setViewRow(null)}>
        <DialogContent className="md:max-w-lg">
          <DialogHeader>
            <DialogTitle>Return Detail</DialogTitle>
          </DialogHeader>
          {viewRow && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
              <dt className="text-muted-foreground">Reference</dt>
              {/* The id in full here — the table shows only its first segment. */}
              <dd className="break-all text-right font-mono text-xs">{viewRow.id}</dd>

              <dt className="text-muted-foreground">Product</dt>
              <dd className="text-right font-medium">{viewRow.productName}</dd>

              <dt className="text-muted-foreground">Quantity</dt>
              <dd className="text-right font-semibold tabular-nums">{viewRow.qty}</dd>

              <dt className="text-muted-foreground">Status</dt>
              <dd className="text-right">
                <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', STATUS_STYLES[viewRow.status] ?? 'bg-muted')}>
                  {statusLabel(viewRow.status)}
                </span>
              </dd>

              <dt className="text-muted-foreground">Business day</dt>
              <dd className="text-right">{formatDate(viewRow.date)}</dd>

              <dt className="text-muted-foreground">Recorded</dt>
              <dd className="text-right">{formatDateTime(viewRow.createdAt)}</dd>

              {/* "Reviewed", not "Approved" — the same two columns now also carry a
                  rejection and a send-back, and labelling them Approved made a
                  refused return read as an approved one. */}
              <dt className="text-muted-foreground">Reviewed</dt>
              <dd className="text-right">{viewRow.reviewedAt ? formatDateTime(viewRow.reviewedAt) : '—'}</dd>

              <dt className="text-muted-foreground">Raised by</dt>
              <dd className="truncate text-right">{viewRow.createdByName || '—'}</dd>

              <dt className="text-muted-foreground">Reviewed by</dt>
              <dd className="truncate text-right">{viewRow.reviewedByName || '—'}</dd>

              <dt className="text-muted-foreground">Source</dt>
              <dd className="text-right">{viewRow.source === 'branch' ? 'Raised by this branch' : 'Recorded by Production'}</dd>

              <dt className="col-span-2 pt-1 text-muted-foreground">Reason</dt>
              <dd className="col-span-2 rounded-md bg-muted/40 p-2.5">{viewRow.reason || '—'}</dd>
            </dl>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewRow(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Change ──────────────────────────────────────────────────────────
          Behind GeofenceGate: this moves the same units POST /api/stock/return
          does, and that endpoint is geofence-guarded server-side, so the rule has
          to be the same here or the form fills in and then 403s on save. */}
      <Dialog open={!!editRow} onOpenChange={(o) => !o && !reviseMut.isPending && setEditRow(null)}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle>Change Return</DialogTitle>
            <DialogDescription>
              {editRow
                ? `${editRow.productName} · ${editRow.status === 'returned' ? 'sent back by production — saving resubmits it' : 'awaiting production review'}`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <GeofenceGate action="Stock updates">
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="return-qty">Quantity returned</Label>
                <Input
                  id="return-qty"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  value={editQty}
                  onChange={(e) => setEditQty(e.target.value)}
                />
                {/* Says which way the stock will move BEFORE it moves. Raising the
                    figure takes more off the shelf and can be refused if the
                    branch no longer holds it; lowering it brings units back and
                    can be refused if production has already used them. Either way
                    the operator should know which of the two they are asking for. */}
                {editRow && qtyValid && qtyChanged && (
                  <p className="text-xs text-muted-foreground">
                    {parsedQty > editRow.qty
                      ? `${parsedQty - editRow.qty} more will come off branch stock.`
                      : `${editRow.qty - parsedQty} will come back into branch stock.`}
                  </p>
                )}
                {!qtyValid && editQty !== '' && (
                  <p className="text-xs text-destructive">Enter a whole number of 1 or more.</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="return-reason">Reason</Label>
                <Textarea
                  id="return-reason"
                  rows={3}
                  maxLength={500}
                  value={editReason}
                  onChange={(e) => setEditReason(e.target.value)}
                  placeholder="Why was this returned?"
                />
              </div>

              <Separator />

              <DialogFooter>
                <Button variant="outline" onClick={() => setEditRow(null)} disabled={reviseMut.isPending}>
                  Cancel
                </Button>
                <Button
                  onClick={submitEdit}
                  disabled={reviseMut.isPending || !qtyValid || (!qtyChanged && !reasonChanged)}
                >
                  {reviseMut.isPending ? 'Saving…' : 'Save Change'}
                </Button>
              </DialogFooter>
            </div>
          </GeofenceGate>
        </DialogContent>
      </Dialog>

      {/* ── Delete ──────────────────────────────────────────────────────────── */}
      <Dialog open={!!deleteRow} onOpenChange={(o) => !o && !withdrawMut.isPending && setDeleteRow(null)}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle>Withdraw this return?</DialogTitle>
            <DialogDescription>
              {deleteRow
                ? `${deleteRow.qty} × ${deleteRow.productName} will come back into branch stock and production will no longer see this return. The record is removed; the stock movements stay in the ledger.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <GeofenceGate action="Stock updates">
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleteRow(null)} disabled={withdrawMut.isPending}>
                Cancel
              </Button>
              <Button variant="destructive" onClick={submitDelete} disabled={withdrawMut.isPending}>
                {withdrawMut.isPending ? 'Withdrawing…' : 'Withdraw Return'}
              </Button>
            </DialogFooter>
          </GeofenceGate>
        </DialogContent>
      </Dialog>
    </div>
  );
}
