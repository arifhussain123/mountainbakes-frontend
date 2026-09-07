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
  /** The product behind the line. Carried so a review screen can key its inputs; never printed. */
  productId?: string;
  productName: string;
  /**
   * What the BRANCH asked for. `null` on a line Production added — nobody
   * demanded it, and a dash on paper says that where a 0 would read as a cut.
   */
  demandQty: number | null;
  /** The CHANGED (approved) quantity — what actually ships. Defaults to the demand until Production reviews. */
  changedQty: number;
  unitPrice: number;
  /** changedQty × unitPrice, as the screen shows it. Checked, never recomputed, at print time. */
  amount: number;
  /** A one-off made to the branch's description rather than picked off a shelf. */
  isSpecial?: boolean;
  /** What the branch wrote for a special item. Printed under the name where present. */
  description?: string | null;
  /** Added by Production, or found in the delivery at verification (migration 83). */
  isAdded?: boolean;
}

/**
 * One packing-material line — a shopper, a box, a packet of spoons.
 *
 * No price and no amount, and there never will be: packing materials are
 * company service items (see `packing-material.types.ts`) and never fold into
 * the order's money total. Present on the document ONLY when the branch asked
 * for it; a demand with no packing request has an empty array here and prints
 * no packing section at all.
 */
export interface ProductionOrderPackingLine {
  packingMaterialId: string;
  materialName: string;
  /** What the branch requested. Always > 0 — a zero request is not a request. */
  demandQty: number;
  /** What Production is sending. Defaults to the demand until reviewed. */
  changedQty: number;
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
  /**
   * The working behind `returnsAmount` and `discountsAmount`, itemised by the
   * server from the same rows it totalled. Optional: the roll prints the totals
   * only; the A4 Company Copy lists them.
   */
  returnItems?: { productName: string; qty: number; amount: number }[];
  discountItems?: { demandNumber: string; amount: number }[];
}

/**
 * The canonical print document for a production order, as data.
 *
 *   order → getPrintData() → validatePrintData() → THIS → PDF / POP / preview
 *
 * Built ONCE by `getPrintData` (`lib/print/productionOrderPrintData.ts`) from
 * the order as stored, and handed unchanged to every destination: the roll
 * receipt (`productionOrder.ts`), the A4 challan, and the on-screen review.
 * Nothing downstream recomputes a quantity or a total from it — a destination
 * that did would be the one place the paper could disagree with the screen.
 */
export interface ProductionOrderDoc {
  /** The demand number, `DMD-######` — the number the order is known by everywhere. */
  orderNumber: string;
  /** The date/time slip reference, `PO-YYYYMMDD-HHMM`, printed beside it for continuity. */
  refText?: string | null;
  /** The BUSINESS date — the day the demand was raised. Already formatted. */
  dateText: string;
  timeText: string;
  /** `'—'` where the demand predates the required-date field. Never faked from `date`. */
  requiredDateText: string;
  /** When this document was produced. Already formatted. */
  printDateText: string;
  printTimeText: string;
  /** Human status label — `Awaiting Verification`, `Approved`, … */
  statusText: string;
  branchName: string;
  companyName?: string | null;
  currencySymbol: string;
  /** Product lines worth printing: every line with a demand or a changed quantity. */
  items: ProductionOrderLine[];
  /**
   * Packing lines the branch requested. EMPTY when none were requested, and the
   * section is then left off the paper entirely — never an empty heading.
   */
  packingItems: ProductionOrderPackingLine[];
  /** Σ `items[].amount`, products only. Packing materials carry no value. */
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
