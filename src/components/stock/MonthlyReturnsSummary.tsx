'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import type {
  MonthlyReturnsSummary as Summary,
  ProductionReturnStatus,
  ReturnsBucket,
  ReturnsSummaryTotals,
} from '@mb/shared';
import { buildBranchReturnBoxes, emptyReturnsTotals } from '@mb/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { FilteredRangeLine, MonthToDateLine, MonthlySummaryHeader, SUMMARY_TONE, SummaryTile, longDate } from '@/components/shared/MonthlySummary';
import { SectionError } from '@/components/dashboard/branch-v2/parts';
import { CURRENCY_LOCALE, CURRENCY_SYMBOL, formatCurrency } from '@/utils/currency';
import { logger } from '@/utils/logger';
import { cn } from '@/lib/utils';

/**
 * The month-to-date Product Returns summary, above the returns table on both
 * Production → Product Returns and the branch's Return Stock page.
 *
 * Lays out the server's figures (GET /api/production-returns/summary and
 * /api/stock/returns/summary) and computes none of its own — see
 * `shared/utils/returns-summary.ts` for what each one means and how a return is
 * priced. The headline cards count every return raised this month, whatever
 * its status; the status cards beside them split that same total, so an
 * unreviewed or refused request is never read as an approved one.
 *
 * On Production the cards are followed by one box per active branch — its
 * monthly return amount under `branchReturnAmount` (approved, awaiting review
 * and sent back; rejected excluded) — and, under it, how much of that is still
 * awaiting review and in how many claims. Branches whose amount is zero get no
 * box; picking one narrows the cards above (and the table below) to it.
 *
 * The window is the server's, so the date line is too — it always names the
 * month the figures actually cover, never one computed here.
 *
 * The header and the tiles are the shared month-summary parts
 * (components/shared/MonthlySummary.tsx), which Branch → Cash Transfer Details
 * uses as well.
 */

const TONE: Record<ProductionReturnStatus | 'submitted', string> = {
  submitted: SUMMARY_TONE.neutral,
  accepted: SUMMARY_TONE.positive,
  pending: SUMMARY_TONE.warning,
  rejected: SUMMARY_TONE.negative,
  returned: SUMMARY_TONE.info,
};

const STATUS_ORDER: ProductionReturnStatus[] = ['accepted', 'pending', 'rejected', 'returned'];
const EMPTY_BUCKET: ReturnsBucket = { qty: 0, amount: 0, count: 0 };

