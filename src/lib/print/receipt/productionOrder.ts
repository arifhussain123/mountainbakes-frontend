import { escapeHtml, kv, logoHtml, money, num, rule, wrapDocument, type PrintDocument } from './document';
import { paperSpec } from './styles';
import type { PaperWidth, PreviousCollection, ProductionOrderDoc } from './types';
import { validateProductionDoc } from './validate';

const BRAND = 'MOUNTAIN BAKES';

/**
 * The production demand as the canonical print document.
 *
 * Top to bottom: company and department, the order's identifying facts, the
 * approved lines as PRODUCT / QTY / RATE / AMOUNT, the total, the previous
 * order's collection working in the six fields it settles on, and the two
 * signature lines. Only what the floor needs to make and send the order, plus
 * what the rider needs to settle the last one.
 *
 * Every size and every face comes from `styles.ts`. Nothing here sets a font.
 */
export function buildProductionOrderDocument(doc: ProductionOrderDoc, paper: PaperWidth): PrintDocument {
  validateProductionDoc(doc);
  const spec = paperSpec(paper);
  const symbol = doc.currencySymbol?.trim() || 'Rs.';
  const company = (doc.companyName?.trim() || BRAND).toUpperCase();
  // A line approved at zero is not going out, so it is not on the sheet the floor
  // packs from.
  const lines = doc.items.filter((line) => line.qty > 0);
  const totalQty = lines.reduce((sum, line) => sum + line.qty, 0);
  const total = money(doc.grandTotal, symbol);

  const rows = lines
    .map(
      (line) => `<tr>
  <td class="name">${escapeHtml(line.productName)}</td>
  <td class="num qty">${num(line.qty)}</td>
  <td class="num rate">${num(line.unitPrice)}</td>
  <td class="num amt">${num(line.amount)}</td>
</tr>`,
    )
    .join('');

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
  ${kv('Branch', doc.branchName || '—', 'full')}
  ${kv('Date', doc.dateText)}
  ${kv('Time', doc.timeText || '—')}
  ${kv('Required Date', doc.requiredDateText || '—', 'full')}
</div>
${rule()}
<table class="items">
  <thead><tr><th class="name">Product</th><th class="num qty">Qty</th><th class="num rate">Rate</th><th class="num amt">Amount</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
${rule()}
${kv('Total Qty', num(totalQty))}
${kv('TOTAL', total, 'total')}
${rule()}
${doc.previousCollection === undefined ? '' : previousCollectionHtml(doc.previousCollection, symbol)}
<div class="sign"><div>Collected By</div><div>Received By</div></div>
<div class="footer">Thank You<br><span class="b">${escapeHtml(company)}</span></div>
`;

  return {
    kind: 'production-order',
    id: doc.orderNumber,
    title: `Production order ${doc.orderNumber}`,
    paper: spec,
    html: wrapDocument(`Production order ${doc.orderNumber}`, spec, body),
    // The reference and the total: if either is not on the rendered page, the
    // page is not this document and must not be printed.
    mustContain: [doc.orderNumber, total, company],
  };
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
