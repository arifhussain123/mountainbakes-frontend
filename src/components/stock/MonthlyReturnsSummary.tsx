'use client';

import { Fragment, useEffect, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import type {
  MonthlyReturnsSummary as Summary,
  ProductionReturnStatus,
  ProductReturnsLine,
  ReturnsBucket,
} from '@mb/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SectionError } from '@/components/dashboard/branch-v2/parts';
import { formatCurrency } from '@/utils/currency';
import { logger } from '@/utils/logger';
import { cn } from '@/lib/utils';

/**
 * The month-to-date Product Returns summary, above the returns table on both
 * Production → Product Returns and the branch's Return Stock page.
 *
 * Lays out the server's figures (GET /api/production-returns/summary and
 * /api/stock/returns/summary) and computes none of its own — see
 * `shared/utils/returns-summary.ts` for what each one means and how a return is
 * priced. The headline cards count every return raised this month, whatever
 * its status; the status cards beside them split that same total, so an
 * unreviewed or refused request is never read as an approved one.
 *
 * The window is the server's, so the date line is too — it always names the
 * month the figures actually cover, never one computed here.
 */

const TONE: Record<ProductionReturnStatus | 'submitted', string> = {
  submitted: 'text-foreground',
  accepted: 'text-emerald-700 dark:text-emerald-400',
  pending: 'text-amber-700 dark:text-amber-400',
  rejected: 'text-red-700 dark:text-red-400',
  returned: 'text-sky-700 dark:text-sky-400',
};

const STATUS_ORDER: ProductionReturnStatus[] = ['accepted', 'pending', 'rejected', 'returned'];

const longDate = (d: string) => format(parseISO(d), 'd MMMM yyyy');
const qtyText = (n: number) => n.toLocaleString();
const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const bucketLine = (b: ReturnsBucket) => `${plural(b.qty, 'item', 'items')} · ${plural(b.count, 'return', 'returns')}`;

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone: string }) {
  return (
    <div className="min-w-0 rounded-lg border bg-card p-3">
      <p className="truncate text-xs font-medium text-muted-foreground">{label}</p>
      <p className={cn('mt-1 truncate text-xl font-bold tabular-nums', tone)}>{value}</p>
      <p className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}

/** Item-wise lines: product, code, qty, amount, transactions. */
function ProductLines({ lines, dense = false }: { lines: ProductReturnsLine[]; dense?: boolean }) {
  if (lines.length === 0) return <p className="py-3 text-center text-sm text-muted-foreground">No returns this month.</p>;
  return (
    <Table className={cn('whitespace-nowrap', dense && 'text-xs')}>
      <TableHeader>
        <TableRow>
          <TableHead>Product</TableHead>
          <TableHead>Code</TableHead>
          <TableHead className="text-right">Returned Qty</TableHead>
          <TableHead className="text-right">Return Amount</TableHead>
          <TableHead className="text-right">Transactions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((p) => (
          <TableRow key={p.productId}>
            <TableCell className="font-medium">{p.productName}</TableCell>
            <TableCell className="font-mono text-xs text-muted-foreground">{p.productCode || '—'}</TableCell>
            <TableCell className="text-right tabular-nums">{qtyText(p.qty)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatCurrency(p.amount)}</TableCell>
            <TableCell className="text-right tabular-nums">{p.count}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export function MonthlyReturnsSummary({
  summary,
  isLoading,
  isError,
  isFetching,
  error,
  onRetry,
  statusLabels,
  showBranches = false,
}: {
  summary: Summary | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  error: unknown;
  onRetry: () => void;
  /** Each page already names the statuses its own way ("Awaiting Review" vs "Awaiting Production"). */
  statusLabels: Record<ProductionReturnStatus, string>;
  /** Production: Branches Reporting, and a per-branch table with an All Branches total row. */
  showBranches?: boolean;
}) {
  const [openBranch, setOpenBranch] = useState<string | null>(null);

  useEffect(() => {
    if (error) logger.error('Monthly returns summary request failed', error);
  }, [error]);

  if (isError && !summary) {
    return <SectionError what="the monthly returns summary" onRetry={onRetry} retrying={isFetching} />;
  }

  const t = summary?.totals;
  const tiles = t && summary
    ? [
        { label: 'Total Returned Items', value: qtyText(t.submitted.qty), sub: 'every status, this month', tone: TONE.submitted },
        { label: 'Total Return Amount', value: formatCurrency(t.submitted.amount), sub: 'at each day’s price', tone: TONE.submitted },
        { label: 'Return Transactions', value: qtyText(t.submitted.count), sub: 'one per product returned', tone: TONE.submitted },
        ...(showBranches
          ? [{ label: 'Branches Reporting', value: qtyText(summary.branchesReporting), sub: `of ${plural(summary.branches.length, 'branch', 'branches')}`, tone: TONE.submitted }]
          : []),
        ...STATUS_ORDER.map((s) => ({ label: statusLabels[s], value: formatCurrency(t[s].amount), sub: bucketLine(t[s]), tone: TONE[s] })),
      ]
    : [];
  const tileCount = showBranches ? 8 : 7;
  const colSpan = 4 + STATUS_ORDER.length;

  return (
    <section aria-label="Monthly returns summary" className={cn('space-y-3 transition-opacity', isFetching && summary && 'opacity-70')}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {summary ? `Monthly Returns: ${longDate(summary.from)} – ${longDate(summary.to)}` : 'Monthly Returns'}
        </h3>
        <p className="text-xs text-muted-foreground">Valued at each product&apos;s price on the return date</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {isLoading || !t
          ? Array.from({ length: tileCount }, (_, i) => <Skeleton key={i} className="h-[86px] rounded-lg" />)
          : tiles.map((tile) => <Tile key={tile.label} {...tile} />)}
      </div>

      {t && t.unpricedCount > 0 ? (
        <p role="status" className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          <AlertTriangle className="size-4 shrink-0" />
          {t.unpricedCount} {t.unpricedCount === 1 ? 'return has' : 'returns have'} no price on record, so the amounts above leave {t.unpricedCount === 1 ? 'it' : 'them'} out.
          Their quantities are still counted.
        </p>
      ) : null}

      {summary && !showBranches ? (
        <details className="rounded-lg border bg-card" open={summary.products.length > 0 && summary.products.length <= 8}>
          <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
            Item-wise returns ({summary.products.length})
          </summary>
          <div className="border-t">
            <ProductLines lines={summary.products} />
          </div>
        </details>
      ) : null}

      {showBranches && summary ? (
        summary.branches.length === 0 ? (
          <p className="rounded-lg border bg-card py-6 text-center text-sm text-muted-foreground">No branches to summarise.</p>
        ) : (
          <div className="rounded-lg border bg-card">
            <Table className="whitespace-nowrap">
              <TableHeader>
                <TableRow>
                  <TableHead>Branch</TableHead>
                  <TableHead className="text-right">Return Qty</TableHead>
                  <TableHead className="text-right">Return Amount</TableHead>
                  <TableHead className="text-right">Transactions</TableHead>
                  {STATUS_ORDER.map((s) => (
                    <TableHead key={s} className="text-right">{statusLabels[s]}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.branches.map((b) => {
                  const open = openBranch === b.branchId;
                  return (
                    <Fragment key={b.branchId}>
                      <TableRow>
                        <TableCell className="font-medium">
                          <button
                            type="button"
                            className="inline-flex items-center gap-1 hover:underline disabled:no-underline disabled:opacity-100"
                            aria-expanded={open}
                            disabled={b.products.length === 0}
                            onClick={() => setOpenBranch(open ? null : b.branchId)}
                          >
                            {b.products.length > 0
                              ? (open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />)
                              : <span className="inline-block size-4" />}
                            {b.branchName.replace('Mountain Bakes ', '')}
                          </button>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{qtyText(b.submitted.qty)}</TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(b.submitted.amount)}</TableCell>
                        <TableCell className="text-right tabular-nums">{b.submitted.count}</TableCell>
                        {STATUS_ORDER.map((s) => (
                          <TableCell key={s} className="text-right tabular-nums">
                            {qtyText(b[s].qty)} · {formatCurrency(b[s].amount)}
                          </TableCell>
                        ))}
                      </TableRow>
                      {open ? (
                        <TableRow className="bg-muted/30 hover:bg-muted/30">
                          <TableCell colSpan={colSpan} className="p-2 pl-8">
                            <ProductLines lines={b.products} dense />
                          </TableCell>
                        </TableRow>
                      ) : null}
                    </Fragment>
                  );
                })}
              </TableBody>
              {summary.branches.length > 1 && t ? (
                <TableFooter>
                  <TableRow className="font-semibold">
                    <TableCell>All Branches</TableCell>
                    <TableCell className="text-right tabular-nums">{qtyText(t.submitted.qty)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(t.submitted.amount)}</TableCell>
                    <TableCell className="text-right tabular-nums">{t.submitted.count}</TableCell>
                    {STATUS_ORDER.map((s) => (
                      <TableCell key={s} className="text-right tabular-nums">
                        {qtyText(t[s].qty)} · {formatCurrency(t[s].amount)}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableFooter>
              ) : null}
            </Table>
            <details className="border-t">
              <summary className="cursor-pointer select-none px-3 py-2 text-sm font-medium">
                Item-wise returns, all branches ({summary.products.length})
              </summary>
              <div className="border-t">
                <ProductLines lines={summary.products} />
              </div>
            </details>
          </div>
        )
      ) : null}
    </section>
  );
}
