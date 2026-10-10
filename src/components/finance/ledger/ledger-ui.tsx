'use client';

import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import {
  LEDGER_EXCLUSION_LABELS,
  type LedgerCell,
  type LedgerExclusion,
  type LedgerYearOption,
} from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
import { useMoney } from '../finance-ui';

/**
 * The pieces the two read-only year ledgers are both built from — the Salary
 * Ledger and Company Transaction Details are the same screen over different
 * records, and keeping them on one set of parts is what keeps them the same.
 *
 * NOTHING HERE CAN CHANGE A FIGURE. There is no input for an amount, no add
 * row, no edit, no delete. Every control is a way of looking: pick a year,
 * search, filter, sort, open the records behind a number.
 */

export const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const MONTHS_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** 'September 2026' */
export const periodLabel = (year: number, month: number) => `${MONTHS_LONG[month - 1]} ${year}`;

/** '2026-09-15' → '15 Sep 2026'. Parsed as text: a date has no time zone to drift in. */
export function niceDate(date: string | null | undefined): string {
  if (!date) return '—';
  const [y, m, d] = date.slice(0, 10).split('-');
  return `${Number(d)} ${MONTHS_SHORT[Number(m) - 1]} ${y}`;
}

/** An instant, shown on the business clock (Asia/Karachi). */
export function niceDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  return at.toLocaleString('en-GB', {
    timeZone: 'Asia/Karachi',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Amounts as a grid shows them: grouped, no currency symbol, and decimals only
 * when there are any. Twelve columns of "Rs. 30,000.00" do not fit on a tablet;
 * the legend says the unit once. Cards and the detail drawer use the module's
 * full two-decimal format (`money`).
 */
export function useLedgerFormat() {
  const { symbol, format } = useMoney();
  const amount = (value: number) =>
    value.toLocaleString('en-PK', {
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      maximumFractionDigits: 2,
    });
  return { symbol, amount, money: (value: number) => format(value) };
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

export function LedgerHeader({
  title,
  year,
  description,
  actions,
}: {
  title: string;
  year: number | null;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0 space-y-1">
        <h2 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xl font-bold tracking-tight sm:text-2xl">
          <span>
            {title}
            {year !== null && <span className="text-primary"> — {year}</span>}
          </span>
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold tracking-normal text-muted-foreground">
            Read-only
          </span>
        </h2>
        <p className="text-sm text-pretty text-muted-foreground">{description}</p>
      </div>
      {actions && <div className="no-print flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary cards
// ---------------------------------------------------------------------------

export interface SummaryCard {
  label: string;
  value: string;
  note: string;
  tone?: 'default' | 'warning';
}

export function SummaryCards({ cards, loading }: { cards: SummaryCard[]; loading?: boolean }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((card) => (
        <div key={card.label} className="flex flex-col gap-1 rounded-xl border bg-card px-4 py-3.5">
          <p className="text-[13px] text-muted-foreground">{card.label}</p>
          {loading ? (
            <Skeleton className="my-1 h-6 w-28" />
          ) : (
            <p
              className={cn(
                'text-lg font-bold tracking-tight tabular-nums sm:text-[22px]',
                card.tone === 'warning' && 'text-amber-700 dark:text-amber-400',
              )}
            >
              {card.value}
            </p>
          )}
          <p className="text-xs text-muted-foreground/80">{card.note}</p>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

// 16px on a phone: iOS zooms the page when a field with smaller text is focused.
const CONTROL = 'h-11 rounded-lg border border-input bg-card text-base md:h-9 md:text-sm';

/**
 * Previous / pick / next. The list comes from the server and always reaches one
 * year ahead: a new year is there to be opened, empty, before anything is
 * approved in it — it never starts as a copy of the last one.
 */
export function YearPicker({
  year,
  years,
  onChange,
}: {
  year: number;
  years: LedgerYearOption[];
  onChange: (year: number) => void;
}) {
  const known = years.map((y) => y.year);
  const min = Math.min(year, ...known);
  const max = Math.max(year, ...known);
  const options = years.some((y) => y.year === year) ? years : [{ year, hasRecords: false }, ...years];

  return (
    <div className="space-y-1">
      <Label htmlFor="ledger-year" className="text-xs text-muted-foreground">
        Year
      </Label>
      <div className={cn('flex items-stretch overflow-hidden', CONTROL)}>
        <button
          type="button"
          aria-label="Previous year"
          disabled={year <= min}
          onClick={() => onChange(year - 1)}
          className="flex w-10 items-center justify-center border-r border-input hover:bg-muted disabled:pointer-events-none disabled:text-muted-foreground/40 md:w-8"
        >
          <ChevronLeft className="size-4" />
        </button>
        <select
          id="ledger-year"
          value={year}
          onChange={(e) => onChange(Number(e.target.value))}
          className="bg-transparent px-2 text-base font-bold tabular-nums outline-none focus-visible:bg-muted md:text-sm"
        >
          {options.map((y) => (
            <option key={y.year} value={y.year}>
              {y.year}
              {y.hasRecords ? '' : ' · no records'}
            </option>
          ))}
        </select>
        <button
          type="button"
          aria-label="Next year"
          disabled={year >= max}
          onClick={() => onChange(year + 1)}
          className="flex w-10 items-center justify-center border-l border-input hover:bg-muted disabled:pointer-events-none disabled:text-muted-foreground/40 md:w-8"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * A native select. On a phone this is the system picker, which is the right
 * control for a short fixed list inside a strip of five of them.
 */
export function LedgerSelect<T extends string>({
  id,
  label,
  value,
  onChange,
  options,
  className,
}: {
  id: string;
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  className?: string;
}) {
  return (
    <div className={cn('min-w-[9.5rem] flex-1 space-y-1 sm:flex-none', className)}>
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className={cn(CONTROL, 'w-full px-2.5 outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50')}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function LedgerSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="min-w-[12rem] flex-[1_1_15rem] space-y-1 sm:max-w-xs">
      <Label htmlFor="ledger-search" className="text-xs text-muted-foreground">
        Search
      </Label>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          id="ledger-search"
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-11 bg-card pl-8 md:h-9"
        />
      </div>
    </div>
  );
}

export function LedgerControls({ children }: { children: ReactNode }) {
  return <div className="no-print flex flex-wrap items-end gap-3">{children}</div>;
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

export function LedgerLegend({ salary, symbol }: { salary: boolean; symbol: string }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-[3px] border border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/60" />
        Approved amount ({symbol})
      </span>
      {salary && (
        <span className="flex items-center gap-1.5">
          <span className="text-[11px] font-bold text-amber-700 dark:text-amber-400">Review</span>
          Approved after resignation — flagged
        </span>
      )}
      {salary && (
        <span className="flex items-center gap-1.5">
          <span className="font-bold text-red-500">—</span>
          Eligible month, no approved salary
        </span>
      )}
      <span className="flex items-center gap-1.5">
        <span className="font-bold text-muted-foreground/50">—</span>
        No approved record
      </span>
      {salary && (
        <span className="flex items-center gap-1.5">
          <span className={cn('h-2.5 w-3.5 rounded-[3px] border', HATCH)} />
          After resignation — closed
        </span>
      )}
    </div>
  );
}

const HATCH =
  'bg-[repeating-linear-gradient(135deg,var(--muted)_0_4px,transparent_4px_8px)]';

// ---------------------------------------------------------------------------
// The grid
// ---------------------------------------------------------------------------

export interface LedgerGridRow {
  id: string;
  code: string;
  name: string;
  /** Second line under the name. */
  sub?: string;
  subTone?: 'muted' | 'danger';
  cells: LedgerCell[];
  total: number;
}

export interface LedgerGridProps {
  idHead: string;
  nameHead: string;
  year: number;
  rows: LedgerGridRow[];
  /** Twelve totals over every filtered row, not just this page. */
  monthTotals: number[];
  yearTotal: number;
  /** A short second line inside a paid cell, e.g. "3 transactions". */
  cellNote?: (cell: LedgerCell) => string | null;
  onOpenRow: (rowId: string) => void;
  onOpenCell: (rowId: string, month: number) => void;
  /** Dimmed while a new year or filter is on its way in. */
  stale?: boolean;
}

/**
 * Row × twelve months.
 *
 * From `md` up it is a table whose name column stays put while the months
 * scroll under it (and the code column too from `lg`, where there is room), so
 * a figure is never separated from who it belongs to.
 * Below `md` a twelve-column table is not readable at any scroll position, so
 * each row becomes a card holding its own twelve months.
 *
 * Every cell opens the records behind it. That is the only thing a cell does.
 */
export function LedgerGrid(props: LedgerGridProps) {
  const { amount } = useLedgerFormat();
  const { idHead, nameHead, year, rows, monthTotals, yearTotal, stale } = props;

  return (
    <div className={cn('transition-opacity', stale && 'opacity-60')} aria-busy={stale || undefined}>
      {/* md and up, and always on paper */}
      <div className="print-table-wrap hidden overflow-hidden rounded-xl border bg-card md:block print:rounded-none print:border-0">
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full border-separate border-spacing-0 text-[13px] tabular-nums print:text-[9px]">
            <thead data-table-head>
              <tr>
                <th
                  scope="col"
                  className="relative z-20 w-[104px] min-w-[104px] border-b bg-card px-3 py-3 lg:sticky lg:left-0 text-left font-semibold whitespace-nowrap print:static print:w-auto print:min-w-0 print:px-1 print:py-1"
                >
                  <HeadFill />
                  <span className="relative">{idHead}</span>
                </th>
                <th
                  scope="col"
                  className="sticky left-0 z-20 min-w-[190px] border-r border-b bg-card lg:left-[104px] px-2.5 py-3 text-left font-semibold whitespace-nowrap print:static print:min-w-0 print:px-1 print:py-1"
                >
                  <HeadFill />
                  <span className="relative">{nameHead}</span>
                </th>
                {MONTHS_SHORT.map((m) => (
                  <th
                    key={m}
                    scope="col"
                    className="min-w-[92px] border-b px-2.5 py-3 text-right font-semibold whitespace-nowrap print:min-w-0 print:px-1 print:py-1"
                  >
                    {m}
                  </th>
                ))}
                <th
                  scope="col"
                  className={cn(TOTAL_COLUMN, 'z-20 min-w-[116px] border-b px-3.5 py-3 text-right font-semibold whitespace-nowrap print:min-w-0 print:px-1 print:py-1')}
                >
                  <HeadFill />
                  <span className="relative">Year Total</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="group">
                  <td className="z-10 border-b border-border/60 bg-card px-3 py-2 lg:sticky lg:left-0 font-mono text-xs whitespace-nowrap text-muted-foreground print:static print:px-1 print:py-0.5">
                    {row.code}
                  </td>
                  <td className="sticky left-0 z-10 border-r border-b border-b-border/60 bg-card lg:left-[104px] px-2.5 py-2 whitespace-nowrap print:static print:px-1 print:py-0.5">
                    <button
                      type="button"
                      onClick={() => props.onOpenRow(row.id)}
                      className="flex flex-col items-start gap-px rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span className="text-sm font-semibold hover:text-primary print:text-[9px]">{row.name}</span>
                      {row.sub && (
                        <span
                          className={cn(
                            'text-xs print:text-[8px]',
                            row.subTone === 'danger'
                              ? 'font-semibold text-red-600 dark:text-red-400'
                              : 'text-muted-foreground',
                          )}
                        >
                          {row.sub}
                        </span>
                      )}
                    </button>
                  </td>
                  {row.cells.map((cell) => (
                    <td key={cell.month} className="border-b border-border/60 p-1 align-middle print:p-0.5">
                      <CellButton
                        cell={cell}
                        label={`${row.name}, ${periodLabel(year, cell.month)}`}
                        note={props.cellNote?.(cell) ?? null}
                        onClick={() => props.onOpenCell(row.id, cell.month)}
                      />
                    </td>
                  ))}
                  <td className={cn(TOTAL_COLUMN, 'z-10 border-b border-b-border/60 px-3.5 py-2 text-right font-bold whitespace-nowrap print:px-1 print:py-0.5')}>
                    {row.total ? amount(row.total) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot data-table-foot>
              <tr>
                <td className="relative z-10 bg-card px-3 py-3 lg:sticky lg:left-0 print:static print:p-1">
                  <HeadFill />
                </td>
                <td className="sticky left-0 z-10 border-r bg-card px-2.5 py-3 lg:left-[104px] font-bold whitespace-nowrap print:static print:p-1">
                  <HeadFill />
                  <span className="relative">Monthly total</span>
                </td>
                {monthTotals.map((total, i) => (
                  <td key={i} className="px-3 py-3 text-right font-semibold whitespace-nowrap print:p-1">
                    {total ? amount(total) : '—'}
                  </td>
                ))}
                <td className={cn(TOTAL_COLUMN, 'z-10 px-3.5 py-3 text-right font-bold whitespace-nowrap print:p-1')}>
                  <HeadFill />
                  <span className="relative text-primary">{amount(yearTotal)}</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Phones: one card per row, its twelve months inside it. */}
      <ul className="space-y-3 md:hidden print:hidden">
        {rows.map((row) => (
          <li key={row.id} className="rounded-xl border bg-card p-3">
            <div className="flex items-start justify-between gap-3">
              <button
                type="button"
                onClick={() => props.onOpenRow(row.id)}
                className="flex min-h-11 min-w-0 flex-col items-start justify-center text-left"
              >
                <span className="truncate text-sm font-semibold">{row.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{row.code}</span>
                {row.sub && (
                  <span
                    className={cn(
                      'text-xs',
                      row.subTone === 'danger' ? 'font-semibold text-red-600 dark:text-red-400' : 'text-muted-foreground',
                    )}
                  >
                    {row.sub}
                  </span>
                )}
              </button>
              <div className="shrink-0 text-right">
                <p className="text-[11px] text-muted-foreground">Year total</p>
                <p className="text-sm font-bold tabular-nums">{row.total ? amount(row.total) : '—'}</p>
              </div>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1.5 min-[420px]:grid-cols-4">
              {row.cells.map((cell) => (
                <CellButton
                  key={cell.month}
                  cell={cell}
                  month={MONTHS_SHORT[cell.month - 1]}
                  label={`${row.name}, ${periodLabel(year, cell.month)}`}
                  note={props.cellNote?.(cell) ?? null}
                  onClick={() => props.onOpenCell(row.id, cell.month)}
                />
              ))}
            </div>
          </li>
        ))}
        <li className="rounded-xl border bg-primary/10 p-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-sm font-bold">Monthly total</p>
            <p className="text-sm font-bold text-primary tabular-nums">{amount(yearTotal)}</p>
          </div>
          <dl className="mt-2 grid grid-cols-3 gap-x-3 gap-y-1.5 text-xs tabular-nums min-[420px]:grid-cols-4">
            {monthTotals.map((total, i) => (
              <div key={i} className="flex items-baseline justify-between gap-1.5">
                <dt className="text-muted-foreground">{MONTHS_SHORT[i]}</dt>
                <dd className="font-semibold">{total ? amount(total) : '—'}</dd>
              </div>
            ))}
          </dl>
        </li>
      </ul>
    </div>
  );
}

/**
 * The Year Total column. On a wide screen it stays at the right edge while the
 * months scroll, so a row's total is always in view; on a tablet that would
 * leave room for three months, so there it scrolls with them.
 */
// `relative` below xl: the heading tint inside it is absolutely positioned and
// must stay inside this cell when the cell is not sticky.
const TOTAL_COLUMN = 'relative border-l bg-card xl:sticky xl:right-0 print:static';

/**
 * The heading tint, repainted inside a sticky cell.
 *
 * `[data-table-head]` tints the row with a translucent colour. A sticky cell
 * has to be opaque or the months show through it as they scroll past, so it
 * carries the card colour and this lays the same tint over it.
 */
function HeadFill() {
  return <span aria-hidden className="absolute inset-0 bg-primary/10 print:hidden" />;
}

function CellButton({
  cell,
  month,
  label,
  note,
  onClick,
}: {
  cell: LedgerCell;
  /** Set on the phone layout, where a cell has no column heading above it. */
  month?: string;
  label: string;
  note: string | null;
  onClick: () => void;
}) {
  const { amount } = useLedgerFormat();
  const paid = cell.state === 'paid';
  const description = paid
    ? `${amount(cell.amount)} approved${cell.flagged ? ', flagged for review' : ''}`
    : cell.state === 'unpaid'
      ? 'no approved salary'
      : cell.state === 'closed'
        ? 'closed after resignation'
        : 'no approved record';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label}: ${description}. Open details.`}
      title={`${label} · ${description}`}
      className={cn(
        'flex w-full flex-col gap-px rounded-md border px-2 py-1.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring print:border-0 print:p-0',
        // 40px at least: the table is used by touch on a tablet as well.
        month ? 'min-h-12 items-stretch' : 'min-h-10 items-end justify-center print:min-h-0',
        paid &&
          'border-emerald-100 bg-emerald-50 hover:border-emerald-600 dark:border-emerald-900 dark:bg-emerald-950/50 dark:hover:border-emerald-500',
        cell.state === 'unpaid' && 'border-transparent text-red-500 hover:border-red-200 hover:bg-red-50 dark:hover:border-red-900 dark:hover:bg-red-950/40',
        cell.state === 'none' && 'border-transparent text-muted-foreground/50 hover:border-border',
        cell.state === 'closed' && cn('border-transparent text-muted-foreground/50 hover:border-border', HATCH),
      )}
    >
      {month && <span className="text-left text-[11px] font-medium text-muted-foreground">{month}</span>}
      <span className={cn('flex flex-col gap-px', month ? 'items-end' : 'items-end')}>
        {paid ? (
          <>
            <span className="text-[13.5px] font-semibold whitespace-nowrap text-foreground print:text-[9px]">
              {amount(cell.amount)}
            </span>
            {note && (
              <span className="text-[11px] whitespace-nowrap text-emerald-700 dark:text-emerald-400 print:hidden">
                {note}
              </span>
            )}
            {cell.flagged && (
              <span className="text-[11px] font-bold whitespace-nowrap text-amber-700 dark:text-amber-400">Review</span>
            )}
          </>
        ) : (
          <span className="font-bold">—</span>
        )}
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function LedgerSkeleton() {
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4" aria-busy="true" aria-label="Loading ledger">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="grid grid-cols-[72px_1fr] gap-3 md:grid-cols-[90px_180px_repeat(6,minmax(0,1fr))]">
          <Skeleton className="h-3.5" />
          <Skeleton className="h-3.5" />
          {Array.from({ length: 6 }, (_, j) => (
            <Skeleton key={j} className="hidden h-3.5 opacity-70 md:block" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function LedgerEmpty({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed bg-card px-6 py-14 text-center">
      <p className="text-[17px] font-semibold">{title}</p>
      <p className="max-w-md text-sm text-pretty text-muted-foreground">{body}</p>
    </div>
  );
}

export function LedgerError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-6 py-10 text-center dark:border-red-900 dark:bg-red-950/40"
    >
      <p className="text-[17px] font-semibold text-red-900 dark:text-red-200">The ledger could not be loaded</p>
      <p className="max-w-md text-sm text-pretty text-red-800 dark:text-red-300">{message}</p>
      <Button variant="outline" size="sm" className="h-11 md:h-9" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Source records
// ---------------------------------------------------------------------------

const BADGE: Record<'counted' | LedgerExclusion, string> = {
  counted: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  draft: 'bg-muted text-muted-foreground',
  approved_not_posted: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  voucher_removed: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

/**
 * Whether a source record is part of the ledger's figures, and if not, why.
 * The long form spells out the consequence — "Pending · excluded" — because the
 * drawer is where someone comes to learn why a month is empty.
 */
export function SourceBadge({ exclusion, long }: { exclusion: LedgerExclusion | null; long?: boolean }) {
  const key = exclusion ?? 'counted';
  const label = exclusion ? LEDGER_EXCLUSION_LABELS[exclusion] : 'Approved';
  return (
    <span className={cn('inline-block rounded px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap', BADGE[key])}>
      {label}
      {long && (exclusion ? ' · excluded' : ' · counted')}
    </span>
  );
}

/** One source record in the drawer: its number, whether it counts, its amount, and where it came from. */
export function SourceItem({
  reference,
  exclusion,
  amount,
  lines,
}: {
  reference: string;
  exclusion: LedgerExclusion | null;
  amount: string;
  /** Facts about the record, each already a finished phrase. Empty ones are dropped. */
  lines: (string | null | false | undefined)[];
}) {
  return (
    <li className="space-y-1.5 rounded-lg border px-3 py-2.5">
      <div className="flex items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[13px] font-semibold">{reference}</span>
          <SourceBadge exclusion={exclusion} long />
        </div>
        <span className={cn('text-sm font-bold whitespace-nowrap tabular-nums', exclusion && 'text-muted-foreground line-through')}>
          {amount}
        </span>
      </div>
      <p className="text-[12.5px] leading-relaxed text-pretty text-muted-foreground">{lines.filter(Boolean).join(' · ')}</p>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Detail drawer
// ---------------------------------------------------------------------------

export function LedgerSheet({
  open,
  onClose,
  kicker,
  title,
  sub,
  children,
}: {
  open: boolean;
  onClose: () => void;
  kicker: string;
  title: string;
  sub: string;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side="right"
        className="w-full gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[460px]"
      >
        <SheetHeader className="gap-1 border-b pr-12">
          <p className="text-xs text-muted-foreground">{kicker}</p>
          <SheetTitle className="text-[19px] font-bold">{title}</SheetTitle>
          <SheetDescription className="text-sm text-foreground/80">{sub}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">{children}</div>
      </SheetContent>
    </Sheet>
  );
}

export function SheetTotal({ value, note }: { value: string; note: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <p className="text-[26px] font-bold tracking-tight tabular-nums">{value}</p>
      <p className="text-right text-[13px] text-muted-foreground">{note}</p>
    </div>
  );
}

export function SheetFields({ fields }: { fields: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
      {fields.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-right font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SheetNote({ tone, children }: { tone: 'info' | 'warning' | 'danger'; children: ReactNode }) {
  return (
    <div
      className={cn(
        'rounded-lg border px-3.5 py-3 text-[13.5px] text-pretty',
        tone === 'info' && 'border-border bg-muted/60 text-foreground/90',
        tone === 'warning' && 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
        tone === 'danger' && 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200',
      )}
    >
      {children}
    </div>
  );
}

export function SheetLoading() {
  return (
    <div className="space-y-3" aria-busy="true">
      <Skeleton className="h-8 w-40" />
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}
