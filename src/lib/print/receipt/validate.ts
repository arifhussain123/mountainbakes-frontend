import type { ProductionOrderDoc, SaleReceiptDoc } from './types';

/**
 * Validation — run before a document is built, so an empty or self-contradicting
 * document never reaches the printer.
 *
 * Not a paranoia check. The printed total is what a customer is handed and what
 * a shift is reconciled against, so a receipt that disagreed with the record by
 * a rupee would be an unfalsifiable dispute every time. The arithmetic is
 * asserted rather than *performed*: the total is printed exactly as stored, and
 * this only refuses to print when the stored parts cannot produce it — which
 * means the caller assembled the document wrongly, not that the sale is wrong.
 *
 * A one-rupee tolerance, because the app's own totals are rounded for display in
 * several places and an exact comparison would reject sales that are correct.
 */

export class InvalidDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDocumentError';
  }
}

export function validateSaleDoc(doc: SaleReceiptDoc): void {
  if (!doc.items || doc.items.length === 0) {
    throw new InvalidDocumentError('This sale has no items to print.');
  }
  if (!doc.saleId?.trim()) {
    throw new InvalidDocumentError('This sale has no reference number yet.');
  }
  if (!doc.paymentMethodLabel?.trim()) {
    // The payment method is not decoration on this receipt — it is how the shift
    // is reconciled — so an absent one is a refusal rather than a blank line.
    throw new InvalidDocumentError('This sale has no payment method recorded.');
  }
  const expected = doc.grossTotal - doc.discountTotal + doc.taxAmount;
  if (Math.abs(expected - doc.grandTotal) > 1) {
    throw new InvalidDocumentError(
      `The sale totals do not reconcile (gross ${doc.grossTotal} - discount ${doc.discountTotal} + tax ${doc.taxAmount} ≠ total ${doc.grandTotal}).`,
    );
  }
}

/**
 * The demand must add up too, and the total that prints is the one passed in.
 *
 * `grandTotal` is whatever the caller was already showing on screen — the same
 * figure the review table carries — rather than a sum recomputed here. Re-adding
 * the lines at print time is how a printed slip comes to disagree with the screen
 * it was printed from; this checks the two agree and prints the one the rest of
 * the app is using.
 *
 * The gate every destination passes before paper moves:
 *
 *   validatePrintData()
 *         ↓
 *   Has products or packing materials going out?
 *         ↓
 *   YES → build → print → cut        NO → stop; nothing is fed, nothing is cut
 *
 * A packing-only demand (shoppers and boxes, no cake) is a real order and goes
 * through with a total of zero. An order with nothing going out at all — every
 * line cut to zero, or no lines — does not.
 */
export function validatePrintData(doc: ProductionOrderDoc): void {
  if (!doc.orderNumber?.trim()) {
    throw new InvalidDocumentError('This order has no reference number to print.');
  }
  const items = doc.items ?? [];
  const packing = doc.packingItems ?? [];

  const shipping = items.filter((i) => i.changedQty > 0);
  const packingShipping = packing.filter((p) => p.changedQty > 0);
  if (shipping.length === 0 && packingShipping.length === 0) {
    throw new InvalidDocumentError('This order has no approved products or packing materials to print.');
  }

  // Product lines: no line without a quantity behind it, and every amount is
  // the line's own quantity at its own rate. Checked, not recomputed — a slip
  // whose amount column differs from qty × rate is a slip assembled wrongly.
  for (const line of items) {
    const demand = line.demandQty ?? 0;
    if (demand <= 0 && line.changedQty <= 0) {
      throw new InvalidDocumentError(`"${line.productName}" has no quantity and should not be on the print.`);
    }
    if (Math.abs(line.changedQty * line.unitPrice - line.amount) > 1) {
      throw new InvalidDocumentError(
        `"${line.productName}" amount ${line.amount} is not ${line.changedQty} × ${line.unitPrice}.`,
      );
    }
  }
  const summed = items.reduce((total, line) => total + line.amount, 0);
  if (Math.abs(summed - doc.grandTotal) > 1) {
    throw new InvalidDocumentError(
      `The order lines do not add up to the total (${summed} ≠ ${doc.grandTotal}).`,
    );
  }

  // Packing lines: only what was requested, once each, at the exact quantity.
  // A zero row would print a material nobody asked for; a duplicate would print
  // one request twice. Both are the caller's mistake and both stop the print.
  const seen = new Set<string>();
  for (const line of packing) {
    if (!line.materialName?.trim()) {
      throw new InvalidDocumentError('A packing material on this order has no name.');
    }
    if (!(line.demandQty > 0)) {
      throw new InvalidDocumentError(`"${line.materialName}" was not requested and should not be on the print.`);
    }
    if (!(line.changedQty >= 0)) {
      throw new InvalidDocumentError(`"${line.materialName}" has an invalid approved quantity.`);
    }
    const key = line.packingMaterialId || line.materialName.trim().toLowerCase();
    if (seen.has(key)) {
      throw new InvalidDocumentError(`"${line.materialName}" appears twice on this order.`);
    }
    seen.add(key);
  }
}

/** @deprecated Use {@link validatePrintData}. Kept so older imports keep compiling. */
export const validateProductionDoc = validatePrintData;
