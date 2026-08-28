'use client';

// Centralised TanStack Query hooks for server state. These wrap the Express API
// (`apiCall`) so every consumer gets caching, request de-duplication and background
// revalidation for free, and mutations invalidate the right caches on success.
//
// The QueryClient (see providers/QueryProvider.tsx) defaults to staleTime 60s, so
// repeat reads within a minute are served from cache with no network round-trip.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { apiCall } from '@/utils/api';
import { qk } from './queryKeys';
// businessDayBounds is a VALUE, not a type — Branch Closing turns a business
// date into the UTC instants /api/orders filters created_at on.
import { businessDayBounds, businessDateStr } from '@mb/shared';
import type {
  ApproveBranchUserRequestInput,
  Branch,
  BranchStockHistoryRow,
  StockReconciliation,
  BranchStockSummaryResult,
  BranchProductionOrder,
  BranchUserRequest,
  CreateBranchUserRequestInput,
  Expense,
  Order,
  RejectBranchUserRequestInput,
  Category,
  Product,
  ProductionBalanceDoc,
  ProductionReturn,
  ProductionReturnStatus,
  BranchDiscount,
  BranchDiscountStatus,
  LoginSession,
  ProductionStockRow,
  ProductionStockLedgerRow,
  ProductionStockFigures,
  PriceHistoryDoc,
  PackingMaterial,
  PackingMaterialUsageRow,
  CreatePackingMaterialInput,
  UpdatePackingMaterialInput,
  BranchLocation,
  BranchLocationRow,
  BranchLocationStats,
  UpsertBranchLocationInput,
  ReportSummary,
  StockRow,
  StockFigures,
  ConsolidatedDemandRow,
  EventBranchDemand,
  EventDashboardSummary,
  EventDispatchResult,
  EventNotificationRow,
  EventProductionStatusRow,
  EventScheduleResult,
  SpecialEventView,
} from '@mb/shared';

// Query keys live in ./queryKeys so non-React code (@/utils/productPrice) can reuse
// them without importing these hooks. Re-exported here for existing call sites.
export { qk };

// `remarks` was removed from the New Production Order form; the API's Zod schema
// defaults it to '' server-side, so it is simply not sent.
type ProductionOrderItem = { productId: string; qty: number };

/** Optional packing-material line submitted with the same demand. */
type ProductionOrderPackingItem = { packingMaterialId: string; qty: number };
/** Mirrors SpecialOrderItemSchema in @mb/shared — name and qty required, the rest optional. */
type SpecialOrderItemInput = {
  name: string;
  qty: number;
  description: string;
  attachmentIds: string[];
};

// Live/intraday queries: kept fresh by notification-driven invalidation
// (useProductionRealtime / usePriceRealtime) rather than by constant refetching.
// A short staleTime avoids re-hitting the API on every remount/navigation while
// genuine changes still invalidate immediately. Window-focus refetch is disabled
// globally in QueryProvider, so this is now the only refetch trigger on remount.
const LIVE_STALE_TIME = 15_000;

export function useProducts(token: string, opts?: { isActive?: boolean; enabled?: boolean }) {
  const isActive = opts?.isActive;
  return useQuery({
    queryKey: qk.products(isActive),
    queryFn: () =>
      apiCall<{ products: Product[] }>(
        `/api/products${isActive !== undefined ? `?isActive=${isActive}` : ''}`,
        {},
        token,
      ),
    select: (r) => r.products ?? [],
    enabled: !!token && (opts?.enabled ?? true),
  });
}

export function useCategories(token: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.categories(),
    queryFn: () => apiCall<{ categories: Category[] }>('/api/products/categories', {}, token),
    select: (r) => r.categories ?? [],
    enabled: !!token && (opts?.enabled ?? true),
  });
}

// Price history. The write side of the price facade (add / remove / update /
// import) had React bindings here too; nothing ever called them — every screen
// goes through @/utils/productPrice directly — so they were removed rather than
// left as a second, untested way to change a price.

export function usePriceHistory(
  token: string,
  opts?: { productId?: string; limit?: number; enabled?: boolean },
) {
  const params = new URLSearchParams();
  if (opts?.productId) params.set('productId', opts.productId);
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();

  return useQuery({
    queryKey: qk.priceHistory(opts?.productId),
    queryFn: () =>
      apiCall<{ history: PriceHistoryDoc[]; total: number }>(
        `/api/products/price/history${qs ? `?${qs}` : ''}`,
        {},
        token,
      ),
    select: (r) => r.history ?? [],
    enabled: !!token && (opts?.enabled ?? true),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Branch locations — the geofence catalogue (migration 48).
//
// The listing deliberately returns EVERY branch, configured or not: the admin
// module's "Missing GPS" tile counts the ones without a location, so they have to
// be in the same payload rather than filtered out of it.
// ─────────────────────────────────────────────────────────────────────────────

interface BranchLocationsResponse {
  branches: BranchLocationRow[];
  stats: BranchLocationStats;
  geofencingEnabled: boolean;
}

export function useBranchLocations(token: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.branchLocations(),
    queryFn: () => apiCall<BranchLocationsResponse>('/api/branch-locations', {}, token),
    enabled: !!token && (opts?.enabled ?? true),
  });
}

/**
 * Prefix invalidation, so both the listing and the log views refresh. A location
 * change moves the "GPS Configured" / "Missing GPS" tiles as well as the row.
 */
function invalidateBranchLocations(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['branchLocations'] });
  qc.invalidateQueries({ queryKey: ['geofenceLogs'] });
}

export function useUpsertBranchLocation(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { branchId: string; input: UpsertBranchLocationInput }) =>
      apiCall<{ location: BranchLocation }>(
        `/api/branch-locations/${v.branchId}`,
        { method: 'PUT', body: JSON.stringify(v.input) },
        token,
      ),
    onSuccess: () => invalidateBranchLocations(qc),
  });
}

export function useSetBranchLocationStatus(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { branchId: string; isActive: boolean }) =>
      apiCall(
        `/api/branch-locations/${v.branchId}/status`,
        { method: 'PATCH', body: JSON.stringify({ isActive: v.isActive }) },
        token,
      ),
    onSuccess: () => invalidateBranchLocations(qc),
  });
}

