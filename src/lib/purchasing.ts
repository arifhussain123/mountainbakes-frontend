'use client';

// Production → WhatsApp Purchasing: the TanStack Query hooks over
// /api/purchasing (routes/purchasing.routes.ts on the API). Same shape as
// ./queries — `apiCall` + keys from ./queryKeys — kept in a file of its own
// because the feature is one page with two dozen endpoints, and folding them
// into the 2,900-line queries.ts would bury them.
//
// INVALIDATION IS THE WHOLE ['purchasing'] ROOT, on every write. A quotation
// decision moves the demand between tabs, changes the summary counts, queues a
// WhatsApp message (conversation list, outbox counter) and rewrites the detail;
// a receipt moves ingredient stock the catalog shows. Listing which of the
// cached views one write touched is how a stale tab count happens. The page is
// one screen, so refetching its active queries is cheap.
//
// IDEMPOTENCY. Every endpoint the API wraps in `idempotent(...)` takes `key`:
// the caller mints it once per submission (SubmissionKey) and passes the SAME
// key when the person retries the same submission, so a lost answer cannot
// record a payment, a receipt or a send twice. The key travels as the
// Idempotency-Key header; endpoints whose schema also takes a clientRequestId
// get the caller's id in the body as the database-level guard.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  PurchaseDelivery,
  PurchaseDemand,
  PurchaseDemandDetail,
  PurchaseDemandListResponse,
  PurchaseItem,
  PurchaseReceipt,
  PurchasingSummary,
  Quotation,
  Supplier,
  SupplierBalance,
  SupplierBill,
  SupplierCredit,
  SupplierPayment,
  VerificationResult,
  WhatsAppConnectionStatus,
  WhatsAppConversation,
  WhatsAppMessage,
} from '@mb/shared';
import { apiCall } from '@/utils/api';
import { qk } from './queryKeys';

const BASE = '/api/purchasing';
/** The page is a work queue; a minute-old count is a wrong count. */
const LIVE_STALE_TIME = 15_000;

const json = (body: unknown) => JSON.stringify(body);
const post = (body?: unknown, key?: string): RequestInit => ({
  method: 'POST',
  ...(key ? { headers: { 'Idempotency-Key': key } } : {}),
  ...(body === undefined ? {} : { body: json(body) }),
});

function useInvalidatePurchasing() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['purchasing'] });
}

// ── Reads ───────────────────────────────────────────────────────────────────

export function usePurchasingStatus(token: string) {
  return useQuery({
    queryKey: qk.purchasingStatus(),
    queryFn: () => apiCall<WhatsAppConnectionStatus>(`${BASE}/status`, {}, token),
    enabled: !!token,
    staleTime: LIVE_STALE_TIME,
  });
}

export function usePurchasingSummary(token: string) {
  return useQuery({
    queryKey: qk.purchasingSummary(),
    queryFn: () => apiCall<PurchasingSummary>(`${BASE}/summary`, {}, token),
    enabled: !!token,
    staleTime: LIVE_STALE_TIME,
  });
}

export type DemandSortKey = 'created_at' | 'required_date' | 'demand_no' | 'supplier_name' | 'updated_at';

export interface DemandListParams {
  bucket?: string | null;
  status?: string | null;
  priority?: string | null;
  supplierId?: string | null;
  from?: string | null;
  to?: string | null;
  search?: string | null;
  sortBy?: DemandSortKey | null;
  sortDir?: 'asc' | 'desc' | null;
  page?: number;
  limit?: number;
}

export function usePurchaseDemands(token: string, p: DemandListParams, opts?: { enabled?: boolean }) {
  const limit = p.limit ?? 20;
  const offset = ((p.page ?? 1) - 1) * limit;
  // The whole filter object is the key: bucket, status, supplier, dates,
  // search and sort each select different rows (same convention as qk.branchReturns).
  const key = {
    bucket: p.bucket ?? null,
    status: p.status ?? null,
    priority: p.priority ?? null,
    supplierId: p.supplierId ?? null,
    from: p.from ?? null,
    to: p.to ?? null,
    search: p.search ?? null,
    sortBy: p.sortBy ?? null,
    sortDir: p.sortDir ?? null,
    limit,
    offset,
  };
  return useQuery({
    queryKey: qk.purchaseDemands(key),
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      for (const [k, v] of Object.entries(key)) {
        if (k === 'limit' || k === 'offset' || v === null || v === '' || (k === 'bucket' && v === 'all')) continue;
        params.set(k, String(v));
      }
      return apiCall<PurchaseDemandListResponse>(`${BASE}/demands?${params.toString()}`, {}, token);
    },
    enabled: !!token && (opts?.enabled ?? true),
    staleTime: LIVE_STALE_TIME,
    placeholderData: (prev) => prev,
  });
}

