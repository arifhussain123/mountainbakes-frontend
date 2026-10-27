/**
 * Data Engine — list state and its two serialisations.
 *
 * One `ListQueryState` describes everything a list view is showing: page,
 * page size, search term, filters and sort. It is written to the page URL
 * (`serializeQueryParams` / `parseQueryParams`) so a refresh, the back button
 * or a shared link land on the same view, and sent to the API
 * (`toApiSearchParams`) in the SAME shape — the server's `parseListQuery`
 * reads exactly what the browser's address bar shows.
 *
 * Wire format, both places:
 *
 *   page=2  pageSize=50  search=cake  sort=createdAt:desc
 *   status=completed                     → eq
 *   createdAt.gte=2026-09-01             → operator after a dot
 *   status.in=pending&status.in=ready    → repeated param for list operators
 */
import {
  DEFAULT_PAGE_SIZE,
  FILTER_OPERATORS,
  PAGE_SIZES,
  type FilterOperator,
  type FilterValue,
  type ListQueryState,
  type PageSize,
  type SortState,
} from '@mb/shared';

export const RESERVED_PARAMS = new Set(['page', 'pageSize', 'search', 'sort']);

const LIST_OPERATORS: ReadonlySet<FilterOperator> = new Set(['in', 'nin', 'between']);
const UNARY_OPERATORS: ReadonlySet<FilterOperator> = new Set(['null', 'notnull']);

export interface ListStateDefaults {
  pageSize?: PageSize;
  sort?: SortState | null;
  filters?: FilterValue[];
  search?: string;
}

export function defaultListState(defaults: ListStateDefaults = {}): ListQueryState {
  return {
    page: 1,
    pageSize: defaults.pageSize ?? DEFAULT_PAGE_SIZE,
    search: defaults.search ?? '',
    filters: defaults.filters ? [...defaults.filters] : [],
    sort: defaults.sort ?? null,
  };
}

/** Stable identity of a filter: one value per (field, operator). */
export function filterId(f: Pick<FilterValue, 'key' | 'op'>): string {
  return `${f.key}.${f.op}`;
}

function isPageSize(n: number): n is PageSize {
  return (PAGE_SIZES as readonly number[]).includes(n);
}

function isOperator(s: string): s is FilterOperator {
  return (FILTER_OPERATORS as readonly string[]).includes(s);
}

export interface ParseOptions {
  /**
   * Which filter keys belong to this list. Anything else in the URL is left
   * alone — another component's `?new=1`, a tracking parameter — rather than
   * sent to the API as a filter it would reject.
   */
  filterKeys?: readonly string[];
  /** Prefix for every key, so two lists on one page can share a URL. */
  namespace?: string;
  defaults?: ListStateDefaults;
}

function ownKey(raw: string, ns: string): string | null {
  if (!ns) return raw;
  return raw.startsWith(ns) ? raw.slice(ns.length) : null;
}

/** URL → state. Malformed values fall back to the default, never throw. */
export function parseQueryParams(input: string | URLSearchParams, opts: ParseOptions = {}): ListQueryState {
  const params = typeof input === 'string' ? new URLSearchParams(input) : input;
  const ns = opts.namespace ?? '';
  const state = defaultListState(opts.defaults);
  const known = opts.filterKeys ? new Set(opts.filterKeys) : null;

  const page = Number(params.get(`${ns}page`));
  if (Number.isInteger(page) && page >= 1) state.page = page;

  const pageSize = Number(params.get(`${ns}pageSize`));
  if (isPageSize(pageSize)) state.pageSize = pageSize;

  const search = params.get(`${ns}search`);
  if (search !== null) state.search = search;

  const sort = params.get(`${ns}sort`);
  if (sort !== null) {
    const m = /^([A-Za-z][A-Za-z0-9]*):(asc|desc)$/.exec(sort);
    state.sort = m ? { key: m[1]!, direction: m[2] as SortState['direction'] } : null;
  }

  // Filters: if the URL carries ANY filter for this list, it replaces the
  // defaults wholesale — a person who cleared the default status filter and
  // shared the link expects the recipient to see it cleared too.
  const filters = new Map<string, FilterValue>();
  let sawFilter = false;
  for (const rawKey of new Set(params.keys())) {
    const scoped = ownKey(rawKey, ns);
    if (scoped === null || RESERVED_PARAMS.has(scoped)) continue;
    const dot = scoped.indexOf('.');
    const key = dot === -1 ? scoped : scoped.slice(0, dot);
    const opName = dot === -1 ? 'eq' : scoped.slice(dot + 1);
    if (known && !known.has(key)) continue;
    if (!known && !/^[A-Za-z][A-Za-z0-9]*$/.test(key)) continue;
    if (!isOperator(opName)) continue;
    sawFilter = true;
    const values = params.getAll(rawKey).filter((v) => v !== '');
    if (UNARY_OPERATORS.has(opName)) {
      filters.set(filterId({ key, op: opName }), { key, op: opName, value: null });
    } else if (LIST_OPERATORS.has(opName)) {
      if (values.length > 0) filters.set(filterId({ key, op: opName }), { key, op: opName, value: values });
    } else if (values.length > 0) {
      filters.set(filterId({ key, op: opName }), { key, op: opName, value: values[0]! });
    }
  }
  if (sawFilter) state.filters = [...filters.values()];

  return state;
}

