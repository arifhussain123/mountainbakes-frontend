'use client';

// Dry Items Store: the TanStack Query hooks over /api/store
// (routes/store.routes.ts on the API). Same shape as ./purchasing — `apiCall`
// plus keys from ./queryKeys — in a file of its own because the Store is a
// dozen screens over one API.
//
// INVALIDATION IS THE WHOLE ['store'] ROOT, on every write: a receipt changes
// stock, the ledger, the dashboard and what a demand can be approved for.
//
// IDEMPOTENCY. Creates that move stock (receipts, adjustments, demands,
// issues, prices, queries) take a `key` minted once per submission
// (crypto.randomUUID) and reused on a retry of the SAME submission. It travels
// as the Idempotency-Key header AND as `clientRequestId`, the database-level
// guard, so a lost answer cannot receive or issue stock twice.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  StoreAccount,
  StoreAccountFlagsInput,
  StoreAdjustInput,
  StoreAdjustment,
  StoreAuditEvent,
  StoreConfirmIssueInput,
  StoreDashboard,
  StoreDecisionInput,
  StoreDemand,
  StoreDemandInput,
  StoreDemandStatus,
  StoreDepartment,
  StoreFeature,
  StoreIssue,
  StoreIssueInput,
  StoreItem,
  StoreItemBarcode,
  StoreItemBarcodeInput,
  StoreItemHistory,
  StoreItemPackage,
  StoreItemPackageInput,
  StoreItemImportCommitRow,
  StoreItemImportPreview,
  StoreItemImportResult,
  StoreItemInput,
  StoreLedger,
  StoreLookup,
  StoreLookupInput,
  StoreMe,
  StorePage,
  StorePrice,
  StorePriceInput,
  StorePriceRequest,
  StoreSupplier,
  StoreSupplierInput,
  StoreQuery,
  StoreQueryInput,
  StoreQueryMessageInput,
  StoreQueryStatus,
  StoreReceipt,
  StoreReceiptInput,
  StoreReport,
  StoreReportType,
  StoreSettingsInput,
  StoreStockRow,
} from '@mb/shared';
import { apiCall } from '@/utils/api';
import { saveBlob } from '@/utils/saveBlob';
import { qk } from './queryKeys';

const BASE = '/api/store';
/** Store screens are work queues: a minute-old free-stock figure is a wrong approval. */
const LIVE_STALE_TIME = 15_000;

const send = (method: string, body?: unknown, key?: string): RequestInit => ({
  method,
  ...(key ? { headers: { 'Idempotency-Key': key } } : {}),
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

function qs(params: Record<string, unknown>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** A fresh id for one submission; keep it while the same submission is retried. */
export const newSubmissionKey = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));

export function useInvalidateStore() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['store'] });
}

function useStoreMutation<TVars, TOut>(fn: (vars: TVars) => Promise<TOut>) {
  const invalidate = useInvalidateStore();
  return useMutation({ mutationFn: fn, onSuccess: () => invalidate() });
}

// ── Reads ───────────────────────────────────────────────────────────────────

export function useStoreMe(token: string) {
  return useQuery({
    queryKey: qk.storeMe(),
    queryFn: () => apiCall<StoreMe>(`${BASE}/me`, {}, token),
    enabled: !!token,
    staleTime: 60_000,
  });
}

export function useStoreLookups(token: string, all = false) {
  return useQuery({
    queryKey: qk.storeLookups(all),
    queryFn: () => apiCall<StoreLookup[]>(`${BASE}/lookups${all ? '?all=true' : ''}`, {}, token),
    enabled: !!token,
    staleTime: 5 * 60_000,
  });
}

export function useStoreAccounts(token: string, enabled = true) {
  return useQuery({
    queryKey: qk.storeAccounts(),
    queryFn: () => apiCall<StoreAccount[]>(`${BASE}/accounts`, {}, token),
    enabled: !!token && enabled,
  });
}

export function useStoreItems(token: string, includeInactive = false) {
  return useQuery({
    queryKey: qk.storeItems(includeInactive),
    queryFn: () => apiCall<StoreItem[]>(`${BASE}/items${includeInactive ? '?includeInactive=true' : ''}`, {}, token),
    enabled: !!token,
    staleTime: LIVE_STALE_TIME,
  });
}

