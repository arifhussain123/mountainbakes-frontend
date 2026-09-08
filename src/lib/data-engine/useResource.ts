'use client';

/**
 * Data Engine — TanStack Query hooks over `/api/data/:resource`.
 *
 * Every read goes through `useQuery` with a key from `qk`, so the generic
 * list gets the same caching, de-duplication and offline snapshot as every
 * other server read in the app. Race protection is structural: a different
 * filter is a different key, so a late response for "Branch A" can only ever
 * update the "Branch A" entry — it cannot overwrite "Branch B". The fetch is
 * also handed TanStack's AbortSignal, so an answer nobody is waiting for is
 * cancelled at the network rather than parsed and thrown away.
 */
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { apiCall } from '@/utils/api';
import { useAuth } from '@/hooks/useAuth';
import { qk } from '@/lib/queryKeys';
import type {
  AggregateResponse,
  FilterValue,
  ListQueryState,
  PaginatedResponse,
  ResourceMeta,
} from '@mb/shared';
import { toApiSearchParams } from './listState';

/** Matches `LIVE_STALE_TIME` in lib/queries.ts — intraday figures. */
export const LIVE_STALE_TIME = 15_000;
/** Reference data — products, branches, users. */
export const STATIC_STALE_TIME = 5 * 60_000;

export type CacheProfile = 'live' | 'static';

export interface UseResourceListOptions {
  /** Filters applied on top of the state, invisible to the filter UI (a page's fixed scope). */
  fixedFilters?: FilterValue[];
  cache?: CacheProfile;
  enabled?: boolean;
}

export function useResourceList<T = Record<string, unknown>>(
  resource: string,
  state: ListQueryState,
  opts: UseResourceListOptions = {},
) {
  const { token } = useAuth();
  const params = toApiSearchParams(state, opts.fixedFilters);
  params.sort();
  const query = params.toString();

  return useQuery({
    queryKey: qk.data(resource, query),
    queryFn: ({ signal }) => apiCall<PaginatedResponse<T>>(`/api/data/${resource}?${query}`, { signal }, token),
    enabled: Boolean(token) && (opts.enabled ?? true),
    // The previous page stays on screen, greyed, while the next one loads —
    // paging never flashes an empty table.
    placeholderData: keepPreviousData,
    staleTime: opts.cache === 'static' ? STATIC_STALE_TIME : LIVE_STALE_TIME,
  });
}

export interface AggregateSpec {
  /** e.g. `['count', 'sum:grandTotal']` */
  metrics: string[];
  groupBy?: string[];
}

/**
 * Totals over the SAME filtered set as the list — page and sort dropped, every
 * filter kept — so a card above a table always describes the rows in it.
 */
export function useResourceAggregate(
  resource: string,
  state: ListQueryState,
  spec: AggregateSpec,
  opts: UseResourceListOptions = {},
) {
  const { token } = useAuth();
  const params = toApiSearchParams({ ...state, page: 1, sort: null }, opts.fixedFilters);
  params.delete('page');
  params.delete('pageSize');
  params.set('metrics', spec.metrics.join(','));
  if (spec.groupBy && spec.groupBy.length > 0) params.set('groupBy', spec.groupBy.join(','));
  params.sort();
  const query = params.toString();

  return useQuery({
    queryKey: qk.dataAggregate(resource, query),
    queryFn: ({ signal }) => apiCall<AggregateResponse>(`/api/data/${resource}/aggregate?${query}`, { signal }, token),
    enabled: Boolean(token) && (opts.enabled ?? true),
    placeholderData: keepPreviousData,
    staleTime: opts.cache === 'static' ? STATIC_STALE_TIME : LIVE_STALE_TIME,
  });
}

/** What the server allows for a resource — filterable fields, operators, sortable keys. */
export function useResourceMeta(resource: string, enabled = true) {
  const { token } = useAuth();
  return useQuery({
    queryKey: qk.dataMeta(resource),
    queryFn: ({ signal }) => apiCall<ResourceMeta>(`/api/data/${resource}/meta`, { signal }, token),
    enabled: Boolean(token) && enabled,
    staleTime: Infinity,
  });
}

/** Refetch every cached view of a resource after a write. */
export function useInvalidateResource() {
  const qc = useQueryClient();
  return useCallback(
    (resource: string) => qc.invalidateQueries({ queryKey: qk.dataResource(resource) }),
    [qc],
  );
}

export type ExportScope = 'page' | 'all';
export type ExportFormat = 'excel' | 'csv';

/**
 * Download the filtered set as a file. The query string is the list's own,
 * so what lands in the sheet is exactly what the table was showing (or would
 * show across every page) — never a different dataset.
 */
export async function exportResource(
  resource: string,
  state: ListQueryState,
  token: string,
  opts: { scope: ExportScope; format: ExportFormat; fixedFilters?: FilterValue[]; fileName?: string },
): Promise<void> {
  const params = toApiSearchParams(state, opts.fixedFilters);
  params.set('scope', opts.scope);
  params.set('format', opts.format);
  const blob = await apiCall<Blob>(`/api/data/${resource}/export?${params.toString()}`, {}, token);
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `${opts.fileName ?? `mountain-bakes-${resource}`}-${stamp}.${opts.format === 'csv' ? 'csv' : 'xlsx'}`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
