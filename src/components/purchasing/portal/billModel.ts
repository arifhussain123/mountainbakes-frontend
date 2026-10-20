import { BillInputSchema, type BillInput, type SupplierPortalView } from '@mb/shared';
import { parseFigure, round2 } from '@/lib/supplierPortal';
import { todayIso } from './portalFormat';

/**
 * The bill form as plain data — see quotationModel.ts for why it lives apart
 * from the component. A bill is raised against the APPROVED quotation: one
 * line per quoted line the supplier is delivering, prefilled with the quoted
 * quantity and rate. Anything changed from the quotation is allowed (the
 * server records it as a difference for Production to accept), and shown here
 * so the supplier sees it before Mountain Bakes does.
 */

export interface BillLine {
  /** The approved quotation line this bills; also the line's key. */
  quotationItemId: string;
  itemName: string;
  unit: string;
  quotedQty: number;
  quotedRate: number;
  included: boolean;
  qty: string;
  rate: string;
}

export interface BillFormState {
  lines: BillLine[];
  supplierBillNo: string;
  invoiceDate: string;
  deliveryDate: string;
  deliveryCharge: string;
  discount: string;
  otherCharges: string;
  otherChargesNote: string;
  supplierPaymentMethod: string;
  supplierStatedPaid: string;
  notes: string;
}

/** What the supplier says about payment. Free text on the API; these are the usual answers. */
export const SUPPLIER_PAYMENT_METHOD_OPTIONS = ['Cash', 'Easypaisa', 'Bank transfer', 'Credit / on account'];

const figure = (n: number | null | undefined) => (n === null || n === undefined || n === 0 ? '' : String(n));

export function initialBillState(view: SupplierPortalView, now: Date = new Date()): BillFormState {
  const q = view.approvedQuotation;
  // A bill Production returned, against this same approval, is the best
  // starting point for the corrected one.
  const returned =
    view.latestBill && view.latestBill.status === 'rejected' && q && view.latestBill.quotationId === q.id ? view.latestBill : null;
  const billed = new Map((returned?.items ?? []).map((l) => [l.quotationItemId, l]));

  const lines: BillLine[] = (q?.items ?? [])
    .filter((l) => l.availableQty > 0)
    .map((l) => {
      const b = billed.get(l.id);
      return {
        quotationItemId: l.id,
        itemName: l.itemName,
        unit: l.unit,
        quotedQty: l.availableQty,
        quotedRate: l.unitRate,
        included: returned ? !!b : true,
        qty: String(b ? b.qty : l.availableQty),
        rate: String(b ? b.unitRate : l.unitRate),
      };
    });

  return {
    lines,
    supplierBillNo: returned?.supplierBillNo ?? '',
    invoiceDate: returned?.invoiceDate ?? todayIso(now),
    deliveryDate: returned?.deliveryDate ?? q?.estimatedDeliveryDate ?? '',
    deliveryCharge: returned ? figure(returned.deliveryCharge) : figure(q?.deliveryCharge),
    discount: figure(returned?.discount),
    otherCharges: figure(returned?.otherCharges),
    otherChargesNote: returned?.otherChargesNote ?? '',
    supplierPaymentMethod: returned?.supplierPaymentMethod ?? '',
    supplierStatedPaid: figure(returned?.supplierStatedPaid),
    notes: returned?.notes ?? '',
  };
}

const num = (raw: string): number => {
  const n = parseFigure(raw);
  return n === null || Number.isNaN(n) ? 0 : n;
};

export function previewBillLine(l: BillLine): number | null {
  const q = parseFigure(l.qty);
  const r = parseFigure(l.rate);
  if (q === null || r === null || Number.isNaN(q) || Number.isNaN(r)) return null;
  return round2(q * r);
}

