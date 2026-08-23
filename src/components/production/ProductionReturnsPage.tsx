'use client';

import { useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import type { ProductionReturn, ProductionReturnStatus } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useProductionReturns, useReviewReturn } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { DataTable } from '@/components/shared/DataTable';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatDate } from '@/utils/date';
import { ApiError } from '@/utils/api';
import { cn } from '@/lib/utils';
import { Check, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Production → Product Returns: the queue of stock branches have sent back.
 *
 * IT IS A QUEUE NOW, not a log. Branch-raised returns used to arrive already
 * `accepted` — `POST /api/stock/return` approved them on the branch's behalf and
 * credited the production pool before this screen ever saw them, so every row
 * here was a decision already taken and the Accept/Reject buttons only ever
 * appeared on the handful Production had recorded themselves. That auto-approval
 * is gone: a branch return now arrives `pending` and waits here.
 *
 * WHAT EACH ACTION MOVES, and why it depends on where the return came from. The
 * branch half of a branch-raised return has already happened — the units came
 * off the shop's balance as it was raised, because the goods physically left the
 * shop — while a Production-recorded return has moved nothing at all:
 *
 *                     from a branch                    recorded here
 *   Approve           into the production pool          pool ↑ and branch ↓
 *   Reject            back onto the branch's balance    nothing to undo
 *   Send Back         nothing — the branch corrects it  not offered
 *
 * Send Back is the one that is not a decision. It hands the paperwork to the
 * branch to fix, leaves the stock exactly where it is, and the branch's Return
 * Stock page lets them correct the quantity and resubmit — at which point the
 * row comes back here as `pending`. It is offered on branch-raised rows only,
 * there being no branch record to hand back otherwise; the server refuses it on
 * the rest with a 400 rather than trusting this to be the only guard.
 *
 * Every action is confirmed. They are three small buttons side by side in a
 * dense table, each irreversible from this screen, and two of them move stock in
 * a shop that is not looking.
 */

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  accepted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  returned: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400',
};

/**
 * Badge wording. `returned` must not render as "Returned" on a board where every
 * row is a return — it would read as "done" when it means the branch still has
 * to act. The labels say who the row is waiting on, which mirrors the branch's
 * own Return Stock page so the two screens describe one row the same way.
 */
const STATUS_LABELS: Record<string, string> = {
  pending: 'Awaiting Review',
  accepted: 'Approved',
  rejected: 'Rejected',
  returned: 'Sent Back to Branch',
};

const short = (name: string) => name.replace('Mountain Bakes ', '');

/** The confirmation copy for each action — what it does, in stock terms. */
function confirmCopy(r: ProductionReturn, status: ProductionReturnStatus): { title: string; body: string } {
  const units = `${r.qty} × ${r.productName}`;
  const fromBranch = r.source === 'branch';
  if (status === 'accepted') {
    return {
      title: 'Approve this return?',
      body: fromBranch
        ? `${units} goes into production stock. ${short(r.branchName)} has already had it taken off their balance, so nothing changes at the branch. The return becomes final.`
        : `${units} goes into production stock and comes off ${short(r.branchName)}'s balance. The return becomes final.`,
    };
  }
  if (status === 'rejected') {
    return {
      title: 'Reject this return?',
      body: fromBranch
        ? `${units} goes back onto ${short(r.branchName)}'s balance and nothing enters production stock. The return becomes final and the branch cannot change it.`
        : `${units} is refused. No stock moves. The return becomes final.`,
    };
  }
  return {
    title: 'Send this back to the branch?',
    body: `No stock moves. ${short(r.branchName)} can correct ${units} and send it again, and it will come back to this queue. Use this when the count or the reason is wrong rather than rejecting a return that is genuinely coming back.`,
  };
}

const col = createColumnHelper<ProductionReturn>();