export function useDeleteBranchLocation(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (branchId: string) =>
      apiCall(`/api/branch-locations/${branchId}`, { method: 'DELETE' }, token),
    onSuccess: () => invalidateBranchLocations(qc),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Packing materials — company service items with no price, requested alongside a
// branch demand. Kept in their own table and their own endpoint (see migration 38).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `includeInactive` is the admin catalogue view. The server only honours it for a
 * super admin, so a branch or production user always gets active rows — which is
 * what stops a disabled material appearing in the demand dropdown.
 */
export function usePackingMaterials(token: string, opts?: { includeInactive?: boolean; enabled?: boolean }) {
  const includeInactive = opts?.includeInactive ?? false;
  return useQuery({
    queryKey: qk.packingMaterials(includeInactive),
    queryFn: () =>
      apiCall<{ packingMaterials: PackingMaterial[] }>(
        `/api/packing-materials${includeInactive ? '?includeInactive=true' : ''}`,
        {},
        token,
      ),
    select: (r) => r.packingMaterials ?? [],
    enabled: !!token && (opts?.enabled ?? true),
  });
}

function invalidatePackingMaterials(qc: ReturnType<typeof useQueryClient>) {
  // Prefix match: both the active-only and include-inactive cache entries.
  qc.invalidateQueries({ queryKey: ['packingMaterials'] });
}

export function useCreatePackingMaterial(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreatePackingMaterialInput) =>
      apiCall('/api/packing-materials', { method: 'POST', body: JSON.stringify(input) }, token),
    onSuccess: () => invalidatePackingMaterials(qc),
  });
}

export function useUpdatePackingMaterial(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; input: UpdatePackingMaterialInput }) =>
      apiCall(`/api/packing-materials/${v.id}`, { method: 'PUT', body: JSON.stringify(v.input) }, token),
    onSuccess: () => invalidatePackingMaterials(qc),
  });
}

export function useDeletePackingMaterial(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiCall(`/api/packing-materials/${id}`, { method: 'DELETE' }, token),
    onSuccess: () => invalidatePackingMaterials(qc),
  });
}

/** Daily Packing Material Usage report. `deliveredQty` is derived from approval. */
export function usePackingUsage(
  token: string,
  filters: { from?: string | null; to?: string | null; branchId?: string | null; packingMaterialId?: string | null },
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: qk.packingUsage(filters),
    queryFn: () => {
      const qs = new URLSearchParams();
      if (filters.from) qs.set('from', filters.from);
      if (filters.to) qs.set('to', filters.to);
      if (filters.branchId) qs.set('branchId', filters.branchId);
      if (filters.packingMaterialId) qs.set('packingMaterialId', filters.packingMaterialId);
      const query = qs.toString();
      return apiCall<{ usage: PackingMaterialUsageRow[] }>(
        `/api/reports/packing-usage${query ? `?${query}` : ''}`,
        {},
        token,
      );
    },
    select: (r) => r.usage ?? [],
    enabled: !!token && (opts?.enabled ?? true),
  });
}

export function useBranches(token: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.branches(),
    queryFn: () => apiCall<{ branches: Branch[] }>('/api/branches', {}, token),
    select: (r) => r.branches ?? [],
    enabled: !!token && (opts?.enabled ?? true),
  });
}

/**
 * `range` narrows the summary to an explicit window instead of a named period.
 *
 * The API only reads `from`/`to` when `period` is NOT one of its four named
 * periods — those are recomputed server-side and would silently ignore the
 * window — so passing a range sends `period=custom`. See getDateRange in
 * reports.routes.ts.
 */
export function useReportSummary(
  token: string,
  period: string,
  branchId?: string | null,
  range?: { fromISO: string; toISO: string } | null,
) {
  const effectivePeriod = range ? 'custom' : period;
  const rangeParams = range
    ? `&from=${encodeURIComponent(range.fromISO)}&to=${encodeURIComponent(range.toISO)}`
    : '';
  return useQuery({
    queryKey: qk.reportSummary(effectivePeriod, branchId, range?.fromISO, range?.toISO),
    queryFn: () =>
      apiCall<ReportSummary>(
        `/api/reports/summary?period=${effectivePeriod}${branchId ? `&branchId=${branchId}` : ''}${rangeParams}`,
        {},
        token,
      ),
    enabled: !!token,
  });
}

/**
 * The full derived stock rows (Opening / New / Sold / Returned / Adjustment /
 * Balance) for the Stock page.
 *
 * Deliberately shares `qk.stock(branchId)` with `useStock` below: `select` runs per
 * observer, not per cache entry, so both hooks read one cached response and ONE
 * invalidation refreshes the table and every balance map at once. Do not give this
 * its own key — that would let the two drift apart.
 */
export function useStockRows(
  token: string,
  opts?: { branchId?: string | null; enabled?: boolean; date?: string | null },
) {
  const branchId = opts?.branchId;
  const date = opts?.date ?? null;
  // The shared key is kept for TODAY and only for today. The docstring above is
  // emphatic that this hook must not get a key of its own, and the reason is
  // `useStock`'s balance map reading the same cache entry — but that reason is
  // exactly why a BACK-DATED read must not land there: it would serve the Return
  // Items modal a past day's balances to validate a return against. So a past
  // date gets `qk.stockOn` and today's behaviour is unchanged.
  const historical = !!date && date !== businessDateStr();

  return useQuery({
    queryKey: historical ? qk.stockOn(branchId, date) : qk.stock(branchId),
    queryFn: () => {
      const params = new URLSearchParams();
      if (branchId) params.set('branchId', branchId);
      if (historical && date) params.set('date', date);
      const qs = params.toString();
      return apiCall<{ rows: StockRow[] }>(`/api/stock${qs ? `?${qs}` : ''}`, {}, token);
    },
    select: (r) => r.rows ?? [],
    enabled: !!token && (opts?.enabled ?? true),
    staleTime: LIVE_STALE_TIME,
  });
}

/** Current-stock balances keyed by productId. Always revalidates (intraday changes). */
export function useStock(token: string, opts?: { branchId?: string | null; enabled?: boolean }) {
  const branchId = opts?.branchId;
  return useQuery({
    queryKey: qk.stock(branchId),
    queryFn: () =>
      apiCall<{ rows: StockRow[] }>(`/api/stock${branchId ? `?branchId=${branchId}` : ''}`, {}, token),
    select: (r) => {
      const map: Record<string, number> = {};
      for (const row of r.rows ?? []) map[row.productId] = row.balance;
      return map;
    },
    enabled: !!token && (opts?.enabled ?? true),
    staleTime: LIVE_STALE_TIME,
  });
}

/**
 * Branch Dashboard → Branch Stock History: one row per business day rather than
 * one per product — Previous / New / Sold / Remaining in units and money.
 *
 * Its own key (not `qk.stock`) because the shape is different and the window
 * length is part of the answer, but under the same ['stock'] prefix so the
 * realtime invalidation that refreshes the Stock page refreshes this too.
 * `branchId` is omitted for a branch account — the API takes the branch off the
 * JWT and refuses any other.
 */
