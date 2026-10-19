import { describe, expect, test } from 'vitest';
import type { FilterValue } from '@mb/shared';
import { defaultListState, parseQueryParams, serializeQueryParams, upsertFilter } from '../listState';

/**
 * The list state's filter edits and its URL round trip — above all, a filter
 * that defaults to a value (Finance → Cash Transfers: status = pending) and is
 * then cleared to "All" stays cleared, in the state and after a reload.
 */

const PENDING: FilterValue = { key: 'status', op: 'eq', value: 'pending' };
const OPTS = { filterKeys: ['status', 'branchId', 'businessDate'], defaults: { filters: [PENDING] } };

/** State → URL → state, as a reload does it. */
function reload(state: ReturnType<typeof defaultListState>, opts: Parameters<typeof parseQueryParams>[1] = OPTS) {
  const qs = serializeQueryParams(state, '', opts).toString();
  return { qs, state: parseQueryParams(qs, opts) };
}

describe('upsertFilter', () => {
  test('an empty value removes the filter', () => {
    for (const value of ['', null, [], undefined] as const) {
      expect(upsertFilter([PENDING], { key: 'status', op: 'eq', value: value as never })).toEqual([]);
    }
  });

  test('null is "no filter" on an ordinary operator, never a stored null', () => {
    expect(upsertFilter([], { key: 'status', op: 'eq', value: null })).toEqual([]);
    expect(upsertFilter([], { key: 'note', op: 'ilike', value: null })).toEqual([]);
    expect(upsertFilter([], { key: 'businessDate', op: 'gte', value: null })).toEqual([]);
  });

  test('null is the value of a unary operator', () => {
    expect(upsertFilter([], { key: 'voucherNo', op: 'null', value: null })).toEqual([
      { key: 'voucherNo', op: 'null', value: null },
    ]);
  });

  test('a new value replaces the old one for the same field and operator', () => {
    expect(upsertFilter([PENDING], { key: 'status', op: 'eq', value: 'approved' })).toEqual([
      { key: 'status', op: 'eq', value: 'approved' },
    ]);
  });
});

describe('a defaulted filter cleared to "All"', () => {
  const cleared = () => {
    const s = defaultListState(OPTS.defaults);
    return { ...s, filters: upsertFilter(s.filters, { key: 'status', op: 'eq', value: '' }) };
  };

  test('is written as an empty parameter, not `status=1` and not nothing', () => {
    expect(reload(cleared()).qs).toBe('status=');
  });

  test('stays cleared after a reload instead of snapping back to pending', () => {
    expect(reload(cleared()).state.filters).toEqual([]);
  });

  test('stays cleared on a later page — the page number is not the marker', () => {
    const { qs, state } = reload({ ...cleared(), page: 3 });
    expect(new URLSearchParams(qs).get('page')).toBe('3');
    expect(state.page).toBe(3);
    expect(state.filters).toEqual([]);
  });

  test('stays cleared beside another filter', () => {
    const s = { ...cleared(), filters: [{ key: 'branchId', op: 'eq', value: 'b1' } as FilterValue] };
    expect(reload(s).state.filters).toEqual([{ key: 'branchId', op: 'eq', value: 'b1' }]);
  });

  test('a cleared date default is written with its operator', () => {
    const from: FilterValue = { key: 'businessDate', op: 'gte', value: '2026-10-01' };
    const opts = { ...OPTS, defaults: { filters: [from] } };
    const { qs, state } = reload({ ...defaultListState(opts.defaults), filters: [] }, opts);
    expect(qs).toBe('businessDate.gte=');
    expect(state.filters).toEqual([]);
  });

  test('a namespaced list writes its own key', () => {
    const opts = { ...OPTS, namespace: 'ct_' };
    const { qs, state } = reload(cleared(), opts);
    expect(qs).toBe('ct_status=');
    expect(state.filters).toEqual([]);
  });
});

describe('the untouched default view', () => {
  test('leaves a clean address bar and reloads to the default', () => {
    const { qs, state } = reload(defaultListState(OPTS.defaults));
    expect(qs).toBe('');
    expect(state.filters).toEqual([PENDING]);
  });

  test('on a later page keeps its default — `page=3` alone does not clear it', () => {
    const { qs, state } = reload({ ...defaultListState(OPTS.defaults), page: 3 });
    expect(qs).toBe('page=3');
    expect(state.filters).toEqual([PENDING]);
  });

  test('another chosen status round-trips as itself', () => {
    const s = { ...defaultListState(OPTS.defaults), filters: [{ key: 'status', op: 'eq', value: 'approved' } as FilterValue] };
    const { qs, state } = reload(s);
    expect(qs).toBe('status=approved');
    expect(state.filters).toEqual([{ key: 'status', op: 'eq', value: 'approved' }]);
  });

  test('other parameters on the page survive the rewrite', () => {
    const s = defaultListState(OPTS.defaults);
    const qs = serializeQueryParams({ ...s, filters: [] }, 'new=1&status=pending', OPTS).toString();
    expect(qs).toBe('new=1&status=');
  });
});
