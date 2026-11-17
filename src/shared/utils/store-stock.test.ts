import { describe, expect, it } from 'vitest';
import {
  STORE_STOCK_STATUS_TONE,
  needsReorder,
  storeStockStatus,
} from './store-stock';

describe('storeStockStatus — one definition for Dashboard and Stock', () => {
  it('is inactive for any non-active item, regardless of quantity', () => {
    expect(storeStockStatus({ status: 'inactive', availableQty: 100, minStock: 5 })).toBe('inactive');
    expect(storeStockStatus({ status: 'inactive', availableQty: 0, minStock: 5 })).toBe('inactive');
  });

  it('is out when an active item has nothing (or less) available', () => {
    expect(storeStockStatus({ status: 'active', availableQty: 0, minStock: 5 })).toBe('out');
    expect(storeStockStatus({ status: 'active', availableQty: -1, minStock: 5 })).toBe('out');
  });

  it('is low when available is above zero but at or under the reorder level', () => {
    expect(storeStockStatus({ status: 'active', availableQty: 5, minStock: 5 })).toBe('low');
    expect(storeStockStatus({ status: 'active', availableQty: 2, minStock: 5 })).toBe('low');
  });

  it('is ok only above the reorder level', () => {
    expect(storeStockStatus({ status: 'active', availableQty: 6, minStock: 5 })).toBe('ok');
  });

  it('treats a missing status as active', () => {
    expect(storeStockStatus({ availableQty: 0, minStock: 0 })).toBe('out');
    expect(storeStockStatus({ availableQty: 10, minStock: 0 })).toBe('ok');
  });
});

describe('needsReorder — the shared "Low or out" count', () => {
  it('counts both low and out (what the Stock filter and the dashboard sum to)', () => {
    expect(needsReorder({ status: 'active', availableQty: 0, minStock: 5 })).toBe(true); // out
    expect(needsReorder({ status: 'active', availableQty: 3, minStock: 5 })).toBe(true); // low
  });

  it('does not count healthy or inactive items', () => {
    expect(needsReorder({ status: 'active', availableQty: 9, minStock: 5 })).toBe(false);
    expect(needsReorder({ status: 'inactive', availableQty: 0, minStock: 5 })).toBe(false);
  });
});

describe('status colour language (§10)', () => {
  it('maps low→amber and out→red, not both red', () => {
    expect(STORE_STOCK_STATUS_TONE.low).toBe('amber');
    expect(STORE_STOCK_STATUS_TONE.out).toBe('red');
    expect(STORE_STOCK_STATUS_TONE.ok).toBe('green');
    expect(STORE_STOCK_STATUS_TONE.inactive).toBe('muted');
  });
});
