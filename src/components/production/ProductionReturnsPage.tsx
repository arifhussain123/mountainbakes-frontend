'use client';

import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { RETURN_DISPOSITION_LABELS, type FilterConfig, type ProductionReturn, type ProductionReturnDisposition, type ProductionReturnStatus } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranches, useProducts, useProductionReturns, useProductionReturnsSummary, useReviewReturn } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { DataTable } from '@/components/shared/DataTable';
import { ReturnPhoto } from '@/components/stock/ReturnPhoto';
import { MonthlyReturnsSummary } from '@/components/stock/MonthlyReturnsSummary';
import { RecordReturnDialog } from '@/components/production/RecordReturnDialog';
import { returnValueColumns } from '@/components/stock/returnColumns';
import { Pagination } from '@/components/data-engine/Pagination';
import { ActiveFilters, FilterBar } from '@/components/data-engine';
import { sortStateToTanstack, tanstackToSortState } from '@/lib/data-engine/sortConversion';
import { useListQueryState } from '@/lib/data-engine/useListQueryState';
import { ExpandableText } from '@/components/shared/ExpandableText';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatDate, formatDateTime } from '@/utils/date';
import { ApiError } from '@/utils/api';
import { cn } from '@/lib/utils';
import { Check, ClipboardList, Eye, Plus, Undo2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { ROUTES } from '@/utils/routes';
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
 * Approving never adds to production stock. Returned goods are Branch Return
 * Stock, a separate inventory; only an explicit transfer moves them on.
 *
 *                     from a branch                    recorded here
 *   Approve           into Branch Return Stock          return stock ↑ and branch ↓
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
        ? `${units} goes into Branch Return Stock — it is not added to production stock. ${short(r.branchName)} has already had it taken off their balance, so nothing changes at the branch. The return becomes final.`
        : `${units} goes into Branch Return Stock — it is not added to production stock — and comes off ${short(r.branchName)}'s balance. The return becomes final.`,
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

/**
 * The goods' condition, chosen when approving. Every one lands in Branch Return
 * Stock all the same; it is the record of what came back. Repaired feeds the
 * Production Dashboard's Repaired Stock section. Damaged and expired write value
 * off, so they need a note, as the API requires.
 */
const DISPOSITIONS: ProductionReturnDisposition[] = ['saleable', 'repaired', 'damaged', 'expired'];
const needsNote = (d: ProductionReturnDisposition) => d === 'damaged' || d === 'expired';

const col = createColumnHelper<ProductionReturn>();

export function ProductionReturnsPage() {
  const { token } = useAuth();
  const router = useRouter();

  // The row open in the dialog, and — once one is picked — the action awaiting
  // confirmation. `pendingAction` null means the dialog is showing the record;
  // set, it has turned over to the confirmation for that action. Two pieces of
  // state rather than one union because the row outlives the choice: backing out
  // of a confirmation returns to the detail rather than closing the dialog.
  const [viewRow, setViewRow] = useState<ProductionReturn | null>(null);
  const [pendingAction, setPendingAction] = useState<ProductionReturnStatus | null>(null);
  const [disposition, setDisposition] = useState<ProductionReturnDisposition>('saleable');
  const [dispositionNote, setDispositionNote] = useState('');
  const [recording, setRecording] = useState(false);

  const list = useListQueryState({ syncUrl: true, filterKeys: ['status', 'branchId', 'productId', 'businessDate'] });
  const branchesQ = useBranches(token);
  const productsQ = useProducts(token);
  const filters = useMemo<FilterConfig[]>(
    () => [
      {
        key: 'status', label: 'Status', type: 'select', placement: 'bar',
        options: (Object.keys(STATUS_LABELS) as ProductionReturnStatus[]).map((s) => ({ value: s, label: STATUS_LABELS[s] })),
      },
      { key: 'branchId', label: 'Branch', type: 'select', placement: 'bar', options: (branchesQ.data ?? []).map((b) => ({ value: b.id, label: short(b.name) })) },
      { key: 'productId', label: 'Product', type: 'select', options: (productsQ.data ?? []).map((p) => ({ value: p.id, label: p.name })) },
      { key: 'businessDate', label: 'Date', type: 'date-range' },
    ],
    [branchesQ.data, productsQ.data],
  );
  const returnsQ = useProductionReturns(token, {
    page: list.state.page,
    limit: list.state.pageSize,
    from: list.getFilter('businessDate', 'gte')?.value as string | undefined,
    to: list.getFilter('businessDate', 'lte')?.value as string | undefined,
    branchId: list.getFilter('branchId')?.value as string | undefined,
    productId: list.getFilter('productId')?.value as string | undefined,
    status: list.getFilter('status')?.value as string | undefined,
    search: list.state.search || undefined,
    sortBy: list.state.sort?.key as
      | 'date' | 'createdAt' | 'branchName' | 'productName' | 'qty' | 'source' | 'reason' | 'status'
      | undefined,
    sortDir: list.state.sort?.direction,
  });
  const reviewMut = useReviewReturn(token);
  // Follows the table's Branch filter only. Status, product and date narrow the
  // rows below; the summary is always this whole month, by status, so those
  // filters would only make it disagree with its own heading.
  // Always every branch: the boxes show each active branch's month, and the
  // branch filter only marks one and narrows the cards — no second request.
  const summaryQ = useProductionReturnsSummary(token, null);
  const filteredBranchId = (list.getFilter('branchId')?.value as string | undefined) ?? null;

  // Server-filtered and server-paginated — the query above already narrows to
  // the selected branch/product/status/date range and this page's slice.
  const rows = returnsQ.data?.returns ?? [];
  const total = returnsQ.data?.total ?? 0;

  function closeDialog() {
    if (reviewMut.isPending) return;
    setViewRow(null);
    setPendingAction(null);
    setDisposition('saleable');
    setDispositionNote('');
  }

  async function submit() {
    if (!viewRow || !pendingAction) return;
    const row = viewRow;
    const status = pendingAction;
    try {
      await reviewMut.mutateAsync(
        status === 'accepted'
          ? { id: row.id, status, disposition, dispositionNote: needsNote(disposition) ? dispositionNote.trim() : undefined }
          : { id: row.id, status },
      );
      toast.success(
        status === 'accepted'
          ? `Approved — ${row.qty} × ${row.productName} added to return stock`
          : status === 'rejected'
            ? `Rejected — ${row.qty} × ${row.productName} back with ${short(row.branchName)}`
            : `Sent back to ${short(row.branchName)} to correct`,
      );
      setViewRow(null);
      setPendingAction(null);
      setDisposition('saleable');
      setDispositionNote('');
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
      enableSorting: false,
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
    // Price and amount only — this page leaves out the product code.
    ...returnValueColumns(col).filter((c) => c.id !== 'productCode'),
    // Which side raised it. It decides what Approve moves and whether Send Back
    // is offered at all, so it belongs on the row rather than only in the dialog.
    col.accessor((r) => (r.source === 'branch' ? 'Branch' : 'Production'), {
      id: 'source',
      header: 'Raised By',
      cell: (i) => <span className="text-muted-foreground text-xs">{i.getValue()}</span>,
    }),
    col.accessor('reason', { header: 'Reason', meta: { mobileFull: true }, cell: (i) => <ExpandableText text={i.getValue()} className="text-muted-foreground" /> }),
    // Not sortable — there is nothing to order a picture by. A small fixed
    // thumbnail; the full photo opens from it. Rows without one show a dash.
    col.display({
      id: 'photo',
      header: 'Photo',
      enableSorting: false,
      meta: { align: 'center', mobileLabel: 'Photo' },
      cell: ({ row }) => <ReturnPhoto row={row.original} />,
    }),
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
      enableSorting: false,
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">Product Returns</h2>
          <p className="text-sm text-muted-foreground">
            Last 30 days by default · open a return to approve it, reject it, or send it back to the branch to correct
          </p>
        </div>
        {/* Full width under the heading on a phone, where they are the things to
            tap; beside it from `sm` up. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:shrink-0">
          <Button
            variant="outline"
            className="h-11 w-full border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 hover:text-primary sm:h-9 sm:w-auto dark:border-primary/40 dark:bg-primary/15 dark:hover:bg-primary/25"
            onClick={() => router.push(ROUTES.PRODUCTION_RETURNS_SUMMARY)}
          >
            <ClipboardList className="mr-1.5 h-4 w-4" /> Return Summary
          </Button>
          <Button className="h-11 w-full sm:h-9 sm:w-auto" onClick={() => setRecording(true)}>
            <Plus className="mr-1.5 h-4 w-4" /> Record Return
          </Button>
        </div>
      </div>

      <MonthlyReturnsSummary
        summary={summaryQ.data}
        isLoading={summaryQ.isPending}
        isError={summaryQ.isError}
        isFetching={summaryQ.isFetching}
        error={summaryQ.error}
        onRetry={() => void summaryQ.refetch()}
        statusLabels={STATUS_LABELS}
        showBranches
        branches={branchesQ.data}
        selectedBranchId={filteredBranchId}
        onSelectBranch={(id) => (id ? list.setFilter('branchId', 'eq', id) : list.clearFilter('branchId'))}
      />

      <FilterBar list={list} filters={filters} searchable={false} />
      <ActiveFilters filters={list.activeFilters} configs={filters} onRemove={list.clearFilter} onClearAll={list.clearAll} />

      <DataTable
        columns={columns}
        data={rows}
        loading={returnsQ.isLoading}
        searchPlaceholder="Search reason, product or branch…"
        pager={false}
        sortable
        manual={{
          page: list.state.page,
          pageSize: list.state.pageSize,
          total,
          onPageChange: list.setPage,
          search: list.state.search,
          onSearchChange: list.setSearch,
          sorting: sortStateToTanstack(list.state.sort),
          onSortingChange: (next) => list.setSort(tanstackToSortState(next)),
        }}
      />
      <Pagination
        page={list.state.page}
        pageSize={list.state.pageSize}
        total={total}
        onPageChange={list.setPage}
        onPageSizeChange={list.setPageSize}
        loading={returnsQ.isLoading}
      />

      <RecordReturnDialog open={recording} onOpenChange={setRecording} branches={branchesQ.data ?? []} products={productsQ.data ?? []} />

      {/* ── View, and decide ────────────────────────────────────────────────
          One dialog, two faces. It opens on the record; picking an action turns
          it over to that action's confirmation, and Back returns to the record. */}
      <Dialog open={!!viewRow} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="md:max-w-lg">
          <DialogHeader>
            <DialogTitle>{copy ? copy.title : 'Return Detail'}</DialogTitle>
            {copy && <DialogDescription>{copy.body}</DialogDescription>}
          </DialogHeader>

          {copy && pendingAction === 'accepted' && (
            <div className="space-y-2">
              <p className="text-sm font-medium" id="return-condition">Condition</p>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-labelledby="return-condition">
                {DISPOSITIONS.map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={disposition === d}
                    onClick={() => setDisposition(d)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                      disposition === d ? 'border-foreground bg-foreground text-background' : 'bg-card hover:bg-muted',
                    )}
                  >
                    {RETURN_DISPOSITION_LABELS[d]}
                  </button>
                ))}
              </div>
              {needsNote(disposition) && (
                <Textarea
                  value={dispositionNote}
                  onChange={(e) => setDispositionNote(e.target.value)}
                  placeholder={`Why is it ${disposition}?`}
                  aria-label="Why the stock is damaged or expired"
                  maxLength={500}
                  rows={2}
                />
              )}
            </div>
          )}

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

                {/* What the branch photographed, next to what it claimed — the
                    thing to check before choosing Approve. */}
                <dt className="col-span-2 pt-1 text-muted-foreground">Photo</dt>
                <dd className="col-span-2"><ReturnPhoto row={viewRow} size="sm" /></dd>
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
                  disabled={reviewMut.isPending || (pendingAction === 'accepted' && needsNote(disposition) && !dispositionNote.trim())}
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
