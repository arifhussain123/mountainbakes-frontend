import { describe, expect, test } from 'vitest';
import type { PurchaseDemandItem, PurchaseItem, Quotation, QuotationItem } from '@mb/shared';
import {
  SubmissionKey,
  canSendVerified,
  decimalInput,
  defaultStockItemId,
  demandNamedItemId,
  eventLabel,
  isReplyWindowOpen,
  issuesByPath,
  parseNumber,
  quotationComparison,
  quotationPreviewTotal,
  stockItemChoices,
  versionComparison,
} from '../purchasing-model';

function demandItem(over: Partial<PurchaseDemandItem>): PurchaseDemandItem {
  return { id: 'd1', lineNo: 1, itemId: null, itemName: 'Flour', itemCode: null, requestedQty: 10, unit: 'kg', note: null, ...over };
}

function qLine(over: Partial<QuotationItem>): QuotationItem {
  return {
    id: 'q1',
    lineNo: 1,
    demandItemId: 'd1',
    substituteForDemandItemId: null,
    itemName: 'Flour',
    unit: 'kg',
    requestedQty: 10,
    availableQty: 10,
    unitRate: 100,
    lineTotal: 1000,
    availability: 'available',
    note: null,
    ...over,
  };
}

function quotation(version: number, items: QuotationItem[]): Quotation {
  return {
    id: `qv${version}`,
    demandId: 'dem',
    version,
    status: 'submitted',
    submittedVia: 'portal',
    enteredByName: null,
    subtotal: 0,
    deliveryCharge: 0,
    total: 0,
    estimatedDeliveryDate: null,
    deliveryNotes: null,
    notes: null,
    submittedAt: '2026-10-20T10:00:00Z',
    decidedByName: null,
    decidedAt: null,
    decisionReason: null,
    items,
  };
}

function catalogItem(over: Partial<PurchaseItem>): PurchaseItem {
  return { id: 'c1', itemCode: 'ING-1', name: 'Flour', unit: 'kg', category: null, isActive: true, balance: 0, ...over };
}

describe('SubmissionKey', () => {
  test('reuses the key for the same body and mints a new one when the body changes', () => {
    const k = new SubmissionKey('t');
    const a = k.keyFor('{"amount":100}');
    expect(k.keyFor('{"amount":100}')).toBe(a);
    const b = k.keyFor('{"amount":200}');
    expect(b).not.toBe(a);
    k.reset();
    expect(k.keyFor('{"amount":200}')).not.toBe(b);
  });

  test('keys satisfy the API pattern', () => {
    expect(new SubmissionKey('pay').keyFor('x')).toMatch(/^[A-Za-z0-9._:-]{8,200}$/);
  });
});

describe('canSendVerified', () => {
  const base = { verifiedOk: true, verifiedRevision: 3, savedRevision: 3, dirty: false };
  test('only a passed verify of the revision now saved, with nothing typed since', () => {
    expect(canSendVerified(base)).toBe(true);
    expect(canSendVerified({ ...base, dirty: true })).toBe(false);
    expect(canSendVerified({ ...base, savedRevision: 4 })).toBe(false);
    expect(canSendVerified({ ...base, verifiedOk: false })).toBe(false);
    expect(canSendVerified({ ...base, verifiedRevision: null })).toBe(false);
  });
});

describe('numbers', () => {
  test('a blank field is NaN, not zero', () => {
    expect(Number.isNaN(parseNumber(''))).toBe(true);
    expect(parseNumber(' 1,250.5 ')).toBe(1250.5);
  });
  test('decimalInput keeps digits and one point', () => {
    expect(decimalInput('12a.3.4')).toBe('12.34');
    expect(decimalInput('-5')).toBe('5');
  });
  test('preview total rounds each line to paisa and skips blanks', () => {
    expect(quotationPreviewTotal([{ qty: 3, rate: 0.335 }, { qty: Number.NaN, rate: 5 }], 50)).toBe(51.01);
  });
});

describe('issuesByPath', () => {
  test('first message per dotted path', () => {
    expect(
      issuesByPath([
        { path: ['items', 0, 'requestedQty'], message: 'Enter a quantity above zero' },
        { path: ['items', 0, 'requestedQty'], message: 'second' },
        { path: [], message: 'top' },
      ]),
    ).toEqual({ 'items.0.requestedQty': 'Enter a quantity above zero', '': 'top' });
  });
});

