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
  StoreIssue,
  StoreIssueInput,
  StoreItem,
  StoreItemHistory,
  StoreItemInput,
  StoreLedger,
  StoreLookup,
  StoreLookupInput,
  StoreMe,
  StorePage,
  StorePrice,
  StorePriceInput,
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

export function useStoreSuppliers(token: string) {
  return useQuery({
    queryKey: qk.storeSuppliers(),
    queryFn: () => apiCall<Array<{ id: string; name: string; supplierCode: string }>>(`${BASE}/suppliers`, {}, token),
    enabled: !!token,
    staleTime: 5 * 60_000,
  });
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

export async function downloadStoreReport(token: string, type: StoreReportType, from: string, to: string, itemId: string | null): Promise<void> {
  const blob = await apiCall<Blob>(`${BASE}/reports/${type}/export${qs({ from, to, itemId })}`, {}, token);
  saveBlob(blob, `mountain-bakes-store-${type.replace(/_/g, '-')}-${from}-to-${to}.xlsx`);
}

// ── Writes ──────────────────────────────────────────────────────────────────

export function useSaveStoreItem(token: string) {
  return useStoreMutation((v: { id?: string; input: StoreItemInput }) =>
    apiCall<StoreItem>(v.id ? `${BASE}/items/${v.id}` : `${BASE}/items`, send(v.id ? 'PUT' : 'POST', v.input), token));
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