export function useStoreItemHistory(token: string, id: string | null) {
  return useQuery({
    queryKey: qk.storeItemHistory(id ?? ''),
    queryFn: () => apiCall<StoreItemHistory>(`${BASE}/items/${id}/history`, {}, token),
    enabled: !!token && !!id,
  });
}

/** The purchase packages of one item (Items v2). */
export function useStoreItemPackages(token: string, id: string | null) {
  return useQuery({
    queryKey: qk.storeItemPackages(id ?? ''),
    queryFn: () => apiCall<StoreItemPackage[]>(`${BASE}/items/${id}/packages`, {}, token),
    enabled: !!token && !!id,
    staleTime: 60_000,
  });
}

export function useAddStoreItemPackage(token: string) {
  return useStoreMutation((v: { itemId: string; input: StoreItemPackageInput }) =>
    apiCall<StoreItemPackage>(`${BASE}/items/${v.itemId}/packages`, send('POST', v.input), token));
}

export function useDeleteStoreItemPackage(token: string) {
  return useStoreMutation((id: string) => apiCall<{ ok: true }>(`${BASE}/item-packages/${id}`, send('DELETE'), token));
}

/** An item's barcodes (behind the `barcodes` flag). */
export function useStoreItemBarcodes(token: string, id: string | null) {
  return useQuery({
    queryKey: qk.storeItemBarcodes(id ?? ''),
    queryFn: () => apiCall<StoreItemBarcode[]>(`${BASE}/items/${id}/barcodes`, {}, token),
    enabled: !!token && !!id,
    staleTime: 60_000,
  });
}

export function useAddStoreItemBarcode(token: string) {
  return useStoreMutation((v: { itemId: string; input: StoreItemBarcodeInput }) =>
    apiCall<StoreItemBarcode>(`${BASE}/items/${v.itemId}/barcodes`, send('POST', v.input), token));
}

export function useDeleteStoreItemBarcode(token: string) {
  return useStoreMutation((id: string) => apiCall<{ ok: true }>(`${BASE}/item-barcodes/${id}`, send('DELETE'), token));
}

export function useStoreItemLedger(token: string, id: string | null, from: string, to: string) {
  return useQuery({
    queryKey: qk.storeItemLedger(id ?? '', from, to),
    queryFn: () => apiCall<StoreLedger & { from: string; to: string }>(`${BASE}/items/${id}/ledger${qs({ from, to })}`, {}, token),
    enabled: !!token && !!id && !!from && !!to,
    staleTime: LIVE_STALE_TIME,
  });
}

export function useStorePrices(token: string, params: { itemId?: string; history?: boolean } = {}) {
  return useQuery({
    queryKey: qk.storePrices(params),
    queryFn: () => apiCall<StorePrice[]>(`${BASE}/prices${qs(params)}`, {}, token),
    enabled: !!token,
  });
}

/** Items a keeper has asked Finance to price (default: still open). */
export function useStorePriceRequests(token: string, status: 'open' | 'resolved' | 'cancelled' = 'open', enabled = true) {
  return useQuery({
    queryKey: qk.storePriceRequests(status),
    queryFn: () => apiCall<StorePriceRequest[]>(`${BASE}/price-requests?status=${status}`, {}, token),
    enabled: !!token && enabled,
    staleTime: LIVE_STALE_TIME,
  });
}

export function useStoreSuppliers(token: string, includeInactive = false) {
  return useQuery({
    queryKey: qk.storeSuppliers(includeInactive),
    queryFn: () => apiCall<StoreSupplier[]>(`${BASE}/suppliers${includeInactive ? '?includeInactive=true' : ''}`, {}, token),
    enabled: !!token,
    staleTime: 5 * 60_000,
  });
}

/** Create or edit a supplier in the shared master (behind the `suppliers` flag). */
export function useSaveStoreSupplier(token: string) {
  return useStoreMutation((v: { id?: string; input: StoreSupplierInput }) =>
    apiCall<StoreSupplier>(v.id ? `${BASE}/suppliers/${v.id}` : `${BASE}/suppliers`, send(v.id ? 'PUT' : 'POST', v.input), token));
}