function appendFilter(params: URLSearchParams, prefix: string, f: FilterValue) {
  const name = f.op === 'eq' ? `${prefix}${f.key}` : `${prefix}${f.key}.${f.op}`;
  if (f.value === null) {
    params.append(name, '1');
  } else if (Array.isArray(f.value)) {
    for (const v of f.value) params.append(name, v);
  } else {
    params.append(name, f.value);
  }
}

/**
 * State → URL. `current` is the page's existing query string; only this
 * list's own keys are rewritten, everything else survives. Defaults are
 * omitted so an untouched list leaves a clean address bar.
 */
export function serializeQueryParams(
  state: ListQueryState,
  current: string | URLSearchParams = '',
  opts: ParseOptions = {},
): URLSearchParams {
  const params = new URLSearchParams(typeof current === 'string' ? current : current.toString());
  const ns = opts.namespace ?? '';
  const defaults = defaultListState(opts.defaults);
  const known = opts.filterKeys ? new Set(opts.filterKeys) : null;

  // Drop everything this list owns before writing it back.
  for (const rawKey of [...new Set(params.keys())]) {
    const scoped = ownKey(rawKey, ns);
    if (scoped === null) continue;
    if (RESERVED_PARAMS.has(scoped)) {
      params.delete(rawKey);
      continue;
    }
    const key = scoped.split('.')[0]!;
    if (known ? known.has(key) : /^[A-Za-z][A-Za-z0-9]*$/.test(key)) params.delete(rawKey);
  }

  if (state.page !== 1) params.set(`${ns}page`, String(state.page));
  if (state.pageSize !== defaults.pageSize) params.set(`${ns}pageSize`, String(state.pageSize));
  if (state.search) params.set(`${ns}search`, state.search);
  if (state.sort && !sameSort(state.sort, defaults.sort)) {
    params.set(`${ns}sort`, `${state.sort.key}:${state.sort.direction}`);
  }
  if (!sameFilters(state.filters, defaults.filters)) {
    // An explicitly emptied filter set must be distinguishable from "never
    // touched", or the defaults would come back on reload.
    if (state.filters.length === 0 && defaults.filters.length > 0) params.set(`${ns}page`, String(state.page));
    for (const f of state.filters) appendFilter(params, ns, f);
  }
  return params;
}

/** State → the API query string. Always complete — the server has no defaults to fall back on except its own. */
export function toApiSearchParams(state: ListQueryState, extra: FilterValue[] = []): URLSearchParams {
  const params = new URLSearchParams();
  params.set('page', String(state.page));
  params.set('pageSize', String(state.pageSize));
  if (state.search.trim()) params.set('search', state.search.trim());
  if (state.sort) params.set('sort', `${state.sort.key}:${state.sort.direction}`);
  for (const f of [...extra, ...state.filters]) appendFilter(params, '', f);
  return params;
}

export function sameSort(a: SortState | null, b: SortState | null | undefined): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.key === b.key && a.direction === b.direction;
}

export function sameFilters(a: FilterValue[], b: FilterValue[]): boolean {
  if (a.length !== b.length) return false;
  const norm = (list: FilterValue[]) =>
    [...list]
      .map((f) => `${filterId(f)}=${Array.isArray(f.value) ? [...f.value].sort().join('') : f.value ?? ''}`)
      .sort()
      .join('');
  return norm(a) === norm(b);
}

/** A stable string for the whole filter identity (everything but the page). */
export function scopeKey(state: ListQueryState, extra: FilterValue[] = []): string {
  const p = toApiSearchParams({ ...state, page: 1 }, extra);
  p.sort();
  return p.toString();
}

// ---------------------------------------------------------------------------
// Small immutable helpers for the setters
// ---------------------------------------------------------------------------

export function upsertFilter(filters: FilterValue[], next: FilterValue): FilterValue[] {
  const id = filterId(next);
  const empty =
    next.value === undefined ||
    (next.value === '' && !UNARY_OPERATORS.has(next.op)) ||
    (Array.isArray(next.value) && next.value.length === 0);
  const rest = filters.filter((f) => filterId(f) !== id);
  return empty ? rest : [...rest, next];
}

export function removeFilter(filters: FilterValue[], key: string, op?: FilterOperator): FilterValue[] {
  return filters.filter((f) => !(f.key === key && (op === undefined || f.op === op)));
}

export function getFilter(filters: FilterValue[], key: string, op: FilterOperator = 'eq'): FilterValue | undefined {
  return filters.find((f) => f.key === key && f.op === op);
}
