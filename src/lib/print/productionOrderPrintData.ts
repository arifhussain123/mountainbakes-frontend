import {
  rateOf,
  type BranchProductionOrder,
  type BranchProductionOrderItem,
  type BranchProductionOrderPackingItem,
} from '@mb/shared';
import type { PreviousOrderBalance } from '@/lib/queries';
import type {
  PreviousCollection,
  ProductionOrderDoc,
  ProductionOrderLine,
  ProductionOrderPackingLine,
} from './receipt/types';
import { validatePrintData } from './receipt/validate';

/**
 * The one place a production order becomes print data.
 *
 *   order (as stored) → getPrintData() → validatePrintData() → ProductionOrderDoc
 *                                                                  ├── roll receipt (POP Print)
 *                                                                  ├── A4 challan (PDF / sheet)
 *                                                                  └── on-screen review
 *
 * Every destination reads the SAME document. The quantities on it are resolved
 * here, once, from the order's stored lines — the branch's demand, Production's
 * changed quantity, the snapshotted rate — and nothing downstream is allowed to
 * work them out again. That is what makes "the screen said 12, the paper said
 * 10" impossible to reintroduce by editing one destination and not the others.
 *
 * ---------------------------------------------------------------------------
 * What the caller must hand over
 * ---------------------------------------------------------------------------
 * The ORDER AS THE SERVER HAS IT — fetched, not remembered. A review dialog
 * that has been open for ten minutes is showing what it was given ten minutes
 * ago; the button that prints refetches the order first and passes that in
 * (`OrderPrintPreview`). The one piece of screen state that IS input is the
 * quantities Production is typing into a still-'pending' order: those are the
 * changed quantities it is about to submit, so they are what a slip printed
 * before submission should say. They are ignored the moment the order is no
 * longer pending — a frozen order prints its stored figures and nothing else.
 */

/** Quantities Production has typed into a pending order's review table, by id. */
export interface PrintQuantityEdits {
  products?: Readonly<Record<string, number | undefined>>;
  packing?: Readonly<Record<string, number | undefined>>;
}

export interface PrintDataInput {
  order: BranchProductionOrder;
  /** Applied only while `order.status === 'pending'`; see the header. */
  edits?: PrintQuantityEdits;
  /**
   * FALLBACK rates only, for lines raised before the rate was snapshotted onto
   * the line (§18) and lines Production added at review. A line WITH a snapshot
   * always bills at its snapshot, never at today's price.
   */
  livePriceById?: ReadonlyMap<string, number>;
  /** The branch's display name, when the caller has a fresher one than the order's snapshot. */
  branchName?: string | null;
  companyName?: string | null;
  currencySymbol?: string | null;
  /** An inlined `data:` URL, or nothing. Never a URL to fetch. */
  logo?: string | null;
  /**
   * The server's previous-delivery figures. `undefined` = not loaded yet, and
   * the block is left OFF the document; `null` = loaded, and there was no
   * previous delivery.
   */
  previousBalance?: PreviousOrderBalance | null;
  /** When the document is being produced. Defaults to now. */
  printedAt?: Date;
}

/**
 * Past Production's review: the stored `approvedQty` is the figure, and
 * on-screen edits no longer apply.
 */
export function isFrozenOrder(order: Pick<BranchProductionOrder, 'status'>): boolean {
  return order.status === 'awaiting_verification' || order.status === 'verified' || order.status === 'approved';
}

/** Human reference for the slip header, for demands predating `demandNumber`. */
export function slipReference(order: Pick<BranchProductionOrder, 'date' | 'time'>): string {
  return `PO-${(order.date || '').replace(/-/g, '')}-${(order.time || '').replace(':', '')}`;
}

