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
import {
  addProduct,
  removeProduct,
  updateProductPrice,
  saveImport,
  toPriceProduct,
  type AddProductInput,
  type PriceProduct,
  type SaveImportInput,
  type UpdatePriceInput,
} from '@/utils/productPrice';
import type {
  Branch,
  BranchProductionOrder,
  Category,
  Product,
  ProductionBalanceDoc,
  ProductionExpense,
  ProductionReturn,
  ProductionStockRow,
  PriceHistoryDoc,
  PackingMaterial,
  PackingMaterialUsageRow,
  CreatePackingMaterialInput,
  UpdatePackingMaterialInput,
  BranchLocation,
  BranchLocationRow,
  BranchLocationStats,
  GeofenceLog,
  UpsertBranchLocationInput,
  ReportSummary,
  StockRow,
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

// ─────────────────────────────────────────────────────────────────────────────
// Product price facade — React bindings for @/utils/productPrice.
//
// These share qk.products(isActive) with useProducts above (same cache entry,
// different `select`), so one price change invalidates every screen at once.
// Mutations delegate to the facade functions rather than re-implementing
// apiCall, keeping one HTTP definition per endpoint.

/** Module-level so TanStack can memoize the select; an inline arrow would re-map every render. */
const selectPriceProducts = (r: { products: Product[] }): PriceProduct[] =>
  (r.products ?? []).map(toPriceProduct);

/** Products in the facade's shape (productCode / currentPrice / status). */
export function usePriceProducts(token: string, opts?: { isActive?: boolean; enabled?: boolean }) {
  const isActive = opts?.isActive;
  return useQuery({
    queryKey: qk.products(isActive),
    queryFn: () =>
      apiCall<{ products: Product[] }>(
        `/api/products${isActive !== undefined ? `?isActive=${isActive}` : ''}`,
        {},
        token,
      ),
    select: selectPriceProducts,
    enabled: !!token && (opts?.enabled ?? true),
  });
}

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

/** The only way to change a price. Invalidation is what refreshes open sale screens. */
export function useUpdateProductPrice(token: string) {
  return useMutation({
    mutationFn: (v: { productId: string; input: UpdatePriceInput }) =>
      updateProductPrice(v.productId, v.input, { token }),
  });
}

export function useAddProduct(token: string) {
  return useMutation({ mutationFn: (input: AddProductInput) => addProduct(input, { token }) });
}

export function useRemoveProduct(token: string) {
  return useMutation({ mutationFn: (productId: string) => removeProduct(productId, { token }) });
}

export function useCommitPriceImport(token: string) {
  return useMutation({ mutationFn: (input: SaveImportInput) => saveImport(input, { token }) });
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

/** The geofence audit trail. Admin-only on the server; `blockedOnly` is the hot filter. */
export function useGeofenceLogs(
  token: string,
  filters: { branchId?: string | null; blockedOnly?: boolean },
  opts?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: qk.geofenceLogs(filters),
    queryFn: () => {
      const qs = new URLSearchParams();
      if (filters.branchId) qs.set('branchId', filters.branchId);
      if (filters.blockedOnly) qs.set('blockedOnly', 'true');
      const query = qs.toString();
      return apiCall<{ logs: GeofenceLog[] }>(
        `/api/branch-locations/logs${query ? `?${query}` : ''}`,
        {},
        token,
      );
    },
    select: (r) => r.logs ?? [],
    enabled: !!token && (opts?.enabled ?? true),
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

export function useReportSummary(token: string, period: string, branchId?: string | null) {
  return useQuery({
    queryKey: qk.reportSummary(period, branchId),
    queryFn: () =>
      apiCall<ReportSummary>(
        `/api/reports/summary?period=${period}${branchId ? `&branchId=${branchId}` : ''}`,
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
export function useStockRows(token: string, opts?: { branchId?: string | null; enabled?: boolean }) {
  const branchId = opts?.branchId;
  return useQuery({
    queryKey: qk.stock(branchId),
    queryFn: () =>
      apiCall<{ rows: StockRow[] }>(`/api/stock${branchId ? `?branchId=${branchId}` : ''}`, {}, token),
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
 * Advisory — used to show Previous Balance / Total Required on a still-pending order;
 * the approval transaction recomputes the authoritative figures server-side.
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
    // Packing items are optional; an omitted/empty array posts exactly the payload
    // this endpoint accepted before the packing-material module existed.
    mutationFn: (v: { items: ProductionOrderItem[]; packingItems?: ProductionOrderPackingItem[] }) =>
      apiCall(
        '/api/production-orders',
        { method: 'POST', body: JSON.stringify({ items: v.items, packingItems: v.packingItems ?? [] }) },
        token,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['productionOrders'] });
      qc.invalidateQueries({ queryKey: ['stock'] });
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

export interface ProductionExpenseSummary {
  today: number;
  weekly: number;
  monthly: number;
  yearly: number;
  byCategory: { category: string; total: number }[];
  trend: { date: string; amount: number }[];
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
    mutationFn: ({ id, status }: { id: string; status: 'accepted' | 'rejected' }) =>
      apiCall(`/api/production-returns/${id}/review`, { method: 'PUT', body: JSON.stringify({ status }) }, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['productionReturns'] });
      qc.invalidateQueries({ queryKey: ['productionStock'] });
      qc.invalidateQueries({ queryKey: ['productionBranchStock'] });
      qc.invalidateQueries({ queryKey: ['productionOverview'] });
    },
  });
}

export function useProductionExpenses(token: string) {
  return useQuery({
    queryKey: qk.productionExpenses(),
    queryFn: () => apiCall<{ expenses: ProductionExpense[] }>('/api/production-expenses', {}, token),
    select: (r) => r.expenses ?? [],
    enabled: !!token,
  });
}

export function useProductionExpenseSummary(token: string) {
  return useQuery({
    queryKey: qk.productionExpenseSummary(),
    queryFn: () => apiCall<ProductionExpenseSummary>('/api/production-expenses/summary', {}, token),
    enabled: !!token,
  });
}

export function useCreateProductionExpense(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiCall('/api/production-expenses', { method: 'POST', body: JSON.stringify(body) }, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['productionExpenses'] });
      qc.invalidateQueries({ queryKey: ['productionExpenseSummary'] });
    },
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
export function useRefreshEventEstimates(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { year?: number } = {}) =>
      apiCall<{ updated: number; unresolved: number; schedulesRegenerated: number }>(
        '/api/special-events/maintenance/refresh-estimates',
        { method: 'POST', body: JSON.stringify(body) },
        token,
      ),
    onSuccess: () => invalidateEvents(qc),
  });
}

export function useRollForwardEvents(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { targetYear?: number } = {}) =>
      apiCall<{ created: number; skipped: number }>(
        '/api/special-events/maintenance/roll-forward',
        { method: 'POST', body: JSON.stringify(body) },
        token,
      ),
    onSuccess: () => invalidateEvents(qc),
  });
}
