import { escapeHtml, kv, logoHtml, money, num, rule, wrapDocument, type PrintDocument } from './document';
import { paperSpec } from './styles';
import type { DemandSummaryDoc } from './types';
import type { PaperWidth } from './types';
import { validateDemandSummaryDoc } from './validate';

const BRAND = 'MOUNTAIN BAKES';

/**
 * The production-wide demand snapshot as the canonical print document.
 *
 * Top to bottom: company and department, when the snapshot was taken, the
 * consolidated product pivot, packing materials (only when some are waiting),
 * demand totals, and the branch-wise quantity/amount summary with its grand
 * total. No stock, balance or per-order detail — this is a batching and
 * dispatch document, not the Demand Summary card itself.
 *
 * Every size and every face comes from `styles.ts`, same as every other
 * receipt this shop prints.
 */
export function buildDemandSummaryDocument(doc: DemandSummaryDoc, paper: PaperWidth): PrintDocument {
  validateDemandSummaryDoc(doc);
  const spec = paperSpec(paper);
  const symbol = doc.currencySymbol?.trim() || 'Rs.';
  const company = (doc.companyName?.trim() || BRAND).toUpperCase();

  const productRows = doc.items
    .map((line) => `<tr><td class="name">${escapeHtml(line.productName)}</td><td class="num amt">${num(line.qty)}</td></tr>`)
    .join('');
  const packingRows = doc.packingItems
    .map((line) => `<tr><td class="name">${escapeHtml(line.materialName)}</td><td class="num amt">${num(line.qty)}</td></tr>`)
    .join('');
  const branchRows = doc.branchItems
    .map(
      (b) => `<tr>
  <td class="name">${escapeHtml(b.branchName)}</td>
  <td class="num qty">${num(b.qty)}</td>
  <td class="num amt">${b.amount === null ? 'N/A' : money(b.amount, symbol)}</td>
</tr>`,
    )
    .join('');

  const body = `
<div class="c">
  ${logoHtml(doc.logo)}
  <div class="company">${escapeHtml(company)}</div>
  <div class="dept">Production Department</div>
  <div class="doc-title">Production Demand Summary</div>
</div>
${rule()}
<div class="meta">
  ${kv('Business Date', doc.businessDateText, 'full')}
  ${kv('Printed', `${doc.printDateText} ${doc.printTimeText}`, 'full')}
  ${doc.statusText ? kv('Status', doc.statusText, 'full') : ''}
</div>
${rule()}
<div class="section">Product Demand</div>
<table class="items">
  <thead><tr><th class="name">Product</th><th class="num amt">Qty</th></tr></thead>
  <tbody>${productRows || `<tr><td colspan="2" class="note">No waiting demand.</td></tr>`}</tbody>
</table>
${kv('Total Qty', num(doc.totals.totalProductQty))}
${rule()}
${
  doc.packingItems.length > 0
    ? `<div class="section">Packing Material Requirements</div>
<table class="items">
  <thead><tr><th class="name">Packing Material</th><th class="num amt">Qty</th></tr></thead>
  <tbody>${packingRows}</tbody>
</table>
${kv('Packing Qty', num(doc.totals.totalPackingQty))}
${rule()}`
    : ''
}
<div class="section">Demand Totals</div>
${kv('Distinct Products', num(doc.totals.distinctProducts))}
${kv('Total Product Qty', num(doc.totals.totalProductQty))}
${doc.totals.distinctPacking > 0 ? kv('Distinct Packing Items', num(doc.totals.distinctPacking)) : ''}
${doc.totals.distinctPacking > 0 ? kv('Total Packing Qty', num(doc.totals.totalPackingQty)) : ''}
${rule()}
<div class="section">Branch-wise Summary</div>
<table class="items">
  <thead><tr><th class="name">Branch</th><th class="num qty">Qty</th><th class="num amt">Amount</th></tr></thead>
  <tbody>${branchRows}</tbody>
</table>
${kv('Grand Qty', num(doc.totals.totalProductQty))}
${kv('Grand Amount', doc.totals.grandAmount === null ? 'Amount unavailable' : money(doc.totals.grandAmount, symbol), 'total')}
${rule()}
<div class="footer">* Design &amp; developed by arifsiksavi@gmail.com | 0322-2050545 *</div>
`;

  return {
    kind: 'demand-summary',
    id: doc.businessDateText,
    title: 'Production Demand Summary',
    paper: spec,
    html: wrapDocument('Production Demand Summary', spec, body),
    // The reference and the total: if either is not on the rendered page, the
    // page is not this document and must not be printed.
    mustContain: ['Production Demand Summary', company],
  };
}
