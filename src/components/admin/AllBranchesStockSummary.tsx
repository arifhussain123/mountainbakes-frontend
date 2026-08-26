'use client';

import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { useAllBranchesStockSummary } from '@/lib/queries';
import { useStockRealtime } from '@/hooks/useStockRealtime';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { BranchStockSummaryRow } from '@mb/shared';

/**
 * Admin → Branch Stock, "All branches".
 *
 * The branch-wise counterpart to the Branch Dashboard's stock history card: that
 * one slices ONE branch by day, this one slices ALL branches over a window. Both
 * are derived by the same server function, so the two can never disagree about
 * what a branch did — see computeAllBranchesStockSummary.
 *
 * ─── Reading the numbers ─────────────────────────────────────────────────────
 *
 * 1. The window TELESCOPES. Previous is the balance each branch started the
 *    window with, not a sum of daily openings; New / Sold / Ret-Adj are sums;
 *    Remaining is today's live balance. So
 *    Previous + New − Sold + Ret/Adj = Remaining holds per row and for the total.
 *
 * 2. AMOUNTS ARE STOCK VALUED AT TODAY'S PRICE LIST, not money taken — the same
 *    caveat the per-day card carries. Sold Amount is `units × current price`;
 *    the till figure lives in Reports, net of discounts and at each order's
 *    snapshotted price.
 */

const RANGES = [
  { value: '7', label: 'Last 7 days' },
  { value: '14', label: 'Last 14 days' },
  { value: '30', label: 'Last 30 days' },
];

/** Signed net of returns and corrections — what makes a row reconcile. */
const otherQty = (r: BranchStockSummaryRow) => r.adjustmentQty - r.returnedQty;
const otherAmount = (r: BranchStockSummaryRow) => r.adjustmentAmount - r.returnedAmount;

/** Branch names all start "Mountain Bakes " — dead weight in a table of them. */
const short = (name: string) => name.replace('Mountain Bakes ', '');

/**
 * Quantity over amount — the shape every figure cell takes.
 *
 * Module scope, not inside the component: a component declared during render is
 * a brand-new type on every pass, so React unmounts and remounts the whole
 * subtree instead of updating it (react-hooks/static-components). The currency
 * symbol therefore has to arrive as a prop rather than closing over `settings`.
 */
function Figure({ q, a, cur, tone }: { q: number; a: number; cur: string; tone?: string }) {
  return (
    <div className="leading-tight">
      <span className={cn('block font-medium tabular-nums', tone)}>{q.toLocaleString()}</span>
      <span className="block text-[11px] text-muted-foreground tabular-nums">
        {`${cur}${Math.round(a).toLocaleString()}`}
      </span>
    </div>
  );
}

