'use client';

import {
  DAILY_SALE_STATUS_LABELS,
  DIFFERENCE_STATUS_LABELS,
  differenceStatus,
  type DailySaleRecordStatus,
} from '@mb/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { CheckCircle2, MinusCircle, TrendingDown, TrendingUp } from 'lucide-react';

/**
 * The small presentational pieces the Daily Sale Record surfaces share.
 *
 * They live in one file because the table, the View popup and the print sheet all
 * state the same four things — a status, a difference, a money figure, a
 * label/value row — and three copies of "what colour is Short" is how a screen
 * and its own printout end up disagreeing.
 */

/**
 * Rs. 85,000 — rounded to whole rupees, grouped en-PK.
 *
 * Whole rupees, deliberately: every figure on these screens is a till total or a
 * counted note, the paisa column is always .00, and the extra two characters cost
 * a table this wide a column. The stored values keep their two decimal places —
 * this is display only, and the View popup's difference rows are the one place
 * that shows a non-integer, because a 50-paisa discrepancy is exactly the thing
 * somebody is hunting for.
 */
export function money(n: number, symbol = 'Rs.'): string {
  return `${symbol} ${Math.round(n).toLocaleString('en-PK')}`;
}

/** The same, keeping the paisa. For differences, where a rounding would hide the point. */
export function exactMoney(n: number, symbol = 'Rs.'): string {
  return `${symbol} ${n.toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** An em dash for an absent figure, so "not counted" never renders as a confident 0. */
export function orDash(n: number | null | undefined, format: (v: number) => string): string {
  return n === null || n === undefined ? '—' : format(n);
}

const STATUS_STYLES: Record<DailySaleRecordStatus, string> = {
  open: 'bg-muted text-muted-foreground',
  pending_verification: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  verified: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  locked: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  // Violet rather than red: an amendment is a legitimate, audited correction, not
  // a fault. It has to stand out from `locked` — which is the whole reason it is a
  // separate state — without reading as an alarm.
  amended: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
};

export function StatusBadge({ status }: { status: DailySaleRecordStatus }) {
  return (
    <Badge className={cn('border-0', STATUS_STYLES[status])}>
      {DAILY_SALE_STATUS_LABELS[status]}
    </Badge>
  );
}

const DIFF_STYLES = {
  uncounted: 'bg-muted text-muted-foreground',
  matched: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  over: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  short: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
} as const;

const DIFF_ICONS = {
  uncounted: MinusCircle,
  matched: CheckCircle2,
  over: TrendingUp,
  short: TrendingDown,
} as const;

/**
 * A difference, with the word for what it means (§19).
 *
 * **Over is amber, not green.** A drawer with more money in it than the system
 * recorded is not good news — it usually means a sale that was never rung up —
 * and colouring it as success would train people to ignore exactly the case worth
 * asking about. Short is red, matched is green, and nothing is hidden: there is
 * no tolerance band, because a band wide enough to hide daily noise is wide
 * enough to hide a habit.
 */
export function DifferenceBadge({
  difference,
  symbol = 'Rs.',
  showAmount = true,
}: {
  difference: number | null | undefined;
  symbol?: string;
  showAmount?: boolean;
}) {
  const state = differenceStatus(difference);
  const Icon = DIFF_ICONS[state];

  return (
    <Badge className={cn('border-0 gap-1', DIFF_STYLES[state])}>
      <Icon />
      {showAmount && state !== 'uncounted'
        // The sign is carried explicitly. A bare "500" beside the word "Short"
        // makes the reader work out the direction from the label; "-500" says it.
        ? `${difference! > 0 ? '+' : ''}${exactMoney(difference!, symbol)}`
        : DIFFERENCE_STATUS_LABELS[state]}
    </Badge>
  );
}

/** One label/value line. The View popup and the print sheet are built out of these. */
export function Row({
  label,
  value,
  strong,
  muted,
  className,
}: {
  label: string;
  value: React.ReactNode;
  strong?: boolean;
  muted?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-4 py-1', className)}>
      <span className={cn('text-sm', muted ? 'text-muted-foreground' : '')}>{label}</span>
      <span className={cn('text-sm tabular-nums', strong && 'font-semibold')}>{value}</span>
    </div>
  );
}

/** A titled block inside the View popup / print sheet. */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="avoid-break space-y-1">
      <p className="border-b pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  );
}
