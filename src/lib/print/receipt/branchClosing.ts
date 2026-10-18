import { escapeHtml, kv, logoHtml, money, num, rule, wrapDocument, type PrintDocument } from './document';
import { paperSpec } from './styles';
import type { BranchClosingDoc, PaperWidth } from './types';
import { validateBranchClosingDoc } from './validate';

const BRAND = 'MOUNTAIN BAKES';

/**
 * The Branch Closing end-of-day sheet as the canonical print document.
 *
 * Top to bottom: branch and business date, Balance Stock (product + quantity
 * only — no Opening/Received/Sold/Returned columns, this is a till receipt,
 * not the A4 table), then Payment Details (one line per method, total sales,
 * discounts, expenses, closing cash). `doc.stockLines` is already filtered to
 * balance > 0 by the caller; this file lays out whatever it is handed and has
 * no filtering logic of its own.
 */
export function buildBranchClosingDocument(doc: BranchClosingDoc, paper: PaperWidth): PrintDocument {
  validateBranchClosingDoc(doc);
  const spec = paperSpec(paper);
  const symbol = doc.currencySymbol?.trim() || 'Rs.';
  const company = (doc.companyName?.trim() || BRAND).toUpperCase();
  const branch = doc.branchName.trim();

  const stockRows = doc.stockLines
    .map(
      (line) => `<tr><td class="name">${escapeHtml(line.productName)}</td><td class="num amt">${num(line.balance)}</td></tr>`,
    )
    .join('');

  const paymentRows = doc.paymentLines
    .map((line) => kv(line.label, money(line.amount, symbol)))
    .join('');

  const body = `
<div class="c">
  ${logoHtml(doc.logo)}
  <div class="company">${escapeHtml(company)}</div>
  <div class="dept">Branch Closing</div>
  <div class="sub">${escapeHtml(branch)}</div>
</div>
${rule()}
<div class="meta">
  ${kv('Business Date', doc.businessDateText, 'full')}
  ${kv('Printed', `${doc.printDateText} ${doc.printTimeText}`, 'full')}
</div>
${rule()}
<div class="section">Balance Stock</div>
<table class="items">
  <thead><tr><th class="name">Product</th><th class="num amt">Balance</th></tr></thead>
  <tbody>${stockRows || `<tr><td colspan="2" class="note">No balance stock.</td></tr>`}</tbody>
</table>
${rule()}
<div class="section">Payment Details</div>
${paymentRows || `<div class="note">No sales recorded for this date.</div>`}
${rule()}
${kv('Total Sales', money(doc.totalSales, symbol))}
${doc.discounts > 0 ? kv('Discounts', money(doc.discounts, symbol)) : ''}
${kv('Expenses', money(doc.totalExpenses, symbol))}
${kv('Closing Cash', money(doc.cashInHand, symbol), 'total')}
${kv('Orders / Cancelled', `${num(doc.orderCount)} / ${num(doc.cancelled)}`)}
${rule()}
<div class="footer">End of Closing Report</div>
`;

  return {
    kind: 'branch-closing',
    id: `${branch}-${doc.businessDateText}`,
    title: `Branch Closing — ${branch}`,
    paper: spec,
    html: wrapDocument(`Branch Closing — ${branch}`, spec, body),
    mustContain: ['Branch Closing', company, branch],
  };
}