export function AllBranchesStockSummary({
  days,
  onDaysChange,
}: {
  days: number;
  onDaysChange: (days: number) => void;
}) {
  const { token } = useAuth();
  const { settings } = useSettings();
  const cur = settings?.currencySymbol || 'Rs.';

  const { data, isPending } = useAllBranchesStockSummary(token ?? '', { days });
  // The same invalidation stream every other stock view rides.
  useStockRealtime();

  const rows = data?.rows ?? [];
  const money = (n: number) => `${cur}${Math.round(n).toLocaleString()}`;
  const qty = (n: number) => n.toLocaleString();

  // Every column sums across branches, including Previous and Remaining: those
  // are balances at one instant, so adding them across DIFFERENT branches is a
  // real figure (total stock held by the company) — unlike adding one branch's
  // openings across days, which would count the same stock repeatedly.
  const totals = rows.reduce(
    (acc, r) => ({
      openingQty: acc.openingQty + r.openingQty,
      openingAmount: acc.openingAmount + r.openingAmount,
      newQty: acc.newQty + r.newQty,
      newAmount: acc.newAmount + r.newAmount,
      soldQty: acc.soldQty + r.soldQty,
      soldAmount: acc.soldAmount + r.soldAmount,
      otherQty: acc.otherQty + otherQty(r),
      otherAmount: acc.otherAmount + otherAmount(r),
      balanceQty: acc.balanceQty + r.balanceQty,
      balanceAmount: acc.balanceAmount + r.balanceAmount,
    }),
    { openingQty: 0, openingAmount: 0, newQty: 0, newAmount: 0, soldQty: 0, soldAmount: 0, otherQty: 0, otherAmount: 0, balanceQty: 0, balanceAmount: 0 },
  );

  const header = (
    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 pb-3">
      <div>
        <CardTitle className="text-base">All Branches — Stock Activity</CardTitle>
        <p className="text-xs text-muted-foreground">
          Qty and value per branch{data ? ` · ${data.from} → ${data.to}` : ''} · stock valued at current prices, so Sold here is not the till total
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
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        {header}
        <CardContent>
          <EmptyState title="No branches" description="Add an active branch and its stock activity appears here." />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      {header}
      <CardContent className="p-0">
        {/* Phone cards — six figure groups will not fit a narrow table, the same
            reason the per-day card switches shape below `lg`. */}
        <div className="space-y-3 p-4 lg:hidden">
          {rows.map((r) => (
            <div key={r.branchId} className="rounded-lg border p-3">
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-medium">{short(r.branchName)}</p>
                <p className={cn('text-sm font-semibold tabular-nums', r.balanceQty < 0 && 'text-destructive')}>
                  {qty(r.balanceQty)} left · {money(r.balanceAmount)}
                </p>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                <div>
                  <p className="text-muted-foreground">Previous</p>
                  <Figure q={r.openingQty} a={r.openingAmount} cur={cur} />
                </div>
                <div>
                  <p className="text-muted-foreground">New</p>
                  <Figure q={r.newQty} a={r.newAmount} cur={cur} tone="text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="text-muted-foreground">Sold</p>
                  <Figure q={r.soldQty} a={r.soldAmount} cur={cur} tone="text-red-600 dark:text-red-400" />
                </div>
              </div>
              {otherQty(r) !== 0 && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Returns / adjustments: <span className="tabular-nums">{otherQty(r) > 0 ? '+' : ''}{qty(otherQty(r))}</span>
                  {' · '}
                  <span className="tabular-nums">{money(otherAmount(r))}</span>
                </p>
              )}
              {/* Only when THIS branch was short — the window differs per branch. */}
              {r.capped && (
                <p className="mt-1 text-[11px] text-muted-foreground">Covers {r.from} onwards only.</p>
              )}
            </div>
          ))}
        </div>

        <div className="hidden overflow-x-auto lg:block">
          <table className="w-full text-sm">
            <thead data-table-head>
              <tr>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">Branch</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Previous Stock</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">New Stock</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sold</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Ret / Adj</th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-muted-foreground">Remaining Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.branchId} className="transition-colors hover:bg-muted/30">
                  <td className="whitespace-nowrap px-4 py-3 font-medium">
                    {short(r.branchName)}
                    {r.capped && (
                      <span className="block text-[11px] font-normal text-muted-foreground">from {r.from}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right"><Figure q={r.openingQty} a={r.openingAmount} cur={cur} /></td>
                  <td className="px-4 py-3 text-right">
                    <Figure q={r.newQty} a={r.newAmount} cur={cur} tone={r.newQty ? 'text-emerald-600 dark:text-emerald-400' : undefined} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Figure q={r.soldQty} a={r.soldAmount} cur={cur} tone={r.soldQty ? 'text-red-600 dark:text-red-400' : undefined} />
                  </td>
                  <td className="px-4 py-3 text-right">
                    {otherQty(r) === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <Figure q={otherQty(r)} a={otherAmount(r)} cur={cur} tone="text-sky-600 dark:text-sky-400" />
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Figure q={r.balanceQty} a={r.balanceAmount} cur={cur} tone={cn('font-semibold', r.balanceQty < 0 && 'text-destructive')} />
                  </td>
                </tr>
              ))}
            </tbody>
            {/* The company-wide line. Present because the question "how much stock
                is out there" is the one a branch-wise table invites and cannot
                otherwise answer without mental arithmetic. */}
            <tfoot className="border-t-2 bg-muted/30">
              <tr>
                <td className="px-4 py-3 font-semibold">Total</td>
                <td className="px-4 py-3 text-right"><Figure q={totals.openingQty} a={totals.openingAmount} cur={cur} tone="font-semibold" /></td>
                <td className="px-4 py-3 text-right"><Figure q={totals.newQty} a={totals.newAmount} cur={cur} tone="font-semibold" /></td>
                <td className="px-4 py-3 text-right"><Figure q={totals.soldQty} a={totals.soldAmount} cur={cur} tone="font-semibold" /></td>
                <td className="px-4 py-3 text-right">
                  {totals.otherQty === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    <Figure q={totals.otherQty} a={totals.otherAmount} cur={cur} tone="font-semibold" />
                  )}
                </td>
                <td className="px-4 py-3 text-right"><Figure q={totals.balanceQty} a={totals.balanceAmount} cur={cur} tone="font-semibold" /></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {data?.capped && (
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">
            At least one branch has more history than can be summarised in one read — those rows are marked with the date they start from.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