export function usePurchaseDemand(token: string, id: string | null) {
  return useQuery({
    queryKey: qk.purchaseDemand(id ?? 'none'),
    queryFn: () => apiCall<PurchaseDemandDetail>(`${BASE}/demands/${id}`, {}, token),
    enabled: !!token && !!id,
    staleTime: LIVE_STALE_TIME,
  });
}

/**
 * Suppliers, first 200 by name. The pickers filter this list in memory — a
 * bakery's supplier book is tens of rows, and filtering locally keeps the
 * combobox instant. `search` is for the cases that pass one.
 */
export function usePurchaseSuppliers(token: string, search?: string | null) {
  return useQuery({
    queryKey: qk.purchaseSuppliers(search ?? null),
    queryFn: () => {
      const params = new URLSearchParams({ limit: '200' });
      if (search) params.set('search', search);
      return apiCall<{ suppliers: Supplier[]; total: number }>(`${BASE}/suppliers?${params.toString()}`, {}, token);
    },
    enabled: !!token,
  });
}

/** One supplier's billed / paid / credit position, for the demand form's credit section. */
export function useSupplierBalance(token: string, supplierId: string | null) {
  return useQuery({
    queryKey: qk.purchaseSupplierBalance(supplierId ?? 'none'),
    queryFn: async () => {
      const rows = await apiCall<SupplierBalance[]>(`${BASE}/suppliers/balances?supplierId=${supplierId}`, {}, token);
      return rows[0] ?? null;
    },
    enabled: !!token && !!supplierId,
    staleTime: LIVE_STALE_TIME,
  });
}

/** The ingredient catalog, with stock on hand. */
export function usePurchaseItems(token: string) {
  return useQuery({
    queryKey: qk.purchaseItems(),
    queryFn: () => apiCall<PurchaseItem[]>(`${BASE}/items`, {}, token),
    enabled: !!token,
  });
}

export function usePurchaseConversations(token: string, search?: string | null) {
  return useQuery({
    queryKey: qk.purchaseConversations(search ?? null),
    queryFn: () => {
      const params = new URLSearchParams({ limit: '100' });
      if (search) params.set('search', search);
      return apiCall<{ conversations: WhatsAppConversation[]; total: number }>(`${BASE}/conversations?${params.toString()}`, {}, token);
    },
    enabled: !!token,
    staleTime: LIVE_STALE_TIME,
  });
}

export interface MessageListParams {
  conversationId?: string | null;
  demandId?: string | null;
  supplierId?: string | null;
  filter?: 'failed' | 'unmatched' | 'inbound' | 'outbound' | null;
  page?: number;
  limit?: number;
}

export function usePurchaseMessages(token: string, p: MessageListParams, opts?: { enabled?: boolean }) {
  const limit = p.limit ?? 50;
  const offset = ((p.page ?? 1) - 1) * limit;
  const key = {
    conversationId: p.conversationId ?? null,
    demandId: p.demandId ?? null,
    supplierId: p.supplierId ?? null,
    filter: p.filter ?? null,
    limit,
    offset,
  };
  return useQuery({
    queryKey: qk.purchaseMessages(key),
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (key.conversationId) params.set('conversationId', key.conversationId);
      if (key.demandId) params.set('demandId', key.demandId);
      if (key.supplierId) params.set('supplierId', key.supplierId);
      if (key.filter) params.set('filter', key.filter);
      return apiCall<{ messages: WhatsAppMessage[]; total: number }>(`${BASE}/messages?${params.toString()}`, {}, token);
    },
    enabled: !!token && (opts?.enabled ?? true),
    staleTime: LIVE_STALE_TIME,
  });
}

// ── Suppliers and catalog ───────────────────────────────────────────────────

