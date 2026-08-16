import type { Category } from '@mb/shared';
import { apiCall } from '@/utils/api';
import { qk } from '@/lib/queryKeys';
import { resolveToken, resolveQueryClient } from './config';
import type { PriceOpts } from './productPrice';

/**
 * Category reads that the price module needs — for validateCategories() and for
 * the category-wise export.
 *
 * Deliberately read-only. Category CRUD stays in lib/queries.ts; duplicating it
 * here would create a second, competing category module.
 */

export async function getCategories(opts?: PriceOpts): Promise<Category[]> {
  const token = await resolveToken(opts?.token);
  const qc = resolveQueryClient();
  const res = await qc.fetchQuery({
    queryKey: qk.categories(),
    queryFn: () => apiCall<{ categories: Category[] }>('/api/products/categories', {}, token),
    ...(opts?.force ? { staleTime: 0 } : {}),
  });
  return res.categories ?? [];
}
