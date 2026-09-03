import type { Block } from './escpos';
// Blocks are the output now — 'renderBlocks' moved to 'printerService' with the job.
import type { PrinterProfile } from './profiles';
import { DEFAULT_PROFILE } from './profiles';
import { amountRow, columnLayout, pairRow, tableHeader, tableRow, type TableCells } from './table';

/**
 * The two documents this shop prints on a thermal roll, and the test page.
 *
 * ---------------------------------------------------------------------------
 * A separate layout from the on-screen one, on purpose
 * ---------------------------------------------------------------------------
 * `InvoiceView` and `OrderPrintPreview` already render a sale and a demand as
 * React. Neither can be reused here and the reason is not laziness: those are
 * components with a type scale, colour and a flex layout, and none of that is
 * text a printer can be sent. What the three renderings share is their
 * **figures** — every one of them is handed the same stored amounts — rather
 * than their formatting, and the figures are where a disagreement would actually
 * cost something.
 *
 * ---------------------------------------------------------------------------
 * The document types are inputs, not the app's models
 * ---------------------------------------------------------------------------
 * A caller builds a `SaleReceiptDoc` from an `Order` and hands it over. That
 * indirection is what keeps a printer concern out of the sales page and a sales
 * concern out of the printer: this module never learns what a production sale is
 * or which endpoint an order came from, and the pages never learn what a column
 * is. It is also where validation gets a place to stand — see `validateSaleDoc`.
 */

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
  /** ISO timestamp of the sale, formatted by the caller's own date helpers. */
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
 * Deliberately not called a "previous balance". The carry-forward balance this
 * document used to carry was removed server-side (migration 74) and Production
 * no longer sees a Prev. Balance / Total Demand pair at all; what remains — and
 * what the A4 challan prints — is money owed for the last delivery, which is the
 * opposite direction from `production_balances` (goods owed TO the branch).
 * Printing the one under the other's name is how a counter dispute starts.
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
  /** The branch's share of that delivery — what is owed before deductions. */
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
   * `null` prints the same sentence the screen shows rather than a row of zeros:
   * "nothing to collect" and "collect nothing because every figure happens to be
   * zero" read identically as numbers and mean different things.
   *
   * Omitted entirely (rather than `null`) by a caller that has not loaded the
   * figures — the block is then left off the slip, which is honest, where
   * printing zeros would not be.
   */
  previousCollection?: PreviousCollection | null;
}

const BRAND = 'MOUNTAIN BAKES';

/** `1,234` — thousands-separated, no symbol. The table's numeric columns are bare by design. */
function num(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

/** `Rs. 1,234` — symbol and a space, as the totals block reads. */
function money(value: number, symbol: string): string {
  const trimmed = symbol.trim();
  return `${trimmed} ${num(value)}`;
}

/* ────────────────────────────────────────────────────────────────────────────
   Validation — run before a byte is built
   ──────────────────────────────────────────────────────────────────────────── */

export class InvalidDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidDocumentError';
  }
}

/**
 * The receipt must add up to the sale that was saved.
 *
 * Not a paranoia check. The printed total is what a customer is handed and what
 * a shift is reconciled against, so a receipt that disagreed with the record by a
 * rupee would be an unfalsifiable dispute every time. The arithmetic is asserted
 * rather than *performed*: `grandTotal` is printed exactly as stored, and this
 * only refuses to print when the stored parts cannot produce it — which means the
 * caller assembled the document wrongly, not that the sale is wrong.
 *
 * A one-rupee tolerance, because the app's own totals are rounded for display in
 * several places and an exact comparison would reject sales that are perfectly
 * correct.
 */
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
 * figure the slip and the review table carry — rather than a sum recomputed here.
 * Re-adding the lines at print time is how a printed challan comes to disagree
 * with the screen it was printed from; this checks the two agree and prints the
 * one the rest of the app is using.
 */
