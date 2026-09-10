import { escapeHtml, kv, logoHtml, money, num, rule, wrapDocument, type PrintDocument } from './document';
import { paperSpec } from './styles';
import type { PaperWidth, SaleReceiptDoc } from './types';
import { validateSaleDoc } from './validate';

const BRAND = 'MOUNTAIN BAKES';

/**
 * The sale slip as the canonical print document.
 *
 * **The footer below is fixed contact copy, not `settings.receiptFooter`.**
 * `InvoiceView` reads that setting for the A4 copy; this till receipt prints a
 * short, hardcoded thank-you note instead, the same way `productionOrder.ts`
 * prints its own fixed credit line — neither reads settings. Keep it to the one
 * line-set below rather than growing it toward the A4 footer's free text: this
 * document is a till record first, and centring/wrapping are tuned for exactly
 * this wording at 58mm.
 */
export function buildSaleReceiptDocument(doc: SaleReceiptDoc, paper: PaperWidth): PrintDocument {
  validateSaleDoc(doc);
  const spec = paperSpec(paper);
  const symbol = doc.currencySymbol?.trim() || 'Rs.';
  const company = (doc.companyName?.trim() || BRAND).toUpperCase();
  const total = money(doc.grandTotal, symbol);

  const rows = doc.items
    .map(
      (line) => `<tr>
  <td class="name">${escapeHtml(line.productName)}</td>
  <td class="num qty">${num(line.qty)}</td>
  <td class="num rate">${num(line.unitPrice)}</td>
  <td class="num amt">${num(line.lineTotal)}</td>
</tr>`,
    )
    .join('');

  const body = `
<div class="c">
  ${logoHtml(doc.logo)}
  <div class="company">${escapeHtml(company)}</div>
  <div class="dept">Sale Receipt</div>
  ${doc.branchName?.trim() ? `<div class="sub">${escapeHtml(doc.branchName.trim())}</div>` : ''}
</div>
${rule()}
<div class="meta">
  ${kv('Sale ID', doc.saleId, 'full')}
  ${kv('Date', doc.dateText)}
  ${kv('Time', doc.timeText)}
  ${doc.customerName?.trim() ? kv('Customer', doc.customerName.trim(), 'full') : ''}
  ${doc.customerPhone?.trim() ? kv('Mobile', doc.customerPhone.trim(), 'full') : ''}
</div>
${rule()}
<table class="items">
  <thead><tr><th class="name">Product</th><th class="num qty">Qty</th><th class="num rate">Rate</th><th class="num amt">Amount</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
${rule()}
${kv('Gross Total', money(doc.grossTotal, symbol))}
${kv('Discount', money(doc.discountTotal, symbol))}
${doc.taxAmount > 0 ? kv('Government Tax', money(doc.taxAmount, symbol)) : ''}
${kv('TOTAL', total, 'total')}
${doc.receivedCash != null ? kv('Cash Received', money(doc.receivedCash, symbol)) + kv('Cash Returned', money(doc.cashReturned ?? 0, symbol)) : ''}
${rule()}
<div class="b up">Payment Method: ${escapeHtml(doc.paymentMethodLabel)}</div>
<div class="footer">
  <div>************************</div>
  <div>Phone: +92 347 9782409</div>
  <div>Thank you for choosing Mountain Bakes! We truly appreciate your support. Best wishes!</div>
  <div>************************</div>
</div>
`;

  return {
    kind: 'sale',
    id: doc.saleId,
    title: `Receipt ${doc.saleId}`,
    paper: spec,
    html: wrapDocument(`Receipt ${doc.saleId}`, spec, body),
    mustContain: [doc.saleId, total, company],
  };
}