export function useStoreReceipts(token: string, params: { from?: string; to?: string; search?: string; limit?: number; offset?: number }) {
  return useQuery({
    queryKey: qk.storeReceipts(params),
    queryFn: () => apiCall<StorePage<StoreReceipt>>(`${BASE}/receipts${qs(params)}`, {}, token),
    enabled: !!token,
    staleTime: LIVE_STALE_TIME,
  });
}

export function useStoreReceipt(token: string, id: string | null) {
  return useQuery({
    queryKey: qk.storeReceipt(id ?? ''),
    queryFn: () => apiCall<StoreReceipt>(`${BASE}/receipts/${id}`, {}, token),
    enabled: !!token && !!id,
  });
}

export function useStoreStock(token: string, from: string, to: string) {
  return useQuery({
    queryKey: qk.storeStock(from, to),
    queryFn: () => apiCall<{ from: string; to: string; rows: StoreStockRow[] }>(`${BASE}/stock${qs({ from, to })}`, {}, token),
    enabled: !!token && !!from && !!to,
    staleTime: LIVE_STALE_TIME,
  });
}

export function useStoreAdjustments(token: string, params: { from?: string; to?: string; itemId?: string; limit?: number; offset?: number }) {
  return useQuery({
    queryKey: qk.storeAdjustments(params),
    queryFn: () => apiCall<StorePage<StoreAdjustment>>(`${BASE}/adjustments${qs(params)}`, {}, token),
    enabled: !!token,
  });
}

export function useStoreDemands(token: string, params: { status?: StoreDemandStatus[]; from?: string; to?: string; search?: string; limit?: number; offset?: number }) {
  return useQuery({
    queryKey: qk.storeDemands(params),
    queryFn: () => apiCall<StorePage<StoreDemand>>(`${BASE}/demands${qs(params)}`, {}, token),
    enabled: !!token,
    staleTime: LIVE_STALE_TIME,
  });
}

export function useStoreDemandCounts(token: string) {
  return useQuery({
    queryKey: qk.storeDemandCounts(),
    queryFn: () => apiCall<Record<StoreDemandStatus | 'all', number>>(`${BASE}/demands/counts`, {}, token),
    enabled: !!token,
    staleTime: LIVE_STALE_TIME,
  });
}

export function useStoreIssues(token: string, params: { demandId?: string; status?: string; from?: string; to?: string; search?: string; limit?: number; offset?: number }) {
  return useQuery({
    queryKey: qk.storeIssues(params),
    queryFn: () => apiCall<StorePage<StoreIssue>>(`${BASE}/issues${qs(params)}`, {}, token),
    enabled: !!token,
    staleTime: LIVE_STALE_TIME,
  });
}

export function useStoreQueries(token: string, params: { status?: StoreQueryStatus; search?: string; archived?: boolean; limit?: number; offset?: number }) {
  return useQuery({
    queryKey: qk.storeQueries(params),
    queryFn: () => apiCall<StorePage<StoreQuery> & { counts: Record<StoreQueryStatus | 'all', number> }>(`${BASE}/queries${qs(params)}`, {}, token),
    enabled: !!token,
    staleTime: LIVE_STALE_TIME,
  });
}

export function useStoreQuery(token: string, id: string | null) {
  return useQuery({
    queryKey: qk.storeQuery(id ?? ''),
    queryFn: () => apiCall<StoreQuery>(`${BASE}/queries/${id}`, {}, token),
    enabled: !!token && !!id,
  });
}

export function useStoreDashboard(token: string, from: string, to: string, period: 'day' | 'week' | 'month') {
  return useQuery({
    queryKey: qk.storeDashboard(from, to, period),
    queryFn: () => apiCall<StoreDashboard & { from: string; to: string; period: string }>(`${BASE}/dashboard${qs({ from, to, period })}`, {}, token),
    enabled: !!token && !!from && !!to,
    staleTime: LIVE_STALE_TIME,
  });
}

