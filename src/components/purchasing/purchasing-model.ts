import {
  PURCHASE_DEMAND_STATUS_LABEL,
  type BillStatus,
  type PurchaseDeliveryStatus,
  type PurchaseDemandItem,
  type PurchaseDemandStatus,
  type PurchaseItem,
  type PurchasePaymentStatus,
  type Quotation,
  type QuotationAvailability,
  type QuotationItem,
  type QuotationStatus,
  type SupplierBill,
  type SupplierCreditStatus,
  type SupplierPaymentStatus,
  type VerificationCheck,
  type WhatsAppMessageStatus,
} from '@mb/shared';

/**
 * WhatsApp Purchasing — the pure half of the page: wording, badge colours, and
 * the few derivations the screens need that are not the server's to make.
 *
 * WHAT IS DELIBERATELY NOT HERE: any rule about which action a demand allows.
 * `PurchaseDemandDetail.actions` is computed on the server from the same states
 * its database functions enforce, and every button reads it. Re-deriving "can
 * this be received?" here would be a second copy of the state machine that
 * drifts the first time the server's changes. Totals are the server's too —
 * the one sum below (`quotationPreviewTotal`) is a preview for a form that has
 * not been sent yet, and is labelled as such where it is shown.
 */

// ── Request ids ─────────────────────────────────────────────────────────────

/** A UUID where the platform offers one, a time-salted fallback where it does not (plain http). */
export function newRequestId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * The Idempotency-Key for one form submission, with the exact body it was
 * minted for.
 *
 * A retry of the SAME body reuses the key, so a payment whose answer was lost
 * on the way back cannot be recorded twice. Any change to the body mints a new
 * one, because the server refuses a key reused for a different request (422) —
 * the same contract ReturnItemsModal keeps for branch returns. `reset()` once
 * the submission has succeeded or the form is closed.
 */
export class SubmissionKey {
  private current: { body: string; key: string } | null = null;

  constructor(private readonly prefix: string) {}

  keyFor(body: string): string {
    if (this.current?.body !== body) this.current = { body, key: newRequestId(this.prefix) };
    return this.current.key;
  }

  reset(): void {
    this.current = null;
  }
}

// ── Badges ──────────────────────────────────────────────────────────────────

const TONE = {
  neutral: 'bg-muted text-muted-foreground',
  info: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-400',
  waiting: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  action: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
  good: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  bad: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
} as const;
export type Tone = keyof typeof TONE;
export const toneClass = (tone: Tone): string => TONE[tone];

/**
 * Who a demand is waiting on, as a colour: amber while the supplier has it,
 * violet while Production has to act, green once the goods are in.
 */
export const DEMAND_STATUS_TONE: Record<PurchaseDemandStatus, Tone> = {
  draft: 'neutral',
  verified: 'info',
  awaiting_supplier: 'waiting',
  quotation_received: 'action',
  changes_requested: 'waiting',
  rejected: 'bad',
  awaiting_supplier_bill: 'waiting',
  bill_submitted: 'action',
  awaiting_delivery: 'info',
  partially_received: 'info',
  received: 'good',
  cancelled: 'bad',
};

export const demandStatusLabel = (s: PurchaseDemandStatus): string => PURCHASE_DEMAND_STATUS_LABEL[s] ?? s;

export const PAYMENT_STATUS_LABEL: Record<PurchasePaymentStatus, string> = {
  unpaid: 'Unpaid',
  partially_paid: 'Partly paid',
  paid: 'Paid',
};
export const PAYMENT_STATUS_TONE: Record<PurchasePaymentStatus, Tone> = {
  unpaid: 'bad',
  partially_paid: 'waiting',
  paid: 'good',
};

export const DELIVERY_STATUS_LABEL: Record<PurchaseDeliveryStatus, string> = {
  not_booked: 'Delivery not booked',
  booked: 'Delivery booked',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
};
export const DELIVERY_STATUS_TONE: Record<PurchaseDeliveryStatus, Tone> = {
  not_booked: 'neutral',
  booked: 'info',
  dispatched: 'waiting',
  delivered: 'good',
};

