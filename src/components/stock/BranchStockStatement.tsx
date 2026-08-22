'use client';

import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { useBranchStockDay } from '@/lib/queries';
import { useStockRealtime } from '@/hooks/useStockRealtime';
import type { BranchStockHistoryRow, StockReconciliation, StockReconciliationCause } from '@mb/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/utils/api';
import { cn } from '@/lib/utils';

/**
 * One business day of branch stock, laid out as a statement.
 *
 * Rendered by the Branch Dashboard's Stock Detail card. It briefly had a second
 * caller — a Branch → Daily Stock page — which is why the statement lives in its
 * own component rather than inside the card; that page was removed once the
 * dashboard carried the same figures, and this stayed split because the card
 * reads better without 100 lines of table markup inlined into it.
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
function formatStatementDate(date: string): string {
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
 * The foot-check: what the lines above say should be left, less what is left.
 *
 * `opening + new − sold − returned + adjustment = balance` holds by construction
 * on the server (see `computeBranchStockHistory`), so on a healthy day this is
 * ZERO — and that is the point of showing it. A non-zero figure means the
 * statement no longer foots, which is a real ledger fault worth surfacing rather
 * than a number to read off. The amount column can land on a rounding-sized
 * value where the qty column is exactly 0, since amounts are units valued at the
 * current price list; `isZero` therefore tolerates a sub-currency-unit residue
 * instead of colouring the row red over half a rupee.
 *
 * Returned and Adjustment are included whether or not their lines were rendered
 * — they are omitted above only when zero, which cannot change this sum.
 */
function endDifference(row: BranchStockHistoryRow): { qty: number; amount: number; isZero: boolean } {
  const qty = row.openingQty + row.newQty - row.soldQty - row.returnedQty + row.adjustmentQty - row.balanceQty;
  const amount =
    row.openingAmount + row.newAmount - row.soldAmount - row.returnedAmount + row.adjustmentAmount - row.balanceAmount;
  return { qty, amount, isZero: Math.abs(qty) < 0.5 && Math.abs(amount) < 1 };
}

/**
 * Plain-language reason for a product's units landing in one figure and not the
 * other. The cause codes come from the server (`reconcileBranchStockDay`); only
 * the first is something a branch can act on — the rest mean the two
 * derivations have drifted and are worded to say so.
 */
const RECONCILIATION_CAUSE_TEXT: Record<StockReconciliationCause, string> = {
  'deleted-from-catalogue': 'held for a product removed from the catalogue, so the Stock page cannot list it',
  discontinued: 'discontinued product counted here but not listed on the Stock page',
  unlisted: 'active product carrying a balance the Stock page did not list',
  mismatch: 'the two screens disagree about this product',
};

/**
 * The cross-check against the Stock page, as statement lines.
 *
 * WHY THIS EXISTS: this total and the Stock page's Balance column are derived
 * from the same ledger by two different paths, and for a long time they
 * disagreed — silently, because nothing compared them. Both are plausible
 * numbers; neither screen could tell you the other one differed. So the
 * comparison is now stated here, on the figure people actually read, and it
 * names what is responsible rather than only reporting a gap.
 *
 * On a healthy day this is one quiet line reading 0.
 */
