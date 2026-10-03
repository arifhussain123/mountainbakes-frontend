'use client';

import { useAuth } from '@/hooks/useAuth';
import { useReturnStock } from '@/lib/queries';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDate } from '@/utils/date';

/**
 * Branch Return Stock — what branches have sent back, shown BESIDE Production
 * Stock and never inside it.
 *
 * Its own endpoint and its own table on purpose. A returned unit is not
 * production stock: it cannot be sold at the counter or sent to a branch until
 * someone explicitly transfers it, and that transfer is the "Transferred" column
 * here and the "From Returns" column above. Nothing on this page adds the two
 * balances together.
 */
export function BranchReturnStockPanel({ date, isToday }: { date: string; isToday: boolean }) {
  const { token } = useAuth();
  const q = useReturnStock(token, date);
  const rows = q.data ?? [];
  const total = rows.reduce((s, r) => s + r.balance, 0);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">Branch Return Stock</h3>
          <p className="text-sm text-muted-foreground">
            Goods returned by branches — {isToday ? 'today' : formatDate(date)}. A separate
            inventory: it is not part of the Production Stock balance above.
          </p>
        </div>
        <div className="rounded-lg border bg-card px-3 py-2 text-right">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Return Stock</p>
          <p className="text-xl font-semibold tabular-nums">{total}</p>
        </div>
      </div>

      {q.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
        </div>
      ) : q.isError ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          Return stock could not be loaded.
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border p-4 text-sm text-muted-foreground">
          {isToday ? 'No return stock on hand.' : `No return stock on ${formatDate(date)}.`}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-muted text-left text-xs">
              <tr>
                <th className="px-3 py-2 font-medium">ID</th>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 text-center font-medium">Opening</th>
                <th className="px-3 py-2 text-center font-medium">Returned</th>
                <th className="px-3 py-2 text-center font-medium">Transferred</th>
                <th className="px-3 py-2 text-center font-medium">Return Stock</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.productId}>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{r.stockCode}</td>
                  <td className="px-3 py-2 font-medium">{r.productName}</td>
                  <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">{r.opening}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{r.returnedToday ? `+${r.returnedToday}` : '—'}</td>
                  <td className="px-3 py-2 text-center tabular-nums">{r.transferredToday ? `−${r.transferredToday}` : '—'}</td>
                  <td className="px-3 py-2 text-center font-semibold tabular-nums">{r.balance}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
