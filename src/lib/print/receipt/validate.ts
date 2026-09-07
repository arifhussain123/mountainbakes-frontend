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
 */
export function validateProductionDoc(doc: ProductionOrderDoc): void {
  if (!doc.orderNumber?.trim()) {
    throw new InvalidDocumentError('This order has no reference number to print.');
  }
  const lines = doc.items.filter((i) => i.qty > 0);
  if (lines.length === 0) {
    throw new InvalidDocumentError('This order has no approved items to print.');
  }
  const summed = lines.reduce((total, line) => total + line.amount, 0);
  if (Math.abs(summed - doc.grandTotal) > 1) {
    throw new InvalidDocumentError(
      `The order lines do not add up to the total (${summed} ≠ ${doc.grandTotal}).`,
    );
  }
}
