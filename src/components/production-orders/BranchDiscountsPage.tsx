'use client';

import { useEffect, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import type { BranchDiscount, BranchDiscountStatus } from '@mb/shared';
import { isDiscountOpen } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranchDiscounts, useReviseBranchDiscount, useWithdrawBranchDiscount } from '@/lib/queries';
import { DataTable } from '@/components/shared/DataTable';
import { ExpandableText } from '@/components/shared/ExpandableText';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { formatCurrency } from '@/utils/currency';
import { ApiError } from '@/utils/api';
import { cn } from '@/lib/utils';
import { BadgePercent, ChevronLeft, ChevronRight, Eye, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  DISCOUNT_STATUS_STYLES,
  DiscountFormFields,
  discountStatusLabel,
  isDiscountInputValid,
  lockReason,
  parseAmount,
  shortRef,
} from './discountShared';

const PAGE_SIZE = 50;

// Sentinel rather than an empty string: Base UI's Select treats an absent
// value as "show the placeholder", so '' as a real option would render as no
// value — same reasoning as the Production Discounts/Returns filters.
const ALL_STATUSES = 'all';

/**
 * Branch → Discounts: every claim this branch has made against a demand.
 *
 * THE COUNTERPART OF Return Stock, and built to read as the same page: one row
 * per claim, a View that opens the full record, and Change / Delete offered for
 * exactly as long as the branch still owns the row. A branch manager should be
 * able to move between the two screens without relearning anything.
 *
 * READS ITS OWN ENDPOINT, not Production's. `/api/production-discounts` is the
 * Production board — every branch's claims, behind a `super_admin` +
 * `production_user` router that 403s a branch role — so this page is served by
 * `GET /api/branch-discounts`, which scopes to the caller's branch off the JWT.
 * The two read one table and are not interchangeable.
 *
 * WHEN THE ACTIONS ARE OFFERED:
 *
 *   pending / returned   Change and Delete
 *   approved / rejected  nothing — Production has decided and the row is final
 *
 * `isDiscountOpen` is shared with the server rather than restated here, so the
 * client cannot drift from the rule branch-discounts.routes.ts enforces on the
 * UPDATE and DELETE predicates. The server re-decides every request and answers a
 * stale tab with a 409 naming the reason, which is surfaced verbatim.
 *
 * NO RESUBMIT BUTTON, where Return Stock has one. A sent-back return can be
 * resent untouched, because Production may have handed it back over something
 * outside the record. A sent-back CLAIM always carries a note saying what to
 * correct — the server refuses a send-back without one — so resending it
 * unchanged would be answering a question by repeating the answer. Saving the
 * correction is what puts it back in the queue; the Change dialog says so.
 *
 * NO GeofenceGate, where Return Stock wraps both write dialogs in one. That gate
 * guards PHYSICAL acts: a return moves units in a shop, and the server geofences
 * the endpoint, so the form there has to match or it fills in and then 403s. A
 * discount moves nothing and its endpoints are not geofenced — a manager chasing
 * a short delivery from home is not what the gate exists to stop.
 *
 * NO useStockRealtime, for the same reason `qk.branchDiscounts` sits outside the
 * ['stock'] prefix: nothing here moves stock, so the notification stream that
 * refreshes Return Stock has nothing to say about this list. It stays live off
 * the app-wide refresh tick instead.
 */

const col = createColumnHelper<BranchDiscount>();

const STATUSES: BranchDiscountStatus[] = ['pending', 'approved', 'rejected', 'returned'];