export function useBranchStockHistory(
  token: string,
  opts?: { branchId?: string | null; days?: number; enabled?: boolean },
) {
  const branchId = opts?.branchId;
  const days = opts?.days ?? 7;
  return useQuery({
    queryKey: qk.stockHistory(branchId, days),
    queryFn: () => {
      const params = new URLSearchParams({ days: String(days) });
      if (branchId) params.set('branchId', branchId);
      return apiCall<{ rows: BranchStockHistoryRow[]; from: string; to: string; capped: boolean }>(
        `/api/stock/history?${params.toString()}`,
        {},
        token,
      );
    },
    enabled: !!token && (opts?.enabled ?? true),
    staleTime: LIVE_STALE_TIME,
  });
}

/**
 * Branch Daily Stock: the single-day statement — Previous balance, New Stock,
 * Sale, Remaining — for one business date.
 *
 * `retry: false` unlike the defaults. The API answers a date it cannot derive
 * (in the future, or past the 365-day reach of the backwards walk) with a 400
 * carrying the reason, and that is a final answer — retrying it three times just
 * delays showing the user why their date did not work.
 */
export function useBranchStockDay(
  token: string,
  opts: { branchId?: string | null; date: string; enabled?: boolean },
) {
  const { branchId, date } = opts;
  return useQuery({
    queryKey: qk.stockDay(branchId, date),
    queryFn: () => {
      const params = new URLSearchParams({ date });
      if (branchId) params.set('branchId', branchId);
      return apiCall<{ row: BranchStockHistoryRow; date: string; reconciliation?: StockReconciliation }>(
        `/api/stock/history?${params.toString()}`,
        {},
        token,
      );
    },
    // The reconciliation rides along with the row rather than being fetched
    // separately — it is the statement's own cross-check against the Stock page,
    // and a check the caller has to remember to ask for is a check nobody runs.
    select: (r) => ({ row: r.row, reconciliation: r.reconciliation ?? null }),
    enabled: !!token && !!date && (opts.enabled ?? true),
    staleTime: LIVE_STALE_TIME,
    retry: false,
  });
}

/**
 * Admin → Branch Stock, "All branches": one row per branch, totalled over the
 * window, rather than one row per day for a single branch.
 *
 * Super-admin only server-side, so `enabled` matters — a branch account mounting
 * this would take a 403 for a screen it cannot reach anyway.
 */
export function useAllBranchesStockSummary(
  token: string,
  opts?: { days?: number; enabled?: boolean },
) {
  const days = opts?.days ?? 7;
  return useQuery({
    queryKey: qk.stockSummary(days),
    queryFn: () =>
      apiCall<BranchStockSummaryResult>(`/api/stock/history/branches?days=${days}`, {}, token),
    enabled: !!token && (opts?.enabled ?? true),
    staleTime: LIVE_STALE_TIME,
  });
}

/**
 * Admin → Branch Stock: the same derived rows as `useStockRows`, for ANY branch on
 * ANY business date.
 *
 * A separate hook rather than a `date` option on `useStockRows`, because the two
 * want opposite cache behaviour. `useStockRows` is today's live figures for the
 * signed-in branch and is shared with `useStock`'s balance map under one key; this
 * one is keyed by (branch, date) so switching either does not serve the previous
 * pair's numbers while the new ones load. `staleTime: 0` for the same reason the
 * page exists — an admin about to overwrite a figure must be looking at the
 * current one, not a cached one from before someone else's sale.
 */
export function useAdminStockRows(
  token: string,
  opts: { branchId?: string | null; date?: string | null; enabled?: boolean },
) {
  const { branchId, date } = opts;
  return useQuery({
    queryKey: qk.adminStock(branchId, date),
    queryFn: () => {
      const params = new URLSearchParams();
      if (branchId) params.set('branchId', branchId);
      if (date) params.set('date', date);
      return apiCall<{ rows: StockRow[]; date: string }>(`/api/stock?${params.toString()}`, {}, token);
    },
    select: (r) => r.rows ?? [],
    enabled: !!token && !!branchId && (opts.enabled ?? true),
    staleTime: 0,
  });
}

/** One product's target figures in an admin save. Mirrors AdminStockRowInput. */
export interface AdminStockRowEdit {
  productId: string;
  opening?: number;
  newQty?: number;
  sold?: number;
  returned?: number;
  adjustment?: number;
  balance?: number;
}

/**
 * What PATCH /api/stock/admin reports back. Partial saves are possible and named:
 * `saved` is what the correction engine accepted (with `applied: false` for a row
 * whose figures already matched — a no-op, not a failure), `failed` is every row
 * it refused and why.
 */
export interface AdminStockSaveResult {
  branchId: string;
  date: string;
  changedCount: number;
  saved: { productId: string; productName: string; applied: boolean; before: StockFigures; after: StockFigures }[];
  failed: { productId: string; productName: string; error: string }[];
}

/**
 * Save edited stock figures for one or many products in one branch.
 *
 * Invalidates the bare ['stock'] prefix rather than this page's key alone: the
 * branch's own Stock page, the production Branch Stock matrix and every balance
 * map read from the same prefix, and all of them are now wrong.
 */
export function useSaveAdminStock(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { branchId: string; date?: string; reason?: string; rows: AdminStockRowEdit[] }) =>
      apiCall<AdminStockSaveResult>(
        '/api/stock/admin',
        { method: 'PATCH', body: JSON.stringify(v) },
        token,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['productionBranchStock'] });
    },
  });
}

/**
 * Remove a product's stock from a branch.
 *
 * `mode: 'zero'` corrects the balance to 0 and keeps the ledger — the reversible
 * one, and the default. `mode: 'purge'` DELETES the stock row and its entire
 * movement history for that branch; it cannot be undone and it restates any past
 * figure derived from those movements. The caller is expected to have confirmed.
 */
export function useDeleteAdminStock(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { branchId: string; productId: string; mode: 'zero' | 'purge'; date?: string; reason?: string }) =>
      apiCall<{ mode: 'zero' | 'purge'; productId: string; productName: string }>(
        '/api/stock/admin/delete',
        { method: 'POST', body: JSON.stringify(v) },
        token,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['productionBranchStock'] });
    },
  });
}

export function useProductionOrders(token: string, opts?: { branchId?: string | null; enabled?: boolean }) {
  const branchId = opts?.branchId;
  return useQuery({
    queryKey: qk.productionOrders(branchId),
    queryFn: () =>
      apiCall<{ orders: BranchProductionOrder[] }>(
        `/api/production-orders${branchId ? `?branchId=${branchId}` : ''}`,
        {},
        token,
      ),
    select: (r) => r.orders ?? [],
    enabled: !!token && (opts?.enabled ?? true),
  });
}

