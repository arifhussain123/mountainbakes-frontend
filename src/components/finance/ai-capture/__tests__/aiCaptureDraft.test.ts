import { describe, expect, test } from 'vitest';
import { CreateFinanceTransactionSchema, type AiExpenseProposal } from '@mb/shared';
import {
  canCombine,
  combineDrafts,
  createBody,
  draftFromProposal,
  missingFields,
  splitDraft,
  summarize,
} from '../aiCaptureDraft';

const CAPTURE = '90000000-0000-4000-8000-000000000001';
const HEAD = '70000000-0000-4000-8000-000000000001';
const P1 = '80000000-0000-4000-8000-000000000001';
const P2 = '80000000-0000-4000-8000-000000000002';

const proposal = (o: Partial<AiExpenseProposal> = {}): AiExpenseProposal => ({
  key: 'e1', photoIds: [P1], merchant: 'Al-Madina Traders', invoiceNo: 'INV-9', businessDate: '2026-10-29', currency: 'PKR',
  subtotal: null, tax: null, discount: null, total: 5000, description: 'Flour purchase — Al-Madina Traders',
  descriptionOriginal: null, language: 'English', lineItems: [], suggestedLedgerHeadId: HEAD, confidence: 'high',
  issues: [], needsReview: false, notes: null, duplicates: [], ...o,
});

describe('a proposal becomes a card', () => {
  test('with the owner\'s defaults: Cash, the date and total read, and a body the create endpoint accepts', () => {
    const d = draftFromProposal(proposal(), CAPTURE);
    expect([d.paymentMethod, d.account, d.businessDate, d.amount, d.ledgerHeadId, d.referenceNo]).toEqual(['cash', 'cash', '2026-10-29', '5000', HEAD, 'INV-9']);
    expect(missingFields(d)).toEqual([]);
    const body = createBody(d);
    expect(body).toMatchObject({ amount: 5000, asDraft: true, attachmentIds: [P1], aiCaptureId: CAPTURE, referenceNo: 'INV-9' });
    expect(CreateFinanceTransactionSchema.safeParse(body).success).toBe(true);
    expect(d.notes).toContain('Supplier: Al-Madina Traders.');
  });

  test('nothing is invented: an unread date or total stays empty and blocks approval', () => {
    const d = draftFromProposal(proposal({ businessDate: null, total: null, suggestedLedgerHeadId: null }), CAPTURE);
    expect([d.businessDate, d.amount, d.ledgerHeadId]).toEqual(['', '', '']);
    expect(missingFields(d)).toEqual(['ledger head', 'business date', 'amount']);
  });

  test('a possible duplicate must be acknowledged before it can be approved', () => {
    const d = draftFromProposal(proposal({ duplicates: [{ kind: 'reference', message: 'Invoice INV-9 is already on FTX-1.' }] }), CAPTURE);
    expect(missingFields(d)).toEqual(['duplicate check']);
    expect(missingFields({ ...d, duplicateAcknowledged: true })).toEqual([]);
  });

  test('each card has its own idempotency key, kept for its life', () => {
    const a = draftFromProposal(proposal(), CAPTURE);
    const b = draftFromProposal(proposal(), CAPTURE);
    expect(a.idempotencyKey).not.toBe(b.idempotencyKey);
    expect(a.idempotencyKey).toMatch(/^[A-Za-z0-9._:-]{8,200}$/);
  });

  test('item lines go into the notes, not into separate expenses, capped at 500 characters', () => {
    const lineItems = Array.from({ length: 60 }, (_, i) => ({ description: `چینی ${i}`, descriptionEnglish: 'Sugar', quantity: 1, amount: 10 }));
    const d = draftFromProposal(proposal({ lineItems }), CAPTURE);
    expect(d.lineItems).toHaveLength(60);
    expect(d.notes.length).toBeLessThanOrEqual(500);
    expect(d.notes).toContain('چینی 0 (Sugar) 10');
  });
});

describe('split and combine', () => {
  test('a split keeps the photo on both halves; the second starts with no amount and a key of its own', () => {
    const d = { ...draftFromProposal(proposal(), CAPTURE), status: 'approved' as const };
    const [first, second] = splitDraft(d);
    expect(first.status).toBe('review');
    expect(second.photoIds).toEqual([P1]);
    expect(second.amount).toBe('');
    expect(second.idempotencyKey).not.toBe(first.idempotencyKey);
    expect(missingFields(second)).toEqual(['amount']);
  });

  test('two cards read from one bill combine: photos and items together, amounts added, their same-batch warning gone', () => {
    const dupOf = (k: string) => [{ kind: 'same_batch' as const, otherKey: k, message: 'same bill' }];
    const a = draftFromProposal(proposal({ key: 'e1', duplicates: dupOf('e2'), lineItems: [{ description: 'A', descriptionEnglish: null, quantity: 1, amount: 100 }] }), CAPTURE);
    const b = draftFromProposal(proposal({ key: 'e2', photoIds: [P2], total: 250.5, duplicates: dupOf('e1') }), CAPTURE);
    expect(canCombine(a, b)).toBe(true);
    const c = combineDrafts(a, b);
    expect(c.photoIds).toEqual([P1, P2]);
    expect(c.amount).toBe('5250.5');
    expect(c.lineItems).toHaveLength(1);
    expect(c.duplicates).toEqual([]);
    expect(c.status).toBe('review');
  });

  test('a saved card cannot be combined, nor two whose photos would not fit on one entry', () => {
    const a = draftFromProposal(proposal(), CAPTURE);
    expect(canCombine(a, { ...a, key: 'other', status: 'saved' })).toBe(false);
    const many = (n: number) => Array.from({ length: n }, (_, i) => `80000000-0000-4000-8000-00000000010${i}`);
    expect(canCombine({ ...a, photoIds: many(3) }, { ...a, key: 'b', photoIds: many(3).map((x) => x.replace('10', '20')) })).toBe(false);
  });
});

test('the summary counts receipts, expenses, the total and what still needs a look', () => {
  const ok = draftFromProposal(proposal(), CAPTURE);
  const check = draftFromProposal(proposal({ total: 2000, needsReview: true }), CAPTURE);
  const blank = draftFromProposal(proposal({ total: null }), CAPTURE);
  const saved = { ...draftFromProposal(proposal({ total: 100 }), CAPTURE), status: 'saved' as const };
  expect(summarize(4, [ok, check, blank, saved])).toEqual({ receipts: 4, expenses: 4, totalAmount: 7100, needingReview: 2, saved: 1 });
});
