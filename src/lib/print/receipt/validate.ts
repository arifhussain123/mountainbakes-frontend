import type { BranchClosingDoc, DemandSummaryDoc, ProductionOrderDoc, SaleReceiptDoc } from './types';

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
  const packing = doc.packingItems ?? [];
  // Has products or packing materials? A demand of shoppers and boxes alone is
  // a real order; one with nothing going out is not, and no paper moves for it.
  if (lines.length === 0 && packing.length === 0) {
    throw new InvalidDocumentError('This order has no approved items or packing materials to print.');
  }
  const summed = lines.reduce((total, line) => total + line.amount, 0);
  if (Math.abs(summed - doc.grandTotal) > 1) {
    throw new InvalidDocumentError(
      `The order lines do not add up to the total (${summed} ≠ ${doc.grandTotal}).`,
    );
  }
  // Packing rows: only what was requested, once each. A zero row would print a
  // material nobody is sending; a duplicate would print one request twice.
  const seen = new Set<string>();
  for (const line of packing) {
    const name = line.materialName?.trim();
    if (!name) throw new InvalidDocumentError('A packing material on this order has no name.');
    if (!(line.qty > 0)) {
      throw new InvalidDocumentError(`"${name}" has no quantity and should not be on the print.`);
    }
    const key = name.toLowerCase();
    if (seen.has(key)) throw new InvalidDocumentError(`"${name}" appears twice on this order.`);
    seen.add(key);
  }
}

/**
 * There has to be something waiting to print, and the branch total has to
 * agree with the grand total — the same "assert, don't recompute" rule as
 * {@link validateProductionDoc}, applied to the branch-wise pivot instead of a
 * single order's lines.
 */
export function validateDemandSummaryDoc(doc: DemandSummaryDoc): void {
  if (doc.items.length === 0 && doc.packingItems.length === 0) {
    throw new InvalidDocumentError('There are no waiting demands to print.');
  }
  if (doc.totals.grandAmount !== null) {
    const known = doc.branchItems.filter((b) => b.amount !== null);
    if (known.length !== doc.branchItems.length) {
      throw new InvalidDocumentError('The grand amount is stated but a branch amount is unavailable.');
    }
    const summed = known.reduce((total, b) => total + (b.amount ?? 0), 0);
    if (Math.abs(summed - doc.totals.grandAmount) > 1) {
      throw new InvalidDocumentError(
        `The branch amounts do not add up to the grand total (${summed} ≠ ${doc.totals.grandAmount}).`,
      );
    }
  }
}

/**
 * The branch and date identify whose drawer this is, and the payment-method
 * lines have to add up to the same total sales the screen states — the same
 * "assert, don't recompute" rule as the other documents in this file, applied
 * to `computeClosingTotals.sales` instead of an order's own total.
 *
 * An empty `stockLines` is NOT refused here: a branch that sold out of
 * everything legitimately prints "No balance stock" rather than being told it
 * has nothing to hand over.
 */
export function validateBranchClosingDoc(doc: BranchClosingDoc): void {
  if (!doc.branchName?.trim()) {
    throw new InvalidDocumentError('This closing sheet has no branch to print.');
  }
  if (!doc.businessDateText?.trim()) {
    throw new InvalidDocumentError('This closing sheet has no business date to print.');
  }
  const summed = doc.paymentLines.reduce((total, line) => total + line.amount, 0);
  if (Math.abs(summed - doc.totalSales) > 1) {
    throw new InvalidDocumentError(
      `The payment method totals do not add up to total sales (${summed} ≠ ${doc.totalSales}).`,
    );
  }
}
