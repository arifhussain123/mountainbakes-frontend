import type { PriceHistoryDoc } from '@mb/shared';
import { apiCall } from '@/utils/api';
import { qk } from '@/lib/queryKeys';
import { resolveToken, resolveQueryClient } from './config';
import { updateProductPrice, type PriceOpts } from './productPrice';

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

/**
 * The newest history row for a product, whatever its status.
 *
 * Returns the document rather than a number on purpose: the newest row may be a
 * `scheduled` future price that is NOT yet chargeable. Displaying that as the
 * current price would misquote customers. Inspect `.status` before using it, or
 * call getProductPrice() — which always returns the live, chargeable price.
 */
export async function getLatestPrice(productId: string, opts?: PriceOpts): Promise<PriceHistoryDoc | null> {
  const history = await getPriceHistory({ ...opts, productId, limit: 50 });
  return history[0] ?? null;
}

/** The pending future price change for a product, if one is queued. */
export async function getScheduledPrice(productId: string, opts?: PriceOpts): Promise<PriceHistoryDoc | null> {
  const history = await getPriceHistory({ ...opts, productId, limit: 50 });
  return history.find((h) => h.status === 'scheduled') ?? null;
}

/**
 * @deprecated Use `updateProductPrice`. History is append-only and is written
 * server-side by that same call, inside the transaction that computes the version
 * number, supersedes stale scheduled rows and updates products.price. A separate
 * client-side write path could desync history from the live price.
 */
export const addPriceHistory = updateProductPrice;