export const MESSAGE_STATUS_LABEL: Record<WhatsAppMessageStatus, string> = {
  queued: 'Queued',
  accepted: 'Accepted by WhatsApp',
  sent: 'Sent',
  delivered: 'Delivered',
  read: 'Read',
  failed: 'Failed',
  received: 'Received',
};
export const MESSAGE_STATUS_TONE: Record<WhatsAppMessageStatus, Tone> = {
  queued: 'neutral',
  accepted: 'info',
  sent: 'info',
  delivered: 'good',
  read: 'good',
  failed: 'bad',
  received: 'action',
};

export const QUOTATION_STATUS_LABEL: Record<QuotationStatus, string> = {
  submitted: 'Awaiting your decision',
  changes_requested: 'Changes requested',
  approved: 'Approved',
  rejected: 'Rejected',
  superseded: 'Superseded',
};
export const QUOTATION_STATUS_TONE: Record<QuotationStatus, Tone> = {
  submitted: 'action',
  changes_requested: 'waiting',
  approved: 'good',
  rejected: 'bad',
  superseded: 'neutral',
};

export const AVAILABILITY_LABEL: Record<QuotationAvailability, string> = {
  available: 'Available',
  partial: 'Partial',
  unavailable: 'Unavailable',
  substitute: 'Substitute',
};
export const AVAILABILITY_TONE: Record<QuotationAvailability, Tone> = {
  available: 'good',
  partial: 'waiting',
  unavailable: 'bad',
  substitute: 'info',
};

export const BILL_STATUS_LABEL: Record<BillStatus, string> = {
  submitted: 'Awaiting your decision',
  approved: 'Approved',
  rejected: 'Rejected',
};
export const BILL_STATUS_TONE: Record<BillStatus, Tone> = { submitted: 'action', approved: 'good', rejected: 'bad' };

/** Production records a payment; only Finance posts it. The labels say so. */
export const SUPPLIER_PAYMENT_STATUS_LABEL: Record<SupplierPaymentStatus, string> = {
  pending_approval: 'Waiting for Finance',
  posted: 'Posted by Finance',
  rejected: 'Rejected by Finance',
  reversed: 'Reversed',
};
export const SUPPLIER_PAYMENT_STATUS_TONE: Record<SupplierPaymentStatus, Tone> = {
  pending_approval: 'waiting',
  posted: 'good',
  rejected: 'bad',
  reversed: 'neutral',
};

export const CREDIT_STATUS_LABEL: Record<SupplierCreditStatus, string> = {
  pending_approval: 'Waiting for Finance',
  active: 'Active',
  settled: 'Settled',
  rejected: 'Rejected by Finance',
  cancelled: 'Cancelled',
};
export const CREDIT_STATUS_TONE: Record<SupplierCreditStatus, Tone> = {
  pending_approval: 'waiting',
  active: 'info',
  settled: 'good',
  rejected: 'bad',
  cancelled: 'neutral',
};

export const BILL_DIFFERENCE_FIELD_LABEL: Record<SupplierBill['differences'][number]['field'], string> = {
  quantity: 'Quantity',
  rate: 'Rate',
  delivery_charge: 'Delivery charge',
  other_charges: 'Other charges',
};

/** "quotation_approved" → "Quotation approved". Events are server vocabulary; this only makes them readable. */
export function eventLabel(event: string): string {
  const s = event.replace(/[_.]+/g, ' ').trim();
  return s ? s[0]!.toUpperCase() + s.slice(1) : event;
}

// ── Numbers ─────────────────────────────────────────────────────────────────

/** A quantity as typed: up to three decimals, trailing zeros dropped. */
export function formatQty(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—';
  return Number(n).toLocaleString('en-PK', { maximumFractionDigits: 3 });
}

/**
 * A form field's text as the number the schema validates. Blank is NaN rather
 * than 0, so "Enter a valid quantity" is what an empty box gets — a silent zero
 * would pass a `min(0)` check and reach the server as a real figure.
 */
export function parseNumber(text: string): number {
  const t = text.trim().replace(/,/g, '');
  return t === '' ? Number.NaN : Number(t);
}