describe('isReplyWindowOpen', () => {
  const now = Date.parse('2026-10-20T12:00:00Z');
  test('open only while the end is ahead', () => {
    expect(isReplyWindowOpen('2026-10-20T13:00:00Z', now)).toBe(true);
    expect(isReplyWindowOpen('2026-10-20T11:00:00Z', now)).toBe(false);
    expect(isReplyWindowOpen(null, now)).toBe(false);
    expect(isReplyWindowOpen('garbage', now)).toBe(false);
  });
});

describe('quotation comparison', () => {
  const items = [demandItem({}), demandItem({ id: 'd2', lineNo: 2, itemName: 'Butter' })];

  test('every requested item in order, a missing line as not quoted, substitutes after naming what they replace', () => {
    const q = quotation(1, [
      qLine({}),
      qLine({ id: 's1', lineNo: 2, demandItemId: null, substituteForDemandItemId: 'd2', itemName: 'Margarine', availability: 'substitute' }),
    ]);
    const rows = quotationComparison(items, q);
    expect(rows.map((r) => r.itemName)).toEqual(['Flour', 'Butter', 'Margarine']);
    expect(rows[1]!.line).toBeNull();
    expect(rows[2]!.substituteFor).toBe('Butter');
  });

  test('versions side by side, substitutes matched across versions by name', () => {
    const v1 = quotation(1, [qLine({ unitRate: 100 }), qLine({ id: 's1', demandItemId: null, itemName: 'Margarine', availability: 'substitute' })]);
    const v2 = quotation(2, [qLine({ id: 'q2', unitRate: 110 }), qLine({ id: 's2', demandItemId: null, itemName: 'margarine ', availability: 'substitute' })]);
    const rows = versionComparison(items, [v2, v1]);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.cells.map((c) => c?.unitRate)).toEqual([100, 110]);
    expect(rows[1]!.cells).toEqual([null, null]);
    expect(rows[2]!.cells.map((c) => c?.id)).toEqual(['s1', 's2']);
  });
});

describe('receipt stock item', () => {
  const items = [demandItem({ itemId: 'c1' }), demandItem({ id: 'd2', lineNo: 2, itemName: 'Eggs', unit: 'dozen' })];
  const quotations = [
    quotation(1, [
      qLine({}),
      qLine({ id: 'q2', demandItemId: 'd2', itemName: 'Eggs', unit: 'dozen' }),
      qLine({ id: 'q3', demandItemId: null, itemName: 'Brown sugar', unit: 'kg', availability: 'substitute' }),
    ]),
  ];
  const catalog = [
    catalogItem({}),
    catalogItem({ id: 'c2', name: 'Eggs', unit: 'pcs' }),
    catalogItem({ id: 'c3', name: 'Eggs', unit: 'dozen' }),
    catalogItem({ id: 'c4', name: 'Brown Sugar', unit: 'kg' }),
  ];

  test('a line raised against a catalog item is locked to that item', () => {
    const bill = { quotationItemId: 'q1', itemName: 'Flour', unit: 'kg' };
    expect(demandNamedItemId(bill, quotations, items)).toBe('c1');
    expect(stockItemChoices(bill, quotations, items, catalog)).toEqual({ choices: [catalog[0]], locked: true });
    expect(defaultStockItemId(bill, quotations, items, catalog)).toBe('c1');
  });

  test('a free-text line offers only items in the bill unit, defaulting to a same-name match', () => {
    const bill = { quotationItemId: 'q2', itemName: 'Eggs', unit: 'dozen' };
    const { choices, locked } = stockItemChoices(bill, quotations, items, catalog);
    expect(locked).toBe(false);
    expect(choices.map((c) => c.id)).toEqual(['c3']);
    expect(defaultStockItemId(bill, quotations, items, catalog)).toBe('c3');
  });

  test('a substitute has no demand line, so only the name match applies', () => {
    expect(defaultStockItemId({ quotationItemId: 'q3', itemName: 'Brown sugar', unit: 'kg' }, quotations, items, catalog)).toBe('c4');
    expect(defaultStockItemId({ quotationItemId: 'q3', itemName: 'Jaggery', unit: 'kg' }, quotations, items, catalog)).toBeNull();
  });

  test('an inactive named item leaves nothing to choose', () => {
    const inactive = catalog.map((c) => (c.id === 'c1' ? { ...c, isActive: false } : c));
    expect(stockItemChoices({ quotationItemId: 'q1', itemName: 'Flour', unit: 'kg' }, quotations, items, inactive)).toEqual({ choices: [], locked: true });
  });
});

test('eventLabel makes server event names readable', () => {
  expect(eventLabel('quotation_approved')).toBe('Quotation approved');
  expect(eventLabel('demand.sent')).toBe('Demand sent');
});
