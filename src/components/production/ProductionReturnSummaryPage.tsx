'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { format, parseISO } from 'date-fns';
import { createColumnHelper } from '@tanstack/react-table';
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, ClipboardList, Search, X } from 'lucide-react';
import {
  RETURN_REASONS,
  RETURN_REASON_LABELS,
  filterReturnMonthLines,
  shiftMonth,
  sumReturnMonthLines,
  type ReturnMonthItem,
  type ReturnMonthLine,
  type ReturnReason,
} from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useProductionReturnMonthSummary } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { SUMMARY_TONE, SummaryTile, longDate } from '@/components/shared/MonthlySummary';
import { SectionError } from '@/components/dashboard/branch-v2/parts';
import { formatCurrency } from '@/utils/currency';
import { ROUTES } from '@/utils/routes';
import { logger } from '@/utils/logger';
import { cn } from '@/lib/utils';

/**
 * Production → Product Returns → Return Summary.
 *
 * One business month of returns from every branch, in two views of the same
 * figures: a branch-wise table (one line per branch × item × reason) and an
 * item-wise box (an even grid of boxes, one per item, every branch added up;
 * tapping one lists its branches). Both come from one server aggregate —
 * GET /api/production-returns/month-summary — so the cards, the table and
 * the box can never disagree; see
 * `shared/utils/return-month-summary.ts` for which returns count (everything
 * but rejected) and how each is priced (at its own day's price).
 *
 * The month opens on the current business month, chosen by the server, and
 * rolls over by itself on the 1st. The arrows step back through past months;
 * forward stops at the current one.
 *
 * The search and the branch and reason filters narrow the branch-wise table
 * only. The item-wise box and the cards always show the whole month, so a
 * filter can never quietly change a company-wide total.
 */

const col = createColumnHelper<ReturnMonthLine>();
const ALL = 'all';
const qtyText = (n: number) => n.toLocaleString();
const shortBranch = (name: string) => name.replace('Mountain Bakes ', '');

const REASON_STYLES: Record<ReturnReason, string> = {
  expired: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  damaged: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  unsold: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400',
  other: 'bg-muted text-foreground',
  none: 'bg-muted text-muted-foreground',
};

function ReasonPill({ reason }: { reason: ReturnReason }) {
  return (
    <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', REASON_STYLES[reason])}>
      {RETURN_REASON_LABELS[reason]}
    </span>
  );
}

type ItemSort = 'name' | 'qtyDesc' | 'qtyAsc';
const ITEM_SORTS: { value: ItemSort; label: string; aria: string }[] = [
  { value: 'name', label: 'A–Z', aria: 'Sort by item name' },
  { value: 'qtyDesc', label: 'Qty ↓', aria: 'Sort by quantity, highest first' },
  { value: 'qtyAsc', label: 'Qty ↑', aria: 'Sort by quantity, lowest first' },
];