/** Keep what a decimal field can hold: digits and one point. */
export function decimalInput(text: string): string {
  const cleaned = text.replace(/[^0-9.]/g, '');
  const i = cleaned.indexOf('.');
  return i === -1 ? cleaned : cleaned.slice(0, i + 1) + cleaned.slice(i + 1).replace(/\./g, '');
}

/**
 * The quotation total a staff member is about to key in, for the form's own
 * preview. Rounded the way the server rounds (2 decimals per line); the figure
 * that counts is the one the server returns.
 */
export function quotationPreviewTotal(lines: Array<{ qty: number; rate: number }>, deliveryCharge: number): number {
  const cents = lines.reduce((s, l) => {
    if (!Number.isFinite(l.qty) || !Number.isFinite(l.rate)) return s;
    return s + Math.round(l.qty * l.rate * 100);
  }, 0);
  return (cents + Math.round((Number.isFinite(deliveryCharge) ? deliveryCharge : 0) * 100)) / 100;
}

// ── Zod issues → field errors ───────────────────────────────────────────────

/** First message per dotted path ('items.0.requestedQty'), for showing under a field. */
export function issuesByPath(issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const key = i.path.join('.');
    if (!(key in out)) out[key] = i.message;
  }
  return out;
}

// ── Verify / send ───────────────────────────────────────────────────────────

export const failedErrors = (checks: VerificationCheck[]) => checks.filter((c) => !c.ok && c.severity === 'error');
export const failedWarnings = (checks: VerificationCheck[]) => checks.filter((c) => !c.ok && c.severity === 'warning');

/**
 * Whether Send may be offered in the demand form: the last Verify passed, it
 * checked the revision now saved, and nothing has been typed since the save.
 * The server refuses a send for any other revision with a 409; this keeps the
 * button from promising one it will refuse.
 */
export function canSendVerified(input: {
  verifiedOk: boolean;
  verifiedRevision: number | null;
  savedRevision: number | null;
  dirty: boolean;
}): boolean {
  return (
    input.verifiedOk &&
    !input.dirty &&
    input.savedRevision !== null &&
    input.verifiedRevision !== null &&
    input.verifiedRevision === input.savedRevision
  );
}

// ── Conversations ───────────────────────────────────────────────────────────

/**
 * WhatsApp allows free text only within 24 hours of the contact's last
 * message; the server computes the end of that window. Null means it is shut.
 */
export function isReplyWindowOpen(windowOpenUntil: string | null | undefined, now: number = Date.now()): boolean {
  return isInFuture(windowOpenUntil, now);
}

/** Whether a timestamp (a window's end, a link's expiry) is still ahead. Null/invalid is "no". */
export function isInFuture(at: string | null | undefined, now: number = Date.now()): boolean {
  if (!at) return false;
  const t = new Date(at).getTime();
  return Number.isFinite(t) && t > now;
}

// ── Quotation comparison ────────────────────────────────────────────────────

export interface ComparisonRow {
  key: string;
  itemName: string;
  unit: string;
  requestedQty: number | null;
  /** The line the supplier quoted, or null when they left the item off. */
  line: QuotationItem | null;
  /** For a substitute: the requested item it stands in for. */
  substituteFor: string | null;
}

/**
 * One quotation laid against the demand: every requested item in order, with
 * the supplier's line for it (or none — "not quoted"), then the substitutes the
 * supplier added, each naming what it replaces.
 */
export function quotationComparison(items: PurchaseDemandItem[], q: Quotation): ComparisonRow[] {
  const byDemandItem = new Map<string, QuotationItem>();
  for (const l of q.items) if (l.demandItemId) byDemandItem.set(l.demandItemId, l);
  const names = new Map(items.map((i) => [i.id, i.itemName]));
  const rows: ComparisonRow[] = [...items]
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((i) => ({
      key: i.id,
      itemName: i.itemName,
      unit: i.unit,
      requestedQty: i.requestedQty,
      line: byDemandItem.get(i.id) ?? null,
      substituteFor: null,
    }));
  for (const l of [...q.items].sort((a, b) => a.lineNo - b.lineNo)) {
    if (l.demandItemId) continue;
    rows.push({
      key: l.id,
      itemName: l.itemName,
      unit: l.unit,
      requestedQty: l.requestedQty,
      line: l,
      substituteFor: l.substituteForDemandItemId ? names.get(l.substituteForDemandItemId) ?? null : null,
    });
  }
  return rows;
}

