'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { useBranchStockDay } from '@/lib/queries';
import { useStockRealtime } from '@/hooks/useStockRealtime';
import { businessDateStr, type BranchStockHistoryRow } from '@mb/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { PrintButton } from '@/components/shared/PrintButton';
import { ApiError } from '@/utils/api';
import { cn } from '@/lib/utils';

/**
 * Branch Daily Stock — one business day read as a statement rather than a table.
 *
 * The dashboard's Branch Stock History card answers "how have the last N days
 * gone"; this answers "show me the 20th", and lays the day out the way a
 * passbook does — one line per movement, the previous balance brought forward at
 * the top, the closing balance worked out at the bottom.
 *
 * WHY THE FIRST ROW CARRIES A DIFFERENT DATE: "Previous balance" is the closing
 * balance of the day BEFORE the one selected, which is why it is dated to the
 * previous day while every other line is dated to the selected one. It is the
 * same number as that day's Remaining Stock — select yesterday and you will see
 * it as the last line instead of the first.
 *
 * AMOUNTS ARE STOCK VALUED AT THE CURRENT PRICE LIST, not money taken. The Sale
 * line is `units x current price`; the till figure is on Branch Reports and is
 * net of discounts. Valuing this line from orders instead would read truer in
 * that one cell and then stop the statement footing.
 */

/** 'YYYY-MM-DD' -> '20 Aug 2026'. Built from the parts so a bare date is never
 *  re-interpreted as UTC midnight and shown as the previous day west of GMT. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]} ${y}`;
}

/** The day before `date`, as 'YYYY-MM-DD'. */
function previousDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** One line of the statement. */
interface Line {
  key: string;
  date: string;
  detail: string;
  qty: number;
  amount: number;
  /** Signed lines print their sign; the brought-forward and closing lines do not. */
  signed?: boolean;
  tone?: string;
}

/**
 * The statement lines for a day, in passbook order.
 *
 * Returned and Adjustment appear ONLY when non-zero. They were not in the
 * requested layout and on most days they are absent, but a day that had a return
 * or an admin correction does not foot without them — the closing balance would
 * look like an arithmetic error.
 */
function linesFor(row: BranchStockHistoryRow): Line[] {
  const lines: Line[] = [
    { key: 'opening', date: previousDate(row.date), detail: 'Previous balance', qty: row.openingQty, amount: row.openingAmount },
    { key: 'new', date: row.date, detail: 'New Stock items', qty: row.newQty, amount: row.newAmount, tone: 'text-emerald-600 dark:text-emerald-400' },
    { key: 'sold', date: row.date, detail: 'Sale stock items', qty: row.soldQty, amount: row.soldAmount, tone: 'text-red-600 dark:text-red-400' },
  ];
  if (row.returnedQty !== 0 || row.returnedAmount !== 0) {
    lines.push({ key: 'returned', date: row.date, detail: 'Returned to production', qty: row.returnedQty, amount: row.returnedAmount, tone: 'text-amber-600 dark:text-amber-400' });
  }
  if (row.adjustmentQty !== 0 || row.adjustmentAmount !== 0) {
    lines.push({ key: 'adjustment', date: row.date, detail: 'Stock adjustment', qty: row.adjustmentQty, amount: row.adjustmentAmount, signed: true, tone: 'text-sky-600 dark:text-sky-400' });
  }
  return lines;
}

/**
 * The closing line's working, e.g. "10 + 300 − 200". Built from the lines that
 * are actually present so it always matches what is on screen above it, and so
 * the reader can check the total without doing the sum themselves.
 */
function working(row: BranchStockHistoryRow): string {
  const n = (v: number) => Math.round(v).toLocaleString();
  let out = `${n(row.openingQty)} + ${n(row.newQty)} − ${n(row.soldQty)}`;
  if (row.returnedQty !== 0) out += ` − ${n(row.returnedQty)}`;
  if (row.adjustmentQty !== 0) {
    out += row.adjustmentQty > 0 ? ` + ${n(row.adjustmentQty)}` : ` − ${n(Math.abs(row.adjustmentQty))}`;
  }
  return out;
}

export function BranchDailyStockPage() {
  const { token, user } = useAuth();
  const { settings } = useSettings();
  const [date, setDate] = useState(businessDateStr());

  const cur = settings?.currencySymbol || 'Rs.';
  const { data: row, isPending, error } = useBranchStockDay(token ?? '', { date });
  useStockRealtime();

  const money = (n: number) => `${cur}${Math.round(n).toLocaleString()}`;
  const qty = (n: number) => Math.round(n).toLocaleString();
  const signedQty = (n: number) => (n > 0 ? `+${qty(n)}` : qty(n));

  const lines = row ? linesFor(row) : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
        <div>
          <h2 className="text-lg font-semibold">{user?.branchName || 'Branch'} — Stock Detail</h2>
          <p className="text-sm text-muted-foreground">
            One business day, line by line. Amounts value stock at current prices, so the Sale line is not the till total.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs" htmlFor="daily-stock-date">Date</Label>
            <Input
              id="daily-stock-date"
              type="date"
              value={date}
              max={businessDateStr()}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="h-9 w-40"
            />
          </div>
          <PrintButton onPrint={() => window.print()} printLabel="Print" saveLabel="Save PDF" size="sm" />
        </div>
      </div>

      {/* Shown only on paper — the on-screen heading above is in the toolbar that
          print hides, and a printed statement with no date on it is useless. */}
      <div className="hidden print:block">
        <h2 className="text-lg font-semibold">{user?.branchName || 'Branch'} — Stock Detail</h2>
        <p className="text-sm">{formatDate(date)}</p>
      </div>

      <Card>
        <CardContent className="p-0">
          {error ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-medium">Nothing to show for {formatDate(date)}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {error instanceof ApiError ? error.message : 'Could not load the stock ledger for that date.'}
              </p>
            </div>
          ) : isPending ? (
            <div className="space-y-2 p-4">
              {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="whitespace-nowrap px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Date</th>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Detail</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Qty</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {lines.map((l) => (
                    <tr key={l.key} className="transition-colors hover:bg-muted/30">
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(l.date)}</td>
                      <td className="px-4 py-3 font-medium">{l.detail}</td>
                      <td className={cn('px-4 py-3 text-right tabular-nums', l.tone)}>
                        {l.signed ? signedQty(l.qty) : qty(l.qty)}
                      </td>
                      <td className={cn('px-4 py-3 text-right tabular-nums', l.tone)}>{money(l.amount)}</td>
                    </tr>
                  ))}

                  {row && (
                    <tr className="border-t-2 bg-muted/30">
                      <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(row.date)}</td>
                      <td className="px-4 py-3 font-semibold">
                        Remaining Stock items
                        {/* The sum written out, so the total can be checked at a
                            glance against the lines above rather than trusted. */}
                        <span className="ml-2 hidden text-xs font-normal text-muted-foreground sm:inline">
                          ({working(row)})
                        </span>
                      </td>
                      <td className={cn('px-4 py-3 text-right font-semibold tabular-nums', row.balanceQty < 0 && 'text-destructive')}>
                        {qty(row.balanceQty)}
                      </td>
                      <td className={cn('px-4 py-3 text-right font-semibold tabular-nums', row.balanceAmount < 0 && 'text-destructive')}>
                        {money(row.balanceAmount)}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
