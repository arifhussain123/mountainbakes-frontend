'use client';

import type { AppSettings, Branch } from '@mb/shared';
import { useCachedLogo } from '@/lib/print/logoCache';
import { karachiDateStr, karachiTimeStr } from '@mb/shared';
import { PAYMENT_METHOD_LABELS, COMPANY_NAME } from '@/utils/constants';

export interface InvoiceLine {
  productName: string;
  qty: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
}

export interface InvoiceData {
  orderNumber: string;
  customerName: string;
  customerPhone: string;
  items: InvoiceLine[];
  subtotal: number; // gross (Σ qty×rate); the discount line is shown separately
  discountTotal: number;
  taxAmount: number;
  grandTotal: number;
  paymentMethod: string;
  receivedCash?: number; // cash payments only
  cashReturned?: number; // cash payments only
  createdAt: string; // ISO
}

export function InvoiceView({ invoice, settings, branch }: { invoice: InvoiceData; settings: AppSettings | null; branch: Branch | null }) {
  const cur = settings?.currencySymbol || 'Rs.';
  const created = new Date(invoice.createdAt);
  const logo = useCachedLogo(settings?.logoUrl);
  const money = (n: number) => `${cur}${n.toLocaleString()}`;

  return (
    // No `print-area` here: the receipt is rendered twice — once on screen and
    // once inside a PrintPortal — and it is the portalled copy that carries the
    // print class. See PrintPortal for why the on-screen one cannot print.
    <div className="mx-auto max-w-sm bg-white p-6 text-black">
      {/* Header */}
      <div className="text-center">
        {logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="logo" className="mx-auto mb-2 h-14 w-14 object-contain" />
        )}
        <h2 className="text-lg font-bold">{settings?.companyName || COMPANY_NAME}</h2>
        {branch && <p className="text-sm font-medium">{branch.name}</p>}
        {branch?.address && <p className="text-xs text-neutral-600">{branch.address}{branch.city ? `, ${branch.city}` : ''}</p>}
      </div>

      <div className="my-3 border-t border-dashed border-neutral-400" />

      {/* Meta */}
      <div className="space-y-0.5 text-xs">
        <div className="flex justify-between"><span>Invoice #</span><span className="font-mono font-semibold">{invoice.orderNumber}</span></div>
        <div className="flex justify-between"><span>Date</span><span>{karachiDateStr(created)}</span></div>
        <div className="flex justify-between"><span>Time</span><span>{karachiTimeStr(created)}</span></div>
        <div className="flex justify-between"><span>Customer</span><span>{invoice.customerName}</span></div>
        {invoice.customerPhone && <div className="flex justify-between"><span>Mobile</span><span>{invoice.customerPhone}</span></div>}
      </div>

      <div className="my-3 border-t border-dashed border-neutral-400" />

      {/* Items */}
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-neutral-300 text-left">
            <th className="pb-1 font-semibold">Item</th>
            <th className="pb-1 text-center font-semibold">Qty</th>
            <th className="pb-1 text-right font-semibold">Rate</th>
            <th className="pb-1 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items.map((it, i) => (
            <tr key={i} className="align-top">
              <td className="py-1 pr-1">{it.productName}</td>
              <td className="py-1 text-center">{it.qty}</td>
              <td className="py-1 text-right">{it.unitPrice.toLocaleString()}</td>
              <td className="py-1 text-right">{it.lineTotal.toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="my-3 border-t border-dashed border-neutral-400" />

      {/* Totals */}
      <div className="space-y-0.5 text-xs">
        <div className="flex justify-between"><span>Subtotal</span><span>{money(invoice.subtotal)}</span></div>
        {invoice.discountTotal > 0 && <div className="flex justify-between"><span>Discount</span><span>-{money(invoice.discountTotal)}</span></div>}
        <div className="flex justify-between"><span>Government Tax</span><span>{money(invoice.taxAmount)}</span></div>
        <div className="mt-1 flex justify-between border-t border-neutral-400 pt-1 text-sm font-bold">
          <span>Grand Total</span><span>{money(invoice.grandTotal)}</span>
        </div>
        <div className="flex justify-between pt-1"><span>Payment</span><span>{PAYMENT_METHOD_LABELS[invoice.paymentMethod] ?? invoice.paymentMethod}</span></div>
        {invoice.paymentMethod === 'cash' && invoice.receivedCash != null && (
          <>
            <div className="flex justify-between"><span>Received Cash</span><span>{money(invoice.receivedCash)}</span></div>
            <div className="flex justify-between"><span>Cash Returned</span><span>{money(invoice.cashReturned ?? 0)}</span></div>
          </>
        )}
      </div>

      <div className="my-3 border-t border-dashed border-neutral-400" />

      {/* Footer */}
      <div className="text-center text-xs text-neutral-600">
        {branch?.phone && <p>Phone: {branch.phone}</p>}
        <p className="mt-1 font-medium">{settings?.receiptFooter || 'Thank you for your purchase!'}</p>
      </div>
    </div>
  );
}
