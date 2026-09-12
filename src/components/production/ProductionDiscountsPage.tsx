'use client';

import { useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import type { BranchDiscount, BranchDiscountStatus, PageSize } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranches, useProductionDiscounts, useReviewDiscount } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { formatDate, formatDateTime } from '@/utils/date';
import { formatCurrency } from '@/utils/currency';
import { ApiError } from '@/utils/api';
import { cn } from '@/lib/utils';
import { Check, Eye, Undo2, X } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Production → Discounts: the queue of money branches are claiming back against
 * demands Production filled.
 *
 * READ THIS ALONGSIDE ProductionReturnsPage. It is the same screen on purpose —
 * same queue, same four states, same View-then-decide dialog that turns over to a
 * confirmation rather than stacking a second modal — because a production user
 * should not have to learn two boards. Where the two differ, the difference is
 * real and is called out below.
 *
 * NOTHING HERE MOVES STOCK, and that is the one substantive difference. A return
 * has already taken units off a branch's shelf by the time it lands, so Approve
 * and Reject each move goods and the confirmation has to say which way. A
 * discount has moved nothing and never will: approving one records that the claim
 * was allowed. The confirmation copy therefore talks about money and the record,
 * and deliberately does not promise a payment — where the amount is settled is
 * downstream of this screen and outside this table.
 *
 * THE DECISION IS TAKEN IN THE DIALOG, NOT IN THE ROW — the reasoning the Returns
 * page sets out applies here unchanged, and more so: the reason text is the whole
 * basis for choosing Reject over Send Back, and the table truncates it.
 *
 * SEND BACK IS OFFERED ON EVERY ROW, where Returns has to restrict it to
 * branch-raised ones. Every claim in this table was raised by a branch — there is
 * no Production-recorded path — so there is always branch paperwork to hand back.
 * It is the one outcome that needs a note, because "fix this" without saying what
 * is how a claim bounces twice; the server enforces that too.
 */

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  returned: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400',
};

/**
 * Badge wording, following the Returns page's rule: the label says who the row is
 * waiting on. 'returned' must not read as "Returned" — on a board of claims that
 * would suggest money went back, when it means the branch still has to act.
 */
const STATUS_LABELS: Record<string, string> = {
  pending: 'Awaiting Review',
  approved: 'Approved',
  rejected: 'Rejected',
  returned: 'Sent Back to Branch',
};

// Sentinel rather than an empty string: Base UI's Select treats an absent value
// as "show the placeholder", so '' as a real option would render as no value.
const ALL_STATUSES = 'all';

const short = (name: string) => name.replace('Mountain Bakes ', '');

/** First uuid segment — the same short reference, and reasoning, as the Returns page. */
function shortRef(id: string): string {
  return id.split('-')[0]?.toUpperCase() ?? id.slice(0, 8).toUpperCase();
}

/** The confirmation copy for each action — what it does, in record terms. */
function confirmCopy(d: BranchDiscount, status: BranchDiscountStatus): { title: string; body: string } {
  const money = formatCurrency(d.amount);
  if (status === 'approved') {
    return {
      title: 'Approve this discount?',
      body: `${money} against ${d.demandNumber} is allowed for ${short(d.branchName)}. The claim becomes final and neither side can change it.`,
    };
  }
  if (status === 'rejected') {
    return {
      title: 'Reject this discount?',
      body: `${short(d.branchName)} is refused ${money} on ${d.demandNumber}. The claim becomes final and the branch cannot correct or resubmit it — send it back instead if the figure is simply wrong.`,
    };
  }
  return {
    title: 'Send this back to the branch?',
    body: `${short(d.branchName)} can correct ${money} on ${d.demandNumber} and send it again, and it will come back to this queue. Say what needs changing.`,
  };
}

const col = createColumnHelper<BranchDiscount>();