export function previewBillTotals(s: BillFormState) {
  const subtotal = round2(s.lines.filter((l) => l.included).reduce((t, l) => t + (previewBillLine(l) ?? 0), 0));
  const delivery = num(s.deliveryCharge);
  const other = num(s.otherCharges);
  const discount = num(s.discount);
  return { subtotal, delivery, other, discount, grandTotal: round2(subtotal + delivery + other - discount) };
}

/** How a line differs from what was approved, in words; null when it does not. */
export function lineDifference(l: BillLine): string | null {
  const q = parseFigure(l.qty);
  const r = parseFigure(l.rate);
  const parts: string[] = [];
  if (q !== null && !Number.isNaN(q) && q !== l.quotedQty) parts.push(`quoted quantity ${l.quotedQty}`);
  if (r !== null && !Number.isNaN(r) && r !== l.quotedRate) parts.push(`quoted rate Rs. ${l.quotedRate}`);
  return parts.length ? `Differs from the approved quotation (${parts.join(', ')})` : null;
}

/** API error path (`items.1.qty`) → this form's key (`<quotationItemId>.qty`). */
export function billErrorKeyFor(path: string, included: BillLine[]): string {
  const m = /^items\.(\d+)\.?(\w+)?/.exec(path);
  if (!m) return path === 'items' ? 'lines' : path;
  const line = included[Number(m[1])];
  if (!line) return 'lines';
  return `${line.quotationItemId}.${m[2] === 'unitRate' ? 'rate' : 'qty'}`;
}

export interface BuiltBill {
  input: BillInput | null;
  errors: Record<string, string>;
  included: BillLine[];
}

export function buildBill(s: BillFormState, clientRequestId?: string): BuiltBill {
  const errors: Record<string, string> = {};
  const included = s.lines.filter((l) => l.included);
  if (included.length === 0) errors['lines'] = 'Keep at least one item on the bill.';

  for (const l of included) {
    const q = parseFigure(l.qty);
    const r = parseFigure(l.rate);
    if (q === null) errors[`${l.quotationItemId}.qty`] = 'Enter the quantity';
    else if (Number.isNaN(q)) errors[`${l.quotationItemId}.qty`] = 'Enter a number, e.g. 12.5';
    if (r === null) errors[`${l.quotationItemId}.rate`] = 'Enter the rate';
    else if (Number.isNaN(r)) errors[`${l.quotationItemId}.rate`] = 'Enter a number, e.g. 150';
  }
  for (const k of ['deliveryCharge', 'discount', 'otherCharges', 'supplierStatedPaid'] as const) {
    const n = parseFigure(s[k]);
    if (n !== null && Number.isNaN(n)) errors[k] = 'Enter a number, e.g. 300';
  }

  const body = {
    supplierBillNo: s.supplierBillNo.trim(),
    invoiceDate: s.invoiceDate,
    deliveryDate: s.deliveryDate || null,
    items: included.map((l) => ({ quotationItemId: l.quotationItemId, qty: num(l.qty), unitRate: num(l.rate) })),
    deliveryCharge: num(s.deliveryCharge),
    discount: num(s.discount),
    otherCharges: num(s.otherCharges),
    otherChargesNote: s.otherChargesNote.trim() || null,
    supplierPaymentMethod: s.supplierPaymentMethod.trim() || null,
    supplierStatedPaid: num(s.supplierStatedPaid),
    notes: s.notes.trim() || null,
    ...(clientRequestId ? { clientRequestId } : {}),
  };

  const parsed = BillInputSchema.safeParse(body);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = billErrorKeyFor(issue.path.join('.'), included);
      if (!errors[key]) errors[key] = issue.message;
    }
  }

  // The one total rule the database enforces that the schema cannot see.
  const t = previewBillTotals(s);
  if (!errors['discount'] && t.discount > 0 && t.grandTotal < 0) errors['discount'] = 'The discount is larger than the bill.';

  if (Object.keys(errors).length > 0 || !parsed.success) return { input: null, errors, included };
  return { input: parsed.data, errors, included };
}