function ReconciliationRows({
  reconciliation,
  date,
  formatDate,
  qty,
  signedQty,
}: {
  reconciliation: StockReconciliation;
  date: string;
  formatDate: (d: string) => string;
  qty: (n: number) => string;
  signedQty: (n: number) => string;
}) {
  const agrees = reconciliation.difference === 0;
  return (
    <>
      <tr className="bg-muted/30">
        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatDate(date)}</td>
        <td className="px-4 py-3 font-semibold">
          Stock page check
          <span className={cn('ml-2 text-xs font-normal', agrees ? 'text-muted-foreground' : 'text-destructive')}>
            {agrees
              ? 'agrees with the Stock page'
              : `Stock page shows ${qty(reconciliation.itemsQty)}`}
          </span>
        </td>
        <td className={cn('px-4 py-3 text-right font-semibold tabular-nums', !agrees && 'text-destructive')}>
          {agrees ? qty(0) : signedQty(reconciliation.difference)}
        </td>
        <td className="px-4 py-3" />
      </tr>

      {/* Only when they differ: one line per product responsible, then whatever
          no product explains — which is the part that should worry someone. */}
      {!agrees && reconciliation.reasons.map((r) => (
        <tr key={r.productId} className="bg-muted/10">
          <td className="px-4 py-2" />
          <td className="px-4 py-2 pl-8 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{r.productName}</span>
            {' — '}
            {RECONCILIATION_CAUSE_TEXT[r.cause]}
          </td>
          <td className="px-4 py-2 text-right text-xs tabular-nums text-muted-foreground">{signedQty(r.qty)}</td>
          <td className="px-4 py-2" />
        </tr>
      ))}

      {!agrees && reconciliation.unexplained !== 0 && (
        <tr className="bg-muted/10">
          <td className="px-4 py-2" />
          <td className="px-4 py-2 pl-8 text-xs text-destructive">
            Unexplained — no product accounts for this. The two figures are derived differently and have drifted.
          </td>
          <td className="px-4 py-2 text-right text-xs font-semibold tabular-nums text-destructive">
            {signedQty(reconciliation.unexplained)}
          </td>
          <td className="px-4 py-2" />
        </tr>
      )}
    </>
  );
}

export function BranchStockStatement({ date, branchId }: { date: string; branchId?: string | null }) {
  const { token } = useAuth();
  const { settings } = useSettings();
  const cur = settings?.currencySymbol || 'Rs.';

  const { data, isPending, error } = useBranchStockDay(token ?? '', { date, branchId });
  useStockRealtime();
  const row = data?.row;
  const reconciliation = data?.reconciliation ?? null;

  const money = (n: number) => `${cur}${Math.round(n).toLocaleString()}`;
  const qty = (n: number) => Math.round(n).toLocaleString();
  const signedQty = (n: number) => (n > 0 ? `+${qty(n)}` : qty(n));

  if (error) {
    return (
      <div className="px-4 py-10 text-center">
        <p className="text-sm font-medium">Nothing to show for {formatStatementDate(date)}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {error instanceof ApiError ? error.message : 'Could not load the stock ledger for that date.'}
        </p>
      </div>
    );
  }

  if (isPending || !row) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }

  return (
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
          {linesFor(row).map((l) => (
            <tr key={l.key} className="transition-colors hover:bg-muted/30">
              <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatStatementDate(l.date)}</td>
              <td className="px-4 py-3 font-medium">{l.detail}</td>
              <td className={cn('px-4 py-3 text-right tabular-nums', l.tone)}>
                {l.signed ? signedQty(l.qty) : qty(l.qty)}
              </td>
              <td className={cn('px-4 py-3 text-right tabular-nums', l.tone)}>{money(l.amount)}</td>
            </tr>
          ))}

          <tr className="border-t-2 bg-muted/30">
            <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatStatementDate(row.date)}</td>
            <td className="px-4 py-3 font-semibold">Remaining Stock items</td>
            <td className={cn('px-4 py-3 text-right font-semibold tabular-nums', row.balanceQty < 0 && 'text-destructive')}>
              {qty(row.balanceQty)}
            </td>
            <td className={cn('px-4 py-3 text-right font-semibold tabular-nums', row.balanceAmount < 0 && 'text-destructive')}>
              {money(row.balanceAmount)}
            </td>
          </tr>

          {(() => {
            const diff = endDifference(row);
            return (
              <tr className="bg-muted/30">
                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">{formatStatementDate(row.date)}</td>
                <td className="px-4 py-3 font-semibold">
                  End Difference
                  {!diff.isZero && (
                    <span className="ml-2 text-xs font-normal text-destructive">statement does not foot</span>
                  )}
                </td>
                <td className={cn('px-4 py-3 text-right font-semibold tabular-nums', !diff.isZero && 'text-destructive')}>
                  {diff.isZero ? qty(0) : signedQty(diff.qty)}
                </td>
                <td className={cn('px-4 py-3 text-right font-semibold tabular-nums', !diff.isZero && 'text-destructive')}>
                  {money(diff.isZero ? 0 : diff.amount)}
                </td>
              </tr>
            );
          })()}

          {reconciliation && (
            <ReconciliationRows
              reconciliation={reconciliation}
              date={row.date}
              formatDate={formatStatementDate}
              qty={qty}
              signedQty={signedQty}
            />
          )}
        </tbody>
      </table>
    </div>
  );
}
