import {
  PURCHASE_UNITS,
  QuotationInputSchema,
  type PurchaseUnit,
  type QuotationInput,
  type SupplierPortalView,
} from '@mb/shared';
import { parseFigure, round2 } from '@/lib/supplierPortal';

/**
 * The quotation form as plain data, and the one function that turns it into
 * the request body. Kept apart from the component so the rules — what a
 * "removed" item sends, how a substitute is linked, which line an error from
 * the server belongs to — can be read (and tested) without the JSX around them.
 *
 * The figures computed here are a PREVIEW. The server recomputes every line
 * and total in numeric SQL and its answer is the one shown after Submit.
 */

export type RequestedAvailability = 'available' | 'partial' | 'unavailable';

/** A line for an item Mountain Bakes asked for. */
export interface RequestedLine {
  key: string;
  demandItemId: string;
  itemName: string;
  unit: string;
  requestedQty: number;
  availability: RequestedAvailability;
  qty: string;
  rate: string;
  note: string;
}

/**
 * A line the supplier adds: a substitute for a requested item
 * (`substituteFor` set) or an extra item (null). Both go to the API as
 * availability 'substitute' with no demandItemId — QuotationItemInputSchema.
 */
export interface AddedLine {
  key: string;
  substituteFor: string | null;
  itemName: string;
  unit: PurchaseUnit | '';
  qty: string;
  rate: string;
  note: string;
}

export interface QuotationFormState {
  requested: RequestedLine[];
  added: AddedLine[];
  deliveryCharge: string;
  estimatedDeliveryDate: string;
  deliveryNotes: string;
  notes: string;
}

let seq = 0;
export const lineKey = (prefix: string) => `${prefix}-${++seq}`;

export const isUnit = (u: string | null | undefined): u is PurchaseUnit =>
  !!u && (PURCHASE_UNITS as readonly string[]).includes(u);

const figure = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));

/** The form, prefilled from the supplier's latest quotation when there is one. */
export function initialQuotationState(view: SupplierPortalView): QuotationFormState {
  const prev = view.latestQuotation;
  const byItem = new Map((prev?.items ?? []).filter((l) => l.demandItemId).map((l) => [l.demandItemId as string, l]));
  const requestedIds = new Set(view.items.map((i) => i.id));

  const requested: RequestedLine[] = view.items.map((i) => {
    const p = byItem.get(i.id);
    if (p && p.availability !== 'substitute') {
      const unavailable = p.availability === 'unavailable';
      return {
        key: `req-${i.id}`,
        demandItemId: i.id,
        itemName: i.itemName,
        unit: i.unit,
        requestedQty: i.requestedQty,
        availability: p.availability,
        qty: unavailable ? '0' : figure(p.availableQty),
        rate: unavailable && !p.unitRate ? '' : figure(p.unitRate),
        note: p.note ?? '',
      };
    }
    return {
      key: `req-${i.id}`,
      demandItemId: i.id,
      itemName: i.itemName,
      unit: i.unit,
      requestedQty: i.requestedQty,
      availability: 'available',
      qty: figure(i.requestedQty),
      rate: '',
      note: '',
    };
  });

  const added: AddedLine[] = (prev?.items ?? [])
    .filter((l) => l.availability === 'substitute')
    .map((l) => ({
      key: lineKey('add'),
      substituteFor: l.substituteForDemandItemId && requestedIds.has(l.substituteForDemandItemId) ? l.substituteForDemandItemId : null,
      itemName: l.itemName,
      unit: isUnit(l.unit) ? l.unit : '',
      qty: figure(l.availableQty),
      rate: figure(l.unitRate),
      note: l.note ?? '',
    }));

  return {
    requested,
    added,
    deliveryCharge: prev && prev.deliveryCharge ? figure(prev.deliveryCharge) : '',
    estimatedDeliveryDate: prev?.estimatedDeliveryDate ?? '',
    deliveryNotes: prev?.deliveryNotes ?? '',
    notes: prev?.notes ?? '',
  };
}

/** A requested line's lines in payload order: the line itself, then its substitutes. */
export function orderedLines(state: QuotationFormState): Array<RequestedLine | AddedLine> {
  const out: Array<RequestedLine | AddedLine> = [];
  for (const r of state.requested) {
    out.push(r);
    for (const a of state.added) if (a.substituteFor === r.demandItemId) out.push(a);
  }
  for (const a of state.added) if (!a.substituteFor || !state.requested.some((r) => r.demandItemId === a.substituteFor)) out.push(a);
  return out;
}

export const isRequested = (l: RequestedLine | AddedLine): l is RequestedLine => 'demandItemId' in l;

/** Quantity × rate for the preview; null while either is not a usable number. */
export function previewLineTotal(l: RequestedLine | AddedLine): number | null {
  if (isRequested(l) && l.availability === 'unavailable') return 0;
  const q = parseFigure(l.qty);
  const r = parseFigure(l.rate);
  if (q === null || r === null || Number.isNaN(q) || Number.isNaN(r)) return null;
  return round2(q * r);
}