/** The number a demand is known by everywhere it is printed. */
export function orderReference(order: Pick<BranchProductionOrder, 'demandNumber' | 'date' | 'time'>): string {
  return order.demandNumber || slipReference(order);
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  awaiting_verification: 'Awaiting Verification',
  verified: 'Verified — Awaiting Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/**
 * `YYYY-MM-DD` as `DD/MM/YYYY`. String work, not Date work — these are already
 * Karachi dates, and parsing them into a Date would reintroduce the timezone
 * shift they were stored to avoid. Anything else is returned as given.
 */
export function compactDate(iso: string | null | undefined): string {
  const [y, m, d] = (iso || '').split('-');
  return y && m && d ? `${d}/${m}/${y}` : iso || '—';
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** `DD/MM/YYYY` of a Date, in the device's own zone — it is stamping "now". */
export function compactDateOf(date: Date): string {
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** `hh:mm AM` of a Date. */
export function clockTimeOf(date: Date): string {
  const h = date.getHours();
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${pad2(twelve)}:${pad2(date.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`;
}

interface LineContext {
  frozen: boolean;
  edits?: PrintQuantityEdits;
  livePriceById?: ReadonlyMap<string, number>;
}

/**
 * One product line, resolved.
 *
 *   demandQty   what the BRANCH asked for — `null` on a line Production added
 *               or the branch found in the delivery (migration 83), because
 *               nobody demanded it and a 0 would read as a cut line.
 *   changedQty  what ships: the stored approval once frozen; before that, the
 *               quantity being typed, else the demand itself.
 *   amount      changedQty × the line's own rate — the snapshot first, the live
 *               price only where there is no snapshot, and 0 where neither
 *               exists rather than a guess.
 *
 * A pre-migration-74 order may have an approval above its demand, because it
 * was approved against a carry-forward that no longer exists. Printing the
 * stored figure is the truth about that delivery; recomputing it would not be.
 */
export function resolveProductLine(it: BranchProductionOrderItem, ctx: LineContext): ProductionOrderLine {
  const isAdded = it.addedByProduction === true;
  const demand = Number(it.qty) || 0;
  const edited = ctx.edits?.products?.[it.productId];
  const changedQty = ctx.frozen
    ? Number(it.approvedQty ?? demand) || 0
    : edited !== undefined
      ? Number(edited) || 0
      : demand;
  // `rateOf` returns null for a MISSING snapshot, so `??` falls through on
  // absence but not on a genuine zero: a line priced at 0 stays at 0.
  const unitPrice = rateOf(it) ?? ctx.livePriceById?.get(it.productId) ?? 0;
  return {
    productId: it.productId,
    productName: it.productName,
    demandQty: isAdded ? null : demand,
    changedQty,
    unitPrice,
    amount: changedQty * unitPrice,
    isSpecial: it.isSpecial === true,
    description: it.isSpecial ? (it.description ?? it.remarks ?? null) : null,
    isAdded,
  };
}

/** Packing equivalent — no rate, no amount, no carry-forward. */
export function resolvePackingLine(it: BranchProductionOrderPackingItem, ctx: LineContext): ProductionOrderPackingLine {
  const demandQty = Number(it.qty) || 0;
  const edited = ctx.edits?.packing?.[it.packingMaterialId];
  const changedQty = ctx.frozen
    ? Number(it.approvedQty ?? demandQty) || 0
    : edited !== undefined
      ? Number(edited) || 0
      : demandQty;
  return {
    packingMaterialId: it.packingMaterialId,
    materialName: it.materialName,
    demandQty,
    changedQty,
  };
}

/**
 * A line worth printing: something was demanded, or something is going out.
 * A line at zero on both counts — a demand cut to nothing that nobody asked
 * for — has nothing to say on paper.
 */
export function isPrintableLine(line: { demandQty: number | null; changedQty: number }): boolean {
  return (line.demandQty ?? 0) > 0 || line.changedQty > 0;
}

/**
 * The server's collection figures, passed through — never re-derived. The
 * itemised returns and discounts ride along for the Company Copy's tables.
 */
function previousCollectionOf(prevBal: PreviousOrderBalance | null | undefined): PreviousCollection | null | undefined {
  if (prevBal === undefined) return undefined;
  if (!prevBal?.previous) return null;
  return {
    reference: prevBal.previous.demandNumber,
    dateText: compactDate(prevBal.previous.date),
    orderedValue: prevBal.orderedValue ?? 0,
    deliveredValue: prevBal.deliveredValue ?? 0,
    companyShare: prevBal.companyShareValue ?? 0,
    returnsAmount: prevBal.returnsValue ?? 0,
    discountsAmount: prevBal.discountsValue ?? 0,
    amountToCollect: prevBal.amountToCollect ?? 0,
    returnItems: prevBal.returnItems ?? [],
    discountItems: prevBal.discountItems ?? [],
  };
}

/**
 * Build the canonical print document for an order, validated.
 *
 * Throws `InvalidDocumentError` (from `validatePrintData`) when the order has
 * nothing going out, a line that does not reconcile, or a packing line that
 * was never requested or appears twice — before any destination sees it.
 */
export function getPrintData(input: PrintDataInput): ProductionOrderDoc {
  const { order } = input;
  const ctx: LineContext = {
    frozen: isFrozenOrder(order),
    edits: order.status === 'pending' ? input.edits : undefined,
    livePriceById: input.livePriceById,
  };
  const items = (order.items ?? []).map((it) => resolveProductLine(it, ctx)).filter(isPrintableLine);
  // Only what the branch asked for. A packing line with no request behind it is
  // not a request, so it never reaches the document — regardless of what any
  // later edit did to its approved figure.
  const packingItems = (order.packingItems ?? [])
    .map((it) => resolvePackingLine(it, ctx))
    .filter((line) => line.demandQty > 0);
  const printedAt = input.printedAt ?? new Date();

  const doc: ProductionOrderDoc = {
    orderNumber: orderReference(order),
    refText: slipReference(order),
    dateText: compactDate(order.date),
    timeText: order.time || '—',
    requiredDateText: order.requiredDate ? compactDate(order.requiredDate) : '—',
    printDateText: compactDateOf(printedAt),
    printTimeText: clockTimeOf(printedAt),
    statusText: statusLabel(order.status),
    branchName: input.branchName?.trim() || order.branchName || '—',
    companyName: input.companyName ?? null,
    currencySymbol: input.currencySymbol?.trim() || 'Rs.',
    logo: input.logo ?? null,
    items,
    packingItems,
    grandTotal: items.reduce((sum, line) => sum + line.amount, 0),
    previousCollection: previousCollectionOf(input.previousBalance),
  };
  validatePrintData(doc);
  return doc;
}

export { validatePrintData };
