'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { FINANCE_QK_ROOT, qk } from '@/lib/queryKeys';
import type {
  BranchShareBalance,
  FinanceAuditLog,
  FinanceDashboard,
  FinanceDayClosing,
  FinanceEmployee,
  FinanceIncomeApproval,
  FinancePartner,
  FinanceReport,
  FinanceSettings,
  FinanceTicket,
  FinanceTicketReferenceLookup,
  FinanceTransaction,
  LedgerHead,
  LedgerPage,
  PartnerExpense,
  PartnerShareSummary,
  SalaryPayment,
  SalaryRevision,
} from '@mb/shared';

/**
 * Finance Ledger data layer.
 *
 * Its own module rather than more lines in lib/queries.ts, which is already ~1000
 * lines of operations hooks: the finance module is a separate product surface
 * with its own roles, and mixing its hooks in would mean every branch screen
 * importing a file that also knows about payroll.
 *
 * Every key comes from `qk` (queryKeys.ts) — never hand-rolled. A key that
 * differs from the canonical one by even a shape detail creates a second cache
 * entry that invalidations silently miss, and in this module that shows up as an
 * approval that appears not to have happened.
 *
 * Mutations invalidate the WHOLE finance subtree (`FINANCE_QK_ROOT`) rather than
 * naming the affected keys. That is deliberate: approving one voucher moves the
 * dashboard, the ledger, the day's closing, the pending counts and the audit
 * trail at once, and enumerating them is a list that goes stale the moment a
 * screen is added. The subtree is a handful of cheap queries.
 */

// ---------------------------------------------------------------------------
// Query-string helper
// ---------------------------------------------------------------------------

/** Drop empty values so `?branchId=&status=` never reaches the API as a filter. */
export function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

/** Shared by every hook below: no token means no request, not a 401. */
function useToken() {
  const { token } = useAuth();
  return token;
}

// ---------------------------------------------------------------------------
// Dashboard, ledger, heads
// ---------------------------------------------------------------------------

export function useFinanceDashboard(businessDate?: string) {
  const token = useToken();
  return useQuery({
    queryKey: qk.financeDashboard(businessDate),
    enabled: Boolean(token),
    // 15s, matching the app's LIVE_STALE_TIME convention for intraday figures:
    // the dashboard is what a finance user leaves open while approving, and a
    // 60s default would show pending counts that are already dealt with.
    staleTime: 15_000,
    queryFn: () =>
      apiCall<FinanceDashboard>(`/api/finance/dashboard${toQuery({ date: businessDate })}`, {}, token),
  });
}

/**
 * A `type`, not an `interface`, and that is load-bearing: TypeScript gives an
 * object type alias an implicit index signature but never gives one to an
 * interface, so only this form is assignable to the `Record<string, unknown>`
 * that `qk.financeLedger` takes. Declared as an interface it fails to compile at
 * the call site below. Same for IncomeFilters.
 */
export type LedgerFilters = {
  from?: string;
  to?: string;
  branchId?: string;
  ledgerHeadId?: string;
  type?: string;
  account?: string;
  status?: string;
  sourceType?: string;
  voucherNo?: string;
  search?: string;
  minAmount?: number;
  maxAmount?: number;
  limit?: number;
  offset?: number;
};

export function useLedger(filters: LedgerFilters) {
  const token = useToken();
  return useQuery({
    queryKey: qk.financeLedger(filters as Record<string, unknown>),
    enabled: Boolean(token),
    staleTime: 15_000,
    queryFn: () => apiCall<LedgerPage>(`/api/finance/ledger${toQuery(filters)}`, {}, token),
  });
}

export function useLedgerHeads(includeInactive = false) {
  const token = useToken();
  return useQuery({
    queryKey: qk.financeHeads(includeInactive),
    enabled: Boolean(token),
    // The chart of accounts changes a few times a year. Five minutes keeps every
    // form's head dropdown off the network without going stale in practice.
    staleTime: 5 * 60_000,
    queryFn: async () =>
      (await apiCall<{ heads: LedgerHead[] }>(
        `/api/finance/heads${toQuery({ includeInactive: includeInactive || undefined })}`,
        {},
        token,
      )).heads,
  });
}

// ---------------------------------------------------------------------------
// Branch income
// ---------------------------------------------------------------------------

export type IncomeFilters = {
  status?: string;
  branchId?: string;
  from?: string;
  to?: string;
};

export function useIncomeApprovals(filters: IncomeFilters) {
  const token = useToken();
  return useQuery({
    queryKey: qk.financeIncome(filters as Record<string, unknown>),
    enabled: Boolean(token),
    staleTime: 15_000,
    queryFn: async () =>
      (await apiCall<{ approvals: FinanceIncomeApproval[] }>(
        `/api/finance/income${toQuery(filters)}`,
        {},
        token,
      )).approvals,
  });
}