export function previewTotals(state: QuotationFormState): { subtotal: number; delivery: number; total: number } {
  const subtotal = round2(orderedLines(state).reduce((s, l) => s + (previewLineTotal(l) ?? 0), 0));
  const d = parseFigure(state.deliveryCharge);
  const delivery = d === null || Number.isNaN(d) ? 0 : d;
  return { subtotal, delivery, total: round2(subtotal + delivery) };
}

/** Field names of a line as the API reports them, mapped onto this form's. */
const LINE_FIELD: Record<string, string> = {
  availableQty: 'qty',
  unitRate: 'rate',
  itemName: 'itemName',
  unit: 'unit',
  note: 'note',
  availability: 'qty',
  demandItemId: 'itemName',
};

/**
 * Turn an error path from the API or the schema (`items.3.unitRate`,
 * `deliveryCharge`) into this form's error key (`<lineKey>.rate`,
 * `deliveryCharge`).
 */
export function errorKeyFor(path: string, order: Array<RequestedLine | AddedLine>): string {
  const m = /^items\.(\d+)\.?(\w+)?/.exec(path);
  if (!m) return path;
  const line = order[Number(m[1])];
  if (!line) return 'form';
  return `${line.key}.${LINE_FIELD[m[2] ?? ''] ?? 'qty'}`;
}

export interface BuiltQuotation {
  input: QuotationInput | null;
  errors: Record<string, string>;
  order: Array<RequestedLine | AddedLine>;
}

function checkFigure(raw: string, what: 'qty' | 'rate', allowZero: boolean): string | null {
  const n = parseFigure(raw);
  if (n === null) return what === 'qty' ? 'Enter the quantity you can supply' : 'Enter your rate per unit';
  if (Number.isNaN(n)) return 'Enter a number, e.g. 12.5';
  if (!allowZero && n <= 0) return 'Enter a quantity above zero';
  return null;
}

/** Validate the form and build the request body, or say what to fix and where. */
export function buildQuotation(state: QuotationFormState, clientRequestId?: string): BuiltQuotation {
  const order = orderedLines(state);
  const errors: Record<string, string> = {};

  const items = order.map((l) => {
    if (isRequested(l)) {
      if (l.availability === 'unavailable') {
        return { demandItemId: l.demandItemId, itemName: l.itemName, availableQty: 0, unitRate: 0, availability: 'unavailable' as const, note: l.note.trim() || null };
      }
      const qErr = checkFigure(l.qty, 'qty', false);
      const rErr = checkFigure(l.rate, 'rate', true);
      if (qErr) errors[`${l.key}.qty`] = qErr;
      if (rErr) errors[`${l.key}.rate`] = rErr;
      return {
        demandItemId: l.demandItemId,
        itemName: l.itemName,
        availableQty: parseFigure(l.qty) ?? 0,
        unitRate: parseFigure(l.rate) ?? 0,
        availability: l.availability,
        note: l.note.trim() || null,
      };
    }
    if (!l.itemName.trim()) errors[`${l.key}.itemName`] = 'Enter the item name';
    if (!l.unit) errors[`${l.key}.unit`] = 'Choose a unit';
    const qErr = checkFigure(l.qty, 'qty', false);
    const rErr = checkFigure(l.rate, 'rate', true);
    if (qErr) errors[`${l.key}.qty`] = qErr;
    if (rErr) errors[`${l.key}.rate`] = rErr;
    return {
      demandItemId: null,
      substituteForDemandItemId: l.substituteFor,
      itemName: l.itemName.trim(),
      ...(l.unit ? { unit: l.unit } : {}),
      availableQty: parseFigure(l.qty) ?? 0,
      unitRate: parseFigure(l.rate) ?? 0,
      availability: 'substitute' as const,
      note: l.note.trim() || null,
    };
  });

  const delivery = parseFigure(state.deliveryCharge);
  if (delivery !== null && Number.isNaN(delivery)) errors['deliveryCharge'] = 'Enter a number, e.g. 300';

  const body = {
    items,
    deliveryCharge: delivery === null || Number.isNaN(delivery) ? 0 : delivery,
    estimatedDeliveryDate: state.estimatedDeliveryDate || null,
    deliveryNotes: state.deliveryNotes.trim() || null,
    notes: state.notes.trim() || null,
    ...(clientRequestId ? { clientRequestId } : {}),
  };

  // The shared schema has the rest: decimals, limits, lengths, the
  // availability rules. Its messages are written for this audience already.
  const parsed = QuotationInputSchema.safeParse(body);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = errorKeyFor(issue.path.join('.'), order);
      if (!errors[key]) errors[key] = issue.message;
    }
  }

  if (Object.keys(errors).length > 0 || !parsed.success) return { input: null, errors, order };
  return { input: parsed.data, errors, order };
}