export function BranchDiscountsPage() {
  const { token } = useAuth();
  const [status, setStatus] = useState<string>(ALL_STATUSES);
  const [search, setSearch] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);
  const discountsQ = useBranchDiscounts(token, {
    status: status === ALL_STATUSES ? undefined : status,
    search: search || undefined,
    from: from || undefined,
    to: to || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });
  const reviseMut = useReviseBranchDiscount(token);
  const withdrawMut = useWithdrawBranchDiscount(token);

  const [viewRow, setViewRow] = useState<BranchDiscount | null>(null);
  const [editRow, setEditRow] = useState<BranchDiscount | null>(null);
  const [deleteRow, setDeleteRow] = useState<BranchDiscount | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editReason, setEditReason] = useState('');

  /** Every filter/search change resets to page 0 — a stale page on a narrowed result set reads as "nothing claimed". */
  function setFilter<T>(setter: (v: T) => void) {
    return (v: T) => {
      setter(v);
      setPage(0);
    };
  }

  function changeStatus(v: string) {
    setFilter(setStatus)(v ?? ALL_STATUSES);
  }

  const rows = discountsQ.data?.discounts ?? [];
  const total = discountsQ.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  useEffect(() => {
    if (discountsQ.isError) toast.error('Could not load discounts');
  }, [discountsQ.isError]);

  function openEdit(d: BranchDiscount) {
    setEditRow(d);
    setEditAmount(String(d.amount));
    setEditReason(d.reason ?? '');
  }

  /** The API's own message is the useful one — see the module comment. */
  function fail(err: unknown, fallback: string) {
    toast.error(err instanceof ApiError || err instanceof Error ? err.message : fallback);
  }

  async function submitEdit() {
    if (!editRow) return;
    const amount = parseAmount(editAmount);
    try {
      await reviseMut.mutateAsync({ id: editRow.id, amount, reason: editReason.trim() });
      toast.success(`Discount on ${editRow.demandNumber} updated — back with Production for review`);
      setEditRow(null);
    } catch (err) {
      fail(err, 'Could not update the discount');
    }
  }

  async function submitDelete() {
    if (!deleteRow) return;
    try {
      await withdrawMut.mutateAsync(deleteRow.id);
      toast.success(`Discount on ${deleteRow.demandNumber} withdrawn`);
      setDeleteRow(null);
    } catch (err) {
      fail(err, 'Could not withdraw the discount');
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
    // keeps the column sorting chronologically. Same trick as Return Stock.
    col.accessor((d) => `${d.date} ${formatDate(d.date)}`, {
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
    col.accessor((d) => d.reviewedAt ?? '', {
      id: 'reviewedAt',
      header: 'Reviewed',
      meta: { align: 'center', mobileLabel: 'Reviewed' },
      cell: ({ row }) => (
        <span className="whitespace-nowrap tabular-nums text-muted-foreground">
          {row.original.reviewedAt ? formatTime(row.original.reviewedAt) : '—'}
        </span>
      ),
    }),
    // Where Return Stock names a product, a claim names the demand it is about —
    // it is the only thing that makes the amount checkable, so it is the title.
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
        <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', DISCOUNT_STATUS_STYLES[i.getValue()] ?? 'bg-muted')}>
          {discountStatusLabel(i.getValue())}
        </span>
      ),
    }),
    col.display({
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const d = row.original;
        return (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => setViewRow(d)}>
              <Eye className="mr-1.5 h-4 w-4" /> View
            </Button>
            {isDiscountOpen(d.status) ? (
              <>
                <Button variant="ghost" size="sm" onClick={() => openEdit(d)}>
                  <Pencil className="mr-1.5 h-4 w-4" />
                  {/* "Correct" on a sent-back row: Production has asked for a
                      specific change and the word should match the request. */}
                  {d.status === 'returned' ? 'Correct' : 'Change'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => setDeleteRow(d)}
                >
                  <Trash2 className="mr-1.5 h-4 w-4" /> Delete
                </Button>
              </>
            ) : (
              // A disabled button would say "you may do this, later"; the row is
              // final, so it says why instead — and stays readable on a phone,
              // where there is no hover to reveal a tooltip.
              <span className="text-xs text-muted-foreground" title={lockReason(d)}>
                Final
              </span>
            )}
          </div>
        );
      },
    }),
  ];

  const inputValid = isDiscountInputValid(editAmount, editReason);
  const amountChanged = !!editRow && parseAmount(editAmount) !== editRow.amount;
  const reasonChanged = !!editRow && editReason.trim() !== (editRow.reason ?? '');

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Discounts</h2>
          <p className="text-sm text-muted-foreground">
            Money this branch has claimed back against a demand · last 90 days ·
            {' '}change or withdraw a claim until production reviews it
          </p>
        </div>
      </div>

      {/* Status narrows the table ahead of the search box within it, matching
          the Production Discounts/Returns boards. Both are server-side: the
          search box sends `search` to the API rather than filtering the
          current page in memory. */}
      <DataTable
        columns={columns}
        data={rows}
        loading={discountsQ.isLoading}
        searchPlaceholder="Search demand # or reason…"
        pager={false}
        manual={{
          page: page + 1,
          pageSize: PAGE_SIZE,
          total,
          onPageChange: (p) => setPage(p - 1),
          search,
          onSearchChange: setFilter(setSearch),
        }}
        leading={
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor="discount-status-filter" className="text-xs text-muted-foreground">
                Status
              </Label>
              <Select value={status} onValueChange={(v) => changeStatus((v as string) ?? ALL_STATUSES)}>
                <SelectTrigger id="discount-status-filter" className="h-11 w-full sm:h-9 sm:w-44">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_STATUSES}>All statuses</SelectItem>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {discountStatusLabel(s)}
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
        }
        empty={
          <div className="flex flex-col items-center gap-2 py-10 text-center">
            <BadgePercent className="h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">Nothing claimed yet</p>
            <p className="text-sm text-muted-foreground">
              Discounts are raised from the New Orders page with the Discount button.
            </p>
          </div>
        }
      />

      <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>{total} total</span>
        <div className="flex items-center gap-2">
          <span>Page {page + 1} of {pageCount}</span>
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 md:h-7 md:w-7"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 md:h-7 md:w-7"
            disabled={page + 1 >= pageCount}
            onClick={() => setPage((p) => p + 1)}
            aria-label="Next page"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── View ─────────────────────────────────────────────────────────── */}
      <Dialog open={!!viewRow} onOpenChange={(o) => !o && setViewRow(null)}>
        <DialogContent className="md:max-w-lg">
          <DialogHeader>
            <DialogTitle>Discount Detail</DialogTitle>
          </DialogHeader>
          {viewRow && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
              <dt className="text-muted-foreground">Reference</dt>
              {/* The id in full here — the table shows only its first segment. */}
              <dd className="break-all text-right font-mono text-xs">{viewRow.id}</dd>

              <dt className="text-muted-foreground">Demand</dt>
              <dd className="text-right font-mono font-medium">{viewRow.demandNumber}</dd>

              <dt className="text-muted-foreground">Amount</dt>
              <dd className="text-right text-base font-semibold tabular-nums">{formatCurrency(viewRow.amount)}</dd>

              <dt className="text-muted-foreground">Status</dt>
              <dd className="text-right">
                <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', DISCOUNT_STATUS_STYLES[viewRow.status] ?? 'bg-muted')}>
                  {discountStatusLabel(viewRow.status)}
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

              <dt className="col-span-2 pt-1 text-muted-foreground">Reason</dt>
              <dd className="col-span-2 rounded-md bg-muted/40 p-2.5">{viewRow.reason || '—'}</dd>

              {/* Only once Production has written one. On a sent-back claim it is
                  the instruction the branch is acting on, so it is the last thing
                  read before the Correct button. */}
              {viewRow.reviewNote && (
                <>
                  <dt className="col-span-2 pt-1 text-muted-foreground">Production&apos;s note</dt>
                  <dd className="col-span-2 rounded-md bg-muted/40 p-2.5">{viewRow.reviewNote}</dd>
                </>
              )}
            </dl>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewRow(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Change ──────────────────────────────────────────────────────────
          A real draft edit, unlike Return Stock's: no money moved when the claim
          was raised, so there is no difference to settle and nothing to warn
          about — the new figure simply replaces the old one. What DOES need
          saying is that saving resends it, which the description does.

          The demand is deliberately not editable. Re-pointing a claim at another
          delivery is a different claim, not a correction of this one — the server
          ignores it for the same reason. Withdraw and raise it again. */}
      <Dialog open={!!editRow} onOpenChange={(o) => !o && !reviseMut.isPending && setEditRow(null)}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle>{editRow?.status === 'returned' ? 'Correct Discount' : 'Change Discount'}</DialogTitle>
            <DialogDescription>
              {editRow
                ? `${editRow.demandNumber} · ${
                    editRow.status === 'returned'
                      ? 'sent back by production — saving resubmits it'
                      : 'awaiting production review'
                  }`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {/* What Production asked for, repeated where the correction is being
                typed. It is on the View dialog too, but expecting someone to hold
                it in their head across two popups is how a claim bounces twice. */}
            {editRow?.status === 'returned' && editRow.reviewNote && (
              <p className="rounded-md bg-muted/60 p-2.5 text-xs">
                <span className="font-medium">Production: </span>
                {editRow.reviewNote}
              </p>
            )}

            <DiscountFormFields
              idPrefix="discount-edit"
              amount={editAmount}
              onAmountChange={setEditAmount}
              reason={editReason}
              onReasonChange={setEditReason}
              disabled={reviseMut.isPending}
            />

            <Separator />

            <DialogFooter>
              <Button variant="outline" onClick={() => setEditRow(null)} disabled={reviseMut.isPending}>
                Cancel
              </Button>
              <Button
                onClick={submitEdit}
                disabled={reviseMut.isPending || !inputValid || (!amountChanged && !reasonChanged)}
              >
                {reviseMut.isPending ? 'Saving…' : 'Save & Resend'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Delete ──────────────────────────────────────────────────────────
          A real delete, not a status. Nothing was booked when the claim was
          raised, so there is nothing to reverse and nothing left behind — which
          is exactly why it is confirmed: the record simply goes. */}
      <Dialog open={!!deleteRow} onOpenChange={(o) => !o && !withdrawMut.isPending && setDeleteRow(null)}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle>Withdraw this discount?</DialogTitle>
            <DialogDescription>
              {deleteRow
                ? `${formatCurrency(deleteRow.amount)} on ${deleteRow.demandNumber} comes off production's queue and is deleted. Nothing has been paid or booked against it, so nothing is reversed — but the request itself is gone and cannot be brought back.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteRow(null)} disabled={withdrawMut.isPending}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={submitDelete} disabled={withdrawMut.isPending}>
              {withdrawMut.isPending ? 'Withdrawing…' : 'Withdraw Discount'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