export interface VersionRow {
  key: string;
  itemName: string;
  unit: string;
  requestedQty: number | null;
  /** One cell per quotation version, oldest first — null where that version has no line. */
  cells: Array<QuotationItem | null>;
}

/**
 * Every quotation version side by side: the requested items first, then each
 * substitute any version offered (matched across versions by name and the item
 * it replaces, since a resubmission mints new line ids).
 */
export function versionComparison(items: PurchaseDemandItem[], quotations: Quotation[]): VersionRow[] {
  const versions = [...quotations].sort((a, b) => a.version - b.version);
  const rows: VersionRow[] = [...items]
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((i) => ({
      key: i.id,
      itemName: i.itemName,
      unit: i.unit,
      requestedQty: i.requestedQty,
      cells: versions.map((q) => q.items.find((l) => l.demandItemId === i.id) ?? null),
    }));
  const subs = new Map<string, VersionRow>();
  versions.forEach((q, vi) => {
    for (const l of q.items) {
      if (l.demandItemId) continue;
      const k = `${l.itemName.trim().toLowerCase()}|${l.substituteForDemandItemId ?? ''}`;
      let row = subs.get(k);
      if (!row) {
        row = { key: `sub:${k}`, itemName: l.itemName, unit: l.unit, requestedQty: null, cells: versions.map(() => null) };
        subs.set(k, row);
      }
      row.cells[vi] = l;
    }
  });
  return [...rows, ...subs.values()];
}

// ── Receipt ─────────────────────────────────────────────────────────────────

type BillLineRef = { quotationItemId: string | null; itemName: string; unit: string };

/**
 * The catalog item the demand line behind a bill line was raised against, found
 * through the quotation line the bill line was billed from. A substitute has no
 * demand line of its own, so it has none. When there is one, the server books
 * the receipt into THAT item and refuses any other (400).
 */
export function demandNamedItemId(billItem: BillLineRef, quotations: Quotation[], demandItems: PurchaseDemandItem[]): string | null {
  const qLine = billItem.quotationItemId
    ? quotations.flatMap((q) => q.items).find((l) => l.id === billItem.quotationItemId) ?? null
    : null;
  const demandLine = qLine?.demandItemId ? demandItems.find((d) => d.id === qLine.demandItemId) ?? null : null;
  return demandLine?.itemId ?? null;
}

/**
 * The stock items a receipt line may book into, as the server will accept
 * them: only the item the demand named, when it named one; otherwise any
 * active catalog item in the bill line's unit (the server refuses a unit
 * mismatch, since 5 kg booked into a "pcs" item is a wrong balance). The
 * catalog read already leaves inactive items out.
 */
export function stockItemChoices(
  billItem: BillLineRef,
  quotations: Quotation[],
  demandItems: PurchaseDemandItem[],
  catalog: PurchaseItem[],
): { choices: PurchaseItem[]; locked: boolean } {
  const named = demandNamedItemId(billItem, quotations, demandItems);
  if (named) return { choices: catalog.filter((c) => c.id === named && c.isActive), locked: true };
  return { choices: catalog.filter((c) => c.isActive && c.unit === billItem.unit), locked: false };
}

/**
 * The stock item a receipt line starts on: the item the demand named, else a
 * same-unit catalog item of the same name. Null when nothing matches — the
 * receipt form then asks.
 */
export function defaultStockItemId(
  billItem: BillLineRef,
  quotations: Quotation[],
  demandItems: PurchaseDemandItem[],
  catalog: PurchaseItem[],
): string | null {
  const { choices, locked } = stockItemChoices(billItem, quotations, demandItems, catalog);
  if (locked) return choices[0]?.id ?? null;
  const name = billItem.itemName.trim().toLowerCase();
  return choices.find((c) => c.name.trim().toLowerCase() === name)?.id ?? null;
}
