import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { SupplierPortalView } from '@mb/shared';
import { forgetLinkToken, takeLinkToken } from '@/lib/supplierPortal';
import { buildQuotation, errorKeyFor, initialQuotationState, orderedLines, previewTotals } from '../quotationModel';
import { buildBill, initialBillState, previewBillTotals } from '../billModel';

const FLOUR = '00000000-0000-4000-8000-000000000001';
const BUTTER = '00000000-0000-4000-8000-000000000002';
const Q1 = '00000000-0000-4000-8000-0000000000a1';
const QL1 = '00000000-0000-4000-8000-0000000000b1';
const QL2 = '00000000-0000-4000-8000-0000000000b2';
const TOKEN = 'A'.repeat(43);

function view(overrides: Partial<SupplierPortalView> = {}): SupplierPortalView {
  return {
    business: 'Mountain Bakes',
    demandNo: 'MB-WA-20261020-0001',
    status: 'awaiting_supplier',
    statusLabel: 'Awaiting supplier',
    priority: 'urgent',
    requiredDate: '2026-10-22',
    supplierName: 'Supplier 1',
    notes: null,
    deliveryInstructions: null,
    items: [
      { id: FLOUR, lineNo: 1, itemName: 'Flour', requestedQty: 10, unit: 'kg', note: null },
      { id: BUTTER, lineNo: 2, itemName: 'Butter', requestedQty: 5, unit: 'kg', note: null },
    ],
    latestQuotation: null,
    approvedQuotation: null,
    latestBill: null,
    productionNote: null,
    canQuote: true,
    canBill: false,
    linkExpiresAt: '2026-10-27T00:00:00Z',
    ...overrides,
  };
}

const approved = {
  id: Q1,
  demandId: 'd',
  version: 1,
  status: 'approved' as const,
  submittedVia: 'portal' as const,
  enteredByName: null,
  subtotal: 7202.5,
  deliveryCharge: 300,
  total: 7502.5,
  estimatedDeliveryDate: '2026-10-22',
  deliveryNotes: null,
  notes: null,
  submittedAt: '2026-10-20T10:00:00Z',
  decidedByName: null,
  decidedAt: null,
  decisionReason: null,
  items: [
    { id: QL1, lineNo: 1, demandItemId: FLOUR, substituteForDemandItemId: null, itemName: 'Flour', unit: 'kg', requestedQty: 10, availableQty: 8, unitRate: 150, lineTotal: 1200, availability: 'partial' as const, note: null },
    { id: QL2, lineNo: 2, demandItemId: BUTTER, substituteForDemandItemId: null, itemName: 'Butter', unit: 'kg', requestedQty: 5, availableQty: 5, unitRate: 1200.5, lineTotal: 6002.5, availability: 'available' as const, note: null },
  ],
};

describe('the link token', () => {
  beforeEach(() => {
    sessionStorage.clear();
    window.history.replaceState(null, '', '/supplier-portal/');
  });
  afterEach(() => forgetLinkToken());

  test('is read from the fragment, kept for this tab, and removed from the address bar', () => {
    window.history.replaceState(null, '', `/supplier-portal/#t=${TOKEN}`);
    const replace = vi.spyOn(window.history, 'replaceState');
    expect(takeLinkToken()).toBe(TOKEN);
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain(TOKEN);
    expect(replace).toHaveBeenCalledOnce();
    // A refresh (no fragment any more) still finds it — in sessionStorage, never localStorage.
    expect(takeLinkToken()).toBe(TOKEN);
    expect(JSON.stringify({ ...localStorage })).not.toContain(TOKEN);
    replace.mockRestore();
  });

  test('a newer link replaces the one this tab holds', () => {
    window.history.replaceState(null, '', `/supplier-portal/#t=${TOKEN}`);
    takeLinkToken();
    const next = 'B'.repeat(43);
    window.history.replaceState(null, '', `/supplier-portal/#t=${next}`);
    expect(takeLinkToken()).toBe(next);
  });

  test('no fragment and nothing stored means no token', () => {
    expect(takeLinkToken()).toBeNull();
  });
});

