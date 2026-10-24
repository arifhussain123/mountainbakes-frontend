'use client';

import { useEffect } from 'react';
import { format, parseISO } from 'date-fns';
import { Loader2, RefreshCw } from 'lucide-react';
import { businessMonthStartStr, type DiscountSummaryTotals, type MonthlyDiscountSummary as Summary } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { SectionError } from '@/components/dashboard/branch-v2/parts';
import { SummaryTotalCard, formatSummaryAmount } from '@/components/shared/SummaryTotalCard';
import { formatCurrency } from '@/utils/currency';
import { logger } from '@/utils/logger';
import { cn } from '@/lib/utils';

/**
 * The month-to-date Branch Discount summary, above the claims table on both
 * Production → Discounts (one card per active branch) and Branch → Discounts
 * (the branch's own card).
 *
 * Lays out the server's figures (GET /api/production-discounts/summary and
 * /api/branch-discounts/summary) and computes none of its own — see
 * `shared/utils/discount-summary.ts`. A card's Total Discount is the APPROVED
 * amount, the one netted off the branch's collection; what is still awaiting
 * review is a separate line under it, never added in.
 *
 * The period line is the server's window, so it always names the month the
 * figures actually cover. A branch with nothing this month — no approved
 * discount and nothing awaiting review — gets no card, unless it is the branch
 * the page is filtered to. On a phone the cards are one row that scrolls
 * sideways rather than squeezing a card until its name or amount is cut off;
 * from tablet width they form a grid — one row when the screen is wide enough —
 * so every branch is in view at once.
 *
 * Branch → Discounts (no `showBranches`) is one branch, the user's own, so it
 * gets no branch card at all: one full-width total laid out like Shop Expenses'
 * (`SummaryTotalCard`), with the period under the heading as Shop Expenses has
 * it. Only Branch roles reach that page, so the branch never needs naming.
 */

