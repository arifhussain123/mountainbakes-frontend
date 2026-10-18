'use client';

import { useEffect } from 'react';
import type { CashTransferBucket, MonthlyCashTransferSummary as Summary } from '@mb/shared';
import { SectionError } from '@/components/dashboard/branch-v2/parts';
import {
  MonthToDateLine,
  MonthlySummaryHeader,
  SUMMARY_TONE,
  SummaryTile,
  SummaryTileSkeleton,
  longDate,
} from '@/components/shared/MonthlySummary';
import { formatCurrency } from '@/utils/currency';
import { logger } from '@/utils/logger';
import { cn } from '@/lib/utils';

/**
 * The month-to-date Cash Transfer summary above Branch → Cash Transfer Details'
 * table — the same block as the Return Stock page's monthly returns summary,
 * built from the same parts.
 *
 * Lays out the server's figures (GET /api/cash-transfers/monthly-summary) and
 * computes none of its own — see `shared/utils/cash-transfer-summary.ts`. It
 * always covers this branch's business month to date and never follows the
 * table's filters or search, which only change the list below.
 *
 * The first row is the money handed over (Total Amount, split by channel); the
 * second splits that same Total Amount by Finance's decision and adds Fuel
 * Charges, which Finance books as income on its own and is never part of Total
 * Amount. A failure here leaves the table working: it only replaces this block.
 */

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const transfers = (b: CashTransferBucket) => plural(b.count, 'transfer', 'transfers');

export function MonthlyCashTransferSummary({
  summary,
  isLoading,
  isError,
  isFetching,
  error,
  onRetry,
}: {
  summary: Summary | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  useEffect(() => {
    if (error) logger.error('Monthly cash transfer summary request failed', error);
  }, [error]);

  if (isError && !summary) {
    return <SectionError what="the monthly transfers summary" onRetry={onRetry} retrying={isFetching} />;
  }

  const t = summary?.totals;
  const tiles = t
    ? [
        { label: 'Total Transferred', value: formatCurrency(t.transferred.amount), sub: `${transfers(t.transferred)} · every status`, tone: SUMMARY_TONE.neutral },
        { label: 'Cash', value: formatCurrency(t.cash.amount), sub: transfers(t.cash), tone: SUMMARY_TONE.neutral },
        { label: 'Easypaisa', value: formatCurrency(t.easypaisa.amount), sub: transfers(t.easypaisa), tone: SUMMARY_TONE.neutral },
        { label: 'Bank', value: formatCurrency(t.bank.amount), sub: transfers(t.bank), tone: SUMMARY_TONE.neutral },
        { label: 'Approved', value: formatCurrency(t.approved.amount), sub: transfers(t.approved), tone: SUMMARY_TONE.positive },
        { label: 'Awaiting Finance', value: formatCurrency(t.pending.amount), sub: transfers(t.pending), tone: SUMMARY_TONE.warning },
        { label: 'Rejected', value: formatCurrency(t.rejected.amount), sub: transfers(t.rejected), tone: SUMMARY_TONE.negative },
        { label: 'Fuel Charges', value: formatCurrency(t.fuel.amount), sub: `across ${transfers(t.fuel)}`, tone: SUMMARY_TONE.neutral },
      ]
    : [];

  return (
    <section aria-label="Monthly transfers summary" className={cn('space-y-3 transition-opacity', isFetching && summary && 'opacity-70')}>
      <MonthlySummaryHeader
        title={summary ? `Monthly Transfers: ${longDate(summary.from)} – ${longDate(summary.to)}` : 'Monthly Transfers'}
        subtitle={summary ? <MonthToDateLine from={summary.from} /> : null}
        note="Approved transfers are confirmed by Finance"
      />

      {/* Four across on a desktop, two on a tablet, one on a phone. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {isLoading || !t
          ? Array.from({ length: 8 }, (_, i) => <SummaryTileSkeleton key={i} />)
          : tiles.map((tile) => <SummaryTile key={tile.label} {...tile} />)}
      </div>
    </section>
  );
}