describe('quotation form', () => {
  test('a fresh form asks for every requested item at the requested quantity', () => {
    const s = initialQuotationState(view());
    expect(s.requested.map((r) => [r.itemName, r.availability, r.qty, r.rate])).toEqual([
      ['Flour', 'available', '10', ''],
      ['Butter', 'available', '5', ''],
    ]);
    const built = buildQuotation(s);
    expect(built.input).toBeNull();
    expect(Object.keys(built.errors).sort()).toEqual([`req-${FLOUR}.rate`, `req-${BUTTER}.rate`]);
  });

  test('a removed item goes as unavailable with quantity 0, and a substitute is linked to it', () => {
    const s = initialQuotationState(view());
    s.requested[0] = { ...s.requested[0]!, availability: 'unavailable', qty: '0' };
    s.requested[1] = { ...s.requested[1]!, rate: '1,200.50' };
    s.added.push({ key: 'add-x', substituteFor: FLOUR, itemName: 'Maida', unit: 'kg', qty: '10', rate: '140', note: '' });
    s.deliveryCharge = '300';
    const built = buildQuotation(s, 'portal-test-request-1');
    expect(built.errors).toEqual({});
    expect(built.input?.items).toEqual([
      expect.objectContaining({ demandItemId: FLOUR, availability: 'unavailable', availableQty: 0, unitRate: 0 }),
      expect.objectContaining({ demandItemId: null, substituteForDemandItemId: FLOUR, itemName: 'Maida', unit: 'kg', availability: 'substitute', availableQty: 10, unitRate: 140 }),
      expect.objectContaining({ demandItemId: BUTTER, availability: 'available', availableQty: 5, unitRate: 1200.5 }),
    ]);
    expect(built.input?.clientRequestId).toBe('portal-test-request-1');
    expect(previewTotals(s)).toEqual({ subtotal: 7402.5, delivery: 300, total: 7702.5 });
  });

  test('a server error path lands on the right line of the form', () => {
    const s = initialQuotationState(view());
    s.added.push({ key: 'add-y', substituteFor: FLOUR, itemName: 'Maida', unit: 'kg', qty: '1', rate: '1', note: '' });
    const order = orderedLines(s);
    // Payload order is Flour, its substitute, Butter.
    expect(errorKeyFor('items.1.unitRate', order)).toBe('add-y.rate');
    expect(errorKeyFor('items.2.availableQty', order)).toBe(`req-${BUTTER}.qty`);
    expect(errorKeyFor('deliveryCharge', order)).toBe('deliveryCharge');
  });

  test('a revision starts from the latest quotation', () => {
    const s = initialQuotationState(view({ status: 'changes_requested', latestQuotation: { ...approved, status: 'changes_requested' } }));
    expect(s.requested.map((r) => [r.availability, r.qty, r.rate])).toEqual([
      ['partial', '8', '150'],
      ['available', '5', '1200.5'],
    ]);
    expect(s.deliveryCharge).toBe('300');
    expect(s.estimatedDeliveryDate).toBe('2026-10-22');
  });

  test('too many decimals are refused before the round trip', () => {
    const s = initialQuotationState(view());
    s.requested[0] = { ...s.requested[0]!, qty: '1.2345', rate: '10' };
    s.requested[1] = { ...s.requested[1]!, rate: '10.555' };
    const built = buildQuotation(s);
    expect(built.errors[`req-${FLOUR}.qty`]).toMatch(/3 decimal/);
    expect(built.errors[`req-${BUTTER}.rate`]).toMatch(/2 decimal/);
  });
});

describe('bill form', () => {
  const billView = () => view({ status: 'awaiting_supplier_bill', canBill: true, approvedQuotation: approved, latestQuotation: approved });

  test('starts from the approved quotation', () => {
    const s = initialBillState(billView(), new Date('2026-10-21T08:00:00Z'));
    expect(s.lines.map((l) => [l.itemName, l.qty, l.rate, l.included])).toEqual([
      ['Flour', '8', '150', true],
      ['Butter', '5', '1200.5', true],
    ]);
    expect(s.deliveryCharge).toBe('300');
    expect(s.invoiceDate).toBe('2026-10-21');
  });

  test('builds the body, leaving out an item not delivered', () => {
    const s = initialBillState(billView());
    s.supplierBillNo = 'INV-77';
    s.lines[0] = { ...s.lines[0]!, included: false };
    s.discount = '2.5';
    s.supplierPaymentMethod = 'Cash';
    s.supplierStatedPaid = '1000';
    const built = buildBill(s, 'portal-bill-request-1');
    expect(built.errors).toEqual({});
    expect(built.input).toMatchObject({
      supplierBillNo: 'INV-77',
      items: [{ quotationItemId: QL2, qty: 5, unitRate: 1200.5 }],
      deliveryCharge: 300,
      discount: 2.5,
      supplierPaymentMethod: 'Cash',
      supplierStatedPaid: 1000,
      clientRequestId: 'portal-bill-request-1',
    });
    expect(previewBillTotals(s).grandTotal).toBe(6300);
  });

  test('needs a bill number, a line, and a discount no larger than the bill', () => {
    const s = initialBillState(billView());
    s.lines = s.lines.map((l) => ({ ...l, included: false }));
    s.discount = '99999';
    const built = buildBill(s);
    expect(built.input).toBeNull();
    expect(built.errors['supplierBillNo']).toBeTruthy();
    expect(built.errors['lines']).toBeTruthy();
    expect(built.errors['discount']).toMatch(/larger than the bill/);
  });
});