function ItemWiseBox({ items }: { items: ReturnMonthItem[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [sort, setSort] = useState<ItemSort>('name');
  const open = items.find((i) => i.productId === openId) ?? null;
  // The server sends items A–Z; equal quantities keep that order.
  const sorted = useMemo(
    () => (sort === 'name' ? items : [...items].sort((a, b) => (sort === 'qtyDesc' ? b.qty - a.qty : a.qty - b.qty))),
    [items, sort],
  );
  return (
    <section aria-labelledby="item-wise-heading" className="rounded-lg border bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-1 border-b px-4 py-3">
        <h3 id="item-wise-heading" className="text-sm font-semibold">All Branches — Item-Wise Total Returns</h3>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Tap an item for its branches</span>
          <div className="flex rounded-md border p-0.5" role="group" aria-label="Sort items">
            {ITEM_SORTS.map((s) => (
              <button
                key={s.value}
                type="button"
                aria-pressed={sort === s.value}
                aria-label={s.aria}
                onClick={() => setSort(s.value)}
                className={cn(
                  'h-8 rounded px-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-7',
                  sort === s.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2 p-4">
        {sorted.map((item) => (
          <li key={item.productId} className="flex">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={openId === item.productId}
              onClick={() => setOpenId(item.productId)}
              className="flex w-full flex-col items-center justify-between gap-1 rounded-lg border bg-background px-3 py-2 text-center transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="flex h-10 items-center">
                <span className="line-clamp-2 text-sm font-medium leading-snug">{item.productName}</span>
              </span>
              <span className="text-lg font-semibold tabular-nums">{qtyText(item.qty)}</span>
            </button>
          </li>
        ))}
      </ul>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="md:max-w-sm">
          <DialogHeader>
            <DialogTitle>{open?.productName}</DialogTitle>
          </DialogHeader>
          {open && (
            <div className="text-sm">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-b pb-2 text-xs font-medium text-muted-foreground">
                <span>Branch Name</span>
                <span className="text-right">Quantity</span>
              </div>
              <ul className="divide-y">
                {open.branches.map((b) => (
                  <li key={b.branchId} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 py-2">
                    <span className="truncate">{shortBranch(b.branchName)}</span>
                    <span className="text-right tabular-nums">{qtyText(b.qty)}</span>
                  </li>
                ))}
              </ul>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 border-t pt-2 font-semibold">
                <span>Total</span>
                <span className="text-right tabular-nums">{qtyText(open.qty)}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function ProductionReturnSummaryPage() {
  const { token } = useAuth();
  const router = useRouter();
  const [month, setMonth] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState<string | null>(null);
  const [reason, setReason] = useState<ReturnReason | null>(null);

  const q = useProductionReturnMonthSummary(token, month);
  const data = q.data;

  useEffect(() => {
    if (q.error) logger.error('Return summary request failed', q.error);
  }, [q.error]);

  const lines = useMemo(() => data?.lines ?? [], [data]);
  const branchOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const l of lines) seen.set(l.branchId, l.branchName);
    return [...seen].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [lines]);
  const reasonOptions = useMemo(() => RETURN_REASONS.filter((r) => lines.some((l) => l.reason === r)), [lines]);

  // A filter left over from another month that has no such branch or reason
  // simply stops applying, rather than leaving an empty table behind a label
  // that no longer names anything.
  const activeBranch = branchId && branchOptions.some((b) => b.id === branchId) ? branchId : null;
  const activeReason = reason && reasonOptions.includes(reason) ? reason : null;
  const filtering = !!search.trim() || !!activeBranch || !!activeReason;
  const shown = useMemo(
    () => filterReturnMonthLines(lines, { search, branchId: activeBranch, reason: activeReason }),
    [lines, search, activeBranch, activeReason],
  );
  const shownTotals = useMemo(() => sumReturnMonthLines(shown), [shown]);

  const clearFilters = () => {
    setSearch('');
    setBranchId(null);
    setReason(null);
  };

  const columns = [
    col.accessor('branchName', {
      header: 'Branch Name',
      meta: { mobile: 'subtitle' },
      cell: (i) => shortBranch(i.getValue()),
      footer: () => <span className="text-xs font-semibold uppercase tracking-wide">Total{filtering ? ' (filtered)' : ''}</span>,
    }),
    col.accessor('productName', { header: 'Item Name', meta: { mobile: 'title' }, cell: (i) => <span className="font-medium">{i.getValue()}</span> }),
    col.accessor('qty', {
      header: 'Quantity',
      meta: { align: 'right' },
      cell: (i) => <span className="tabular-nums">{qtyText(i.getValue())}</span>,
      footer: () => <span className="font-semibold tabular-nums">{qtyText(shownTotals.qty)}</span>,
    }),
    col.accessor('amount', {
      header: 'Total Amount',
      meta: { align: 'right' },
      cell: ({ row }) => (
        <span className="tabular-nums">
          {formatCurrency(row.original.amount)}
          {row.original.unpricedCount > 0 ? <span className="text-amber-700 dark:text-amber-400" title="Includes a return with no price on record"> *</span> : null}
        </span>
      ),
      footer: () => <span className="font-semibold tabular-nums">{formatCurrency(shownTotals.amount)}</span>,
    }),
    col.accessor('reasonLabel', {
      id: 'reason',
      header: 'Reason',
      meta: { mobile: 'badge' },
      sortingFn: (a, b) => RETURN_REASONS.indexOf(a.original.reason) - RETURN_REASONS.indexOf(b.original.reason),
      cell: ({ row }) => <ReasonPill reason={row.original.reason} />,
    }),
  ];

  const monthLabel = data ? format(parseISO(data.from), 'MMMM yyyy') : '';
  const atCurrent = !!data && data.month >= data.currentMonth;
  const t = data?.totals;

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Button variant="ghost" size="sm" className="-ml-2 h-11 md:h-8" onClick={() => router.push(ROUTES.PRODUCTION_RETURNS)}>
          <ArrowLeft className="mr-1.5 h-4 w-4" /> Product Returns
        </Button>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold">Production Return Summary</h2>
            <p className="text-sm text-muted-foreground">
              {data ? `${longDate(data.from)} – ${longDate(data.to)} · business days · every branch` : 'Every branch, one month at a time'}
            </p>
          </div>
          <div className="flex items-center gap-1 self-start sm:self-auto" role="group" aria-label="Reporting month">
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              aria-label="Previous month"
              disabled={!data}
              onClick={() => data && setMonth(shiftMonth(data.month, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-36 text-center text-sm font-semibold" aria-live="polite">
              {monthLabel || <Skeleton className="mx-auto h-4 w-28" />}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9"
              aria-label="Next month"
              disabled={!data || atCurrent}
              onClick={() => data && setMonth(shiftMonth(data.month, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
            {data && !atCurrent && (
              <Button variant="ghost" size="sm" className="h-9" onClick={() => setMonth(null)}>
                This month
              </Button>
            )}
          </div>
        </div>
      </div>

      {q.isError && !data ? (
        <SectionError what="the return summary" onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : (
        <div className={cn('space-y-6 transition-opacity', q.isFetching && data && 'opacity-70')}>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {!t
                ? Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-[86px] rounded-lg" />)
                : [
                    { label: 'Total Returned Quantity', value: qtyText(t.qty), sub: `${qtyText(t.count)} return records` },
                    { label: 'Total Return Amount', value: formatCurrency(t.amount), sub: 'at each day’s price' },
                    { label: 'Branches with Returns', value: qtyText(t.branchCount), sub: 'this month' },
                    { label: 'Unique Items Returned', value: qtyText(t.itemCount), sub: 'this month' },
                  ].map((tile) => <SummaryTile key={tile.label} {...tile} tone={SUMMARY_TONE.neutral} />)}
            </div>
            <p className="text-xs text-muted-foreground">Approved, awaiting review and sent-back returns · rejected returns excluded</p>
            {t && t.unpricedCount > 0 ? (
              <p role="status" className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                <AlertTriangle className="size-4 shrink-0" />
                {t.unpricedCount} {t.unpricedCount === 1 ? 'return has' : 'returns have'} no price on record (marked *), so the amounts leave{' '}
                {t.unpricedCount === 1 ? 'it' : 'them'} out. Their quantities are still counted.
              </p>
            ) : null}
          </div>

          {!data ? (
            <Skeleton className="h-64 rounded-lg" />
          ) : lines.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title={`No returns in ${monthLabel}`}
              description={atCurrent ? 'Returns branches send back this month will be summarised here.' : 'No branch returned anything this month.'}
            />
          ) : (
            <>
              <ItemWiseBox items={data.items} />

              <section aria-labelledby="branch-wise-heading" className="space-y-3">
                <h3 id="branch-wise-heading" className="text-sm font-semibold">Branch-Wise Return Summary</h3>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <div className="relative sm:w-64">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search item…"
                      aria-label="Search item name"
                      className="h-10 pl-8 sm:h-9"
                    />
                  </div>
                  <Select
                    items={[{ value: ALL, label: 'All branches' }, ...branchOptions.map((b) => ({ value: b.id, label: shortBranch(b.name) }))]}
                    value={activeBranch ?? ALL}
                    onValueChange={(v) => setBranchId(v === ALL ? null : (v as string))}
                  >
                    <SelectTrigger className="h-10 w-full sm:h-9 sm:w-52" aria-label="Filter by branch"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All branches</SelectItem>
                      {branchOptions.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{shortBranch(b.name)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    items={[{ value: ALL, label: 'All reasons' }, ...reasonOptions.map((r) => ({ value: r, label: RETURN_REASON_LABELS[r] }))]}
                    value={activeReason ?? ALL}
                    onValueChange={(v) => setReason(v === ALL ? null : (v as ReturnReason))}
                  >
                    <SelectTrigger className="h-10 w-full sm:h-9 sm:w-44" aria-label="Filter by reason"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All reasons</SelectItem>
                      {reasonOptions.map((r) => (
                        <SelectItem key={r} value={r}>{RETURN_REASON_LABELS[r]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {filtering && (
                    <Button variant="ghost" size="sm" className="h-10 self-start sm:h-9" onClick={clearFilters}>
                      <X className="mr-1 h-4 w-4" /> Clear filters
                    </Button>
                  )}
                </div>

                <DataTable
                  columns={columns}
                  data={shown}
                  toolbar={false}
                  sortable
                  pageSize={50}
                  empty={
                    <EmptyState
                      title="No lines match these filters"
                      description="Try another item name, branch or reason."
                      action={<Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button>}
                    />
                  }
                />
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