export function useStoreReport(token: string, type: StoreReportType, from: string, to: string, itemId: string | null) {
  return useQuery({
    queryKey: qk.storeReport(type, from, to, itemId),
    queryFn: () => apiCall<StoreReport>(`${BASE}/reports/${type}${qs({ from, to, itemId })}`, {}, token),
    enabled: !!token && !!from && !!to,
  });
}

export function useStoreAudit(token: string, params: { entity?: string; limit?: number; offset?: number }, enabled = true) {
  return useQuery({
    queryKey: qk.storeAudit(params),
    queryFn: () => apiCall<StorePage<StoreAuditEvent>>(`${BASE}/audit${qs(params)}`, {}, token),
    enabled: !!token && enabled,
  });
}

/** Which optional modules are on for the store (Admin). */
export function useStoreFeatures(token: string, enabled = true) {
  return useQuery({
    queryKey: qk.storeFeatures(),
    queryFn: () => apiCall<StoreFeature[]>(`${BASE}/features`, {}, token),
    enabled: !!token && enabled,
    staleTime: 5 * 60_000,
  });
}

export async function downloadStoreReport(token: string, type: StoreReportType, from: string, to: string, itemId: string | null): Promise<void> {
  const blob = await apiCall<Blob>(`${BASE}/reports/${type}/export${qs({ from, to, itemId })}`, {}, token);
  saveBlob(blob, `mountain-bakes-store-${type.replace(/_/g, '-')}-${from}-to-${to}.xlsx`);
}

/** Download the full item master as .xlsx (or .csv). Doubles as the re-import template. */
export async function downloadStoreItems(token: string, type: 'excel' | 'csv' = 'excel'): Promise<void> {
  const blob = await apiCall<Blob>(`${BASE}/items/export?type=${type}`, {}, token);
  const ext = type === 'csv' ? 'csv' : 'xlsx';
  saveBlob(blob, `mountain-bakes-store-items-${new Date().toISOString().slice(0, 10)}.${ext}`);
}

/** Upload a .xlsx/.csv and get a validated preview. Never writes. */
export async function previewStoreItemImport(token: string, file: File): Promise<StoreItemImportPreview> {
  const body = new FormData();
  body.append('file', file);
  // apiCall omits Content-Type for FormData so the browser sets the multipart boundary.
  return apiCall<StoreItemImportPreview>(`${BASE}/items/import/preview`, { method: 'POST', body }, token);
}

// ── Writes ──────────────────────────────────────────────────────────────────

export function useSaveStoreItem(token: string) {
  return useStoreMutation((v: { id?: string; input: StoreItemInput }) =>
    apiCall<StoreItem>(v.id ? `${BASE}/items/${v.id}` : `${BASE}/items`, send(v.id ? 'PUT' : 'POST', v.input), token));
}

/** Apply the confirmed rows from an item Excel import; invalidates the Store on success. */
export function useCommitStoreItemImport(token: string) {
  return useStoreMutation((rows: StoreItemImportCommitRow[]) =>
    apiCall<StoreItemImportResult>(`${BASE}/items/import/commit`, send('POST', { rows }), token));
}

export function useSetStoreItemStatus(token: string) {
  return useStoreMutation((v: { id: string; active: boolean }) =>
    apiCall<StoreItem>(`${BASE}/items/${v.id}/status`, send('PATCH', { active: v.active }), token));
}

export function useDeleteStoreItem(token: string) {
  return useStoreMutation((id: string) => apiCall<{ ok: true }>(`${BASE}/items/${id}`, send('DELETE'), token));
}

export function useAddStorePrice(token: string) {
  return useStoreMutation((v: { input: StorePriceInput; key: string }) =>
    apiCall<StorePrice>(`${BASE}/prices`, send('POST', v.input, v.key), token));
}

export function useDeactivateStorePrice(token: string) {
  return useStoreMutation((id: string) => apiCall<StorePrice>(`${BASE}/prices/${id}/deactivate`, send('POST'), token));
}

/** Ask Finance/Admin to set a price for an item that has none. */
export function useRequestStorePrice(token: string) {
  return useStoreMutation((v: { itemId: string; note?: string }) =>
    apiCall<StorePriceRequest>(`${BASE}/price-requests`, send('POST', v), token));
}

