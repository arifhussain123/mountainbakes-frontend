'use client';

import type { ProductionStockRow } from '@mb/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/hooks/useAuth';
import { useProductionStockDetail } from '@/lib/queries';
import { formatDate } from '@/utils/date';
import { cn } from '@/lib/utils';
import { LedgerQty, LedgerTypeChip } from './StockLedgerTypes';

/**
 * One product, one business day: its figures and the whole movement trail behind
 * them (§14).
 *
 * ── WHY THE TRAIL RUNS FORWARDS ──────────────────────────────────────────────
 * The listing on the main page is newest-first, because there it is a log being
 * monitored. Here it is an EXPLANATION — how the day got from its opening figure
 * to its balance — and an explanation reads in the order things happened. The
 * OPENING and CLOSING rows are the two ends of that arithmetic, which is why they
 * are shown here and nowhere else.
 *
 * ── THE RESERVED ROW IS NOT PART OF THE SUM ──────────────────────────────────
 * DEMAND_RESERVED rows are claims on stock that has not moved. They are shown
 * because "why can I only sell 20 of the 60 on the shelf" is exactly the question
 * this dialog is opened to answer, but they sit outside the opening→closing
 * arithmetic and are visually separated so nobody tries to add them in.
 */

/** 'HH:mm' in Karachi, for the movement clock column. */
function clockOf(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('en-PK', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Karachi',
    });
  } catch {
    return '—';
  }
}

function Figure({ label, value, strong, tone }: { label: string; value: number; strong?: boolean; tone?: 'bad' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={cn(
          'tabular-nums',
          strong ? 'text-base font-semibold' : 'text-sm',
          tone === 'bad' && value < 0 && 'text-red-600 dark:text-red-400',
        )}
      >
        {value}
      </span>
    </div>
  );
}

export interface ProductStockDetailProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: ProductionStockRow | null;
  date: string;
}

export function ProductStockDetail({ open, onOpenChange, row, date }: ProductStockDetailProps) {
  const { token } = useAuth();
  const q = useProductionStockDetail(token, row?.productId ?? null, date, { enabled: open && !!row });

  // The row already on screen, so the dialog opens with figures rather than a
  // skeleton, and the fetched copy replaces it when it lands. They agree — both
  // come from the same server derivation — so the swap is invisible.
  const figures = q.data?.figures ?? row;
  const movements = q.data?.movements ?? [];
  const posted = movements.filter((m) => m.transactionType !== 'DEMAND_RESERVED');
  const reserved = movements.filter((m) => m.transactionType === 'DEMAND_RESERVED');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent mobile="fullscreen" className="md:max-w-3xl">
        {row && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-baseline gap-2">
                <span>{row.productName}</span>
                <span className="font-mono text-xs font-normal text-muted-foreground">{row.stockCode}</span>
              </DialogTitle>
              <p className="text-sm text-muted-foreground">
                {formatDate(date)}
                {row.categoryName ? ` · ${row.categoryName}` : ''}
              </p>
            </DialogHeader>

            <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
              {figures && (
                <div className="grid gap-x-6 rounded-lg border bg-muted/40 p-3 sm:grid-cols-2">
                  <div className="divide-y">
                    <Figure label="Opening Stock" value={figures.opening} />
                    <Figure label="Prepared Stock" value={figures.preparedToday} />
                    <Figure label="Total Stock" value={figures.totalStock} strong />
                    <Figure label="Return Stock" value={figures.returned} />
                  </div>
                  <div className="divide-y">
                    <Figure label="Branch Demand (outstanding)" value={figures.branchDemand} />
                    <Figure label="Demand fulfilled" value={figures.demandFulfilled} />
                    <Figure label="Sale" value={figures.soldToday} />
                    <Figure label="Adjustment" value={figures.adjustment} />
                    <Figure label="Balance" value={figures.balance} strong tone="bad" />
                  </div>
                </div>
              )}

              {q.isLoading && movements.length === 0 ? (
                <div className="space-y-2">
                  {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
                </div>
              ) : (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead className="bg-muted text-left text-xs">
                      <tr>
                        <th className="px-3 py-2 font-medium">Time</th>
                        <th className="px-3 py-2 font-medium">Movement</th>
                        <th className="px-3 py-2 text-right font-medium">Qty</th>
                        <th className="px-3 py-2 font-medium">Branch</th>
                        <th className="px-3 py-2 font-medium">Reference</th>
                        <th className="px-3 py-2 font-medium">User</th>
                      </tr>
                    </thead>
                    <tbody>
                      {posted.map((m) => {
                        const bookend = m.transactionType === 'OPENING' || m.transactionType === 'CLOSING';
                        return (
                          <tr key={m.id} className={cn('border-t', bookend && 'bg-muted/40')}>
                            <td className="px-3 py-2 tabular-nums text-muted-foreground">
                              {bookend ? '—' : clockOf(m.createdAt)}
                            </td>
                            <td className="px-3 py-2"><LedgerTypeChip type={m.transactionType} /></td>
                            <td className="px-3 py-2 text-right">
                              {bookend ? (
                                <span className="font-semibold tabular-nums">{m.qty}</span>
                              ) : (
                                <LedgerQty qty={m.qty} />
                              )}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">{m.branchName ?? '—'}</td>
                            <td className="px-3 py-2">
                              {/* The transaction number is what someone quotes on a
                                  query, so it leads. The business reference (demand
                                  number, order id) sits under it. */}
                              {m.transactionNo ? (
                                <span className="font-mono text-xs">{m.transactionNo}</span>
                              ) : (
                                <span className="text-xs text-muted-foreground">derived</span>
                              )}
                              {m.referenceId && (
                                <p className="text-xs text-muted-foreground">{m.referenceId}</p>
                              )}
                            </td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">
                              {m.createdByName ?? '—'}
                              {m.remarks && <p className="italic">{m.remarks}</p>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Separated from the table above, deliberately. These have not moved
                  stock and are not part of the opening→closing sum; putting them in
                  the same body would invite adding them into it. */}
              {reserved.length > 0 && (
                <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
                    Reserved against branch demand — still on the shelf
                  </p>
                  <ul className="mt-2 space-y-1 text-sm">
                    {reserved.map((m) => (
                      <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-amber-900/80 dark:text-amber-200/80">
                          {m.branchName ?? 'Branch'}
                          {m.referenceId && <span className="ml-1.5 font-mono text-xs">{m.referenceId}</span>}
                        </span>
                        <span className="font-medium tabular-nums text-amber-800 dark:text-amber-300">
                          {Math.abs(m.qty)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-xs text-amber-800/70 dark:text-amber-300/70">
                    Not deducted from the balance above — these units leave the pool when the
                    branch verifies the delivery.
                  </p>
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
