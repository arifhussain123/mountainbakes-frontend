'use client';

import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { useBranchStockHistory } from '@/lib/queries';
import { useStockRealtime } from '@/hooks/useStockRealtime';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { BranchStockHistoryRow } from '@mb/shared';

/**
 * Branch Dashboard → Branch Stock History.
 *
 * One row per business day: what the branch opened with, what Production added,
 * what it sold, and what it is left holding — each as a quantity and a money
 * figure. It answers the question the per-product Stock page cannot, because that
 * page only ever shows today.
 *
 * ─── The two things to know before reading a number here ────────────────────
 *
 * 1. AMOUNTS ARE STOCK VALUED AT TODAY'S PRICE LIST, not money taken. Sold
 *    Amount is `units × current price`; the till figure is Sales on the stat row
 *    above, which is net of discounts and uses each order's snapshotted price.
 *    They will differ, and that is the design: valuing one column differently
 *    from the others would stop every row adding up.
 *
 * 2. `Ret/Adj` is what makes the row add up — returns to Production and admin
 *    stock corrections, netted and signed, so that
 *    Previous + New − Sold + Ret/Adj = Remaining on every row. Without it a day
 *    with a return reads like an arithmetic error.
 */

/** Window lengths offered. Kept short — this is a dashboard card, not a report. */
const RANGES = [
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
];

/** Signed net of returns and corrections — see the header note. */
function otherQty(r: BranchStockHistoryRow) {
  return r.adjustmentQty - r.returnedQty;
}
function otherAmount(r: BranchStockHistoryRow) {
  return r.adjustmentAmount - r.returnedAmount;
}

/**
 * 'YYYY-MM-DD' → 'Thu 21 Aug'. Built by hand from the parts rather than through
 * `new Date(str)`, which parses a bare date as UTC midnight and would render the
 * previous day for anyone west of Greenwich.
 */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) return date;
  const weekday = DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${weekday} ${String(d).padStart(2, '0')} ${MONTHS[m - 1]}`;
}

export function BranchStockHistoryCard({
  days,
  onDaysChange,
  branchId,
}: {
  days: number;
  onDaysChange: (days: number) => void;
  branchId?: string | null;
}) {
  const { token } = useAuth();
  const { settings } = useSettings();
  const cur = settings?.currencySymbol || 'Rs.';

  const { data, isPending } = useBranchStockHistory(token ?? '', { branchId, days });
  // Same invalidation stream the Stock page rides: a sale or a Production
  // approval moves stock, and this card is a view of exactly those movements.
  useStockRealtime();

  const rows = data?.rows ?? [];
  const money = (n: number) => `${cur}${Math.round(n).toLocaleString()}`;
  const qty = (n: number) => n.toLocaleString();

  /** Quantity over amount — the shape every figure cell takes. */
  const Figure = ({ q, a, tone }: { q: number; a: number; tone?: string }) => (
    <div className="leading-tight">
      <span className={cn('block font-medium tabular-nums', tone)}>{qty(q)}</span>
      <span className="block text-[11px] text-muted-foreground tabular-nums">{money(a)}</span>
    </div>
  );

  const header = (
    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
      <div>
        <CardTitle className="text-base">Branch Stock History</CardTitle>
        <p className="text-xs text-muted-foreground">
          Qty and value per business day · stock valued at current prices, so Sold here is not the till total
        </p>
      </div>
      <Select value={String(days)} onValueChange={(v) => v && onDaysChange(Number(v))}>
        <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
        <SelectContent>
          {RANGES.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </CardHeader>
  );

  if (isPending) {
    return (
      <Card>
        {header}
        <CardContent className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        {header}
        <CardContent>
          <EmptyState title="No stock history yet" description="Days appear here once stock starts moving in this branch." />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      {header}
      <CardContent className="p-0">
        {/* Phone cards. Six figure groups will not fit a 360px table at any
            column-hiding setting, so below `lg` the same row renders as a card —
            the pattern RecentOrdersTable already uses. */}
        <div className="space-y-3 p-4 lg:hidden">
          {rows.map((r) => (
            <div key={r.date} className="rounded-lg border p-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium">{formatDay(r.date)}</p>
                <p className={cn('text-sm font-semibold tabular-nums', r.balanceQty < 0 && 'text-destructive')}>
                  {qty(r.balanceQty)} left · {money(r.balanceAmount)}
                </p>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Previous</p>
                  <Figure q={r.openingQty} a={r.openingAmount} />
                </div>
                <div>
                  <p className="text-muted-foreground">New</p>
                  <Figure q={r.newQty} a={r.newAmount} tone="text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="text-muted-foreground">Sold</p>
                  <Figure q={r.soldQty} a={r.soldAmount} tone="text-red-600 dark:text-red-400" />
                </div>
              </div>
              {otherQty(r) !== 0 && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Returns / adjustments: <span className="tabular-nums">{otherQty(r) > 0 ? '+' : ''}{qty(otherQty(r))}</span>
                  {' · '}
                  <span className="tabular-nums">{money(otherAmount(r))}</span>
                </p>
              )}
            </div>
          ))}
        </div>

        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full text-sm">
            <thead data-table-head>
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Date</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Previous Stock</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">New Stock</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sold</th>
                {/* Present so the row reconciles; reads as a dash on the many days
                    with neither a return nor a correction. */}
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ret / Adj</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Remaining Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.date} className="transition-colors hover:bg-muted/30">
                  <td className="whitespace-nowrap px-4 py-3 font-medium">{formatDay(r.date)}</td>
                  <td className="px-4 py-3 text-right"><Figure q={r.openingQty} a={r.openingAmount} /></td>
                  <td className="px-4 py-3 text-right">
                    <Figure q={r.newQty} a={r.newAmount} tone={r.newQty ? 'text-emerald-600 dark:text-emerald-400' : undefined} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Figure q={r.soldQty} a={r.soldAmount} tone={r.soldQty ? 'text-red-600 dark:text-red-400' : undefined} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {otherQty(r) === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <Figure q={otherQty(r)} a={otherAmount(r)} tone="text-sky-600 dark:text-sky-400" />
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Figure q={r.balanceQty} a={r.balanceAmount} tone={cn('font-semibold', r.balanceQty < 0 && 'text-destructive')} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Only shown when the ledger read actually hit its cap, which needs a very
            large catalogue over a wide window. Silence would read as "this is the
            whole period". */}
        {data?.capped && (
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            Too much history to summarise in one read — showing from {data.from} onwards.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
