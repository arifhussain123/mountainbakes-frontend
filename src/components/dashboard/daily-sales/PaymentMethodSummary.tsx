'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { PAYMENT_METHOD_LABELS } from '@/utils/constants';
import type { SalesAnalytics } from '@mb/shared';

/**
 * Where the money came in — one row per payment method.
 *
 * The rows sum EXACTLY to Total Sales above them, because the API's breakdown is
 * over paid orders only. Staff sales (unpaid: the goods left the counter and
 * nothing came in) are reported underneath as their own line, outside the total
 * and labelled as such — a card whose rows do not add up to its own heading is
 * worse than one that separates the exception out.
 *
 * The bar is a share of the largest method, not of the total: at four methods a
 * share-of-total bar leaves every row a stub and compares nothing. This one is
 * read as "how does Easypaisa compare with cash", which is the question the card
 * is actually asked.
 */
export function PaymentMethodSummary({
  analytics,
  loading,
  currency,
}: {
  analytics: SalesAnalytics | null;
  loading: boolean;
  currency: string;
}) {
  const methods = analytics?.paymentMethods ?? [];
  const largest = methods.reduce((max, m) => Math.max(max, m.total), 0);
  const money = (n: number) => `${currency}${Math.round(n).toLocaleString()}`;

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Payment Methods</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-1.5 w-full" />
              </div>
            ))}
          </div>
        ) : methods.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No payments recorded for this period.
          </p>
        ) : (
          <ul className="space-y-3">
            {methods.map((m) => (
              <li key={m.method} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium">
                    {PAYMENT_METHOD_LABELS[m.method] ?? m.method}
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {money(m.total)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-[width] duration-300"
                      style={{ width: `${largest > 0 ? (m.total / largest) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="w-20 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                    {m.count.toLocaleString()} {m.count === 1 ? 'sale' : 'sales'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        {/* Only when there were any. A permanent zero row would imply staff sales
            are a normal part of the mix rather than the exception they are. */}
        {!loading && (analytics?.staffCount ?? 0) > 0 && (
          <div className="mt-4 flex items-baseline justify-between gap-3 border-t pt-3 text-sm text-muted-foreground">
            <span className="truncate">
              Staff (unpaid) · {analytics!.staffCount.toLocaleString()}
            </span>
            <span className="shrink-0 tabular-nums">{money(analytics!.staffTotal)}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
