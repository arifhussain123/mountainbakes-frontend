import { escapeHtml, kv, logoHtml, money, num, rule, wrapDocument, type PrintDocument } from './document';
import { paperSpec } from './styles';
import type { PaperWidth, PreviousCollection, ProductionOrderDoc, ProductionOrderLine, ProductionOrderPackingLine } from './types';
import { validatePrintData } from './validate';

const BRAND = 'MOUNTAIN BAKES';

/**
 * The production demand as the canonical print document, on the roll.
 *
 * Top to bottom: company and department, the order's identifying facts (number,
 * branch, status, business date, required date, when it was printed), the
 * PRODUCTS as PRODUCT / DEMAND / CHANGED / AMOUNT with the rate under each name,
 * the total, the PACKING MATERIALS as PACKING MATERIAL / DEMAND / CHANGED —
 * only when the branch requested any — the previous order's collection working,
 * the payment lines the rider fills in, and the two signature lines.
 *
 * Every figure is `doc`'s figure. Nothing here decides a quantity: the lines
 * arrive already resolved by `getPrintData`, the same lines the screen and the
 * A4 challan show, and `validatePrintData` has already refused a document with
 * nothing going out. Every size and every face comes from `styles.ts`.
 */
export function buildProductionOrderDocument(doc: ProductionOrderDoc, paper: PaperWidth): PrintDocument {
  validatePrintData(doc);
  const spec = paperSpec(paper);
  const symbol = doc.currencySymbol?.trim() || 'Rs.';
  const company = (doc.companyName?.trim() || BRAND).toUpperCase();
  const lines = doc.items;
  const packing = doc.packingItems ?? [];
  const totalQty = lines.reduce((sum, line) => sum + line.changedQty, 0);
  const total = money(doc.grandTotal, symbol);

  const body = `
<div class="c">
  ${logoHtml(doc.logo)}
  <div class="company">${escapeHtml(company)}</div>
  <div class="dept">Production Department</div>
  <div class="doc-title">Production Order</div>
</div>
${rule()}
<div class="meta">
  ${kv('Order No', doc.orderNumber, 'full')}
  ${doc.refText?.trim() ? kv('Ref', doc.refText.trim(), 'full') : ''}
  ${kv('Branch', doc.branchName || '—', 'full')}
  ${kv('Status', doc.statusText || '—', 'full')}
  ${kv('Business Date', `${doc.dateText} ${doc.timeText || ''}`.trim(), 'full')}
  ${kv('Required Date', doc.requiredDateText || '—', 'full')}
  ${kv('Printed', `${doc.printDateText} ${doc.printTimeText}`.trim(), 'full')}
</div>
${rule()}
${productsHtml(lines)}
${rule()}
${kv('Total Qty', num(totalQty))}
${kv('TOTAL', total, 'total')}
${rule()}
${packing.length > 0 ? packingHtml(packing) : ''}
${doc.previousCollection === undefined ? '' : previousCollectionHtml(doc.previousCollection, symbol)}
<div class="section">Payment</div>
${fill('Cash Paid', symbol)}
${fill('Payment Status')}
${fill('Received By (Rider)')}
<div class="sign"><div>Collected By</div><div>Received By</div></div>
<div class="footer">Thank You<br><span class="b">${escapeHtml(company)}</span></div>
`;

  return {
    kind: 'production-order',
    id: doc.orderNumber,
    title: `Production order ${doc.orderNumber}`,
    paper: spec,
    html: wrapDocument(`Production order ${doc.orderNumber}`, spec, body),
    // The reference, the total, the company — and every requested packing
    // material by name. If any of it is not on the rendered page, the page is
    // not this document and must not be printed.
    mustContain: [doc.orderNumber, total, company, ...packing.map((p) => p.materialName)],
  };
}

/**
 * PRODUCTS — Demand beside Changed, so the branch reads what it asked for and
 * what is coming in one glance. An added line (Production's own) shows a dash
 * for demand: nobody demanded it, and a 0 would read as a cut.
 */
function productsHtml(lines: ProductionOrderLine[]): string {
  if (lines.length === 0) {
    return `<div class="section">Products</div>
<div class="note">No products on this order.</div>`;
  }
  const rows = lines
    .map(
      (line) => `<tr>
  <td class="name">${escapeHtml(line.productName)} <span class="small rate-note">@ ${escapeHtml(num(line.unitPrice))}</span>${
    line.isSpecial ? ' <span class="tag">Special</span>' : ''
  }${line.isSpecial && line.description?.trim() ? `<div class="small">${escapeHtml(line.description.trim())}</div>` : ''}</td>
  <td class="num qty">${line.demandQty === null ? '—' : num(line.demandQty)}</td>
  <td class="num chg">${num(line.changedQty)}</td>
  <td class="num amt">${num(line.amount)}</td>
</tr>`,
    )
    .join('');
  return `<div class="section">Products</div>
<table class="items">
  <thead><tr><th class="name">Product (@ rate)</th><th class="num qty">Demand</th><th class="num chg">Changed</th><th class="num amt">Amount</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

/**
 * PACKING MATERIALS — printed only when the branch asked for some, and then
 * every requested line at its exact quantities. No rate and no amount: these
 * never fold into the order's money total.
 */
function packingHtml(packing: ProductionOrderPackingLine[]): string {
  const rows = packing
    .map(
      (line) => `<tr>
  <td class="name">${escapeHtml(line.materialName)}</td>
  <td class="num pqty">${num(line.demandQty)}</td>
  <td class="num pchg">${num(line.changedQty)}</td>
</tr>`,
    )
    .join('');
  const totalChanged = packing.reduce((sum, line) => sum + line.changedQty, 0);
  return `<div class="section">Packing Materials</div>
<table class="items packing">
  <thead><tr><th class="name">Packing Material</th><th class="num pqty">Demand</th><th class="num pchg">Changed</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
${kv('Packing Qty', num(totalChanged))}
${rule()}`;
}

/** A label with a line to write on — the rider's cash-collection log. */
function fill(label: string, prefix?: string): string {
  return `<div class="fill"><span class="k">${escapeHtml(label)}</span>${
    prefix ? `<span class="p">${escapeHtml(prefix)}</span>` : ''
  }<span class="line"></span></div>`;
}

/**
 * PREVIOUS ORDER BALANCE — the six fields, in the order the A4 challan and the
 * screen state them, so a rider holding the roll and the sheet is reading one
 * document twice.
 *
 * Both deductions print even at zero. A rider settling in cash reads down a fixed
 * set of rows, and a line that disappears when it happens to be nil is a line the
 * reader has to notice is missing to know it was nil.
 */
function previousCollectionHtml(collection: PreviousCollection | null, symbol: string): string {
  if (!collection) {
    return `<div class="section">Previous Order Balance</div>
<div class="note">No previous delivery — nothing to collect.</div>
${rule()}`;
  }
  return `<div class="section">Previous Order Balance</div>
<div class="small">${kv('Order No', collection.reference)}${kv('Order Date', collection.dateText)}</div>
${kv('Previous Order', money(collection.orderedValue, symbol))}
${kv('Delivered Value', money(collection.deliveredValue, symbol))}
${kv('Company Share', money(collection.companyShare, symbol))}
${kv('Less Returns', money(collection.returnsAmount, symbol))}
${kv('Less Discount', money(collection.discountsAmount, symbol))}
${rule(true)}
${kv('AMOUNT TO COLLECT', money(collection.amountToCollect, symbol), 'total')}
${rule()}`;
}