export function ProductionDiscountsPage() {
  const { token } = useAuth();

  // The row open in the dialog, and — once one is picked — the action awaiting
  // confirmation. Two pieces of state rather than one union because the row
  // outlives the choice: backing out of a confirmation returns to the detail
  // rather than closing the dialog. Same shape as the Returns page.
  const [viewRow, setViewRow] = useState<BranchDiscount | null>(null);
  const [pendingAction, setPendingAction] = useState<BranchDiscountStatus | null>(null);
  const [note, setNote] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>(ALL_STATUSES);
  const [branchFilter, setBranchFilter] = useState<string>(ALL_STATUSES);
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
  const discountsQ = useProductionDiscounts(token, {
    page,
    limit: pageSize,
    from: from || undefined,
    to: to || undefined,
    branchId: branchFilter === ALL_STATUSES ? undefined : branchFilter,
    status: statusFilter === ALL_STATUSES ? undefined : statusFilter,
    search: search || undefined,
  });
  const reviewMut = useReviewDiscount(token);

  // Server-filtered and server-paginated — the query above already narrows to
  // the selected branch/status/date range and this page's slice.
  const rows = discountsQ.data?.discounts ?? [];
  const total = discountsQ.data?.total ?? 0;

  function closeDialog() {
    if (reviewMut.isPending) return;
    setViewRow(null);
    setPendingAction(null);
    setNote('');
  }

  function pick(status: BranchDiscountStatus) {
    setPendingAction(status);
    setNote('');
  }

  // Mandatory on a send-back only. The server refuses one without a note, so this
  // is the button knowing the rule rather than the rule itself.
  const noteRequired = pendingAction === 'returned';
  const noteMissing = noteRequired && note.trim().length < 3;

  async function submit() {
    if (!viewRow || !pendingAction || noteMissing) return;
    const row = viewRow;
    const status = pendingAction;
    try {
      await reviewMut.mutateAsync({ id: row.id, status, ...(note.trim() ? { reviewNote: note.trim() } : {}) });
      toast.success(
        status === 'approved'
          ? `Approved — ${formatCurrency(row.amount)} on ${row.demandNumber}`
          : status === 'rejected'
            ? `Rejected — ${formatCurrency(row.amount)} on ${row.demandNumber}`
            : `Sent back to ${short(row.branchName)} to correct`,
      );
      closeDialog();
    } catch (err) {
      // The API's message names why a review was refused ("Discount already
      // reviewed" when someone else got there first), which is more use than a
      // generic failure — same handling as the Returns page.
      toast.error(err instanceof ApiError || err instanceof Error ? err.message : 'Failed to review discount');
      // Back to the detail, not closed: "already reviewed" means the row changed
      // under the operator and the record is what they need to see, while closing
      // would drop them on a table they must find it in again.
      setPendingAction(null);
    }
  }

  const columns = [
    col.accessor('id', {
      header: 'ID',
      meta: { mobileLabel: 'Ref' },
      cell: (i) => <span className="font-mono text-xs text-muted-foreground">{shortRef(i.getValue())}</span>,
    }),
    // The accessor carries both spellings — ISO and displayed — so the global
    // filter matches "15 Aug", "Aug 2026" and "2026-08-15" alike, and the ISO
    // date first leaves the value sorting chronologically. Same trick as Returns.
    col.accessor((d) => `${d.date} ${formatDate(d.date)}`, {
      id: 'date',
      header: 'Raised',
      cell: ({ row }) => <span className="text-sm whitespace-nowrap">{formatDate(row.original.date)}</span>,
    }),
    col.accessor('branchName', {
      header: 'Branch',
      meta: { mobile: 'subtitle' },
      cell: (i) => <span className="font-medium">{short(i.getValue())}</span>,
    }),
    // The demand is what makes the amount checkable, so it is on the row rather
    // than only in the dialog — it is the first thing a reviewer looks up.
    col.accessor('demandNumber', {
      header: 'Demand #',
      meta: { mobile: 'title' },
      cell: (i) => <span className="font-mono font-medium">{i.getValue()}</span>,
    }),
    col.accessor('amount', {
      header: 'Amount',
      meta: { align: 'center' },
      cell: (i) => <span className="font-semibold tabular-nums">{formatCurrency(i.getValue())}</span>,
    }),
    col.accessor('reason', {
      header: 'Reason',
      meta: { mobileFull: true },
      cell: (i) => <ExpandableText text={i.getValue()} className="text-muted-foreground" />,
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
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => { setViewRow(row.original); setPendingAction(null); setNote(''); }}>
          <Eye className="mr-1.5 h-4 w-4" /> View
        </Button>
      ),
    }),
  ];

  const copy = viewRow && pendingAction ? confirmCopy(viewRow, pendingAction) : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Discounts</h2>
        <p className="text-sm text-muted-foreground">
          Last 30 days by default · open a claim to approve it, reject it, or send it back to the branch to correct
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label htmlFor="discount-status-filter" className="text-xs text-muted-foreground">
            Status
          </Label>
          <Select value={statusFilter} onValueChange={(v) => setFilter(setStatusFilter)((v as string) ?? ALL_STATUSES)}>
            <SelectTrigger id="discount-status-filter" className="h-11 w-full sm:h-9 sm:w-44">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
              {(Object.keys(STATUS_LABELS) as BranchDiscountStatus[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="discount-branch-filter" className="text-xs text-muted-foreground">
            Branch
          </Label>
          <Select value={branchFilter} onValueChange={(v) => setFilter(setBranchFilter)(v ?? ALL_STATUSES)}>
            <SelectTrigger id="discount-branch-filter" className="h-11 w-full sm:h-9 sm:w-44">
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
          <Label htmlFor="discount-from-filter" className="text-xs text-muted-foreground">
            From
          </Label>
          <Input
            id="discount-from-filter"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => setFilter(setFrom)(e.target.value)}
            className="h-11 sm:h-9"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="discount-to-filter" className="text-xs text-muted-foreground">
            To
          </Label>
          <Input
            id="discount-to-filter"
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
        loading={discountsQ.isLoading}
        searchPlaceholder="Search demand #, reason or branch…"
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
        loading={discountsQ.isLoading}
      />

      {/* ── View, and decide ────────────────────────────────────────────────
          One dialog, two faces. It opens on the record; picking an action turns
          it over to that action's confirmation, and Back returns to the record. */}
      <Dialog open={!!viewRow} onOpenChange={(o) => !o && closeDialog()}>
        <DialogContent className="md:max-w-lg">
          <DialogHeader>
            <DialogTitle>{copy ? copy.title : 'Discount Detail'}</DialogTitle>
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

                <dt className="text-muted-foreground">Demand</dt>
                <dd className="text-right font-mono font-medium">{viewRow.demandNumber}</dd>

                <dt className="text-muted-foreground">Amount</dt>
                <dd className="text-right text-base font-semibold tabular-nums">{formatCurrency(viewRow.amount)}</dd>

                <dt className="text-muted-foreground">Status</dt>
                <dd className="text-right">
                  <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', STATUS_STYLES[viewRow.status] ?? 'bg-muted')}>
                    {STATUS_LABELS[viewRow.status] ?? viewRow.status}
                  </span>
                </dd>

                <dt className="text-muted-foreground">Business day</dt>
                <dd className="text-right">{formatDate(viewRow.date)}</dd>

                <dt className="text-muted-foreground">Raised</dt>
                <dd className="text-right">{formatDateTime(viewRow.createdAt)}</dd>

                <dt className="text-muted-foreground">Reviewed</dt>
                <dd className="text-right">{viewRow.reviewedAt ? formatDateTime(viewRow.reviewedAt) : '—'}</dd>

                <dt className="text-muted-foreground">Raised by</dt>
                <dd className="truncate text-right">{viewRow.createdByName || '—'}</dd>

                <dt className="text-muted-foreground">Reviewed by</dt>
                <dd className="truncate text-right">{viewRow.reviewedByName || '—'}</dd>

                {/* Full width and untruncated — the table clips it, and it is the
                    basis for choosing Reject over Send Back. */}
                <dt className="col-span-2 pt-1 text-muted-foreground">Reason</dt>
                <dd className="col-span-2 rounded-md bg-muted/40 p-2.5">{viewRow.reason || '—'}</dd>

                {/* Only once someone has written one. An empty "Review note —"
                    row on every pending claim would be noise on the state this
                    screen shows most. */}
                {viewRow.reviewNote && (
                  <>
                    <dt className="col-span-2 pt-1 text-muted-foreground">Review note</dt>
                    <dd className="col-span-2 rounded-md bg-muted/40 p-2.5">{viewRow.reviewNote}</dd>
                  </>
                )}
              </dl>

              {viewRow.status === 'pending' && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Decision</p>
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => pick('approved')}>
                        <Check className="mr-1.5 h-4 w-4" /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="text-red-600 hover:text-red-600"
                        onClick={() => pick('rejected')}
                      >
                        <X className="mr-1.5 h-4 w-4" /> Reject
                      </Button>
                      {/* Every row, unlike Returns — see the module comment. */}
                      <Button size="sm" variant="outline" onClick={() => pick('returned')}>
                        <Undo2 className="mr-1.5 h-4 w-4" /> Send Back
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* The note lives on the confirmation face, not the detail face: it is
              about the decision being taken, and asking for it before one is
              picked would be a box with no question attached. Required on a send
              back, offered on a rejection — a refusal over money is worth
              explaining, but it is final either way and there is nothing for the
              branch to do with it, so it is not made a hurdle. Approve gets no
              box: there is nothing to say beyond the amount. */}
          {copy && pendingAction !== 'approved' && (
            <div className="space-y-1">
              <Label htmlFor="discount-review-note">
                {noteRequired ? 'What needs correcting?' : 'Note to the branch (optional)'}
              </Label>
              <Textarea
                id="discount-review-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  noteRequired
                    ? 'The branch sees this and corrects the claim against it.'
                    : 'The branch sees this on the claim.'
                }
                disabled={reviewMut.isPending}
              />
            </div>
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
                  disabled={reviewMut.isPending || noteMissing}
                >
                  {reviewMut.isPending
                    ? 'Saving…'
                    : pendingAction === 'approved'
                      ? 'Approve Discount'
                      : pendingAction === 'rejected'
                        ? 'Reject Discount'
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