export interface SupplierCreateBody {
  name: string;
  whatsappNumber: string;
  contactPerson?: string | null;
  phone?: string | null;
  category?: string | null;
  address?: string | null;
  paymentTerms?: string | null;
  notes?: string | null;
  whatsappOptIn: boolean;
  whatsappOptInSource?: string | null;
}

export function useCreateSupplier(token: string) {
  const invalidate = useInvalidatePurchasing();
  return useMutation({
    mutationFn: (body: SupplierCreateBody) => apiCall<Supplier>(`${BASE}/suppliers`, post(body), token),
    onSuccess: invalidate,
  });
}

export function useCreatePurchaseItem(token: string) {
  const invalidate = useInvalidatePurchasing();
  return useMutation({
    mutationFn: (body: { name: string; unit: string; category?: string | null }) =>
      apiCall<PurchaseItem>(`${BASE}/items`, post(body), token),
    onSuccess: invalidate,
  });
}

// ── Demand: draft, verify, send ─────────────────────────────────────────────

/** The demand body the form sends, exactly as DemandInputSchema parsed it. */
export type DemandBody = Record<string, unknown>;

export function useCreateDemand(token: string) {
  const invalidate = useInvalidatePurchasing();
  return useMutation({
    mutationFn: ({ body, key }: { body: DemandBody; key: string }) =>
      apiCall<PurchaseDemand & { replayed: boolean }>(`${BASE}/demands`, post(body, key), token),
    onSuccess: invalidate,
  });
}

export function useUpdateDemand(token: string) {
  const invalidate = useInvalidatePurchasing();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: DemandBody & { revision: number } }) =>
      apiCall<PurchaseDemand>(`${BASE}/demands/${id}`, { method: 'PUT', body: json(body) }, token),
    onSuccess: invalidate,
  });
}

export function useVerifyDemand(token: string) {
  const invalidate = useInvalidatePurchasing();
  return useMutation({
    mutationFn: ({ id, revision }: { id: string; revision: number }) =>
      apiCall<VerificationResult>(`${BASE}/demands/${id}/verify`, post({ revision }), token),
    onSuccess: invalidate,
  });
}

export function useSendDemand(token: string) {
  const invalidate = useInvalidatePurchasing();
  return useMutation({
    mutationFn: ({ id, revision, key }: { id: string; revision: number; key: string }) =>
      apiCall<PurchaseDemand & { messageId: string }>(`${BASE}/demands/${id}/send`, post({ revision }, key), token),
    onSuccess: invalidate,
  });
}

export function useResendLink(token: string) {
  const invalidate = useInvalidatePurchasing();
  return useMutation({
    mutationFn: ({ id, key }: { id: string; key: string }) =>
      apiCall<PurchaseDemand>(`${BASE}/demands/${id}/resend-link`, post(undefined, key), token),
    onSuccess: invalidate,
  });
}

export function useCancelDemand(token: string) {
  const invalidate = useInvalidatePurchasing();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      apiCall<PurchaseDemand>(`${BASE}/demands/${id}/cancel`, post({ reason }), token),
    onSuccess: invalidate,
  });
}

export function useAddDemandNote(token: string) {
  const invalidate = useInvalidatePurchasing();
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note: string }) => apiCall(`${BASE}/demands/${id}/notes`, post({ note }), token),
    onSuccess: invalidate,
  });
}

// ── Quotation and bill ──────────────────────────────────────────────────────

export function useEnterQuotation(token: string) {
  const invalidate = useInvalidatePurchasing();
  return useMutation({
    mutationFn: ({ id, body, key }: { id: string; body: Record<string, unknown>; key: string }) =>
      apiCall<Quotation>(`${BASE}/demands/${id}/quotations`, post(body, key), token),
    onSuccess: invalidate,
  });
}

export function useDecideQuotation(token: string) {
  const invalidate = useInvalidatePurchasing();
  return useMutation({
    mutationFn: ({ id, quotationId, body }: {
      id: string;
      quotationId: string;
      body: { version: number; decision: 'approve' | 'request_changes' | 'reject'; reason?: string | null };
    }) => apiCall<PurchaseDemand>(`${BASE}/demands/${id}/quotations/${quotationId}/decision`, post(body), token),
    onSuccess: invalidate,
  });
}