export function ProductionReturnsPage() {
  const { token } = useAuth();
  const returnsQ = useProductionReturns(token);
  const reviewMut = useReviewReturn(token);

  const [confirming, setConfirming] = useState<{ row: ProductionReturn; status: ProductionReturnStatus } | null>(null);

  // The id being acted on, rather than `reviewMut.isPending` alone: that is one
  // flag for the whole mutation, so disabling on it greys out every button in
  // every row while one is in flight. Production works this queue at speed and a
  // table that freezes whole is indistinguishable from one that has hung.
  const [actingId, setActingId] = useState<string | null>(null);

  async function submit() {
    if (!confirming) return;
    const { row, status } = confirming;
    setActingId(row.id);
    try {
      await reviewMut.mutateAsync({ id: row.id, status });
      toast.success(
        status === 'accepted'
          ? `Approved — ${row.qty} × ${row.productName} added to production stock`
          : status === 'rejected'
            ? `Rejected — ${row.qty} × ${row.productName} back with ${short(row.branchName)}`
            : `Sent back to ${short(row.branchName)} to correct`,
      );
      setConfirming(null);
    } catch (err) {
      // The API's message names the reason a review was refused ("Return already
      // reviewed" when someone else got there first), which is more use than a
      // generic failure — same handling as the branch's Return Stock page.
      toast.error(err instanceof ApiError || err instanceof Error ? err.message : 'Failed to review return');
    } finally {
      setActingId(null);
    }
  }

  const columns = [
    // The global filter only matches what it reaches through the accessor, so the
    // accessor carries both spellings — the ISO date and the displayed one — and
    // "15 Aug", "Aug 2026" and "2026-08-15" all find the row. Keeping the ISO date
    // first also leaves the value sorting chronologically.
    col.accessor((r) => `${r.date} ${formatDate(r.date)}`, {
      id: 'date',
      header: 'Return Date',
      cell: ({ row }) => <span className="text-sm whitespace-nowrap">{formatDate(row.original.date)}</span>,
    }),
    col.accessor('branchName', { header: 'Branch', meta: { mobile: 'subtitle' }, cell: (i) => <span className="font-medium">{short(i.getValue())}</span> }),
    col.accessor('productName', { header: 'Product', meta: { mobile: 'title' }, cell: (i) => <span>{i.getValue()}</span> }),
    col.accessor('qty', { header: 'Qty', meta: { align: 'center' }, cell: (i) => <span className="font-semibold tabular-nums">{i.getValue()}</span> }),
    // Which side raised it. Production has to know before deciding: approving a
    // branch-raised return credits the pool only, while approving one of their
    // own also takes the units off the branch — and Send Back applies to the
    // first kind alone. It was invisible on this table until now.
    col.accessor((r) => (r.source === 'branch' ? 'Branch' : 'Production'), {
      id: 'source',
      header: 'Raised By',
      cell: (i) => <span className="text-muted-foreground text-xs">{i.getValue()}</span>,
    }),
    col.accessor('reason', { header: 'Reason', meta: { mobileFull: true }, cell: (i) => <span className="text-muted-foreground">{i.getValue()}</span> }),
    col.accessor('status', {
      header: 'Status',
      meta: { mobile: 'badge' },
      cell: (i) => (
        <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', STATUS_STYLES[i.getValue()] ?? 'bg-muted')}>
          {STATUS_LABELS[i.getValue()] ?? i.getValue()}
        </span>
      ),
    }),
    col.display({
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const r = row.original;
        // Only `pending` is actionable. A row Production has sent back is waiting
        // on the branch, and the server's check-and-set is guarded on `pending`
        // too — so a button here would be one that 409s.
        if (r.status !== 'pending') {
          return (
            <span className="text-muted-foreground text-xs">
              {r.status === 'returned' ? 'With branch' : '—'}
            </span>
          );
        }
        const busy = actingId === r.id;
        return (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" className="h-8" onClick={() => setConfirming({ row: r, status: 'accepted' })} disabled={busy}>
              <Check className="mr-1 h-3.5 w-3.5" /> Approve
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-red-600" onClick={() => setConfirming({ row: r, status: 'rejected' })} disabled={busy}>
              <X className="mr-1 h-3.5 w-3.5" /> Reject
            </Button>
            {/* Branch-raised rows only — see the module comment. */}
            {r.source === 'branch' && (
              <Button size="sm" variant="outline" className="h-8" onClick={() => setConfirming({ row: r, status: 'returned' })} disabled={busy}>
                <Undo2 className="mr-1 h-3.5 w-3.5" /> Send Back
              </Button>
            )}
          </div>
        );
      },
    }),
  ];

  const copy = confirming ? confirmCopy(confirming.row, confirming.status) : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Product Returns</h2>
        <p className="text-sm text-muted-foreground">
          Last 30 days · approve, reject or send a return back to the branch to correct
        </p>
      </div>

      <DataTable columns={columns} data={returnsQ.data ?? []} loading={returnsQ.isLoading} searchPlaceholder="Search returns…" />

      <Dialog open={!!confirming} onOpenChange={(o) => !o && !reviewMut.isPending && setConfirming(null)}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle>{copy?.title}</DialogTitle>
            <DialogDescription>{copy?.body}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)} disabled={reviewMut.isPending}>
              Cancel
            </Button>
            <Button
              variant={confirming?.status === 'rejected' ? 'destructive' : 'default'}
              onClick={submit}
              disabled={reviewMut.isPending}
            >
              {reviewMut.isPending
                ? 'Saving…'
                : confirming?.status === 'accepted'
                  ? 'Approve Return'
                  : confirming?.status === 'rejected'
                    ? 'Reject Return'
                    : 'Send Back'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