const qtyText = (n: number) => n.toLocaleString();
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const bucketLine = (b: ReturnsBucket) => `${plural(b.qty, 'item', 'items')} · ${plural(b.count, 'return', 'returns')}`;
/** Box amounts always carry the paisa: "Rs. 12,500.00", "Rs. 0.00". */
const boxAmount = (n: number) =>
  `${CURRENCY_SYMBOL} ${n.toLocaleString(CURRENCY_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function BranchBox({
  name,
  amount,
  awaiting,
  awaitingLabel,
  selected,
  onPick,
}: {
  name: string;
  amount: number;
  /** This branch's returns still awaiting review — part of `amount`, not final. */
  awaiting: ReturnsBucket;
  awaitingLabel: string;
  selected: boolean;
  onPick?: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="return-branch-box"
      aria-pressed={selected}
      title={selected ? 'Showing this branch only — click to show all' : 'Show only this branch'}
      onClick={onPick}
      className={cn(
        'flex min-h-[104px] min-w-0 flex-col justify-between gap-2.5 rounded-lg border bg-card px-4 py-3.5 text-left transition-colors hover:border-primary',
        selected && 'border-primary bg-primary/10 ring-2 ring-primary/25',
      )}
    >
      <span className="text-sm font-semibold leading-snug break-words">{name}</span>
      <span className="block space-y-1 border-t pt-2.5">
        <span
          data-testid="return-branch-amount"
          className={cn('block text-xl font-bold whitespace-nowrap tabular-nums', amount === 0 && 'text-muted-foreground')}
        >
          {boxAmount(amount)}
        </span>
        <span
          data-testid="return-branch-awaiting"
          className={cn(
            'block text-xs tabular-nums',
            awaiting.count > 0 ? 'font-medium text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
          )}
        >
          {awaiting.count > 0
            ? `${boxAmount(awaiting.amount)} ${awaitingLabel} · ${plural(awaiting.count, 'claim', 'claims')}`
            : `Nothing ${awaitingLabel}`}
        </span>
      </span>
    </button>
  );
}

export function MonthlyReturnsSummary({
  summary,
  isLoading,
  isError,
  isFetching,
  error,
  onRetry,
  statusLabels,
  showBranches = false,
  branches,
  selectedBranchId = null,
  onSelectBranch,
  filtered = false,
}: {
  summary: Summary | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  /** Each page already names the statuses its own way ("Awaiting Review" vs "Awaiting Production"). */
  statusLabels: Record<ProductionReturnStatus, string>;
  /** Production: Branches Reporting, and one return-amount box per active branch. */
  showBranches?: boolean;
  /** Branch records (with `isActive`) — the boxes are the active ones, matched by id. */
  branches?: { id: string; name: string; isActive?: boolean }[];
  /** The branch the page is filtered to: its box is marked and the cards show its figures. */
  selectedBranchId?: string | null;
  /** A box was clicked: its id, or null when the selected box is clicked again. */
  onSelectBranch?: (branchId: string | null) => void;
  /** The page's Date filter set the window: the cards cover those days, not this month. */
  filtered?: boolean;
}) {
  useEffect(() => {
    if (error) logger.error('Monthly returns summary request failed', error);
  }, [error]);

  if (isError && !summary) {
    return <SectionError what="the monthly returns summary" onRetry={onRetry} retrying={isFetching} />;
  }

  // The summary always covers every branch; a selected branch narrows the cards
  // to that branch's own figures without a second request.
  const selected = selectedBranchId && summary ? summary.branches.find((b) => b.branchId === selectedBranchId) : undefined;
  // A branch with no entry (e.g. an inactive one picked in the filter) has no returns: zeros, not a skeleton.
  const t: ReturnsSummaryTotals | undefined = summary && selectedBranchId ? (selected ?? emptyReturnsTotals()) : summary?.totals;
  const tiles = t && summary
    ? [
        { label: 'Total Returned Items', value: qtyText(t.submitted.qty), sub: filtered ? 'every status, in this range' : 'every status, this month', tone: TONE.submitted },
        { label: 'Total Return Amount', value: formatCurrency(t.submitted.amount), sub: 'at each day’s price', tone: TONE.submitted },
        { label: 'Return Transactions', value: qtyText(t.submitted.count), sub: 'one per product returned', tone: TONE.submitted },
        ...(showBranches
          ? [{ label: 'Branches Reporting', value: qtyText(summary.branchesReporting), sub: `of ${plural(summary.branches.length, 'branch', 'branches')}`, tone: TONE.submitted }]
          : []),
        ...STATUS_ORDER.map((s) => ({ label: statusLabels[s], value: formatCurrency(t[s].amount), sub: bucketLine(t[s]), tone: TONE[s] })),
      ]
    : [];
  const tileCount = showBranches ? 8 : 7;
  // A branch with nothing to show this month gets no box — unless it is the
  // selected one, which stays so it can be clicked again to clear the filter.
  const boxes = showBranches && summary && branches
    ? buildBranchReturnBoxes(summary, branches).filter((b) => b.amount !== 0 || b.branchId === selectedBranchId)
    : null;
  const ruleText = `Active branches · ${statusLabels.accepted.toLowerCase()}, ${statusLabels.pending.toLowerCase()} and ${statusLabels.returned.toLowerCase()} · ${statusLabels.rejected.toLowerCase()} excluded`;

  return (
    <section aria-label="Monthly returns summary" className={cn('space-y-3 transition-opacity', isFetching && summary && 'opacity-70')}>
      <MonthlySummaryHeader
        title={
          <>
            {filtered ? 'Returns' : 'Monthly Returns'}
            {summary ? `: ${longDate(summary.from)} – ${longDate(summary.to)}` : ''}
            {selected ? ` · ${selected.branchName.replace('Mountain Bakes ', '')}` : ''}
          </>
        }
        subtitle={summary ? (filtered ? <FilteredRangeLine /> : <MonthToDateLine from={summary.from} />) : null}
        note="Valued at each product's price on the return date"
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {isLoading || !t
          ? Array.from({ length: tileCount }, (_, i) => <Skeleton key={i} className="h-[86px] rounded-lg" />)
          : tiles.map((tile) => <SummaryTile key={tile.label} {...tile} />)}
      </div>

      {t && t.unpricedCount > 0 ? (
        <p role="status" className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          <AlertTriangle className="size-4 shrink-0" />
          {t.unpricedCount} {t.unpricedCount === 1 ? 'return has' : 'returns have'} no price on record, so the amounts {showBranches ? 'and branch boxes ' : ''}leave {t.unpricedCount === 1 ? 'it' : 'them'} out.
          Their quantities are still counted.
        </p>
      ) : null}

      {showBranches ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-1.5">
            <h3 className="text-sm font-semibold">Monthly Return Amount by Branch</h3>
            <span className="text-xs text-muted-foreground">{ruleText}</span>
          </div>
          {/* One row when the width allows; fewer columns on a tablet, two (or one) on a phone. */}
          <div className="grid auto-rows-fr grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-3">
            {!boxes ? (
              Array.from({ length: 4 }, (_, i) => <Skeleton key={i} data-testid="return-branch-skeleton" className="h-[104px] rounded-lg" />)
            ) : boxes.length === 0 ? (
              <p className="col-span-full rounded-lg border bg-card py-6 text-center text-sm text-muted-foreground">No branch return amounts this month.</p>
            ) : (
              boxes.map((b) => (
                <BranchBox
                  key={b.branchId}
                  name={b.branchName.replace('Mountain Bakes ', '')}
                  amount={b.amount}
                  awaiting={summary?.branches.find((e) => e.branchId === b.branchId)?.pending ?? EMPTY_BUCKET}
                  awaitingLabel={statusLabels.pending.toLowerCase()}
                  selected={b.branchId === selectedBranchId}
                  onPick={onSelectBranch ? () => onSelectBranch(b.branchId === selectedBranchId ? null : b.branchId) : undefined}
                />
              ))
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