// ---------------------------------------------------------------------------
// Manual entries, salaries, partner expenses
// ---------------------------------------------------------------------------

export function useFinanceEntries(filters: Record<string, unknown>) {
  const token = useToken();
  return useQuery({
    queryKey: qk.financeEntries(filters),
    enabled: Boolean(token),
    queryFn: async () =>
      (await apiCall<{ entries: FinanceTransaction[] }>(
        `/api/finance/income/entries${toQuery(filters)}`,
        {},
        token,
      )).entries,
  });
}

export function useSalaryPayments(filters: Record<string, unknown>) {
  const token = useToken();
  return useQuery({
    queryKey: qk.financeSalaries(filters),
    enabled: Boolean(token),
    queryFn: async () =>
      (await apiCall<{ salaries: SalaryPayment[] }>(
        `/api/finance/payroll/salaries${toQuery(filters)}`,
        {},
        token,
      )).salaries,
  });
}

export function useFinanceEmployees(includeInactive = false) {
  const token = useToken();
  return useQuery({
    queryKey: qk.financeEmployees(includeInactive),
    enabled: Boolean(token),
    staleTime: 5 * 60_000,
    queryFn: async () =>
      (await apiCall<{ employees: FinanceEmployee[] }>(
        `/api/finance/payroll/employees${toQuery({ includeInactive: includeInactive || undefined })}`,
        {},
        token,
      )).employees,
  });
}

/** Only fetches once a dialog actually opens with an employee — no point warming this on every payroll page load. */
export function useSalaryRevisions(employeeId: string | null) {
  const token = useToken();
  return useQuery({
    queryKey: qk.financeSalaryRevisions(employeeId ?? ''),
    enabled: Boolean(token) && Boolean(employeeId),
    queryFn: async () =>
      (await apiCall<{ revisions: SalaryRevision[] }>(
        `/api/finance/payroll/employees/${employeeId}/salary-revisions`,
        {},
        token,
      )).revisions,
  });
}

export function usePartnerExpenses(filters: Record<string, unknown>) {
  const token = useToken();
  return useQuery({
    queryKey: qk.financePartnerExpenses(filters),
    enabled: Boolean(token),
    queryFn: async () =>
      (await apiCall<{ expenses: PartnerExpense[] }>(
        `/api/finance/partner-expenses${toQuery(filters)}`,
        {},
        token,
      )).expenses,
  });
}

export function useFinancePartners(includeInactive = false) {
  const token = useToken();
  return useQuery({
    queryKey: qk.financePartners(includeInactive),
    enabled: Boolean(token),
    staleTime: 5 * 60_000,
    queryFn: async () =>
      (await apiCall<{ partners: FinancePartner[] }>(
        `/api/finance/partner-expenses/partners${toQuery({ includeInactive: includeInactive || undefined })}`,
        {},
        token,
      )).partners,
  });
}

export function usePartnerShareSummary(from?: string, to?: string) {
  const token = useToken();
  return useQuery({
    queryKey: qk.financePartnerShareSummary(from, to),
    enabled: Boolean(token),
    queryFn: async () =>
      (await apiCall<{ summary: PartnerShareSummary }>(
        `/api/finance/partner-expenses/share-summary${toQuery({ from, to })}`,
        {},
        token,
      )).summary,
  });
}

/**
 * What each branch is still owed — recorded share minus what has been paid out,
 * plus the split the branch is currently on.
 *
 * Read by the payout form so the amount is not keyed from memory. Since each
 * branch may sit on its own percentage, "what do we owe Gilgit" stopped being a
 * number anyone can hold in their head.
 */
export function useBranchShareBalances(branchId?: string) {
  const token = useToken();
  return useQuery({
    queryKey: qk.financeBranchShareBalances(branchId),
    enabled: Boolean(token),
    queryFn: async () =>
      (await apiCall<{ balances: BranchShareBalance[] }>(
        `/api/finance/branch-share/balances${toQuery({ branchId })}`,
        {},
        token,
      )).balances,
  });
}

// ---------------------------------------------------------------------------
// Closing, settings, audit
// ---------------------------------------------------------------------------

export function useDayClosing(businessDate?: string) {
  const token = useToken();
  return useQuery({
    queryKey: qk.financeClosing(businessDate),
    enabled: Boolean(token),
    staleTime: 15_000,
    queryFn: async () =>
      (await apiCall<{ closing: FinanceDayClosing }>(
        `/api/finance/closing${toQuery({ date: businessDate })}`,
        {},
        token,
      )).closing,
  });
}