export function validateProductionDoc(doc: ProductionOrderDoc): void {
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

/* ────────────────────────────────────────────────────────────────────────────
   Sale receipt
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * The sale slip for an 80mm roll.
 *
 * **No marketing footer, and that is a requirement rather than an omission.**
 * `settings.receiptFooter` ("Thank you for choosing Mountain Bakes… Phone: …") is
 * read by `InvoiceView` for the A4/PDF copy and is deliberately NOT read here:
 * the POS receipt ends at the payment method and the cut. Do not add it back
 * because the on-screen invoice has it — the two documents are asked for
 * different things, and this one is a till record.
 */
export function saleReceiptBlocks(doc: SaleReceiptDoc, profile: PrinterProfile = DEFAULT_PROFILE): Block[] {
  const columns = profile.charactersPerLine;
  const symbol = doc.currencySymbol || 'Rs.';
  // Cells before layout: the column widths are measured from these very strings,
  // which is what stops a five-figure rate fusing to the quantity beside it.
  const cells: TableCells[] = doc.items.map((line) => ({
    productName: line.productName,
    qty: num(line.qty),
    rate: num(line.unitPrice),
    amount: num(line.lineTotal),
  }));
  const layout = columnLayout(columns, cells);
  const blocks: Block[] = [];

  // ---- Head ---------------------------------------------------------------
  blocks.push({
    kind: 'text',
    text: (doc.companyName?.trim() || BRAND).toUpperCase(),
    align: 'center',
    style: { bold: true, doubleHeight: true },
  });
  blocks.push({ kind: 'text', text: 'SALE RECEIPT', align: 'center', style: { bold: true } });
  if (doc.branchName?.trim()) {
    blocks.push({ kind: 'text', text: doc.branchName.trim(), align: 'center' });
  }
  blocks.push({ kind: 'rule' });

  // ---- What this sale is, compactly --------------------------------------
  // Date and time share a line; the sale reference gets its own because it is
  // the field anyone reads the receipt to find.
  blocks.push(...pairRow(`Date: ${doc.dateText}`, `Time: ${doc.timeText}`, columns));
  blocks.push({ kind: 'text', text: `Sale ID: ${doc.saleId}` });
  if (doc.customerName?.trim()) {
    blocks.push({ kind: 'text', text: `Customer: ${doc.customerName.trim()}` });
  }
  if (doc.customerPhone?.trim()) {
    blocks.push({ kind: 'text', text: `Mobile: ${doc.customerPhone.trim()}` });
  }

  // ---- The basket ---------------------------------------------------------
  blocks.push({ kind: 'rule' });
  blocks.push(tableHeader(layout));
  blocks.push({ kind: 'rule' });
  for (const cell of cells) blocks.push(...tableRow(cell, layout));
  blocks.push({ kind: 'rule' });

  // ---- Money --------------------------------------------------------------
  blocks.push(amountRow('GROSS TOTAL', money(doc.grossTotal, symbol), columns));
  blocks.push(amountRow('DISCOUNT', money(doc.discountTotal, symbol), columns));
  if (doc.taxAmount > 0) {
    blocks.push(amountRow('GOVERNMENT TAX', money(doc.taxAmount, symbol), columns));
  }

  /*
   * The total is double HEIGHT and not double width. Double width halves the
   * line to 24 characters, and "TOTAL" plus a five-figure amount with a symbol
   * does not fit in 24 — it would wrap, putting the total on its own line under
   * its label. Height alone gives the emphasis and keeps the column maths at 48.
   */
  blocks.push({
    ...amountRow('TOTAL', money(doc.grandTotal, symbol), columns),
    style: { bold: true, doubleHeight: true },
  });

  if (doc.receivedCash != null) {
    blocks.push(amountRow('Cash received', money(doc.receivedCash, symbol), columns));
    blocks.push(amountRow('Cash returned', money(doc.cashReturned ?? 0, symbol), columns));
  }

  // ---- How it was paid ----------------------------------------------------
  blocks.push({ kind: 'rule' });
  blocks.push({
    kind: 'text',
    text: `PAYMENT METHOD: ${doc.paymentMethodLabel.toUpperCase()}`,
    style: { bold: true },
  });

  return blocks;
}

/* ────────────────────────────────────────────────────────────────────────────
   Production order
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * The production demand for an 80mm roll.
 *
 * The header is a compact block, not four stacked sections: date beside time,
 * order number beside required date. On a roll every line costs paper and every
 * section costs a glance, and the four facts are read together — "what is this,
 * when was it raised, when is it due".
 *
 * Only what the floor needs to make and send the order, plus what the rider
 * needs to settle the last one. No status badge and no approval trail — those
 * live on the A4 challan, which still prints through the browser path and is a
 * different document for a different reader.
 *
 * The previous-delivery collection and the signature lines are on both, and
 * deliberately so: the roll is what physically travels with the delivery, and a
 * collection the rider cannot read at the counter is a collection that gets
 * argued about later. The figures come from the server on both documents (see
 * `PreviousCollection`), so the two cannot disagree.
 */
export function productionOrderBlocks(
  doc: ProductionOrderDoc,
  profile: PrinterProfile = DEFAULT_PROFILE,
): Block[] {
  const columns = profile.charactersPerLine;
  const symbol = doc.currencySymbol || 'Rs.';
  // A line approved at zero is not going out, so it is not on the sheet the floor
  // packs from — the same rule the A4 slip has always applied. Filtered before the
  // layout is measured, so a dropped line cannot widen a column for nothing.
  const cells: TableCells[] = doc.items
    .filter((line) => line.qty > 0)
    .map((line) => ({
      productName: line.productName,
      qty: num(line.qty),
      rate: num(line.unitPrice),
      amount: num(line.amount),
    }));
  const layout = columnLayout(columns, cells);
  const blocks: Block[] = [];

  blocks.push({
    kind: 'text',
    text: (doc.companyName?.trim() || BRAND).toUpperCase(),
    align: 'center',
    style: { bold: true, doubleHeight: true },
  });
  blocks.push({ kind: 'text', text: 'PRODUCTION DEPARTMENT', align: 'center', style: { bold: true } });
  blocks.push({ kind: 'rule' });

  blocks.push(...pairRow(`Date: ${doc.dateText}`, `Time: ${doc.timeText}`, columns));
  blocks.push(...pairRow(`Order No: ${doc.orderNumber}`, `Required: ${doc.requiredDateText}`, columns));
  blocks.push({ kind: 'text', text: `Branch: ${doc.branchName}` });

  blocks.push({ kind: 'rule' });
  blocks.push(tableHeader(layout));
  blocks.push({ kind: 'rule' });

  for (const cell of cells) blocks.push(...tableRow(cell, layout));

  blocks.push({ kind: 'rule' });
  blocks.push({
    ...amountRow('G. TOTAL', money(doc.grandTotal, symbol), columns),
    style: { bold: true, doubleHeight: true },
  });
  blocks.push({ kind: 'rule' });

  // ---- What the rider collects for the last delivery ----------------------
  // Only when the caller supplied the figures. `undefined` means "not loaded",
  // which is a different thing from `null` ("loaded, and there was no previous
  // delivery") — the first leaves the block off, the second says so on paper.
  if (doc.previousCollection !== undefined) {
    blocks.push(...previousCollectionBlocks(doc.previousCollection, symbol, columns));
  }

  // ---- Who handed it over and who took it --------------------------------
  blocks.push(...signatureBlocks(columns));

  blocks.push({ kind: 'rule' });
  blocks.push({
    kind: 'text',
    text: (doc.companyName?.trim() || BRAND).toUpperCase(),
    align: 'center',
    style: { bold: true },
  });

  return blocks;
}

/**
 * The previous delivery's collection working, as the A4 challan states it.
 *
 * Same four figures in the same order, so a rider holding the roll and the sheet
 * is reading one document twice rather than reconciling two. The deductions are
 * labelled "Less" because a bare `Returns  Rs 500` under a share of `Rs 8,000`
 * reads as an addition often enough to matter when it is being totalled by hand
 * at a counter.
 *
 * The deduction lines are printed only when they are non-zero. A row of zeros is
 * three lines of roll saying nothing happened, and it makes the one delivery that
 * *did* have a claim against it harder to spot in a stack.
 */
function previousCollectionBlocks(
  collection: PreviousCollection | null,
  symbol: string,
  columns: number,
): Block[] {
  if (!collection) {
    return [
      { kind: 'text', text: 'PREVIOUS ORDER', style: { bold: true } },
      { kind: 'text', text: 'No previous delivery - nothing to collect.' },
      { kind: 'rule' },
    ];
  }

  const blocks: Block[] = [
    { kind: 'text', text: 'PREVIOUS ORDER', style: { bold: true } },
    ...pairRow(`No: ${collection.reference}`, `Date: ${collection.dateText}`, columns),
    amountRow('Company Share', money(collection.companyShare, symbol), columns),
  ];
  if (collection.returnsAmount > 0) {
    blocks.push(amountRow('Less Returns', money(collection.returnsAmount, symbol), columns));
  }
  if (collection.discountsAmount > 0) {
    blocks.push(amountRow('Less Claims', money(collection.discountsAmount, symbol), columns));
  }
  blocks.push({
    ...amountRow('TO COLLECT', money(collection.amountToCollect, symbol), columns),
    style: { bold: true },
  });
  blocks.push({ kind: 'rule' });
  return blocks;
}

/**
 * The two signature lines.
 *
 * Ruled to the edge of the roll rather than to a fixed width, because a 58mm
 * slip and an 80mm one otherwise get the same short rule with very different
 * amounts of blank paper after it. A minimum of four underscores keeps the line
 * recognisable as somewhere to sign even on the narrowest roll, where the label
 * has eaten most of the width.
 *
 * A blank line between them, and nothing after: the cut is the end of the
 * document, and feed past it is the printer's business (`escpos.cut`), not this
 * layout's. Padding the bottom here is what produces the trailing blank paper
 * these receipts were criticised for.
 */
function signatureBlocks(columns: number): Block[] {
  const line = (label: string) => {
    const rule = '_'.repeat(Math.max(4, columns - label.length));
    return { kind: 'text', text: `${label}${rule}` } as Block;
  };
  return [line('Collected By: '), { kind: 'feed', lines: 1 }, line('Received By:  ')];
}

/* ────────────────────────────────────────────────────────────────────────────
   Test page
   ──────────────────────────────────────────────────────────────────────────── */

export interface TestPageDoc {
  printerName: string;
  connectionLabel: string;
  companyName?: string | null;
}

/**
 * The test page, which exists to answer three questions at once.
 *
 * Is the link up, is the paper the width the profile thinks it is, and does this
 * printer render what the app sends. The ruler line is the second of those and it
 * is the one worth having: 48 characters that end exactly at the edge of the roll
 * prove the column count, and 48 that wrap prove it wrong — which is otherwise
 * only discovered when a customer's total ends up on its own line.
 *
 * It also states the transliteration limit plainly rather than leaving someone to
 * find it on a real receipt. See `escpos.encode`.
 */
export function testPageBlocks(doc: TestPageDoc, profile: PrinterProfile = DEFAULT_PROFILE): Block[] {
  const columns = profile.charactersPerLine;
  const sampleRows: TableCells[] = [
    { productName: 'Chocolate Truffle Celebration Cake', qty: '2', rate: '1,250', amount: '2,500' },
    { productName: 'Cream Puff', qty: '20', rate: '50', amount: '1,000' },
  ];
  const layout = columnLayout(columns, sampleRows);
  return [
    {
      kind: 'text',
      text: (doc.companyName?.trim() || BRAND).toUpperCase(),
      align: 'center',
      style: { bold: true, doubleHeight: true },
    },
    { kind: 'text', text: 'TEST PRINT', align: 'center', style: { bold: true } },
    { kind: 'rule' },
    amountRow('Printer', doc.printerName, columns),
    amountRow('Connection', doc.connectionLabel, columns),
    amountRow('Paper', `${profile.paperWidthMm}mm`, columns),
    amountRow('Line width', `${columns} characters`, columns),
    { kind: 'rule' },
    { kind: 'text', text: ruler(columns) },
    { kind: 'text', text: 'The line above must end at the edge of the roll.' },
    { kind: 'rule' },
    tableHeader(layout),
    ...sampleRows.flatMap((row) => tableRow(row, layout)),
    { kind: 'rule' },
    { kind: 'text', text: 'Normal' },
    { kind: 'text', text: 'Bold', style: { bold: true } },
    { kind: 'text', text: 'Tall', style: { doubleHeight: true } },
    { kind: 'text', text: 'Wide', style: { doubleWidth: true } },
    { kind: 'rule' },
    { kind: 'text', text: 'Latin text only. Urdu and other non-Latin names print as question marks.' },
    { kind: 'rule' },
    { kind: 'text', text: 'Printer connection successful.', align: 'center', style: { bold: true } },
  ];
}

/**
 * `....5...10...15...` up to the column count, ending on the exact character.
 *
 * A row of identical dashes would prove the width just as well but would say
 * nothing about *where* a wrap happened when it is wrong. This one is readable as
 * a measurement.
 */
function ruler(columns: number): string {
  let out = '';
  while (out.length < columns) {
    const marker = String(out.length + 5);
    out += `${'.'.repeat(Math.max(0, 5 - marker.length))}${marker}`;
  }
  return out.slice(0, columns);
}

/* ────────────────────────────────────────────────────────────────────────────
   Bytes — composed one layer up now
   ──────────────────────────────────────────────────────────────────────────── */

/*
 * `saleReceiptBytes` and its two siblings used to live here, each wrapping its
 * `*Blocks` function in `toBytes(renderBlocks(…))`. They are gone because bytes
 * are no longer the only form a transport takes: the installed-printer route is
 * handed a page to render and needs the blocks themselves, so `printerService`
 * composes both from one list of blocks and passes them together as a `PrintJob`.
 *
 * Keeping the shortcuts would have left two places that turn a document into
 * bytes, and the day one of them gained a step the other would not have it.
 */