export function useEnterBill(token: string) {
  const invalidate = useInvalidatePurchasing();
  return useMutation({
    mutationFn: ({ id, body, key }: { id: string; body: Record<string, unknown>; key: string }) =>
      apiCall<SupplierBill>(`${BASE}/demands/${id}/bills`, post(body, key), token),
    onSuccess: invalidate,
  });
}

export function useDecideBill(token: string) {
  const invalidate = useInvalidatePurchasing();
  return useMutation({
    mutationFn: ({ id, billId, body }: {
      id: string;
      billId: string;
      body: { decision: 'approve' | 'reject'; acceptDifferences?: boolean; reason?: string | null };
    }) => apiCall<PurchaseDemand>(`${BASE}/demands/${id}/bills/${billId}/decision`, post(body), token),
    onSuccess: invalidate,
  });
}

// ── Delivery, receipt, payment, credit ──────────────────────────────────────

export function useSaveDelivery(token: string) {
  const invalidate = useInvalidatePurchasing();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Record<string, unknown> }) =>
      apiCall<PurchaseDelivery>(`${BASE}/demands/${id}/delivery`, { method: 'PUT', body: json(body) }, token),
    onSuccess: invalidate,
  });
}

export function useRecordReceipt(token: string) {
  const invalidate = useInvalidatePurchasing();
  return useMutation({
    mutationFn: ({ id, body, key }: { id: string; body: Record<string, unknown>; key: string }) =>
      apiCall<PurchaseReceipt & { status: string; shortages: unknown[]; replayed: boolean }>(
        `${BASE}/demands/${id}/receipts`,
        post(body, key),
        token,
      ),
    onSuccess: invalidate,
  });
}

export function useRecordSupplierPayment(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body, key }: { id: string; body: Record<string, unknown>; key: string }) =>
      apiCall<SupplierPayment & { replayed: boolean }>(`${BASE}/demands/${id}/payments`, post(body, key), token),
    // ['finance'] too: the payment lands on Finance's Supplier Payments queue,
    // which a super admin may have open in the same session.
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchasing'] });
      void qc.invalidateQueries({ queryKey: ['finance', 'supplierPayments'] });
    },
  });
}

export function useRequestSupplierCredit(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body, key }: { id: string; body: Record<string, unknown>; key: string }) =>
      apiCall<SupplierCredit>(`${BASE}/demands/${id}/credits`, post(body, key), token),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['purchasing'] });
      void qc.invalidateQueries({ queryKey: ['finance', 'supplierPayments'] });
    },
  });
}

// ── Conversations and messages ──────────────────────────────────────────────

export function useMarkConversationRead(token: string) {
  const invalidate = useInvalidatePurchasing();
  return useMutation({
    mutationFn: (id: string) => apiCall(`${BASE}/conversations/${id}/read`, post(), token),
    onSuccess: invalidate,
  });
}

export function useReplyConversation(token: string) {
  const invalidate = useInvalidatePurchasing();
  return useMutation({
    mutationFn: ({ id, body, key }: { id: string; body: { body: string; demandId?: string | null; clientRequestId?: string }; key: string }) =>
      apiCall<WhatsAppMessage>(`${BASE}/conversations/${id}/reply`, post(body, key), token),
    onSuccess: invalidate,
  });
}

/**
 * Retry a failed send. Not idempotency-keyed on the API: it re-queues the SAME
 * message row (no new message, no new demand), so a double press re-queues one
 * message once and the second is refused by its state.
 */
export function useRetryMessage(token: string) {
  const invalidate = useInvalidatePurchasing();
  return useMutation({
    mutationFn: (messageId: string) => apiCall<WhatsAppMessage>(`${BASE}/messages/${messageId}/retry`, post(), token),
    onSuccess: invalidate,
  });
}

export function useReviewMessage(token: string) {
  const invalidate = useInvalidatePurchasing();
  return useMutation({
    mutationFn: ({ messageId, body }: {
      messageId: string;
      body: { action: 'assign' | 'dismiss'; supplierId?: string | null; demandId?: string | null };
    }) => apiCall<WhatsAppMessage>(`${BASE}/messages/${messageId}/review`, post(body), token),
    onSuccess: invalidate,
  });
}
