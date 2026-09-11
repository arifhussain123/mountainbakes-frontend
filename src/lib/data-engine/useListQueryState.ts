'use client';

/**
 * Data Engine — the one piece of client state behind every generic list.
 *
 * Holds a `ListQueryState`, hands out setters that keep the invariants a
 * pager needs (any change to search, filters, sort or page size lands on
 * page 1), and — when `syncUrl` is on — mirrors the state into the address
 * bar so refresh, back/forward and shared links all reproduce the view.
 *
 * URL sync is done with `window.history`, not `useSearchParams`: this is a
 * static-export app, and Next requires a Suspense boundary around every
 * `useSearchParams` consumer or the whole route bails out of prerendering.
 * `history.pushState` for a discrete change (a filter, a page) and
 * `replaceState` for search typing keeps the back button meaningful without
 * one history entry per keystroke.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FilterOperator, FilterValue, ListQueryState, PageSize, SortState } from '@mb/shared';
import {
  defaultListState,
  getFilter,
  parseQueryParams,
  removeFilter,
  scopeKey,
  serializeQueryParams,
  upsertFilter,
  type ListStateDefaults,
} from './listState';

export interface UseListQueryStateOptions {
  /** Read from and write to the page URL. Default false. */
  syncUrl?: boolean;
  /** Which filter keys this list owns. Required for URL sync to leave other params alone. */
  filterKeys?: readonly string[];
  /** Prefix for URL keys when two lists share one page. */
  namespace?: string;
  defaults?: ListStateDefaults;
}

export interface ListQueryStateApi {
  state: ListQueryState;
  /** Identity of everything but the page — the key a page number belongs to. */
  scopeKey: string;
  setPage: (page: number) => void;
  setPageSize: (pageSize: PageSize) => void;
  setSearch: (search: string) => void;
  setSort: (sort: SortState | null) => void;
  toggleSort: (key: string) => void;
  setFilter: (key: string, op: FilterOperator, value: string | string[] | null) => void;
  clearFilter: (key: string, op?: FilterOperator) => void;
  clearAll: () => void;
  getFilter: (key: string, op?: FilterOperator) => FilterValue | undefined;
  /** Filters that differ from the defaults — what "Clear" would remove. */
  activeFilters: FilterValue[];
  hasActiveFilters: boolean;
}

function readUrlState(opts: UseListQueryStateOptions): ListQueryState {
  if (typeof window === 'undefined') return defaultListState(opts.defaults);
  return parseQueryParams(window.location.search, opts);
}

export function useListQueryState(opts: UseListQueryStateOptions = {}): ListQueryStateApi {
  const { syncUrl = false } = opts;
  // The options object is recreated by callers each render; the parts that
  // matter are stable strings, so key the memo on those.
  const filterKeysKey = (opts.filterKeys ?? []).join(',');
  const defaultsKey = JSON.stringify(opts.defaults ?? {});
  const stableOpts = useMemo<UseListQueryStateOptions>(
    () => ({ syncUrl, filterKeys: opts.filterKeys, namespace: opts.namespace, defaults: opts.defaults }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [syncUrl, filterKeysKey, opts.namespace, defaultsKey],
  );

  const [state, setState] = useState<ListQueryState>(() =>
    syncUrl ? readUrlState(stableOpts) : defaultListState(stableOpts.defaults),
  );

  // Back / forward: re-read the URL the browser restored.
  useEffect(() => {
    if (!syncUrl || typeof window === 'undefined') return;
    const onPop = () => setState(readUrlState(stableOpts));
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [syncUrl, stableOpts]);

  // Write the URL after every change. `mode` decides push vs replace.
  const pendingMode = useRef<'push' | 'replace' | null>(null);
  useEffect(() => {
    if (!syncUrl || typeof window === 'undefined' || !pendingMode.current) return;
    const mode = pendingMode.current;
    pendingMode.current = null;
    const params = serializeQueryParams(state, window.location.search, stableOpts);
    const qs = params.toString();
    const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash}`;
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next === current) return;
    if (mode === 'push') window.history.pushState(window.history.state, '', next);
    else window.history.replaceState(window.history.state, '', next);
  }, [state, syncUrl, stableOpts]);

  const update = useCallback((mode: 'push' | 'replace', fn: (s: ListQueryState) => ListQueryState) => {
    pendingMode.current = mode;
    setState((s) => fn(s));
  }, []);

  const api = useMemo<Omit<ListQueryStateApi, 'state' | 'scopeKey' | 'activeFilters' | 'hasActiveFilters' | 'getFilter'>>(
    () => ({
      setPage: (page) => update('push', (s) => (s.page === page ? s : { ...s, page: Math.max(1, page) })),
      setPageSize: (pageSize) => update('push', (s) => (s.pageSize === pageSize ? s : { ...s, pageSize, page: 1 })),
      setSearch: (search) => update('replace', (s) => (s.search === search ? s : { ...s, search, page: 1 })),
      setSort: (sort) => update('push', (s) => ({ ...s, sort, page: 1 })),
      toggleSort: (key) =>
        update('push', (s) => {
          if (!s.sort || s.sort.key !== key) return { ...s, sort: { key, direction: 'asc' }, page: 1 };
          if (s.sort.direction === 'asc') return { ...s, sort: { key, direction: 'desc' }, page: 1 };
          return { ...s, sort: stableOpts.defaults?.sort ?? null, page: 1 };
        }),
      setFilter: (key, op, value) =>
        update('push', (s) => ({ ...s, filters: upsertFilter(s.filters, { key, op, value }), page: 1 })),
      clearFilter: (key, op) => update('push', (s) => ({ ...s, filters: removeFilter(s.filters, key, op), page: 1 })),
      clearAll: () =>
        update('push', () => ({ ...defaultListState(stableOpts.defaults), pageSize: stableOpts.defaults?.pageSize ?? 20 })),
    }),
    [update, stableOpts],
  );

  const defaults = useMemo(() => defaultListState(stableOpts.defaults), [stableOpts]);
  const activeFilters = useMemo(() => {
    const defaultIds = new Map(defaults.filters.map((f) => [`${f.key}.${f.op}`, JSON.stringify(f.value)]));
    return state.filters.filter((f) => defaultIds.get(`${f.key}.${f.op}`) !== JSON.stringify(f.value));
  }, [state.filters, defaults]);

  return {
    state,
    scopeKey: useMemo(() => scopeKey(state), [state]),
    ...api,
    getFilter: (key, op) => getFilter(state.filters, key, op),
    activeFilters,
    hasActiveFilters: activeFilters.length > 0 || state.search.trim().length > 0,
  };
}
