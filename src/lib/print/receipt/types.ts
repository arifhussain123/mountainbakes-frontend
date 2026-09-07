/**
 * The two documents this shop prints on a thermal roll, as inputs.
 *
 * A caller builds a `SaleReceiptDoc` from an `Order`, or a `ProductionOrderDoc`
 * from a production order, and hands it over. That indirection is what keeps a
 * printer concern out of the sales page and a sales concern out of the printer:
 * the builders in this folder never learn what a production sale is or which
 * endpoint an order came from, and the pages never learn what a page box is.
 *
 * Every figure here is the STORED figure. Nothing in this folder recomputes a
 * total — `validate.ts` checks the parts agree with the total and the document
 * prints the total it was given, so the receipt in a customer's hand is the one
 * the ledger has.
 */

/** Roll widths the shop uses. Chosen once per device — see `receiptPaper.ts`. */
export type PaperWidth = '58mm' | '80mm';

export interface ReceiptLine {
  productName: string;
  qty: number;
  unitPrice: number;
  /** What this line actually billed, net of any line discount. From the stored sale. */
  lineTotal: number;
}

export interface SaleReceiptDoc {
  /** The human sale reference, e.g. `MB-000786`. */
  saleId: string;
  /** Already formatted by the caller's own date helpers. */
  dateText: string;
  timeText: string;
  customerName?: string | null;
  customerPhone?: string | null;
  branchName?: string | null;
  companyName?: string | null;
  currencySymbol: string;
  items: ReceiptLine[];
  /** Σ qty × rate, before any discount. */
  grossTotal: number;
  discountTotal: number;
  taxAmount: number;
  /** What was charged. The stored figure, never recomputed here. */
  grandTotal: number;
  /** Already humanised by the caller — `Cash`, `Easypaisa`, `Bank Account`. */
  paymentMethodLabel: string;
  receivedCash?: number | null;
  cashReturned?: number | null;
  /** An inlined `data:` URL for the logo, when one is already in hand. Never fetched here. */
  logo?: string | null;
}

export interface ProductionOrderLine {
  productName: string;
  /** The APPROVED quantity — what actually ships. */
  qty: number;
  unitPrice: number;
  amount: number;
}

/**
 * What the rider collects against the PREVIOUS delivery, as the slip states it.
 *
 * Every figure is server-computed (`company_share_pct` lives in finance_settings,
 * which production users cannot read) and is printed exactly as supplied. Nothing
 * here re-derives them: a slip that recomputed the collection would be the one
 * document in the building disagreeing with the ledger.
 */
export interface PreviousCollection {
  /** The previous demand's number, and when it was raised. */
  reference: string;
  dateText: string;
  /** What the previous demand ASKED for. Context only — nothing bills against it. */
  orderedValue: number;
  /** What that delivery was worth — the base the share is taken from. */
  deliveredValue: number;
  /** The company's share of that delivery — the VALUE, never the percentage. */
  companyShare: number;
  /** Accepted returns from that delivery, already netted server-side. */
  returnsAmount: number;
  /** Claims against that delivery. An amount, never a quantity. */
  discountsAmount: number;
  /** What the rider actually collects. The server's figure, printed as given. */
  amountToCollect: number;
}

export interface ProductionOrderDoc {
  orderNumber: string;
  dateText: string;
  timeText: string;
  /** `'—'` where the demand predates the required-date field. Never faked from `date`. */
  requiredDateText: string;
  branchName: string;
  companyName?: string | null;
  currencySymbol: string;
  items: ProductionOrderLine[];
  grandTotal: number;
  /**
   * The previous delivery's collection, or `null` where there was no previous
   * delivery for this branch.
   *
   * `null` prints the same sentence the screen shows rather than a row of zeros.
   * Omitted entirely (rather than `null`) by a caller that has not loaded the
   * figures — the block is then left off the slip, which is honest, where
   * printing zeros would not be.
   */
  previousCollection?: PreviousCollection | null;
  /** An inlined `data:` URL for the logo, when one is already in hand. Never fetched here. */
  logo?: string | null;
}
