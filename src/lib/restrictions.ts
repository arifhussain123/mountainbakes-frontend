'use client';

// Restriction Rules (migration 136) — the popups' preflight, the approval
// requests, and the Admin Settings screen.
//
// The API decides. A preflight here only tells a popup what the server WILL say
// so it can show the notice before the user types; the write endpoint runs the
// same evaluation again and is the one that counts.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/api/client';
import { apiCall } from '@/utils/api';
import { qk } from './queryKeys';
import type {
  CreateRestrictionRequestInput,
  Restriction,
  RestrictionCheck,
  RestrictionEvent,
  RestrictionGroup,
  RestrictionMonitorRow,
  RestrictionRequest,
  RestrictionRules,
  RestrictionRulesState,
} from '@mb/shared';

/** The restriction a refused write carried, or null when the error is something else. */
export function restrictionFromError(err: unknown): Restriction | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const d = err.details as { code?: string; restriction?: Restriction | null } | undefined;
  return d?.code === 'restriction' && d.restriction ? d.restriction : null;
}

export type RestrictionCheckKind = 'demand' | 'sale' | 'cash-deposit' | 'finance-entry';

export interface RestrictionPreflight {
  /** The server's answer. Null while loading, offline, or when the check failed. */
  check: RestrictionCheck | null;
  restriction: Restriction | null;
  /** True only when the server has said yes (or has nothing to say). */
  allowed: boolean;
  /**
   * The server could not be asked — the device is offline or the request
   * failed. The popup shows "Verification Required" and does not submit: a cached
   * answer is never treated as permission.
   */
  unverified: boolean;
  isLoading: boolean;
  refetch: () => void;
}

/**
 * Ask the server what it would say to this action, for display inside the popup.
 *
 * Always fresh (`staleTime: 0`, never restored from the offline snapshot) and
 * only fetched while the popup is open. Query string values that are empty are
 * left out, so the key and the URL stay stable as a form is filled in.
 */
export function useRestrictionCheck(
  token: string,
  kind: RestrictionCheckKind,
  params: Record<string, string | number | null | undefined>,
  enabled: boolean,
): RestrictionPreflight {
  const clean: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') clean[k] = String(v);
  }
  const query = new URLSearchParams(clean).toString();

  const q = useQuery({
    queryKey: qk.restrictionCheck(kind, clean),
    queryFn: () => apiCall<RestrictionCheck>(`/api/restrictions/check/${kind}${query ? `?${query}` : ''}`, {}, token),
    enabled: !!token && enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    // A popup that has been open a while must not act on an old answer.
    refetchOnMount: 'always',
  });

  const check = q.isError ? null : (q.data ?? null);
  return {
    check,
    restriction: check?.restriction ?? null,
    allowed: check?.allowed === true,
    unverified: enabled && q.isError,
    isLoading: enabled && q.isLoading,
    refetch: () => void q.refetch(),
  };
}

/** Ask Admin to lift a restriction once. */
export function useRequestRestrictionApproval(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRestrictionRequestInput) =>
      apiCall<{ request: RestrictionRequest }>(
        '/api/restrictions/requests',
        { method: 'POST', body: JSON.stringify(body) },
        token,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['restrictionCheck'] });
      void qc.invalidateQueries({ queryKey: ['restrictions'] });
    },
  });
}

// ─── Admin Settings ──────────────────────────────────────────────────────────

export function useRestrictionRules(token: string) {
  return useQuery({
    queryKey: qk.restrictionRules(),
    queryFn: () => apiCall<RestrictionRulesState & { pendingRequests: number }>('/api/restrictions/rules', {}, token),
    enabled: !!token,
  });
}

/** One group and ITS config — a `demand` save cannot carry a `cash` body. */
export type SaveRestrictionGroupInput = {
  [G in RestrictionGroup]: { group: G; config: RestrictionRules[G] };
}[RestrictionGroup];

export function useSaveRestrictionGroup(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ group, config }: SaveRestrictionGroupInput) =>
      apiCall<RestrictionRulesState>(
        `/api/restrictions/rules/${group}`,
        { method: 'PUT', body: JSON.stringify(config) },
        token,
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['restrictions'] }),
  });
}

export function useRestrictionRequests(token: string, filters: { type?: string | null }) {
  const key = { type: filters.type ?? null };
  return useQuery({
    queryKey: qk.restrictionRequests(key),
    queryFn: () => {
      const params = new URLSearchParams();
      if (key.type) params.set('type', key.type);
      return apiCall<{ requests: RestrictionRequest[] }>(`/api/restrictions/requests?${params.toString()}`, {}, token);
    },
    enabled: !!token,
    staleTime: 15_000,
  });
}

export function useDecideRestrictionRequest(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, decision, reason }: { id: string; decision: 'approved' | 'rejected'; reason?: string }) =>
      apiCall<{ request: RestrictionRequest }>(
        `/api/restrictions/requests/${id}/decide`,
        { method: 'POST', body: JSON.stringify({ decision, reason }) },
        token,
      ),
    // Settled, not just success: a 409 means someone else decided it, and the
    // list on screen is stale either way.
    onSettled: () => qc.invalidateQueries({ queryKey: ['restrictions'] }),
  });
}

export function useRestrictionMonitor(token: string, enabled: boolean) {
  return useQuery({
    queryKey: qk.restrictionMonitor(),
    queryFn: () => apiCall<{ branches: RestrictionMonitorRow[] }>('/api/restrictions/monitor', {}, token),
    enabled: !!token && enabled,
    staleTime: 15_000,
  });
}

export function useRestrictionEvents(token: string, ruleCode: string | null, enabled: boolean) {
  return useQuery({
    queryKey: qk.restrictionEvents(ruleCode),
    queryFn: () =>
      apiCall<{ events: RestrictionEvent[] }>(
        `/api/restrictions/events${ruleCode ? `?ruleCode=${encodeURIComponent(ruleCode)}` : ''}`,
        {},
        token,
      ),
    enabled: !!token && enabled,
    staleTime: 15_000,
  });
}
