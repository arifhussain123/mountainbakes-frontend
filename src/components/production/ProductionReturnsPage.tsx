'use client';

import { useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import type { PageSize, ProductionReturn, ProductionReturnStatus } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranches, useProducts, useProductionReturns, useReviewReturn } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { DataTable } from '@/components/shared/DataTable';
import { Pagination } from '@/components/data-engine/Pagination';
import { ExpandableText } from '@/components/shared/ExpandableText';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDate, formatDateTime } from '@/utils/date';
import { ApiError } from '@/utils/api';
import { cn } from '@/lib/utils';
import { Check, Eye, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Production → Product Returns: the queue of stock branches have sent back.
 *
 * IT IS A QUEUE, not a log. Branch-raised returns used to arrive already
 * `accepted` — `POST /api/stock/return` approved them on the branch's behalf and
 * credited the production pool before this screen ever saw them, so every row
 * here was a decision already taken. A branch return now arrives `pending` and
 * waits here.
 *
 * THE DECISION IS TAKEN IN THE DIALOG, NOT IN THE ROW. The three actions used to
 * sit inline in the actions column. They are gone from the table: a row is a
 * summary, and Approve/Reject/Send Back were three small targets crowded into
 * the narrowest column on the densest screen in the app, each irreversible and
 * two of them moving stock in a shop that is not looking. View opens the row and
 * the decision is taken there, against the full record — the reason text in
 * particular, which the table truncates and which is the whole basis for
 * choosing Reject over Send Back.
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
 * Picking an action does not fire it. The dialog turns over to a confirmation
 * naming what moves, in the SAME dialog rather than a second one stacked on top
 * — two overlapping modals to take one decision is how a mis-click becomes a
 * stock movement nobody meant.
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

// Sentinel rather than an empty string: Base UI's Select treats an absent value
// as "show the placeholder", so '' as a real option would render as no value.
const ALL_STATUSES = 'all';

const short = (name: string) => name.replace('Mountain Bakes ', '');

/**
 * The short reference shown in the ID column.
 *
 * The id is a uuid — unreadable at a glance and far too wide for a table that
 * also has to fit on a phone. The first segment is enough to match a row against
 * the one open in the dialog, which prints the id in full. Same helper, and the
 * same reasoning, as the branch's Return Stock page.
 */
function shortRef(id: string): string {
  return id.split('-')[0]?.toUpperCase() ?? id.slice(0, 8).toUpperCase();
}

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

  // The row open in the dialog, and — once one is picked — the action awaiting
  // confirmation. `pendingAction` null means the dialog is showing the record;
  // set, it has turned over to the confirmation for that action. Two pieces of
  // state rather than one union because the row outlives the choice: backing out
  // of a confirmation returns to the detail rather than closing the dialog.
  const [viewRow, setViewRow] = useState<ProductionReturn | null>(null);
  const [pendingAction, setPendingAction] = useState<ProductionReturnStatus | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>(ALL_STATUSES);
  const [branchFilter, setBranchFilter] = useState<string>(ALL_STATUSES);
  const [productFilter, setProductFilter] = useState<string>(ALL_STATUSES);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);

  /** Every filter/search change resets to page 1 — a stale page number on a narrowed result set reads as "no results". */
  function setFilter<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(1);
    };
  }

  const branchesQ = useBranches(token);
  const productsQ = useProducts(token);
  const returnsQ = useProductionReturns(token, {
    page,
    limit: pageSize,
    from: from || undefined,
    to: to || undefined,
    branchId: branchFilter === ALL_STATUSES ? undefined : branchFilter,
    productId: productFilter === ALL_STATUSES ? undefined : productFilter,
    status: statusFilter === ALL_STATUSES ? undefined : statusFilter,
    search: search || undefined,
  });
  const reviewMut = useReviewReturn(token);

  // Server-filtered and server-paginated — the query above already narrows to
  // the selected branch/product/status/date range and this page's slice.
  const rows = returnsQ.data?.returns ?? [];
  const total = returnsQ.data?.total ?? 0;

  function closeDialog() {
    if (reviewMut.isPending) return;
    setViewRow(null);
    setPendingAction(null);
  }

  async function submit() {
    if (!viewRow || !pendingAction) return;
    const row = viewRow;
    const status = pendingAction;
    try {
      await reviewMut.mutateAsync({ id: row.id, status });
      toast.success(
        status === 'accepted'
          ? `Approved — ${row.qty} × ${row.productName} added to production stock`
          : status === 'rejected'
            ? `Rejected — ${row.qty} × ${row.productName} back with ${short(row.branchName)}`
            : `Sent back to ${short(row.branchName)} to correct`,
      );
      setViewRow(null);
      setPendingAction(null);
    } catch (err) {
      // The API's message names the reason a review was refused ("Return already
      // reviewed" when someone else got there first), which is more use than a
      // generic failure — same handling as the branch's Return Stock page.
      toast.error(err instanceof ApiError || err instanceof Error ? err.message : 'Failed to review return');
      // Deliberately back to the detail, not closed: "already reviewed" means
      // this row has changed under the operator and the record is what they need
      // to see, while closing would drop them on a table they must find it in
      // again.
      setPendingAction(null);
    }
  }

  const columns = [
    col.accessor('id', {
      header: 'ID',
      meta: { mobileLabel: 'Ref' },
      cell: (i) => <span className="font-mono text-xs text-muted-foreground">{shortRef(i.getValue())}</span>,
    }),
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
    // Which side raised it. It decides what Approve moves and whether Send Back
    // is offered at all, so it belongs on the row rather than only in the dialog.
    col.accessor((r) => (r.source === 'branch' ? 'Branch' : 'Production'), {
      id: 'source',
      header: 'Raised By',
      cell: (i) => <span className="text-muted-foreground text-xs">{i.getValue()}</span>,
    }),
    col.accessor('reason', { header: 'Reason', meta: { mobileFull: true }, cell: (i) => <ExpandableText text={i.getValue()} className="text-muted-foreground" /> }),
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
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => setViewRow(row.original)}>
          <Eye className="mr-1.5 h-4 w-4" /> View
        </Button>
      ),
    }),
  ];

  const copy = viewRow && pendingAction ? confirmCopy(viewRow, pendingAction) : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Product Returns</h2>
        <p className="text-sm text-muted-foreground">
          Last 30 days by default · open a return to approve it, reject it, or send it back to the branch to correct
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="return-status-filter" className="text-xs text-muted-foreground">
            Status
          </Label>
          <Select value={statusFilter} onValueChange={(v) => setFilter(setStatusFilter)((v as string) ?? ALL_STATUSES)}>
            <SelectTrigger id="return-status-filter" className="h-11 w-full sm:h-9 sm:w-44">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
              {(Object.keys(STATUS_LABELS) as ProductionReturnStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="return-branch-filter" className="text-xs text-muted-foreground">
            Branch
          </Label>
          <Select value={branchFilter} onValueChange={(v) => setFilter(setBranchFilter)(v ?? ALL_STATUSES)}>
            <SelectTrigger id="return-branch-filter" className="h-11 w-full sm:h-9 sm:w-44">
              <SelectValue placeholder="All branches" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STATUSES}>All branches</SelectItem>
              {(branchesQ.data ?? []).map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {short(b.name)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="return-product-filter" className="text-xs text-muted-foreground">
            Product
          </Label>
          <Select value={productFilter} onValueChange={(v) => setFilter(setProductFilter)(v ?? ALL_STATUSES)}>
            <SelectTrigger id="return-product-filter" className="h-11 w-full sm:h-9 sm:w-44">
              <SelectValue placeholder="All products" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STATUSES}>All products</SelectItem>
              {(productsQ.data ?? []).map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="return-from-filter" className="text-xs text-muted-foreground">
            From
          </Label>
          <Input
            id="return-from-filter"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFilter(setFrom)(e.target.value)}
            className="h-11 sm:h-9"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="return-to-filter" className="text-xs text-muted-foreground">
            To
          </Label>
          <Input
            id="return-to-filter"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => setFilter(setTo)(e.target.value)}
            className="h-11 sm:h-9"
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        loading={returnsQ.isLoading}
        searchPlaceholder="Search reason, product or branch…"
        pager={false}
        manual={{
          page,
          pageSize,
          total,
          onPageChange: setPage,
          search,
          onSearchChange: setFilter(setSearch),
        }}
      />
      <Pagination
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
        loading={returnsQ.isLoading}
      />

      {/* ── View, and decide ────────────────────────────────────────────────
          One dialog, two faces. It opens on the record; picking an action turns
          it over to that action's confirmation, and Back returns to the record. */}
      <Dialog open={!!viewRow} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="md:max-w-lg">
          <DialogHeader>
            <DialogTitle>{copy ? copy.title : 'Return Detail'}</DialogTitle>
            {copy && <DialogDescription>{copy.body}</DialogDescription>}
          </DialogHeader>

          {viewRow && !copy && (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
                <dt className="text-muted-foreground">Reference</dt>
                {/* The id in full here — the table shows only its first segment. */}
                <dd className="break-all text-right font-mono text-xs">{viewRow.id}</dd>

                <dt className="text-muted-foreground">Branch</dt>
                <dd className="text-right font-medium">{short(viewRow.branchName)}</dd>

                <dt className="text-muted-foreground">Product</dt>
                <dd className="text-right font-medium">{viewRow.productName}</dd>

                <dt className="text-muted-foreground">Quantity</dt>
                <dd className="text-right font-semibold tabular-nums">{viewRow.qty}</dd>

                <dt className="text-muted-foreground">Status</dt>
                <dd className="text-right">
                  <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', STATUS_STYLES[viewRow.status] ?? 'bg-muted')}>
                    {STATUS_LABELS[viewRow.status] ?? viewRow.status}
                  </span>
                </dd>

                <dt className="text-muted-foreground">Business day</dt>
                <dd className="text-right">{formatDate(viewRow.date)}</dd>

                <dt className="text-muted-foreground">Recorded</dt>
                <dd className="text-right">{formatDateTime(viewRow.createdAt)}</dd>

                <dt className="text-muted-foreground">Reviewed</dt>
                <dd className="text-right">{viewRow.reviewedAt ? formatDateTime(viewRow.reviewedAt) : '—'}</dd>

                <dt className="text-muted-foreground">Raised by</dt>
                <dd className="truncate text-right">{viewRow.createdByName || '—'}</dd>

                <dt className="text-muted-foreground">Reviewed by</dt>
                <dd className="truncate text-right">{viewRow.reviewedByName || '—'}</dd>

                {/* Spelled out rather than left as "Branch"/"Production", because
                    it is what decides whether Approve also moves branch stock. */}
                <dt className="text-muted-foreground">Source</dt>
                <dd className="text-right">
                  {viewRow.source === 'branch' ? 'Raised by the branch' : 'Recorded by production'}
                </dd>

                {/* Full width and untruncated — the table clips it, and it is the
                    basis for choosing Reject over Send Back. */}
                <dt className="col-span-2 pt-1 text-muted-foreground">Reason</dt>
                <dd className="col-span-2 rounded-md bg-muted/40 p-2.5">{viewRow.reason || '—'}</dd>
              </dl>

              {viewRow.status === 'pending' && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Decision</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => setPendingAction('accepted')}>
                        <Check className="mr-1.5 h-4 w-4" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 hover:text-red-600"
                        onClick={() => setPendingAction('rejected')}
                      >
                        <X className="mr-1.5 h-4 w-4" /> Reject
                      </Button>
                      {/* Branch-raised rows only — see the module comment. */}
                      {viewRow.source === 'branch' && (
                        <Button size="sm" variant="outline" onClick={() => setPendingAction('returned')}>
                          <Undo2 className="mr-1.5 h-4 w-4" /> Send Back
                        </Button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          <DialogFooter>
            {copy ? (
              <>
                <Button variant="outline" onClick={() => setPendingAction(null)} disabled={reviewMut.isPending}>
                  Back
                </Button>
                <Button
                  variant={pendingAction === 'rejected' ? 'destructive' : 'default'}
                  onClick={submit}
                  disabled={reviewMut.isPending}
                >
                  {reviewMut.isPending
                    ? 'Saving…'
                    : pendingAction === 'accepted'
                      ? 'Approve Return'
                      : pendingAction === 'rejected'
                        ? 'Reject Return'
                        : 'Send Back'}
                </Button>
              </>
            ) : (
              <Button variant="outline" onClick={closeDialog}>
                Close
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