/**
 * Live outstanding pending balances per product for a branch, keyed by productId.
 *
 * @deprecated UNUSED as of server migration 74, which removed the pending-balance
 * carry-forward: a demand is now the fresh demand only, so there is no Previous
 * Balance / Total Required pair for this to feed. `production_balances` is no
 * longer written and every row was zeroed by that migration, so this now resolves
 * to an empty map for every branch. Kept only because the API route still exists.
 * Do NOT wire it back into the review screen — that is the bug migration 74 fixed.
 */
export function useProductionBalances(token: string, opts?: { branchId?: string | null; enabled?: boolean }) {
  const branchId = opts?.branchId;
  return useQuery({
    queryKey: qk.productionBalances(branchId),
    queryFn: () =>
      apiCall<{ balances: ProductionBalanceDoc[] }>(
        `/api/production-orders/balances${branchId ? `?branchId=${branchId}` : ''}`,
        {},
        token,
      ),
    select: (r): Record<string, number> =>
      Object.fromEntries((r.balances ?? []).map((b) => [b.productId, Number(b.pendingQty ?? 0)])),
    enabled: !!token && (opts?.enabled ?? true),
    staleTime: LIVE_STALE_TIME,
  });
}

export interface PreviousOrderBalance {
  previous: { demandNumber: string; date: string } | null;
  deliveredValue: number;
  companySharePct: number;
  companyShareValue: number;
  returnsValue: number;
  /** The exact accepted returns that returnsValue was built from. */
  returnItems: { productName: string; qty: number; amount: number }[];
  amountToCollect: number;
}

/**
 * What the branch owes for its PREVIOUS delivery, for this order's company copy.
 *
 * Server-computed: company_share_pct lives in finance_settings, which production
 * users cannot read at any layer. Not related to `useProductionBalances` — that
 * one is unmet demand (goods owed TO the branch), not a receivable.
 */
export function usePreviousOrderBalance(token: string, orderId: string | null, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.previousOrderBalance(orderId ?? ''),
    queryFn: () =>
      apiCall<PreviousOrderBalance>(`/api/production-orders/${orderId}/previous-balance`, {}, token),
    enabled: !!token && !!orderId && (opts?.enabled ?? true),
    staleTime: LIVE_STALE_TIME,
  });
}

/** Mark a production slip printed. Idempotent server-side; never mutates stock. */
export function useMarkPrinted(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiCall(`/api/production-orders/${id}/printed`, { method: 'PUT' }, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['productionOrders'] });
    },
  });
}

/** Submit a branch production order; refreshes history + stock on success. */
export function useSubmitProductionOrder(token: string) {
  const qc = useQueryClient();
  return useMutation({
    // Packing and special items are both optional; an omitted/empty array posts
    // exactly the payload this endpoint accepted before either module existed.
    mutationFn: (v: {
      items: ProductionOrderItem[];
      packingItems?: ProductionOrderPackingItem[];
      /**
       * One-off items typed by hand. Each becomes a hidden `is_special` product
       * server-side so it can carry production and branch stock like any line.
       */
      specialItems?: SpecialOrderItemInput[];
      /**
       * 'YYYY-MM-DD' the branch needs this delivered by. REQUIRED, unlike the
       * two above — the API rejects a demand without one.
       */
      requiredDate: string;
    }) =>
      apiCall(
        '/api/production-orders',
        {
          method: 'POST',
          body: JSON.stringify({
            items: v.items,
            packingItems: v.packingItems ?? [],
            specialItems: v.specialItems ?? [],
            requiredDate: v.requiredDate,
          }),
        },
        token,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['productionOrders'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      // A special item creates a product, so the catalogue the order form reads
      // is now stale. Cheap to refetch and confusing if it is not.
      qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

/**
 * Branch deletes a demand it has just sent, with a mandatory reason.
 *
 * A soft delete server-side — the row stays, flips to 'cancelled' and carries
 * the reason — so this only has to invalidate the order list for both sides to
 * repaint. The overview is invalidated too: a withdrawn demand leaves
 * Production's waiting count and demand charts.
 */
export function useCancelProductionOrder(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; reason: string }) =>
      apiCall(
        `/api/production-orders/${v.id}/cancel`,
        { method: 'PUT', body: JSON.stringify({ reason: v.reason }) },
        token,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['productionOrders'] });
      qc.invalidateQueries({ queryKey: ['productionOverview'] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Production module
// ─────────────────────────────────────────────────────────────────────────────

export interface ProductionOverviewCards {
  waitingOrders: number;
  approvedOrders: number;
  deliveredOrders: number;
  changedOrders: number;
  returnedProducts: number;
  todayProduction: number;
  weeklyProduction: number;
  monthlyProduction: number;
  totalBranches: number;
  totalProducts: number;
  totalDemandQty: number;
  availableProductionStock: number;
}

export interface ProductionOverview {
  cards: ProductionOverviewCards;
  demandByDay: { date: string; qty: number; orders: number }[];
  demandByMonth: { month: string; qty: number }[];
  branchDemand: { branchId: string; branchName: string; qty: number }[];
  topProducts: { productId: string; productName: string; qty: number }[];
}

export interface BranchStockMatrix {
  branches: { branchId: string; branchName: string }[];
  rows: { productId: string; productName: string; byBranch: Record<string, number> }[];
}


/** Dashboard cards + chart series. Always revalidates (live demand). */
export function useProductionOverview(token: string) {
  return useQuery({
    queryKey: qk.productionOverview(),
    queryFn: () => apiCall<ProductionOverview>('/api/production/overview', {}, token),
    enabled: !!token,
    staleTime: LIVE_STALE_TIME,
  });
}

/**
 * Central production-pool table for a Karachi day (defaults to today).
 *
 * Every figure on a row is scoped to the requested business date, with ONE
 * carry-forward: `opening` is the previous day's closing balance, so `balance` is
 * the ledger's running position rather than the day's net.
 *
 * `branchDemand` is what branches are still owed and is NOT subtracted from
 * `balance` — compare them via `status`, or read `available` for the difference.
 *
 * A product with no opening balance and no movement on the day is ABSENT rather
 * than present with zeroes. Callers keying a map off this (the Demand Summary,
 * the counter sale form) read a missing product as 0, which is what an omitted
 * row means.
 *
 * `enabled` matters here: /api/production-stock is requireRole('super_admin',
 * 'production_user'), so a branch manager mounting a component that calls this
 * unconditionally would just collect 403s.
 */
export function useProductionStock(token: string, date?: string | null, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.productionStock(date),
    queryFn: () =>
      apiCall<{ rows: ProductionStockRow[]; date: string }>(
        `/api/production-stock${date ? `?date=${date}` : ''}`,
        {},
        token,
      ),
    select: (r) => r.rows ?? [],
    enabled: !!token && (opts?.enabled ?? true),
    staleTime: LIVE_STALE_TIME,
  });
}

/**
 * The Stock Ledger (§13), server-filtered and paged.
 *
 * The whole filter object is in the key, so changing any one of them is a new
 * cache entry rather than a refetch that briefly shows the previous filter's rows
 * under the new heading. `placeholderData` keeps the old page visible while the
 * next one loads — a table that empties on every keystroke of a search box reads
 * as "no results" when it means "still asking".
 */
export function useProductionLedger(
  token: string,
  params: {
    from?: string; to?: string; productId?: string; categoryId?: string;
    branchId?: string; movementType?: string; search?: string;
    limit?: number; offset?: number;
  },
  opts?: { enabled?: boolean },
) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const query = qs.toString();
  return useQuery({
    queryKey: qk.productionStockLedger(params),
    queryFn: () =>
      apiCall<{ rows: ProductionStockLedgerRow[]; total: number; limit: number; offset: number }>(
        `/api/production-stock/movements${query ? `?${query}` : ''}`,
        {},
        token,
      ),
    enabled: !!token && (opts?.enabled ?? true),
    placeholderData: (prev) => prev,
    staleTime: LIVE_STALE_TIME,
  });
}

/** One product on one business day: its nine figures and its full movement trail (§14). */
export function useProductionStockDetail(
  token: string,
  productId: string | null,
  date: string,
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: qk.productionStockDetail(productId ?? '', date),
    queryFn: () =>
      apiCall<{
        productId: string;
        date: string;
        figures: ProductionStockFigures;
        movements: ProductionStockLedgerRow[];
      }>(`/api/production-stock/movements/${productId}?date=${date}`, {}, token),
    enabled: !!token && !!productId && (opts?.enabled ?? true),
    staleTime: LIVE_STALE_TIME,
  });
}

