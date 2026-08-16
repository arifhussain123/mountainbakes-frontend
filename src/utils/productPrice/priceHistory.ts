import type { PriceHistoryDoc } from '@mb/shared';
import { apiCall } from '@/utils/api';
import { qk } from '@/lib/queryKeys';
import { resolveToken, resolveQueryClient } from './config';
import type { PriceOpts } from './productPrice';

/**
 * Price-change history. Append-only and written exclusively server-side, inside
 * the same transaction that updates products.price — so this module is read-only
 * by design (RLS also denies all client writes to the table).
 *
 * Every price change, manual or bulk import, appends one immutable row carrying a
 * per-product monotonic versionNumber. Previous sales are unaffected: orders
 * snapshot unitPrice at sale time.
 */

export interface GetPriceHistoryOpts extends PriceOpts {
  productId?: string;
  limit?: number;
}

/** Most recent first (the server sorts). */
export async function getPriceHistory(opts?: GetPriceHistoryOpts): Promise<PriceHistoryDoc[]> {
  const token = await resolveToken(opts?.token);
  const qc = resolveQueryClient();
  const params = new URLSearchParams();
  if (opts?.productId) params.set('productId', opts.productId);
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();

  const res = await qc.fetchQuery({
    queryKey: qk.priceHistory(opts?.productId),
    queryFn: () =>
      apiCall<{ history: PriceHistoryDoc[]; total: number }>(
        `/api/products/price/history${qs ? `?${qs}` : ''}`,
        {},
        token,
      ),
    ...(opts?.force ? { staleTime: 0 } : {}),
  });
  return res.history ?? [];
}
