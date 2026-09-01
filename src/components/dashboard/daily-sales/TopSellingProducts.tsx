'use client';

import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SALES_TOP_PRODUCT_LIMITS, type SalesAnalyticsProduct, type SalesTopProductLimit } from '@mb/shared';

/**
 * Top Selling Products for the selected window.
 *
 * The depth (5 or 10) is a SERVER parameter, not a slice taken here — the API
 * ranks and truncates in SQL, so asking for ten does not mean fetching every
 * product sold and throwing most of them away in the browser.
 *
 * Two layouts, the same rows: a ranked list on a phone and a table from `md`
 * up. A four-column table cannot hold its shape at 360px, and the pattern
 * matches the Top 10 Products card on the Reports page.
 */
export function TopSellingProducts({
  products,
  loading,
  currency,
  limit,
  onLimitChange,
}: {
  products: SalesAnalyticsProduct[];
  loading: boolean;
  currency: string;
  limit: SalesTopProductLimit;
  onLimitChange: (limit: SalesTopProductLimit) => void;
}) {
  const money = (n: number) => `${currency}${Math.round(n).toLocaleString()}`;
  // Quantities are numeric(14,3) — a cake is sold whole, but a weighed item is
  // not, so trailing zeros are trimmed rather than the figure being rounded to
  // an integer that would misreport 0.5 kg as "1".
  const qty = (n: number) => Number(n.toFixed(3)).toLocaleString();

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Top Selling Products</CardTitle>
        <CardAction>
          <Select
            value={String(limit)}
            onValueChange={(v) => v && onLimitChange(Number(v) as SalesTopProductLimit)}
          >
            <SelectTrigger className="h-8 w-24" aria-label="How many products to rank">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SALES_TOP_PRODUCT_LIMITS.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  Top {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>

      <CardContent className="px-0">
        {loading ? (
          <div className="space-y-2 px-(--card-spacing)">
            {Array.from({ length: Math.min(limit, 5) }, (_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : products.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No products sold in this period.
          </p>
        ) : (
          <>
            {/* Phone — a ranked leaderboard rather than a table. */}
            <ul className="divide-y divide-border md:hidden">
              {products.map((p, i) => (
                <li
                  key={p.productId || `name:${p.productName}`}
                  className="flex items-center gap-3 px-(--card-spacing) py-2.5"
                >
                  <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{p.productName}</p>
                    {p.categoryName && (
                      <p className="truncate text-xs text-muted-foreground">{p.categoryName}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums">{money(p.sales)}</p>
                    <p className="text-xs tabular-nums text-muted-foreground">{qty(p.qty)} sold</p>
                  </div>
                </li>
              ))}
            </ul>

            {/* `print-doc-table` so the Print export gets the table and not the
                phone list, whatever the screen width was when it was pressed. */}
            <table className="hidden w-full text-sm md:table print-doc-table">
              <thead>
                <tr className="border-b">
                  <th className="px-(--card-spacing) py-2 text-left text-xs font-semibold text-muted-foreground">
                    #
                  </th>
                  <th className="py-2 text-left text-xs font-semibold text-muted-foreground">
                    Product
                  </th>
                  <th className="py-2 text-center text-xs font-semibold text-muted-foreground">
                    Qty Sold
                  </th>
                  <th className="px-(--card-spacing) py-2 text-right text-xs font-semibold text-muted-foreground">
                    Sales
                  </th>
                </tr>
              </thead>
              <tbody>
                {products.map((p, i) => (
                  <tr
                    key={p.productId || `name:${p.productName}`}
                    className="border-b last:border-0 transition-colors hover:bg-muted/40"
                  >
                    <td className="px-(--card-spacing) py-2 tabular-nums text-muted-foreground">
                      {i + 1}
                    </td>
                    <td className="py-2">
                      <p className="font-medium">{p.productName}</p>
                      {p.categoryName && (
                        <p className="text-xs text-muted-foreground">{p.categoryName}</p>
                      )}
                    </td>
                    {/* Centred with tabular-nums, per the table conventions: a
                        centred figure column jitters as the digit count changes
                        row to row unless the digits are fixed-width. */}
                    <td className="py-2 text-center tabular-nums">{qty(p.qty)}</td>
                    <td className="px-(--card-spacing) py-2 text-right font-semibold tabular-nums">
                      {money(p.sales)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