/**
 * Book an authorised stock adjustment (§11).
 *
 * Invalidates the whole `productionStock` prefix, not just the table: an
 * adjustment moves the balance, so the ledger, any open product detail and the
 * summary cards are all stale the moment it lands.
 */
export function useProductionAdjustment(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      productId: string;
      adjustmentType: string;
      qty: number;
      reason: string;
      remarks?: string;
      approvedBy?: string;
    }) =>
      apiCall<{ before: number; after: number; delta: number; duplicate: boolean }>(
        '/api/production-stock/adjustment',
        { method: 'POST', body: JSON.stringify(body) },
        token,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['productionStock'] });
      qc.invalidateQueries({ queryKey: ['productionOverview'] });
    },
  });
}

export function usePrepareProducts(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: { productId: string; qty: number }[]) =>
      apiCall('/api/production-stock/prepare', { method: 'POST', body: JSON.stringify({ items }) }, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['productionStock'] });
      qc.invalidateQueries({ queryKey: ['productionOverview'] });
    },
  });
}

export interface ReviewOrderPayload {
  id: string;
  status: 'awaiting_verification' | 'rejected';
  approvedItems?: { productId: string; approvedQty: number }[];
  /** Packing-material overrides. Omitted on an order with no packing lines. */
  approvedPackingItems?: { packingMaterialId: string; approvedQty: number }[];
  reason?: string;
}

/** Submit a production demand for branch verification, or reject it (with optional qty overrides). */
export function useReviewProductionOrder(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: ReviewOrderPayload) =>
      apiCall(`/api/production-orders/${id}/review`, { method: 'PUT', body: JSON.stringify(body) }, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['productionOrders'] });
      qc.invalidateQueries({ queryKey: ['productionBalances'] });
      qc.invalidateQueries({ queryKey: ['productionStock'] });
      qc.invalidateQueries({ queryKey: ['productionBranchStock'] });
      qc.invalidateQueries({ queryKey: ['productionOverview'] });
    },
  });
}

/** Production adding an extra line to a still-'pending' order before submitting it. */
export function useAddProductionOrderItem(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, productId, qty, remarks }: { id: string; productId: string; qty: number; remarks?: string }) =>
      apiCall(
        `/api/production-orders/${id}/items`,
        { method: 'POST', body: JSON.stringify({ productId, qty, remarks: remarks ?? '' }) },
        token,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['productionOrders'] });
    },
  });
}

export interface VerifyOrderPayload {
  id: string;
  verifiedItems: { productId: string; verifiedQty: number }[];
  newItems: { productId: string; qty: number }[];
  /** Photos of what actually arrived. At least one — the API refuses a verification without. */
  attachmentIds: string[];
}

/**
 * Production's closing sign-off on a branch-verified demand ('verified' →
 * 'approved'). Status only — stock moved at verification.
 */
export function useFinalApproveProductionOrder(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiCall(`/api/production-orders/${id}/final-approve`, { method: 'PUT' }, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['productionOrders'] });
      qc.invalidateQueries({ queryKey: ['productionOverview'] });
    },
  });
}

/** Branch confirms physical receipt of an 'awaiting_verification' demand — moves it to 'verified'. */
export function useVerifyProductionOrder(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: VerifyOrderPayload) =>
      apiCall(`/api/production-orders/${id}/verify`, { method: 'PUT', body: JSON.stringify(body) }, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['productionOrders'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['productionStock'] });
      qc.invalidateQueries({ queryKey: ['productionBranchStock'] });
      qc.invalidateQueries({ queryKey: ['productionOverview'] });
    },
  });
}

