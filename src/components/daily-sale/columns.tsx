'use client';

import type { ColumnDef } from '@tanstack/react-table';
import { karachiTimeStr, type DailySaleRecord } from '@mb/shared';
import { DifferenceBadge, StatusBadge, money } from './parts';

/**
 * The Daily Sale Record table's columns — Date through Source.
 *
 * One definition, because two screens show this table: the branch's own board
 * (DailySaleRecordPage) and Finance's Daily Closing, which exists to check the
 * same figures. Finance reading a different heading, order or rounding from the
 * branch it is auditing would be the two of them disagreeing before either had
 * looked at a number, so neither screen writes these out for itself.
 *
 * What a screen may DO to a row differs — a branch feeds and verifies, Finance
 * only reads — so the actions column is not here. Each screen appends its own.
 */
export function dailySaleRecordColumns<T extends DailySaleRecord = DailySaleRecord>({
  symbol,
  showBranch,
  showSymbol = true,
}: {
  symbol: string;
  /** More than one branch is on show, so a date alone does not identify a row. */
  showBranch: boolean;
  /**
   * Write the currency symbol in front of every figure. Finance turns it off: in
   * a table of nothing but rupee figures the symbol is the same three characters
   * in every cell, and the room is better spent on the columns.
   */
  showSymbol?: boolean;
}): ColumnDef<T>[] {
  // One figure column, in this table's currency style. The rounding is the
  // formatter's either way; only the symbol in front of it is optional.
  const figure = (
    id: string,
    header: string,
    pick: (r: T) => number,
    strong = false,
    tone = '',
    format: (n: number, symbol: string) => string = money,
  ) =>
    moneyColumn<T>(id, header, pick, symbol, strong, tone, showSymbol ? format : (n) => format(n, '').trim());

  return [
    {
      id: 'date',
      accessorFn: (r) => r.businessDate,
      header: 'Date',
      meta: { mobile: 'title' },
      cell: ({ row }) => (
        <div>
          <p className="font-medium tabular-nums">{displayDate(row.original.businessDate)}</p>
          {/* The branch belongs under the date in the consolidated view, where a
              date alone does not identify a row. Hidden when one branch is on
              show, so the column does not repeat the same name forty times. */}
          {showBranch && (
            <p className="text-xs text-muted-foreground">{row.original.branchName}</p>
          )}
        </div>
      ),
    },
    {
      id: 'time',
      accessorFn: (r) => r.generatedAt,
      header: 'Time',
      meta: { mobile: 'hidden', mobileLabel: 'Generated' },
      cell: ({ row }) => (
        <span className="text-xs tabular-nums text-muted-foreground">
          {row.original.generatedAt ? karachiTimeStr(new Date(row.original.generatedAt)) : '—'}
        </span>
      ),
    },
    figure('totalSale', 'Total Sale', (r) => r.autoTotalSale, true),
    // Server-computed: Total Sale × the branch's Admin company share (the
    // percentage booked on the day's income approval where there is one).
    // Nothing is multiplied here, so the column cannot disagree with the API.
    figure('companyShare', 'Company Share', (r) => r.companyShare, true, 'text-red-600 dark:text-red-400 font-bold', paisaMoney),
    figure('cash', 'Cash', (r) => r.autoCash),
    figure('easypaisa', 'Easypaisa', (r) => r.autoEasypaisa),
    figure('foodpanda', 'Foodpanda', (r) => r.autoFoodpanda),
    figure('bank', 'Bank', (r) => r.autoBank),
    figure('cashExpense', 'Cash Expense', (r) => r.cashExpense),
    // Straight after Cash Expense so the subtraction is visible in the row —
    // 45,000 · 5,000 · 40,000 reads as arithmetic rather than as three
    // unrelated figures. This is what the counted cash is checked against, so
    // it sits next to the Difference column's reasoning rather than off in the
    // View popup where the person counting the drawer would not see it.
    figure('cashOnTable', 'Cash on Table', (r) => r.expectedCashInHand, true),
    figure('discount', 'Discount', (r) => r.discount),
    {
      id: 'difference',
      accessorFn: (r) => r.overallDifference,
      header: 'Difference',
      meta: { align: 'center', mobile: 'badge' },
      cell: ({ row }) => {
        const r = row.original;
        // Nothing counted at all reads as "not counted", never as a matched
        // zero: `overallDifference` is 0 when no method has been fed, and a
        // green tick there would say the day balances when nobody has looked.
        const nothingCounted =
          r.cashDifference === null && r.easypaisaDifference === null && r.bankDifference === null;
        return (
          <DifferenceBadge
            difference={nothingCounted ? null : r.overallDifference}
            symbol={symbol}
          />
        );
      },
    },
    {
      id: 'status',
      accessorFn: (r) => r.status,
      header: 'Status',
      meta: { align: 'center', mobile: 'badge' },
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
    {
      id: 'source',
      accessorFn: (r) => (r.fedAt ? 'System + Counted' : 'System'),
      header: 'Source',
      enableSorting: false,
      meta: { align: 'center', mobileLabel: 'Source' },
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.fedAt ? 'System + Counted' : 'System'}
        </span>
      ),
    },
  ];
}

/**
 * Money that keeps its paisa when it has any: "Rs. 750", "Rs. 28,312.50".
 *
 * `money` rounds to whole rupees, which is right for takings and wrong for a
 * percentage of them — 75% of 37,750 is 28,312.50, and showing 28,313 would be a
 * figure nobody can reproduce from the row.
 */
export function paisaMoney(n: number, symbol: string): string {
  if (Number.isInteger(n)) return money(n, symbol);
  return `${symbol} ${n.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * One right-aligned money column.
 *
 * A factory rather than nine near-identical literals, because the alignment,
 * `tabular-nums` and the rounding have to match across all of them — a centred
 * or proportional figures column jitters as the digit count changes row to row,
 * which is the exact failure `table-meta.ts` documents.
 */
export function moneyColumn<T extends DailySaleRecord = DailySaleRecord>(
  id: string,
  header: string,
  pick: (r: T) => number,
  symbol: string,
  strong = false,
  tone = '',
  format: (n: number, symbol: string) => string = money,
): ColumnDef<T> {
  // A figure the API did not send (an API one release behind this build) reads
  // as a dash, never as "Rs. NaN", and sorts and totals as 0.
  const value = (r: T) => {
    const v = pick(r);
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  return {
    id,
    accessorFn: (r) => value(r) ?? 0,
    header,
    meta: { align: 'right', mobileLabel: header },
    cell: ({ row }) => {
      const v = value(row.original);
      return (
        <span className={`tabular-nums ${strong ? 'font-semibold' : ''} ${tone}`}>
          {v === null ? '—' : format(v, symbol)}
        </span>
      );
    },
    footer: ({ table }) => (
      <span className={`tabular-nums ${tone}`}>
        {format(
          Math.round(table.getFilteredRowModel().rows.reduce((s, r) => s + (value(r.original) ?? 0), 0) * 100) / 100,
          symbol,
        )}
      </span>
    ),
  };
}

/** 'DD-MM-YYYY'. String work — these are already Karachi business dates. */
export function displayDate(iso: string): string {
  const [y, m, d] = (iso || '').split('-');
  return y && m && d ? `${d}-${m}-${y}` : iso || '—';
}

export function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}