const longDate = (d: string) => format(parseISO(d), 'd MMMM yyyy');
const claims = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'claim' : 'claims'}`;
const approvedClaims = (n: number) => (n === 0 ? 'No approved claims yet' : `${claims(n)} approved`);

/** A failed refresh keeps the last figures on screen, but says they are not current. */
function StaleNotice({ updatedAt, onRetry, isFetching }: { updatedAt?: number; onRetry: () => void; isFetching: boolean }) {
  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
      <span>
        Could not refresh — showing the figures loaded
        {updatedAt ? ` at ${format(updatedAt, 'h:mm a, d MMM')}` : ' earlier'}. They may be out of date.
      </span>
      <Button size="sm" variant="outline" onClick={onRetry} disabled={isFetching}>
        {isFetching ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
        Retry
      </Button>
    </div>
  );
}

/** Branch → Discounts: the branch's own month-to-date total, one full-width card. */
function OwnBranchSummary({
  summary,
  isLoading,
  isError,
  isFetching,
  onRetry,
  updatedAt,
  currencySymbol,
}: {
  summary: Summary | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  onRetry: () => void;
  updatedAt?: number;
  currencySymbol?: string | null;
}) {
  // The server scopes a branch role to its own branch, so the totals ARE that branch.
  const totals = summary?.totals;
  const stale = isError && !!summary;
  const failed = isError && !summary;
  const amount = (n: number) => formatSummaryAmount(n, currencySymbol);

  return (
    <section aria-label="Monthly discount summary" aria-busy={isFetching || undefined} className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Monthly Discount Summary</h3>
        <p className="text-sm text-muted-foreground">
          {summary ? `Period: ${longDate(summary.from)} – ${longDate(summary.to)}` : 'This month'} · approved claims
          {isFetching && summary ? <Loader2 aria-label="Refreshing" className="ml-1.5 inline size-3 animate-spin align-[-2px]" /> : null}
        </p>
      </div>

      {stale ? <StaleNotice updatedAt={updatedAt} onRetry={onRetry} isFetching={isFetching} /> : null}

      <SummaryTotalCard
        data-testid="discount-summary-card"
        className={cn(stale && 'opacity-60')}
        label={`Total discount (since ${summary?.from ?? businessMonthStartStr()})`}
        amount={totals ? amount(totals.approved.amount) : null}
        secondaryText={
          totals ? (
            <>
              <p>{approvedClaims(totals.approved.count)}</p>
              {totals.pending.count > 0 ? (
                <p className="mt-0.5 text-amber-700 dark:text-amber-400">
                  {amount(totals.pending.amount)} awaiting review · {claims(totals.pending.count)}
                </p>
              ) : null}
            </>
          ) : (
            // Keeps the skeleton's second line, the height the loaded card has.
            ''
          )
        }
        loading={!failed && (isLoading || !summary)}
        error={failed ? { message: 'Could not load the discount summary.', onRetry, retrying: isFetching } : null}
      />
    </section>
  );
}

function BranchBox({
  name,
  totals,
  highlight = false,
  aggregate = false,
}: {
  name: string;
  totals: DiscountSummaryTotals;
  /** The branch the page is narrowed to. */
  highlight?: boolean;
  /** The All Branches card. */
  aggregate?: boolean;
}) {
  return (
    <div
      data-testid="discount-summary-card"
      aria-current={highlight || undefined}
      className={cn(
        'flex min-w-[11rem] flex-1 basis-0 flex-col overflow-hidden rounded-lg border bg-card md:min-w-0',
        highlight && 'border-primary ring-1 ring-primary',
        aggregate && 'border-primary/40',
      )}
    >
      <div className={cn('border-b px-3 py-2', highlight || aggregate ? 'bg-primary/10' : 'bg-muted/40')}>
        <p className="text-sm font-semibold leading-snug break-words">{name}</p>
      </div>
      <div className="flex flex-1 flex-col px-3 py-3">
        <p className="text-xs font-medium text-muted-foreground">Total Discount</p>
        <p className="mt-0.5 whitespace-nowrap text-lg font-bold tabular-nums">{formatCurrency(totals.approved.amount)}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{claims(totals.approved.count)} approved</p>
        {totals.pending.count > 0 ? (
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            {formatCurrency(totals.pending.amount)} awaiting review · {claims(totals.pending.count)}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function MonthlyDiscountSummary({
  summary,
  isLoading,
  isError,
  isFetching,
  error,
  onRetry,
  updatedAt,
  showBranches = false,
  highlightBranchId = null,
  currencySymbol,
}: {
  summary: Summary | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  /** When `summary` was fetched (React Query's `dataUpdatedAt`) — named if a refresh fails. */
  updatedAt?: number;
  /** Production / super admin: one card per branch, plus All Branches when there is more than one. */
  showBranches?: boolean;
  /** Marks one branch's card (the branch the page is filtered to) without hiding the others. */
  highlightBranchId?: string | null;
  /** Settings' currency symbol, for the branch view's total (formatted as Shop Expenses formats its own). */
  currencySymbol?: string | null;
}) {
  useEffect(() => {
    if (error) logger.error('Monthly discount summary request failed', error);
  }, [error]);

  if (!showBranches) {
    return (
      <OwnBranchSummary
        summary={summary}
        isLoading={isLoading}
        isError={isError}
        isFetching={isFetching}
        onRetry={onRetry}
        updatedAt={updatedAt}
        currencySymbol={currencySymbol}
      />
    );
  }

  if (isError && !summary) {
    return <SectionError what="the monthly discount summary" onRetry={onRetry} retrying={isFetching} />;
  }

  // Rs. 0 branches add nothing to read; a branch with only claims awaiting
  // review still shows, so that line is not lost.
  const branches = (summary?.branches ?? []).filter(
    (b) => b.approved.amount !== 0 || b.pending.count > 0 || b.branchId === highlightBranchId,
  );
  // A failed refresh keeps the last figures on screen, but says they are not current.
  const stale = isError && !!summary;

  return (
    <section aria-label="Monthly discount summary" aria-busy={isFetching || undefined} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Monthly Discount Summary</h3>
        <p className="text-xs text-muted-foreground">
          {summary ? `Period: ${longDate(summary.from)} – ${longDate(summary.to)}` : 'This month'} · approved claims
          {isFetching && summary ? <Loader2 aria-label="Refreshing" className="ml-1.5 inline size-3 animate-spin align-[-2px]" /> : null}
        </p>
      </div>

      {stale ? <StaleNotice updatedAt={updatedAt} onRetry={onRetry} isFetching={isFetching} /> : null}

      {/* Phone: one row that scrolls sideways — `contain: inline-size` keeps its
          width from pushing the page wider. Tablet up: a grid, a single row
          when the screen is wide enough, so no branch sits off-screen. */}
      <div
        className={cn(
          '-mx-1 flex gap-3 overflow-x-auto px-1 pb-1 [contain:inline-size]',
          'md:mx-0 md:grid md:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] md:overflow-visible md:px-0 md:pb-0 md:[contain:none]',
          stale && 'opacity-60',
        )}
      >
        {isLoading || !summary ? (
          Array.from({ length: showBranches ? 4 : 1 }, (_, i) => (
            <Skeleton key={i} data-testid="discount-summary-skeleton" className="h-[118px] min-w-[11rem] flex-1 basis-0 rounded-lg md:min-w-0" />
          ))
        ) : branches.length === 0 ? (
          <p className="w-full rounded-lg border bg-card py-6 text-center text-sm text-muted-foreground md:col-span-full">
            {summary.branches.length === 0 ? 'No active branches.' : 'No branch discounts this month.'}
          </p>
        ) : (
          <>
            {branches.map((b) => (
              <BranchBox
                key={b.branchId}
                name={b.branchName.replace('Mountain Bakes ', '')}
                totals={b}
                highlight={b.branchId === highlightBranchId}
              />
            ))}
            {showBranches && branches.length > 1 ? <BranchBox name="All Branches" totals={summary.totals} aggregate /> : null}
          </>
        )}
      </div>
    </section>
  );
}
