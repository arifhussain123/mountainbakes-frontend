'use client';

import { Component, type ReactNode } from 'react';
import { AlertTriangle, Info, RotateCw } from 'lucide-react';
import type { DashboardDelta } from '@mb/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Panel } from '../ProductionPanel';
import { fmt } from './format';

export const TONE = {
  good: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  warn: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  bad: 'bg-red-500/10 text-red-600 dark:text-red-400',
  accent: 'bg-primary/10 text-primary',
  muted: 'bg-muted text-muted-foreground',
} as const;

export function Badge({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return (
    <span className={cn('inline-block whitespace-nowrap rounded-full px-[9px] py-[3px] text-[11.5px] font-bold', TONE[tone])}>
      {children}
    </span>
  );
}

/**
 * Change against the same stretch of the previous period. `invert` for figures
 * where a rise is the bad direction (returns, rejected, open orders).
 */
export function Delta({ delta, versus, invert }: { delta: DashboardDelta | null | undefined; versus: string; invert?: boolean }) {
  if (!delta || !Number.isFinite(delta.value)) return null;
  const up = delta.value >= 0;
  const flat = delta.value === 0;
  return (
    <span
      className={cn('whitespace-nowrap rounded-full px-[7px] py-0.5 text-[11px] font-bold tabular-nums', flat ? TONE.muted : (invert ? !up : up) ? TONE.good : TONE.bad)}
      title={`Against ${versus}`}
    >
      {up && !flat ? '+' : ''}{delta.value.toFixed(1)}{delta.unit === 'pts' ? ' pts' : '%'}
    </span>
  );
}

/** What a figure means, on hover and to a screen reader. */
export function Definition({ text }: { text: string }) {
  return (
    <span className="inline-flex cursor-help text-muted-foreground/70 hover:text-muted-foreground" title={text} aria-label={text} role="img">
      <Info className="size-3.5" aria-hidden />
    </span>
  );
}

export function Kpi({
  name, value, note, delta, definition, loading, size = 'lg',
}: {
  name: string;
  value: string;
  note?: ReactNode;
  delta?: ReactNode;
  definition?: string;
  loading?: boolean;
  size?: 'lg' | 'sm';
}) {
  return (
    <div className={cn('flex min-w-0 flex-col rounded-[14px] border bg-card', size === 'lg' ? 'gap-2 px-[18px] py-4' : 'gap-1.5 bg-muted/30 px-3.5 py-3')}>
      <div className="flex items-center justify-between gap-2">
        <p className={cn('flex min-w-0 items-center gap-1 font-semibold text-muted-foreground', size === 'lg' ? 'text-[12.5px]' : 'text-[11.5px]')}>
          <span className="truncate">{name}</span>
          {definition && <Definition text={definition} />}
        </p>
        {!loading && delta}
      </div>
      {loading
        ? <Skeleton className={size === 'lg' ? 'h-7 w-20' : 'h-6 w-16'} />
        : (
          <p className={cn('truncate font-extrabold leading-none tabular-nums', size === 'lg' ? 'text-[28px] tracking-[-0.5px]' : 'text-[21px] tracking-[-0.3px]')} title={value}>
            {value}
          </p>
        )}
      {note && <p className="truncate text-[11.5px] text-muted-foreground">{note}</p>}
    </div>
  );
}

export function KpiRow({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">{children}</div>;
}

export function EmptyState({ children, height = 200 }: { children: ReactNode; height?: number }) {
  return (
    <div className="flex items-center justify-center rounded-xl border border-dashed text-center text-sm text-muted-foreground" style={{ minHeight: height }}>
      {children}
    </div>
  );
}

export function ErrorState({ message, onRetry, retrying }: { message: string; onRetry: () => void; retrying?: boolean }) {
  return (
    <div role="alert" className="flex min-h-[160px] flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-red-500/30 bg-red-500/5 px-4 text-center">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-red-700 dark:text-red-400">
        <AlertTriangle className="size-4" aria-hidden />
        This section could not be loaded
      </p>
      <p className="max-w-md text-xs text-muted-foreground">{message}</p>
      <RetryButton onRetry={onRetry} retrying={retrying} />
    </div>
  );
}

function RetryButton({ onRetry, retrying }: { onRetry: () => void; retrying?: boolean }) {
  return (
    <button
      type="button"
      onClick={onRetry}
      disabled={retrying}
      className="inline-flex items-center gap-1.5 rounded-[9px] border bg-card px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-muted disabled:opacity-60"
    >
      <RotateCw className={cn('size-3.5', retrying && 'animate-spin')} aria-hidden />
      Retry
    </button>
  );
}

/** The part of a TanStack query a section needs to draw its states. */
export interface SectionQuery {
  data: unknown;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  isFetching: boolean;
  isPlaceholderData: boolean;
  refetch: () => unknown;
}

const errorText = (e: unknown) => (e instanceof Error && e.message ? e.message : 'The server did not answer. Check the connection and try again.');

/**
 * One section of the dashboard: its own card, title, one-line subtitle, KPI row
 * and chart, and its own loading, empty and error states, so one that fails
 * leaves the others standing.
 */
export function SectionCard({
  id, title, subtitle, action, query, kpiCount, kpis, empty, emptyText, children, className,
}: {
  id: string;
  title: string;
  subtitle: string;
  action?: ReactNode;
  query: SectionQuery;
  /** How many tiles the loading skeleton shows. */
  kpiCount: number;
  kpis: () => ReactNode;
  empty: boolean;
  emptyText: string;
  children: () => ReactNode;
  className?: string;
}) {
  const { data, isLoading, isError, error, isFetching, isPlaceholderData, refetch } = query;
  return (
    <Panel title={title} subtitle={subtitle} action={action} className={cn('gap-4', className)}>
      <div id={id} className={cn('flex min-w-0 flex-col gap-4 transition-opacity', isPlaceholderData && 'opacity-60')} aria-busy={isFetching}>
        {isLoading ? (
          <>
            <KpiRow>{Array.from({ length: kpiCount }, (_, i) => <Kpi key={i} name=" " value="" loading size="sm" />)}</KpiRow>
            <Skeleton className="h-[240px] w-full" />
          </>
        ) : isError && !data ? (
          <ErrorState message={errorText(error)} onRetry={() => refetch()} retrying={isFetching} />
        ) : data ? (
          <>
            {isError && (
              <p role="status" className="flex flex-wrap items-center gap-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="size-3.5" aria-hidden /> Showing the last figures; the refresh failed.
                <RetryButton onRetry={() => refetch()} retrying={isFetching} />
              </p>
            )}
            {kpis()}
            {empty ? <EmptyState>{emptyText}</EmptyState> : children()}
          </>
        ) : null}
      </div>
    </Panel>
  );
}

/**
 * Keeps a section that throws while drawing from taking the page down with it.
 * The query layer handles failed requests; this is for everything after.
 */
export class SectionBoundary extends Component<{ title: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(err: unknown) {
    console.error(`[ProductionDashboard] ${this.props.title} failed to render`, err);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <Panel title={this.props.title}>
        <ErrorState message="Something went wrong drawing this section." onRetry={() => this.setState({ failed: false })} />
      </Panel>
    );
  }
}

/** A tiny line of one series, for a card. Flat and muted when there is nothing in it. */
export function Sparkline({ values, color, label, width = 96, height = 26 }: { values: number[]; color: string; label: string; width?: number; height?: number }) {
  const max = Math.max(...values, 0);
  const n = values.length;
  if (n === 0) return null;
  const pts = values.map((v, i) => {
    const x = n === 1 ? width / 2 : (i / (n - 1)) * (width - 4) + 2;
    const y = max > 0 ? height - 3 - (v / max) * (height - 6) : height - 3;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="shrink-0 overflow-visible">
      <polyline points={pts.join(' ')} fill="none" stroke={max > 0 ? color : 'var(--border)'} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {max > 0 && <circle cx={pts.at(-1)!.split(',')[0]} cy={pts.at(-1)!.split(',')[1]} r={2.5} fill={color} />}
    </svg>
  );
}

/**
 * Branch × product grid, darker where larger, in one colour. The same cell
 * style as the Branch × product demand grid further down the page.
 */
export function HeatGrid({
  products, rows, color, selectedId, label,
}: {
  products: { productId: string | null; productName: string }[];
  rows: { branchId: string; branchName: string; values: number[] }[];
  color: string;
  selectedId: string | null;
  label: string;
}) {
  const max = Math.max(...rows.flatMap((r) => r.values), 1);
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[480px] table-fixed border-separate border-spacing-1 text-xs" aria-label={label}>
        <thead>
          <tr>
            <th className="w-[130px]" />
            {products.map((p) => (
              <th key={p.productId ?? p.productName} scope="col" className="px-0.5 pb-1 text-center align-bottom text-[10.5px] font-bold leading-tight text-muted-foreground [text-wrap:balance]" title={p.productName}>
                {p.productName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.branchId} className={cn('transition-opacity', selectedId && selectedId !== r.branchId && 'opacity-30')}>
              <th scope="row" className="truncate pr-2 text-left font-semibold" title={r.branchName}>{r.branchName.replace('Mountain Bakes ', '')}</th>
              {r.values.map((v, i) => {
                // Eased, so the many small figures are still told apart beside one large one.
                const t = Math.pow(v / max, 0.55);
                const a = v > 0 ? 0.08 + 0.88 * t : 0;
                return (
                  <td
                    key={i}
                    className={cn('h-8 rounded-md text-center text-[11.5px] font-bold tabular-nums', v === 0 && 'bg-muted/50 text-muted-foreground', t > 0.55 && 'text-white')}
                    style={v > 0 ? { backgroundColor: `color-mix(in oklab, ${color} ${Math.round(a * 100)}%, transparent)` } : undefined}
                  >
                    {v > 0 ? fmt(v) : '–'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Colour key for a chart with more than one series. Text stays in text ink; the swatch carries the colour. */
export function Legend({ items }: { items: { label: string; color: string; line?: boolean }[] }) {
  if (items.length < 2) return null;
  return (
    <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs font-semibold text-muted-foreground">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className={it.line ? 'h-[3px] w-3.5 rounded-sm' : 'size-[9px] rounded-[3px]'} style={{ backgroundColor: it.color }} aria-hidden />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/** A chart's screen-reader summary, wrapping whatever draws it. */
export function Figure({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div role="figure" aria-label={label} className={cn('min-w-0', className)}>
      {children}
    </div>
  );
}
