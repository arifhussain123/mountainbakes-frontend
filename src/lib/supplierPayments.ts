'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SupplierBalance, SupplierCredit, SupplierPayment } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { toQuery } from '@/lib/finance';
import { FINANCE_QK_ROOT, qk } from '@/lib/queryKeys';

/**
 * Finance → Supplier Payments (WhatsApp Purchasing). Production records a
 * supplier payment or asks for supplier credit; nothing reaches the book until
 * a Finance approver acts here (routes/finance-supplier-payments.routes.ts on
 * the API: `view` for the lists, `approve` for every decision).
 *
 * Keys live under the finance root, and every decision invalidates that whole
 * root — the same rule as useFinanceMutation in lib/finance.ts, for the same
 * reason: an approval posts a PV- voucher, which moves the Daily Ledger, the
 * dashboard and the pending counts at once.
 */

const BASE = '/api/finance/supplier-payments';

export type SupplierPaymentFilters = {
  status?: string;
  supplierId?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export type SupplierCreditFilters = {
  status?: string;
  supplierId?: string;
  limit?: number;
  offset?: number;
};

export interface ExpenseHead {
  id: string;
  code: string;
  name: string;
}

/**
 * The head a payment posts under when Finance does not choose one — what
 * supplier_payment_approve falls back to on the API. /heads does not flag it,
 * so the picker preselects it by this code.
 */
export const DEFAULT_SUPPLIER_PAYMENT_HEAD_CODE = 'EXP-RAW-MATERIALS';

export function useSupplierPayments(filters: SupplierPaymentFilters) {
  const { token } = useAuth();
  return useQuery({
    queryKey: qk.financeSupplierPayments(filters),
    enabled: Boolean(token),
    staleTime: 15_000,
    placeholderData: (previous) => previous,
    queryFn: () => apiCall<{ payments: SupplierPayment[]; total: number }>(`${BASE}${toQuery(filters)}`, {}, token),
  });
}

export function useSupplierCredits(filters: SupplierCreditFilters) {
  const { token } = useAuth();
  return useQuery({
    queryKey: qk.financeSupplierCredits(filters),
    enabled: Boolean(token),
    staleTime: 15_000,
    placeholderData: (previous) => previous,
    queryFn: () => apiCall<{ credits: SupplierCredit[]; total: number }>(`${BASE}/credits${toQuery(filters)}`, {}, token),
  });
}

/** Every supplier's position — also the supplier list the filters choose from. */
export function useSupplierBalances(supplierId?: string) {
  const { token } = useAuth();
  return useQuery({
    queryKey: qk.financeSupplierBalances(supplierId),
    enabled: Boolean(token),
    staleTime: 30_000,
    queryFn: () => apiCall<SupplierBalance[]>(`${BASE}/balances${toQuery({ supplierId })}`, {}, token),
  });
}

export function useSupplierPaymentHeads(enabled = true) {
  const { token } = useAuth();
  return useQuery({
    queryKey: qk.financeSupplierPaymentHeads(),
    enabled: Boolean(token) && enabled,
    staleTime: 5 * 60_000,
    queryFn: () => apiCall<ExpenseHead[]>(`${BASE}/heads`, {}, token),
  });
}

export type SupplierPaymentDecision =
  | { kind: 'approve'; id: string; ledgerHeadId: string | null }
  | { kind: 'reject'; id: string; reason: string }
  | { kind: 'reverse'; id: string; reason: string };

/** Approve / reject / reverse one payment. Returns the payment as it now stands. */
export function useSupplierPaymentDecision() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (d: SupplierPaymentDecision) =>
      apiCall<SupplierPayment>(
        `${BASE}/${d.id}/${d.kind}`,
        {
          method: 'POST',
          body: JSON.stringify(d.kind === 'approve' ? { ledgerHeadId: d.ledgerHeadId } : { reason: d.reason }),
        },
        token,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FINANCE_QK_ROOT });
    },
  });
}

export type CreditDecision =
  | { id: string; decision: 'approve'; approvedAmount: number | null; reason: string | null }
  | { id: string; decision: 'reject'; reason: string };

export function useSupplierCreditDecision() {
  const { token } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: CreditDecision) =>
      apiCall<SupplierCredit>(`${BASE}/credits/${id}/decision`, { method: 'POST', body: JSON.stringify(body) }, token),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FINANCE_QK_ROOT });
    },
  });
}
