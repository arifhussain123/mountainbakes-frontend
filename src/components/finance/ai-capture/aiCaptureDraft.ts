import {
  ATTACHMENT_MAX_PER_ENTITY,
  type AiExpenseDuplicate,
  type AiExpenseIssue,
  type AiExpenseLineItem,
  type AiExpenseProposal,
  type CreateFinanceTransactionInput,
  type FinanceAccount,
  type FinancePaymentMethod,
} from '@mb/shared';

/**
 * AI Expense Capture's review cards: what the AI proposed, as the user edits it.
 *
 * Pure functions, so the rules can be tested without a page:
 *   * a proposal becomes a card with the owner's defaults (Expense, Cash, the
 *     date and total read off the bill) and nothing invented — a figure the AI
 *     could not read stays empty and has to be typed in;
 *   * a card is saved through the ordinary entry create, as a draft, with one
 *     Idempotency-Key for its whole life, so a retry never saves it twice;
 *   * a possible duplicate must be acknowledged before its card can be saved.
 */

export type DraftStatus = 'review' | 'approved' | 'saving' | 'saved';

export interface AiDraft {
  key: string;
  /** The proposal's key in its run (`e1`, `e2`…) — what a same-batch duplicate names. */
  proposalKey: string;
  captureId: string;
  /** Receipt photos (attachment ids). A split card's copies are made at save time. */
  photoIds: string[];
  ledgerHeadId: string;
  businessDate: string;
  /** As typed — a string so an empty field stays empty instead of becoming 0. */
  amount: string;
  description: string;
  descriptionOriginal: string | null;
  merchant: string | null;
  paymentMethod: FinancePaymentMethod;
  account: FinanceAccount;
  branchId: string | null;
  referenceNo: string;
  notes: string;
  language: string | null;
  lineItems: AiExpenseLineItem[];
  /** The bill total the AI read, kept for a split's "parts should add up to" hint. */
  billTotal: number | null;
  issues: AiExpenseIssue[];
  confidence: AiExpenseProposal['confidence'];
  duplicates: AiExpenseDuplicate[];
  aiNotes: string | null;
  needsReview: boolean;
  duplicateAcknowledged: boolean;
  status: DraftStatus;
  idempotencyKey: string;
  savedTxnNo: string | null;
  error: string | null;
}

function newKey(prefix: string): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

/** Notes for the entry: where the figures came from, the supplier and the items. At most 500 characters. */
export function defaultNotes(p: Pick<AiExpenseProposal, 'merchant' | 'invoiceNo' | 'lineItems' | 'tax' | 'discount'>): string {
  const parts = ['Read from the receipt by AI (Gemini).'];
  if (p.merchant) parts.push(`Supplier: ${p.merchant}.`);
  if (p.tax) parts.push(`Tax: ${p.tax}.`);
  if (p.discount) parts.push(`Discount: ${p.discount}.`);
  if (p.lineItems.length > 0) {
    const items = p.lineItems
      .map((l) => `${l.description}${l.descriptionEnglish ? ` (${l.descriptionEnglish})` : ''}${l.amount !== null ? ` ${l.amount}` : ''}`)
      .join('; ');
    parts.push(`Items: ${items}`);
  }
  const text = parts.join(' ');
  return text.length > 500 ? `${text.slice(0, 497)}…` : text;
}

export function draftFromProposal(p: AiExpenseProposal, captureId: string): AiDraft {
  return {
    key: newKey(p.key),
    proposalKey: p.key,
    captureId,
    photoIds: p.photoIds,
    ledgerHeadId: p.suggestedLedgerHeadId ?? '',
    businessDate: p.businessDate ?? '',
    amount: p.total !== null ? String(p.total) : '',
    description: p.description.slice(0, 300),
    descriptionOriginal: p.descriptionOriginal,
    merchant: p.merchant,
    paymentMethod: 'cash',
    account: 'cash',
    branchId: null,
    referenceNo: (p.invoiceNo ?? '').slice(0, 80),
    notes: defaultNotes(p),
    language: p.language,
    lineItems: p.lineItems,
    billTotal: p.total,
    issues: p.issues,
    confidence: p.confidence,
    duplicates: p.duplicates,
    aiNotes: p.notes,
    needsReview: p.needsReview,
    duplicateAcknowledged: false,
    status: 'review',
    idempotencyKey: newKey('ai-expense'),
    savedTxnNo: null,
    error: null,
  };
}

