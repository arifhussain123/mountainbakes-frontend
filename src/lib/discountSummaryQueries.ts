import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { businessDateStr, type MonthlyDiscountSummary } from '@mb/shared';
import { apiCall } from '@/utils/api';
import { discountSummaryKeys } from './queryKeys';

/**
 * The monthly Branch Discount summary hooks — the server sums, these only fetch.
 * See `shared/utils/discount-summary.ts` for what each figure means.
 *
 * Kept out of queries.ts only so the file stays small; the conventions are the
 * same (15 s live stale time, previous data held while a refetch runs).
 */

const LIVE_STALE_TIME = 15_000;

/** Production / super admin: every active branch and the overall total, or one branch when `branchId` is set. */
export function useProductionDiscountSummary(token: string, branchId: string | null) {
  const today = businessDateStr();
  return useQuery({
    queryKey: discountSummaryKeys.production(branchId, today),
    queryFn: () =>
      apiCall<MonthlyDiscountSummary>(
        `/api/production-discounts/summary${branchId ? `?branchId=${encodeURIComponent(branchId)}` : ''}`,
        {},
        token,
      ),
    enabled: !!token,
    staleTime: LIVE_STALE_TIME,
    placeholderData: keepPreviousData,
  });
}

/**
 * A branch's own month — or the page's Date filter range when `from`/`to` are
 * set. The server takes the branch from the JWT.
 */
export function useBranchDiscountSummary(token: string, range?: { from?: string | null; to?: string | null }) {
  const today = businessDateStr();
  const params = new URLSearchParams();
  if (range?.from) params.set('from', range.from);
  if (range?.to) params.set('to', range.to);
  const qs = params.toString();
  return useQuery({
    queryKey: discountSummaryKeys.branch(today, range?.from || null, range?.to || null),
    queryFn: () => apiCall<MonthlyDiscountSummary>(`/api/branch-discounts/summary${qs ? `?${qs}` : ''}`, {}, token),
    enabled: !!token,
    staleTime: LIVE_STALE_TIME,
    placeholderData: keepPreviousData,
  });
}
