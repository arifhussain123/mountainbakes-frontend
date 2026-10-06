'use client';

import { Loader2, RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Branch Dashboard v2 — the shapes the design repeats.
 *
 * Colours are the Finance Dashboard's `fin-*` tokens (globals.css), which are
 * the design's indigo / brown / ink palette already carried in light and dark.
 * No hex lives in this folder.
 */

export type BandTone = 'income' | 'expense' | 'ink';

const BAND: Record<BandTone, string> = {
  income: 'bg-fin-income text-white',
  expense: 'bg-fin-expense text-white',
  ink: 'bg-fin-ink text-fin-ink-foreground',
};

/** A card under a solid coloured title band — the summary trio. */
export function BandCard({
  title,
  tone,
  children,
  className,
}: {
  title: string;
  tone: BandTone;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('min-w-0 overflow-hidden rounded-md border bg-card', className)}>
      <h3 className={cn('px-3 py-[7px] text-[11px] font-extrabold tracking-[0.08em] uppercase', BAND[tone])}>
        {title}
      </h3>
      <div className="px-3 pt-1 pb-2">{children}</div>
    </section>
  );
}

/** One line of a `BandCard`: a label with its qualifier, and the figure. */
export function StatRow({
  label,
  note,
  value,
  valueClassName,
  loading,
  last,
}: {
  label: string;
  note?: React.ReactNode;
  value: React.ReactNode;
  valueClassName?: string;
  loading?: boolean;
  last?: boolean;
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3 py-2', !last && 'border-b border-border/60')}>
      <div className="min-w-0">
        <div className="text-xs font-bold">{label}</div>
        {loading ? (
          <Skeleton className="mt-1 h-3 w-28" />
        ) : (
          note && <div className="text-[11px] text-muted-foreground">{note}</div>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-5 w-20 shrink-0" />
      ) : (
        <span className={cn('shrink-0 text-[15px] font-extrabold tabular-nums', valueClassName)}>{value}</span>
      )}
    </div>
  );
}

/** The full-width coloured strip that opens the Sales and Stock halves. */
export function SectionBanner({
  title,
  tone,
  children,
}: {
  title: string;
  tone: Exclude<BandTone, 'ink'>;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 rounded-md px-3.5 py-[9px]', BAND[tone])}>
      <h3 className="text-xs font-extrabold tracking-[0.08em] uppercase">{title}</h3>
      {children}
    </div>
  );
}

/** A white card under a tinted title strip — lavender on the sales side, warm on the stock side. */
export function Panel({
  title,
  tone = 'soft',
  aside,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  tone?: 'soft' | 'warm';
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn('min-w-0 overflow-hidden rounded-md border bg-card', className)}>
      <header
        className={cn(
          'flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-3.5 py-[9px]',
          tone === 'soft' ? 'bg-fin-soft' : 'bg-fin-peach/40',
        )}
      >
        <h3 className="text-[11px] font-extrabold tracking-[0.06em] uppercase">{title}</h3>
        {aside}
      </header>
      <div className={cn('p-3.5', bodyClassName)}>{children}</div>
    </section>
  );
}

/** A small square colour key. `className` carries the background token. */
export function Swatch({ className }: { className: string }) {
  return <span aria-hidden className={cn('inline-block size-[7px] shrink-0', className)} />;
}

/** A single figure with a keyed label above and a qualifier below. */
export function Tile({
  label,
  value,
  note,
  swatch,
  inverted,
  loading,
}: {
  label: string;
  value: React.ReactNode;
  note?: React.ReactNode;
  swatch: string;
  /** The one emphasised tile of a group — dark ink, light type. */
  inverted?: boolean;
  loading?: boolean;
}) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-md border px-3 py-2.5',
        inverted ? 'bg-fin-ink text-fin-ink-foreground' : 'bg-card',
      )}
    >
      <div
        className={cn(
          'flex items-center gap-1.5 text-[10px] font-bold tracking-[0.06em] uppercase',
          !inverted && 'text-muted-foreground',
        )}
      >
        <Swatch className={swatch} />
        {label}
      </div>
      {loading ? (
        <>
          <Skeleton className="mt-2 h-6 w-24" />
          <Skeleton className="mt-1.5 h-3 w-20" />
        </>
      ) : (
        <>
          <div className="mt-1.5 truncate text-[19px] leading-tight font-extrabold tracking-[-0.01em] tabular-nums">
            {value}
          </div>
          {note && (
            <div className={cn('mt-0.5 text-[11px]', inverted ? 'text-fin-ink-muted' : 'text-muted-foreground')}>
              {note}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * A section that could not load.
 *
 * One sentence and a Retry. The technical detail goes to the logger at the call
 * site — a Postgres or PostgREST message on a shop-floor screen is noise at best.
 */
export function SectionError({
  what,
  onRetry,
  retrying,
}: {
  what: string;
  onRetry: () => void;
  retrying: boolean;
}) {
  return (
    <div role="alert" className="rounded-md border bg-card px-4 py-8 text-center">
      <p className="text-sm font-semibold">Unable to load {what}</p>
      <p className="mt-1 text-sm text-muted-foreground">Please try again.</p>
      <Button className="mt-4" variant="outline" onClick={onRetry} disabled={retrying}>
        {retrying ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        Retry
      </Button>
    </div>
  );
}

/** Quiet line for a panel with nothing to draw. */
export function PanelEmpty({ children }: { children: React.ReactNode }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>;
}
