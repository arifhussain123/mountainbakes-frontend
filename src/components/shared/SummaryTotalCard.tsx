import type { ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * A full-width total: a muted label on the left, the amount large and bold in
 * the primary colour on the right. First drawn for Shop Expenses' period total;
 * Branch → Discounts' monthly summary is the same card.
 *
 * `layout="stack"` (the default) drops the amount under the label on a phone,
 * left-aligned, so a long label never squeezes it. `layout="inline"` keeps one
 * row at every width — Shop Expenses, exactly as it looked before it moved here.
 *
 * The skeleton draws the same lines at the same heights as the loaded card, so
 * nothing below it moves when the figures arrive. An error stays inside the
 * card, with its own retry, instead of replacing it.
 */

/** `Rs. 12,200`: the settings' currency symbol written straight before the number, as Shop Expenses has always shown it. */
export function formatSummaryAmount(amount: number, currencySymbol?: string | null): string {
  return `${currencySymbol || 'Rs.'}${amount.toLocaleString()}`;
}

export function SummaryTotalCard({
  label,
  amount,
  secondaryText,
  loading = false,
  error = null,
  busy,
  layout = 'stack',
  className,
  'data-testid': testId,
}: {
  label: ReactNode;
  amount: ReactNode;
  /** A small muted line under the label. Pass it while loading too, so the skeleton keeps its row. */
  secondaryText?: ReactNode;
  loading?: boolean;
  error?: { message?: ReactNode; onRetry: () => void; retrying?: boolean } | null;
  /** A refetch is running behind figures already on screen. */
  busy?: boolean;
  layout?: 'stack' | 'inline';
  className?: string;
  'data-testid'?: string;
}) {
  const hasSecondary = secondaryText != null;
  const row =
    layout === 'inline'
      ? 'flex items-center justify-between p-4'
      : 'flex flex-col items-start gap-1 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4';

  if (loading) {
    return (
      <Card className={className} aria-busy="true" data-testid={testId && `${testId}-skeleton`}>
        <CardContent className={row}>
          <div className="min-w-0">
            <Skeleton className="h-5 w-48 max-w-full" />
            {hasSecondary ? <Skeleton className="mt-0.5 h-4 w-28" /> : null}
          </div>
          <Skeleton className="h-7 w-28" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className} data-testid={testId}>
      <CardContent className={row}>
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          {error ? (
            <p role="alert" className="mt-0.5 text-xs text-destructive">
              {error.message ?? 'Could not load this total.'}{' '}
              <button
                type="button"
                className="font-medium underline underline-offset-2 hover:no-underline disabled:opacity-60"
                onClick={error.onRetry}
                disabled={error.retrying}
              >
                {error.retrying ? 'Retrying…' : 'Retry'}
              </button>
            </p>
          ) : hasSecondary ? (
            <div className="mt-0.5 text-xs text-muted-foreground">{secondaryText}</div>
          ) : null}
        </div>
        <p className="text-xl font-bold text-primary" aria-busy={busy}>
          {error ? '—' : amount}
        </p>
      </CardContent>
    </Card>
  );
}