export function useReceiveStock(token: string) {
  return useStoreMutation((v: { input: StoreReceiptInput; key: string }) =>
    apiCall<StoreReceipt>(`${BASE}/receipts`, send('POST', { ...v.input, clientRequestId: v.key }, v.key), token));
}

export function useAdjustStock(token: string) {
  return useStoreMutation((v: { input: StoreAdjustInput; key: string }) =>
    apiCall<StoreAdjustment>(`${BASE}/adjustments`, send('POST', { ...v.input, clientRequestId: v.key }, v.key), token));
}

export function useCreateStoreDemand(token: string) {
  return useStoreMutation((v: { input: StoreDemandInput; key: string }) =>
    apiCall<StoreDemand>(`${BASE}/demands`, send('POST', { ...v.input, clientRequestId: v.key }, v.key), token));
}

export function useCancelStoreDemand(token: string) {
  return useStoreMutation((id: string) => apiCall<StoreDemand>(`${BASE}/demands/${id}/cancel`, send('POST'), token));
}

export function useDecideStoreLine(token: string) {
  return useStoreMutation((v: { lineId: string; input: StoreDecisionInput }) =>
    apiCall<StoreDemand>(`${BASE}/demand-lines/${v.lineId}/decision`, send('POST', v.input), token));
}

export function useApproveAllStoreDemand(token: string) {
  return useStoreMutation((demandId: string) =>
    apiCall<{ demand: StoreDemand; approved: number; skipped: number }>(`${BASE}/demands/${demandId}/approve-all`, send('POST'), token));
}

export function useIssueStock(token: string) {
  return useStoreMutation((v: { input: StoreIssueInput; key: string }) =>
    apiCall<StoreIssue>(`${BASE}/issues`, send('POST', { ...v.input, clientRequestId: v.key }, v.key), token));
}

export function useConfirmStoreIssue(token: string) {
  return useStoreMutation((v: { id: string; input: StoreConfirmIssueInput }) =>
    apiCall<StoreIssue>(`${BASE}/issues/${v.id}/confirm`, send('POST', v.input), token));
}

export function useCreateStoreQuery(token: string) {
  return useStoreMutation((v: { input: StoreQueryInput; key: string }) =>
    apiCall<StoreQuery>(`${BASE}/queries`, send('POST', v.input, v.key), token));
}

export function useReplyStoreQuery(token: string) {
  return useStoreMutation((v: { id: string; input: StoreQueryMessageInput }) =>
    apiCall<StoreQuery>(`${BASE}/queries/${v.id}/messages`, send('POST', v.input), token));
}

export function useArchiveStoreQuery(token: string) {
  return useStoreMutation((id: string) => apiCall<{ ok: true }>(`${BASE}/queries/${id}`, send('DELETE'), token));
}

export function useSaveStoreAccount(token: string) {
  return useStoreMutation((v: { userId: string; input: StoreAccountFlagsInput }) =>
    apiCall<StoreAccount>(`${BASE}/accounts/${v.userId}`, send('PUT', v.input), token));
}

export function useAddStoreLookup(token: string) {
  return useStoreMutation((input: StoreLookupInput) => apiCall<StoreLookup>(`${BASE}/lookups`, send('POST', input), token));
}

export function useSetStoreLookupActive(token: string) {
  return useStoreMutation((v: { id: string; active: boolean }) =>
    apiCall<StoreLookup>(`${BASE}/lookups/${v.id}`, send('PATCH', { active: v.active }), token));
}

export function useSaveStoreSettings(token: string) {
  return useStoreMutation((input: StoreSettingsInput) => apiCall<StoreDepartment>(`${BASE}/settings`, send('PUT', input), token));
}

/** Turn a store module on/off; invalidates ['store'] so /me features refresh. */
export function useSetStoreFeature(token: string) {
  return useStoreMutation((v: { key: string; enabled: boolean }) =>
    apiCall<StoreFeature>(`${BASE}/features/${v.key}`, send('PUT', { enabled: v.enabled }), token));
}