export function useClosingHistory(days = 30) {
  const token = useToken();
  return useQuery({
    queryKey: qk.financeClosingHistory(days),
    enabled: Boolean(token),
    queryFn: async () =>
      (await apiCall<{ closings: FinanceDayClosing[] }>(
        `/api/finance/closing/history?days=${days}`,
        {},
        token,
      )).closings,
  });
}

export function useFinanceSettings() {
  const token = useToken();
  return useQuery({
    queryKey: qk.financeSettings(),
    enabled: Boolean(token),
    staleTime: 5 * 60_000,
    queryFn: async () =>
      (await apiCall<{ settings: FinanceSettings }>('/api/finance/settings', {}, token)).settings,
  });
}

export function useFinanceAudit(filters: Record<string, unknown>) {
  const token = useToken();
  return useQuery({
    queryKey: qk.financeAudit(filters),
    enabled: Boolean(token),
    queryFn: async () =>
      (await apiCall<{ logs: FinanceAuditLog[]; total: number }>(
        `/api/finance/audit${toQuery(filters)}`,
        {},
        token,
      )),
  });
}

export function useFinanceReport(query: Record<string, unknown>, enabled = true) {
  const token = useToken();
  return useQuery({
    queryKey: qk.financeReport(query),
    enabled: Boolean(token) && enabled && Boolean(query['type']),
    // A report is a point-in-time document. Re-running it behind the user's back
    // while they read it — or worse, between reading and exporting — would let
    // the screen and the PDF disagree.
    staleTime: Infinity,
    queryFn: async () =>
      (await apiCall<{ report: FinanceReport }>(`/api/finance/reports${toQuery(query)}`, {}, token)).report,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * One mutation hook for the whole module.
 *
 * Finance actions are overwhelmingly "POST/PUT to a path, then refresh
 * everything" — approve, reject, submit, create, close the day. Twenty
 * near-identical hooks would be twenty places to forget the invalidation; this
 * is one, and every call site gets the same guarantee.
 */
export function useFinanceMutation<TResult = unknown, TBody = unknown>() {
  const token = useToken();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ path, method = 'POST', body }: { path: string; method?: string; body?: TBody }) =>
      apiCall<TResult>(
        path,
        { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) },
        token,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: FINANCE_QK_ROOT });
    },
  });
}

// ---------------------------------------------------------------------------
// Help Desk
// ---------------------------------------------------------------------------

/**
 * The query queue.
 *
 * What comes back is decided by the API from the JWT role, not by anything sent
 * from here: a Finance Admin or Auditor gets the whole queue, everyone else gets
 * only the queries they raised. The filters below narrow that set; they cannot
 * widen it.
 */
export function useFinanceTickets(filters: Record<string, unknown> = {}) {
  const token = useToken();
  return useQuery({
    queryKey: qk.financeTickets(filters),
    enabled: Boolean(token),
    queryFn: async () =>
      (await apiCall<{ tickets: FinanceTicket[] }>(
        `/api/finance/tickets${toQuery(filters)}`,
        {},
        token,
      )).tickets,
  });
}

/**
 * Resolve a reference number to the finance record it names.
 *
 * A plain function rather than a hook: the lookup fires when someone presses
 * Find, and a `useQuery` with `enabled` would either fire on every keystroke or
 * need a second piece of state to hold "have they pressed it yet". The result is
 * short-lived — it is shown once and then embedded in the ticket as a snapshot.
 */
export async function lookupFinanceReference(
  referenceNo: string,
  token: string | null | undefined,
): Promise<FinanceTicketReferenceLookup> {
  const { reference } = await apiCall<{ reference: FinanceTicketReferenceLookup }>(
    `/api/finance/tickets/lookup?ref=${encodeURIComponent(referenceNo.trim())}`,
    {},
    token ?? undefined,
  );
  return reference;
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Download a report as PDF, Excel or CSV.
 *
 * A manual fetch rather than a plain `<a href>`: the export endpoint needs the
 * Bearer token, and a link element cannot carry one. `apiCall` already returns a
 * Blob for these content types (see the download branch in lib/api/client.ts),
 * so this only has to turn it into a click.
 *
 * The object URL is revoked on the next tick rather than immediately — Safari
 * aborts a download whose blob URL is revoked in the same frame as the click.
 */
export async function downloadFinanceReport(
  query: Record<string, unknown>,
  format: 'pdf' | 'excel' | 'csv',
  token: string,
): Promise<void> {
  const blob = await apiCall<Blob>(
    `/api/finance/reports/export${toQuery({ ...query, format })}`,
    {},
    token,
  );

  const extension = format === 'excel' ? 'xlsx' : format;
  const filename = `mountain-bakes-${String(query['type'] ?? 'report').replace(/_/g, '-')}.${extension}`;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