export function useProductionBranchStock(token: string) {
  return useQuery({
    queryKey: qk.productionBranchStock(),
    queryFn: () => apiCall<BranchStockMatrix>('/api/production/branch-stock', {}, token),
    enabled: !!token,
    staleTime: LIVE_STALE_TIME,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Login History
//
// The API decides the scope, not this hook: a super admin gets every user's
// sessions, and every other role is pinned to its own whatever it asks for. The
// `scope` argument only picks the cache key, so an admin toggling between "all"
// and "mine" does not serve one from the other's entry.
//
// LIVE_STALE_TIME because a session's duration grows while you watch it — the
// row for the tab you are reading this in is still open.
// ───────────────────────────────────────────────────────────────────────────

export function useLoginHistory(token: string, opts?: { userId?: string | null; days?: number }) {
  const days = opts?.days ?? 90;
  return useQuery({
    queryKey: qk.loginHistory(opts?.userId ?? 'all', days),
    queryFn: () => {
      const params = new URLSearchParams({ days: String(days) });
      if (opts?.userId) params.set('userId', opts.userId);
      return apiCall<{ sessions: LoginSession[]; scope: string }>(
        `/api/login-history?${params.toString()}`,
        {},
        token,
      );
    },
    select: (r) => r.sessions ?? [],
    enabled: !!token,
    staleTime: LIVE_STALE_TIME,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Branch → Return Stock
//
// A branch reads its OWN returns from /api/stock/returns, not from
// /api/production-returns — that endpoint is Production's board of every
// branch's returns and 403s a branch role outright.
//
// The two mutations both invalidate ['stock'], not just the returns key: a
// revision or a withdrawal moves real units, so the Stock page, the history
// card and the dashboard's Stock Detail are all stale the moment one lands.
// The ['stock'] prefix reaches every one of them, this list included — see
// `qk.branchReturns`. ['productionStock'] and ['productionBranchStock'] go too,
// because the units move on the Production side of the ledger as well.
// ───────────────────────────────────────────────────────────────────────────

export function useBranchReturns(token: string, opts?: { branchId?: string | null; days?: number }) {
  const days = opts?.days ?? 90;
  return useQuery({
    queryKey: qk.branchReturns(opts?.branchId ?? null, days),
    queryFn: () => {
      const params = new URLSearchParams({ days: String(days) });
      // Only an admin may name a branch; the API ignores it for a branch role and
      // reads the JWT instead, so sending it is harmless either way.
      if (opts?.branchId) params.set('branchId', opts.branchId);
      return apiCall<{ returns: ProductionReturn[] }>(`/api/stock/returns?${params.toString()}`, {}, token);
    },
    select: (r) => r.returns ?? [],
    enabled: !!token,
    staleTime: LIVE_STALE_TIME,
  });
}

function invalidateAfterReturnChange(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['stock'] });
  qc.invalidateQueries({ queryKey: ['productionReturns'] });
  qc.invalidateQueries({ queryKey: ['productionStock'] });
  qc.invalidateQueries({ queryKey: ['productionBranchStock'] });
  qc.invalidateQueries({ queryKey: ['productionOverview'] });
}

export function useReviseBranchReturn(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, qty, reason }: { id: string; qty: number; reason?: string }) =>
      apiCall<ProductionReturn>(
        `/api/stock/returns/${id}`,
        { method: 'PUT', body: JSON.stringify({ qty, ...(reason !== undefined ? { reason } : {}) }) },
        token,
      ),
    onSuccess: () => invalidateAfterReturnChange(qc),
  });
}

export function useWithdrawBranchReturn(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiCall<{ success: boolean }>(`/api/stock/returns/${id}`, { method: 'DELETE' }, token),
    onSuccess: () => invalidateAfterReturnChange(qc),
  });
}

/**
 * Send a return Production handed back ('returned') to them again, unchanged.
 *
 * Shares `invalidateAfterReturnChange` with its neighbours even though it is the
 * one write here that moves NO stock — the units left the branch when the return
 * was raised and the pool has never held them. The extra invalidations are a few
 * refetches of already-correct figures, which is the cheaper mistake: this row
 * has just moved onto Production's queue, and their board and overview counts
 * are genuinely stale.
 */
export function useResubmitBranchReturn(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiCall<ProductionReturn>(`/api/stock/returns/${id}/resubmit`, { method: 'POST' }, token),
    onSuccess: () => invalidateAfterReturnChange(qc),
  });
}

export function useProductionReturns(token: string) {
  return useQuery({
    queryKey: qk.productionReturns(),
    queryFn: () => apiCall<{ returns: ProductionReturn[] }>('/api/production-returns', {}, token),
    select: (r) => r.returns ?? [],
    enabled: !!token,
    staleTime: LIVE_STALE_TIME,
  });
}

export function useCreateReturn(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { branchId: string; productId: string; qty: number; reason: string }) =>
      apiCall('/api/production-returns', { method: 'POST', body: JSON.stringify(body) }, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['productionReturns'] });
      qc.invalidateQueries({ queryKey: ['productionOverview'] });
    },
  });
}

export function useReviewReturn(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ProductionReturnStatus }) =>
      apiCall(`/api/production-returns/${id}/review`, { method: 'PUT', body: JSON.stringify({ status }) }, token),
    // ['stock'] as well as the Production keys, which the accept-only version did
    // not need. Every outcome now touches a branch balance: accepting a
    // Production-recorded return debits the branch, and rejecting a branch-raised
    // one credits it back. Leaving the branch's Stock page out meant a branch with
    // it open kept reading a figure the review had already changed.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock'] });
      qc.invalidateQueries({ queryKey: ['productionReturns'] });
      qc.invalidateQueries({ queryKey: ['productionStock'] });
      qc.invalidateQueries({ queryKey: ['productionBranchStock'] });
      qc.invalidateQueries({ queryKey: ['productionOverview'] });
    },
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Discounts
//
// Two endpoints, two audiences, exactly as returns are split: a branch reads and
// writes its OWN claims at /api/branch-discounts, and /api/production-discounts
// is Production's board of every branch's — it 403s a branch role outright, so
// the two are not interchangeable however similar the rows look.
//
// EVERY MUTATION HERE INVALIDATES ONLY ['discounts']. That is the whole list, and
// the restraint is deliberate: a discount moves no stock, credits no pool and
// changes no balance, so the sweeping invalidation `invalidateAfterReturnChange`
// performs would be several refetches of figures that cannot have changed. If a
// discount ever starts settling against a ledger, this is the comment that has to
// be revisited first.
// ───────────────────────────────────────────────────────────────────────────

export function useBranchDiscounts(token: string, opts?: { branchId?: string | null; days?: number }) {
  const days = opts?.days ?? 90;
  return useQuery({
    queryKey: qk.branchDiscounts(opts?.branchId ?? null, days),
    queryFn: () => {
      const params = new URLSearchParams({ days: String(days) });
      // Only an admin may name a branch; the API ignores it for a branch role and
      // reads the JWT instead, so sending it is harmless either way.
      if (opts?.branchId) params.set('branchId', opts.branchId);
      return apiCall<{ discounts: BranchDiscount[] }>(`/api/branch-discounts?${params.toString()}`, {}, token);
    },
    select: (r) => r.discounts ?? [],
    enabled: !!token,
    staleTime: LIVE_STALE_TIME,
  });
}

export function useCreateBranchDiscount(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { productionOrderId: string; amount: number; reason: string }) =>
      apiCall<BranchDiscount>('/api/branch-discounts', { method: 'POST', body: JSON.stringify(body) }, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['discounts'] }),
  });
}

/**
 * Correct a claim that is still open — 'pending' or 'returned'.
 *
 * Both fields are required, unlike `useReviseBranchReturn`'s optional reason: a
 * corrected claim goes back to Production to be read again, and the amount is
 * only reviewable next to the reason for it.
 */
export function useReviseBranchDiscount(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, amount, reason }: { id: string; amount: number; reason: string }) =>
      apiCall<BranchDiscount>(
        `/api/branch-discounts/${id}`,
        { method: 'PUT', body: JSON.stringify({ amount, reason }) },
        token,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['discounts'] }),
  });
}

export function useWithdrawBranchDiscount(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiCall<{ success: boolean }>(`/api/branch-discounts/${id}`, { method: 'DELETE' }, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['discounts'] }),
  });
}