/** What is still missing before a card can be approved, in words; empty when it can be. */
export function missingFields(d: AiDraft): string[] {
  const missing: string[] = [];
  if (!d.ledgerHeadId) missing.push('ledger head');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.businessDate)) missing.push('business date');
  const amount = Number(d.amount);
  if (d.amount.trim() === '' || !Number.isFinite(amount) || amount <= 0) missing.push('amount');
  if (d.description.trim().length < 2) missing.push('description');
  if (d.photoIds.length === 0) missing.push('receipt photo');
  if (d.duplicates.length > 0 && !d.duplicateAcknowledged) missing.push('duplicate check');
  return missing;
}

/** The body for `POST /api/finance/income/entries`. Always a draft, as the web form saves. */
export function createBody(d: AiDraft, photoIds: string[] = d.photoIds): CreateFinanceTransactionInput {
  return {
    ledgerHeadId: d.ledgerHeadId,
    branchId: d.branchId,
    description: d.description.trim(),
    amount: Math.round(Number(d.amount) * 100) / 100,
    paymentMethod: d.paymentMethod,
    account: d.account,
    businessDate: d.businessDate,
    referenceNo: d.referenceNo.trim() || null,
    notes: d.notes.trim() || null,
    asDraft: true,
    confirmDuplicate: false,
    attachmentIds: photoIds,
    aiCaptureId: d.captureId,
  };
}

/**
 * Split one bill into two expenses (e.g. two ledger heads on one receipt).
 * Both keep the same receipt photos; the second starts with no amount, so the
 * user decides the split rather than the app guessing it.
 */
export function splitDraft(d: AiDraft): [AiDraft, AiDraft] {
  const second: AiDraft = {
    ...d,
    key: newKey(`${d.key}-split`),
    amount: '',
    description: `${d.description} (part 2)`.slice(0, 300),
    status: 'review',
    idempotencyKey: newKey('ai-expense'),
    savedTxnNo: null,
    error: null,
  };
  return [{ ...d, status: d.status === 'approved' ? 'review' : d.status }, second];
}

/** Whether two cards can become one entry: neither saved, and the photos fit on one entry. */
export function canCombine(a: AiDraft, b: AiDraft): boolean {
  if (a.status === 'saved' || b.status === 'saved' || a.key === b.key) return false;
  return new Set([...a.photoIds, ...b.photoIds]).size <= ATTACHMENT_MAX_PER_ENTITY;
}

/** Two cards that are really one bill (e.g. read twice), as one: photos and items together, amounts added. */
export function combineDrafts(a: AiDraft, b: AiDraft): AiDraft {
  const amountA = Number(a.amount);
  const amountB = Number(b.amount);
  const amount = a.amount.trim() === '' && b.amount.trim() === ''
    ? ''
    : String(Math.round(((Number.isFinite(amountA) ? amountA : 0) + (Number.isFinite(amountB) ? amountB : 0)) * 100) / 100);
  const combined = {
    ...a,
    photoIds: [...new Set([...a.photoIds, ...b.photoIds])],
    amount,
    lineItems: [...a.lineItems, ...b.lineItems],
    billTotal: a.billTotal !== null && b.billTotal !== null ? a.billTotal + b.billTotal : null,
    issues: [...new Set([...a.issues, ...b.issues])],
    // A repeat between the two is answered by combining them.
    duplicates: [...a.duplicates, ...b.duplicates].filter(
      (x) => !(x.kind === 'same_batch' && a.captureId === b.captureId && (x.otherKey === a.proposalKey || x.otherKey === b.proposalKey)),
    ),
    needsReview: true,
    duplicateAcknowledged: false,
    status: 'review' as const,
    idempotencyKey: newKey('ai-expense'),
  };
  return combined;
}

export interface CaptureSummary {
  receipts: number;
  expenses: number;
  totalAmount: number;
  needingReview: number;
  saved: number;
}

export function summarize(photoCount: number, drafts: AiDraft[]): CaptureSummary {
  return {
    receipts: photoCount,
    expenses: drafts.length,
    totalAmount: Math.round(drafts.reduce((s, d) => s + (Number.isFinite(Number(d.amount)) ? Number(d.amount) : 0), 0) * 100) / 100,
    needingReview: drafts.filter((d) => d.status === 'review' && (d.needsReview || missingFields(d).length > 0)).length,
    saved: drafts.filter((d) => d.status === 'saved').length,
  };
}
