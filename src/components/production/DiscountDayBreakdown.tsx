'use client';

import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react';
import { useDiscountDayCheck } from '@/lib/discountSummaryQueries';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatCurrency } from '@/utils/currency';
import { formatDate } from '@/utils/date';
import { cn } from '@/lib/utils';

/**
 * Production → Discounts → View → Product breakdown, and the same view on
 * Branch → Discounts → View (`side="branch"`, the branch's own day only).
 *
 * The branch's till (POS) discounts for the claim's business day, one row per
 * product, against what the branch claimed for that same day. When the two
 * totals differ the Actual / Claimed / Difference figures are shown in red, so
 * the reviewer sees the gap before approving.
 */
export function DiscountDayBreakdown({
  token,
  branchId,
  branchName,
  date,
  side = 'production',
}: {
  token: string;
  branchId: string;
  branchName: string;
  date: string;
  side?: 'production' | 'branch';
}) {
  const q = useDiscountDayCheck(token, branchId, date, side);

  if (q.isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading till discounts…
      </div>
    );
  }
  if (q.isError || !q.data) {
    return (
      <div className="space-y-2 py-6 text-center text-sm">
        <p className="text-destructive">Could not load the product breakdown.</p>
        <Button size="sm" variant="outline" onClick={() => void q.refetch()}>Retry</Button>
      </div>
    );
  }

  const d = q.data;

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        {branchName} · {formatDate(date)} · discounts given at the till
      </p>

      <div className="max-h-[45vh] overflow-y-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead className="text-right">Discount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {d.products.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-6 text-center text-muted-foreground">
                  No discounts were given at the till on this day.
                </TableCell>
              </TableRow>
            ) : (
              d.products.map((p) => (
                <TableRow key={p.productId ?? `name:${p.productName}`}>
                  <TableCell className="font-medium whitespace-normal">{p.productName}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.qty.toLocaleString()}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(p.discount)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2} className="font-semibold">Total</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatCurrency(d.actualTotal)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>

      {d.matches ? (
        <div className="flex items-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Claimed amount matches the till: {formatCurrency(d.claimedTotal)}
        </div>
      ) : (
        <div className="space-y-2 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4 shrink-0" /> Claimed amount does not match the till
          </p>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
            <dt>Actual amount</dt>
            <dd className="text-right font-semibold tabular-nums">{formatCurrency(d.actualTotal)}</dd>
            <dt>Claimed amount</dt>
            <dd className="text-right font-semibold tabular-nums">{formatCurrency(d.claimedTotal)}</dd>
            <dt>Difference amount</dt>
            <dd className={cn('text-right font-bold tabular-nums')}>
              {d.difference > 0 ? '+' : ''}
              {formatCurrency(d.difference)}
            </dd>
          </dl>
          <p className="text-xs">
            {d.difference > 0
              ? 'The branch claimed more than the till gave away.'
              : 'The branch claimed less than the till gave away.'}
          </p>
        </div>
      )}

      {d.claims.length > 1 && (
        <p className="text-xs text-muted-foreground">
          Claimed amount is the total of {d.claims.length} claims for this day:{' '}
          {d.claims.map((c) => `${c.demandNumber ?? '—'} ${formatCurrency(c.amount)}`).join(', ')}. Rejected
          claims are not counted.
        </p>
      )}
    </div>
  );
}