export function useProductionDiscounts(token: string) {
  return useQuery({
    queryKey: qk.productionDiscounts(),
    queryFn: () => apiCall<{ discounts: BranchDiscount[] }>('/api/production-discounts', {}, token),
    select: (r) => r.discounts ?? [],
    enabled: !!token,
    staleTime: LIVE_STALE_TIME,
  });
}

export function useReviewDiscount(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status, reviewNote }: { id: string; status: BranchDiscountStatus; reviewNote?: string }) =>
      apiCall<BranchDiscount>(
        `/api/production-discounts/${id}/review`,
        { method: 'PUT', body: JSON.stringify({ status, ...(reviewNote ? { reviewNote } : {}) }) },
        token,
      ),
    // Both lists, not just Production's: the branch that raised the claim is very
    // likely looking at it, and the ['discounts'] prefix reaches its copy too.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['discounts'] }),
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Special Events
//
// Every screen in the module is driven from here. Note that the list, calendar
// and summary endpoints are role-scoped SERVER-side — a branch manager calling
// /api/special-events gets only the events its branch participates in — so these
// hooks are shared across the admin, branch and production pages rather than
// duplicated per role.
// ───────────────────────────────────────────────────────────────────────────

export function useSpecialEvents(
  token: string,
  filters?: { year?: number | null; category?: string | null; status?: string | null },
  opts?: { enabled?: boolean },
) {
  const params = new URLSearchParams();
  if (filters?.year) params.set('year', String(filters.year));
  if (filters?.category) params.set('category', filters.category);
  if (filters?.status) params.set('status', filters.status);
  const qs = params.toString();

  return useQuery({
    queryKey: qk.specialEvents(filters),
    queryFn: () =>
      apiCall<{ events: SpecialEventView[] }>(`/api/special-events${qs ? `?${qs}` : ''}`, {}, token),
    select: (r) => r.events ?? [],
    enabled: !!token && (opts?.enabled ?? true),
  });
}

export function useSpecialEvent(token: string, id: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.specialEvent(id),
    queryFn: () =>
      apiCall<{ event: SpecialEventView; stages: EventProductionStatusRow[] }>(
        `/api/special-events/${id}`,
        {},
        token,
      ),
    enabled: !!token && !!id && (opts?.enabled ?? true),
  });
}

export function useEventCalendar(token: string, year: number, month: number) {
  return useQuery({
    queryKey: qk.eventCalendar(year, month),
    queryFn: () =>
      apiCall<{ events: SpecialEventView[] }>(
        `/api/special-events/calendar?year=${year}&month=${month}`,
        {},
        token,
      ),
    select: (r) => r.events ?? [],
    enabled: !!token,
  });
}

export function useEventSummary(token: string) {
  return useQuery({
    queryKey: qk.eventSummary(),
    queryFn: () => apiCall<{ summary: EventDashboardSummary }>('/api/special-events/summary', {}, token),
    select: (r) => r.summary,
    enabled: !!token,
  });
}

/**
 * Invalidate everything an event mutation can touch. Broad on purpose: dates,
 * branch assignment and status all feed the list, the calendar, the summary cards
 * and the reminder schedule at once, and a missed invalidation here shows up as a
 * stale countdown rather than an error.
 */
function invalidateEvents(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['specialEvents'] });
  qc.invalidateQueries({ queryKey: ['specialEvent'] });
  qc.invalidateQueries({ queryKey: ['eventCalendar'] });
  qc.invalidateQueries({ queryKey: ['eventSummary'] });
  qc.invalidateQueries({ queryKey: ['eventNotifications'] });
}

export function useCreateEvent(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiCall<{ event: SpecialEventView }>('/api/special-events', { method: 'POST', body: JSON.stringify(body) }, token),
    onSuccess: () => invalidateEvents(qc),
  });
}

export function useUpdateEvent(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      apiCall<{ event: SpecialEventView }>(`/api/special-events/${id}`, { method: 'PUT', body: JSON.stringify(body) }, token),
    onSuccess: () => invalidateEvents(qc),
  });
}

export function useConfirmEventDate(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, confirmedDate }: { id: string; confirmedDate: string | null }) =>
      apiCall<{ event: SpecialEventView }>(
        `/api/special-events/${id}/confirm-date`,
        { method: 'PATCH', body: JSON.stringify({ confirmedDate }) },
        token,
      ),
    onSuccess: () => invalidateEvents(qc),
  });
}

