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
  ReportSummary,
  StockRow,
  SupportTicket,
  SupportTicketCategory,
  TicketStats,
  CreateTicketInput,
} from '@mb/shared';

// Query keys live in ./queryKeys so non-React code (@/utils/productPrice) can reuse
// them without importing these hooks. Re-exported here for existing call sites.
export { qk };

type ProductionOrderItem = { productId: string; qty: number; remarks: string };

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
    mutationFn: (items: ProductionOrderItem[]) =>
      apiCall('/api/production-orders', { method: 'POST', body: JSON.stringify({ items }) }, token),
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

/** Central production-pool table for a Karachi day (defaults to today). */
export function useProductionStock(token: string, date?: string | null) {
  return useQuery({
    queryKey: qk.productionStock(date),
    queryFn: () =>
      apiCall<{ rows: ProductionStockRow[]; date: string }>(
        `/api/production-stock${date ? `?date=${date}` : ''}`,
        {},
        token,
      ),
    select: (r) => r.rows ?? [],
    enabled: !!token,
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
  status: 'approved' | 'rejected';
  approvedItems?: { productId: string; approvedQty: number }[];
  reason?: string;
}

/** Approve/reject a production demand (with optional qty overrides). */
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

// ─────────────────────────────────────────────────────────────────────────────
// Support / Query tickets
// ─────────────────────────────────────────────────────────────────────────────

export function useTickets(token: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.tickets(),
    queryFn: () => apiCall<{ tickets: SupportTicket[] }>('/api/support-tickets', {}, token),
    select: (r) => r.tickets ?? [],
    staleTime: LIVE_STALE_TIME,
    enabled: !!token && (opts?.enabled ?? true),
  });
}

export function useTicket(token: string, id: string | null) {
  return useQuery({
    queryKey: qk.ticket(id ?? 'none'),
    queryFn: () => apiCall<{ ticket: SupportTicket }>(`/api/support-tickets/${id}`, {}, token),
    select: (r) => r.ticket,
    staleTime: LIVE_STALE_TIME,
    enabled: !!token && !!id,
  });
}

export function useTicketStats(token: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.ticketStats(),
    queryFn: () => apiCall<{ stats: TicketStats }>('/api/support-tickets/stats', {}, token),
    select: (r) => r.stats,
    staleTime: LIVE_STALE_TIME,
    enabled: !!token && (opts?.enabled ?? true),
  });
}

export function useTicketCategories(token: string, opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: qk.ticketCategories(),
    queryFn: () => apiCall<{ categories: SupportTicketCategory[] }>('/api/support-tickets/categories', {}, token),
    select: (r) => r.categories ?? [],
    enabled: !!token && (opts?.enabled ?? true),
  });
}

export function useCreateTicket(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTicketInput) =>
      apiCall<{ id: string; ticketNo: string }>('/api/support-tickets', { method: 'POST', body: JSON.stringify(input) }, token),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.tickets() });
      qc.invalidateQueries({ queryKey: qk.ticketStats() });
    },
  });
}

export function useAddTicketMessage(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { ticketId: string; message: string }) =>
      apiCall(`/api/support-tickets/${v.ticketId}/messages`, { method: 'POST', body: JSON.stringify({ message: v.message }) }, token),
    onSuccess: (_data, v) => {
      qc.invalidateQueries({ queryKey: qk.ticket(v.ticketId) });
      qc.invalidateQueries({ queryKey: qk.tickets() });
    },
  });
}