export function useUpdateEventStatus(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiCall(`/api/special-events/${id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) }, token),
    onSuccess: () => invalidateEvents(qc),
  });
}

export function useDeleteEvent(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiCall(`/api/special-events/${id}`, { method: 'DELETE' }, token),
    onSuccess: () => invalidateEvents(qc),
  });
}

export function useEventDemands(token: string, eventId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.eventDemands(eventId),
    queryFn: () =>
      apiCall<{ demands: EventBranchDemand[] }>(`/api/special-events/${eventId}/demands`, {}, token),
    select: (r) => r.demands ?? [],
    enabled: !!token && !!eventId && (opts?.enabled ?? true),
  });
}

export function useEventConsolidatedDemand(token: string, eventId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.eventConsolidatedDemand(eventId),
    queryFn: () =>
      apiCall<{ rows: ConsolidatedDemandRow[]; branchesIncluded: number }>(
        `/api/special-events/${eventId}/demands/consolidated`,
        {},
        token,
      ),
    enabled: !!token && !!eventId && (opts?.enabled ?? true),
  });
}

export function useMyEventDemand(token: string, eventId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.eventMyDemand(eventId),
    queryFn: () =>
      apiCall<{ demand: EventBranchDemand | null }>(`/api/special-events/${eventId}/my-demand`, {}, token),
    select: (r) => r.demand,
    enabled: !!token && !!eventId && (opts?.enabled ?? true),
  });
}

function invalidateDemands(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['eventDemands'] });
  qc.invalidateQueries({ queryKey: ['eventMyDemand'] });
  qc.invalidateQueries({ queryKey: ['eventConsolidatedDemand'] });
  qc.invalidateQueries({ queryKey: ['specialEvents'] });
  qc.invalidateQueries({ queryKey: ['specialEvent'] });
  qc.invalidateQueries({ queryKey: ['eventSummary'] });
}

export function useSaveEventDemand(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, ...body }: { eventId: string } & Record<string, unknown>) =>
      apiCall<{ id: string }>(
        `/api/special-events/${eventId}/demands`,
        { method: 'POST', body: JSON.stringify(body) },
        token,
      ),
    onSuccess: () => invalidateDemands(qc),
  });
}

export function useSubmitEventDemand(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, demandId }: { eventId: string; demandId: string }) =>
      apiCall(`/api/special-events/${eventId}/demands/${demandId}/submit`, { method: 'POST' }, token),
    onSuccess: () => invalidateDemands(qc),
  });
}

export function useReviewEventDemand(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ demandId, ...body }: { demandId: string } & Record<string, unknown>) =>
      apiCall(
        `/api/special-events/demands/${demandId}/review`,
        { method: 'PUT', body: JSON.stringify(body) },
        token,
      ),
    onSuccess: () => invalidateDemands(qc),
  });
}

export function useEventProductionStatus(token: string, eventId: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.eventProductionStatus(eventId),
    queryFn: () =>
      apiCall<{ stages: EventProductionStatusRow[]; readinessPercentage: number }>(
        `/api/special-events/${eventId}/production-status`,
        {},
        token,
      ),
    enabled: !!token && !!eventId && (opts?.enabled ?? true),
  });
}

export function useUpdateEventStage(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      eventId,
      stage,
      ...body
    }: { eventId: string; stage: string } & Record<string, unknown>) =>
      apiCall(
        `/api/special-events/${eventId}/production-status/${stage}`,
        { method: 'PUT', body: JSON.stringify(body) },
        token,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['eventProductionStatus'] });
      qc.invalidateQueries({ queryKey: ['specialEvent'] });
      qc.invalidateQueries({ queryKey: ['specialEvents'] });
      qc.invalidateQueries({ queryKey: ['eventSummary'] });
    },
  });
}

export function useEventNotifications(
  token: string,
  eventId?: string | null,
  status?: string | null,
  opts?: { enabled?: boolean },
) {
  const params = new URLSearchParams();
  if (eventId) params.set('eventId', eventId);
  if (status) params.set('status', status);
  const qs = params.toString();

  return useQuery({
    queryKey: qk.eventNotifications(eventId, status),
    queryFn: () =>
      apiCall<{ notifications: EventNotificationRow[] }>(
        `/api/special-events/notifications${qs ? `?${qs}` : ''}`,
        {},
        token,
      ),
    select: (r) => r.notifications ?? [],
    enabled: !!token && (opts?.enabled ?? true),
  });
}

/**
 * Send every reminder due on or before today.
 *
 * This is the delivery mechanism, not a convenience button: the server's cron
 * schedulers are commented out, so nothing sends until an admin presses this.
 */
export function useDispatchEventNotifications(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { onDate?: string; dryRun?: boolean } = {}) =>
      apiCall<EventDispatchResult>(
        '/api/special-events/notifications/dispatch',
        { method: 'POST', body: JSON.stringify(body) },
        token,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['eventNotifications'] });
      qc.invalidateQueries({ queryKey: ['eventSummary'] });
    },
  });
}

export function useRegenerateEventSchedule(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (eventId: string) =>
      apiCall<EventScheduleResult>(`/api/special-events/${eventId}/notifications/regenerate`, { method: 'POST' }, token),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['eventNotifications'] }),
  });
}

/**
 * Recompute Hijri estimates. Must be run once after migration 41 — the seeded
 * catalogue ships with no resolved dates, so until this runs the calendar is empty.
 */
// ───────────────────────────────────────────────────────────────────────────
// Shift-account requests
//
// The manager's Shift Accounts page and the admin's Account Requests queue are
// two views of ONE endpoint, which scopes itself from the JWT: a manager gets
// their own branch's rows, an admin gets every branch. So one read hook serves
// both pages, and the mutations differ only in who is allowed to call them.
// ───────────────────────────────────────────────────────────────────────────

export function useBranchUserRequests(token: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.branchUserRequests(),
    queryFn: () =>
      apiCall<{ requests: BranchUserRequest[] }>('/api/branch-user-requests', {}, token),
    select: (r) => r.requests ?? [],
    enabled: !!token && (opts?.enabled ?? true),
    staleTime: LIVE_STALE_TIME,
  });
}

/** Manager → Admin. The branch is taken from the JWT, so it is not sent. */
export function useCreateBranchUserRequest(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBranchUserRequestInput) =>
      apiCall<{ request: BranchUserRequest }>(
        '/api/branch-user-requests',
        { method: 'POST', body: JSON.stringify(body) },
        token,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.branchUserRequests() });
    },
  });
}

/**
 * Admin approval — this is what actually mints the account, on the requesting
 * manager's branch. It also invalidates the Users list, which now has a row in
 * it that was not there a moment ago.
 */
export function useApproveBranchUserRequest(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: ApproveBranchUserRequestInput & { id: string }) =>
      apiCall<{ request: BranchUserRequest; userId: string }>(
        `/api/branch-user-requests/${id}/approve`,
        { method: 'POST', body: JSON.stringify(body) },
        token,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.branchUserRequests() });
      qc.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export function useRejectBranchUserRequest(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: RejectBranchUserRequestInput & { id: string }) =>
      apiCall<{ request: BranchUserRequest }>(
        `/api/branch-user-requests/${id}/reject`,
        { method: 'POST', body: JSON.stringify({ reason }) },
        token,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.branchUserRequests() });
    },
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Branch Closing
//
// The end-of-day sheet is COMPOSED, not fetched: there is no closing endpoint a
// branch account may call. /api/business-day/close is the admin's once-a-day
// lock and /api/reports/summary is manager-and-above, so both are out of reach
// of a shift account by design.
//
// What is in reach is the day's own records — orders, expenses and stock, each
// already branch-scoped server-side from the JWT. Reading the three together
// under one key keeps them on one business date; see qk.branchClosing.
// ───────────────────────────────────────────────────────────────────────────

export interface BranchClosingData {
  orders: Order[];
  expenses: Expense[];
  stock: StockRow[];
}

export function useBranchClosing(token: string, businessDate: string) {
  return useQuery({
    queryKey: qk.branchClosing(businessDate),
    queryFn: async (): Promise<BranchClosingData> => {
      const { fromISO, toISO } = businessDayBounds(businessDate);
      const [orders, expenses, stock] = await Promise.all([
        apiCall<{ orders: Order[] }>(
          `/api/orders?from=${encodeURIComponent(fromISO)}&to=${encodeURIComponent(toISO)}`,
          {},
          token,
        ),
        // The expenses endpoint always returns the last 7 business days and takes
        // no date parameter, so the day is picked out here. A date older than
        // that window comes back empty — the page says so rather than showing a
        // confident zero.
        apiCall<{ expenses: Expense[] }>('/api/expenses', {}, token),
        apiCall<{ rows: StockRow[] }>(`/api/stock?date=${businessDate}`, {}, token),
      ]);
      return {
        orders: orders.orders ?? [],
        expenses: (expenses.expenses ?? []).filter((e) => e.date === businessDate),
        stock: stock.rows ?? [],
      };
    },
    enabled: !!token && !!businessDate,
    staleTime: LIVE_STALE_TIME,
  });
}
