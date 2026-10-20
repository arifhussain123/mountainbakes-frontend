'use client';

import { DELIVERY_PROVIDER_LABEL, PURCHASE_PAYMENT_PREFERENCE_LABEL, type PurchaseDemandDetail } from '@mb/shared';
import { COMPANY_NAME } from '@/utils/constants';
import { formatDate, formatDateTime } from '@/utils/date';
import { SUPPLIER_PAYMENT_STATUS_LABEL, demandStatusLabel, formatQty } from './purchasing-model';
import { money } from './parts';

/**
 * The printed purchase summary: what was asked for, what was agreed, what was
 * billed, received and paid — the sheet filed with the supplier's paper bill.
 *
 * Rendered inside a `PrintPortal` through `useDocumentPrint`, the same A4 path
 * as the Daily Sale Record (see DailySalePrintSheet for why a document never
 * goes through the POS receipt printer). Fixed black on white for the same
 * reason too: it is photocopied and filed.
 */
export function PurchasePrintSheet({ demand }: { demand: PurchaseDemandDetail }) {
  const quotation = demand.quotations.find((q) => q.id === demand.approvedQuotationId) ?? null;
  const bill = demand.bills.find((b) => b.id === demand.approvedBillId) ?? null;
  const t = demand.totals;

  return (
    <div className="print-page mx-auto max-w-3xl bg-white p-8 text-sm text-black">
      <div className="flex items-start justify-between gap-4 border-b-2 border-black pb-3">
        <div>
          <h1 className="text-xl font-bold leading-tight">{COMPANY_NAME}</h1>
          <p className="text-sm font-semibold">Production · Purchasing</p>
        </div>
        <div className="text-right text-xs">
          <p className="text-base font-bold uppercase tracking-wide">Purchase Summary</p>
          <p className="mt-1">
            Demand: <span className="font-semibold">{demand.demandNo}</span>
          </p>
          <p>Status: {demandStatusLabel(demand.status)}</p>
          <p>Printed: {formatDateTime(new Date())}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-4 text-xs">
        <div>
          <p className="font-semibold">Supplier</p>
          <p>{demand.supplierName}</p>
          {demand.supplier?.supplierCode && <p>{demand.supplier.supplierCode}</p>}
          <p>{demand.supplierWhatsapp}</p>
          {demand.supplier?.address && <p>{demand.supplier.address}</p>}
        </div>
        <div className="text-right">
          <p>Required: {formatDate(demand.requiredDate)}</p>
          <p>Priority: {demand.priority === 'urgent' ? 'Urgent' : 'Normal'}</p>
          <p>Payment: {PURCHASE_PAYMENT_PREFERENCE_LABEL[demand.paymentPreference]}</p>
          {demand.sentAt && <p>Sent: {formatDateTime(demand.sentAt)}</p>}
        </div>
      </div>

      <h2 className="mt-4 border-b border-black text-xs font-bold uppercase">Requested</h2>
      <table className="mt-1 w-full text-xs">
        <tbody>
          {[...demand.items].sort((a, b) => a.lineNo - b.lineNo).map((i) => (
            <tr key={i.id} className="border-b border-neutral-300">
              <td className="py-0.5">{i.itemName}{i.note ? ` — ${i.note}` : ''}</td>
              <td className="py-0.5 text-right">{formatQty(i.requestedQty)} {i.unit}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {quotation && (
        <>
          <h2 className="mt-4 border-b border-black text-xs font-bold uppercase">Approved quotation (v{quotation.version})</h2>
          <table className="mt-1 w-full text-xs">
            <thead>
              <tr className="text-left">
                <th className="py-0.5 font-semibold">Item</th>
                <th className="py-0.5 text-right font-semibold">Qty</th>
                <th className="py-0.5 text-right font-semibold">Rate</th>
                <th className="py-0.5 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody>
              {quotation.items.filter((l) => l.availability !== 'unavailable').map((l) => (
                <tr key={l.id} className="border-b border-neutral-300">
                  <td className="py-0.5">{l.itemName}{l.availability === 'substitute' ? ' (substitute)' : ''}</td>
                  <td className="py-0.5 text-right">{formatQty(l.availableQty)} {l.unit}</td>
                  <td className="py-0.5 text-right">{money(l.unitRate)}</td>
                  <td className="py-0.5 text-right">{money(l.lineTotal)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={3} className="pt-1 text-right">Delivery</td>
                <td className="pt-1 text-right">{money(quotation.deliveryCharge)}</td>
              </tr>
              <tr className="font-semibold">
                <td colSpan={3} className="text-right">Quoted total</td>
                <td className="text-right">{money(quotation.total)}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}

      {bill && (
        <>
          <h2 className="mt-4 border-b border-black text-xs font-bold uppercase">
            Bill {bill.supplierBillNo} · {formatDate(bill.invoiceDate)}
          </h2>
          <table className="mt-1 w-full text-xs">
            <tbody>
              {bill.items.map((l) => (
                <tr key={l.id} className="border-b border-neutral-300">
                  <td className="py-0.5">{l.itemName}</td>
                  <td className="py-0.5 text-right">{formatQty(l.qty)} {l.unit}</td>
                  <td className="py-0.5 text-right">{money(l.unitRate)}</td>
                  <td className="py-0.5 text-right">{money(l.lineTotal)}</td>
                </tr>
              ))}
              <tr><td colSpan={3} className="pt-1 text-right">Subtotal</td><td className="pt-1 text-right">{money(bill.subtotal)}</td></tr>
              <tr><td colSpan={3} className="text-right">Delivery</td><td className="text-right">{money(bill.deliveryCharge)}</td></tr>
              {bill.discount > 0 && <tr><td colSpan={3} className="text-right">Discount</td><td className="text-right">−{money(bill.discount)}</td></tr>}
              {bill.otherCharges > 0 && <tr><td colSpan={3} className="text-right">Other charges</td><td className="text-right">{money(bill.otherCharges)}</td></tr>}
              <tr className="font-semibold"><td colSpan={3} className="text-right">Grand total</td><td className="text-right">{money(bill.grandTotal)}</td></tr>
            </tbody>
          </table>
          {bill.acceptedDifferences && <p className="mt-1 text-xs">Differences from the quotation accepted: {bill.decisionReason ?? '—'}</p>}
        </>
      )}

      {demand.receiptProgress.length > 0 && (
        <>
          <h2 className="mt-4 border-b border-black text-xs font-bold uppercase">Received</h2>
          <table className="mt-1 w-full text-xs">
            <tbody>
              {demand.receiptProgress.map((p) => (
                <tr key={p.billItemId} className="border-b border-neutral-300">
                  <td className="py-0.5">{p.itemName}</td>
                  <td className="py-0.5 text-right">billed {formatQty(p.billed)} {p.unit}</td>
                  <td className="py-0.5 text-right">received {formatQty(p.received)}</td>
                  <td className="py-0.5 text-right">damaged {formatQty(p.damaged)}</td>
                  <td className="py-0.5 text-right">owed {formatQty(p.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {demand.delivery && (
        <p className="mt-2 text-xs">
          Delivery: {demand.delivery.provider === 'other' ? demand.delivery.providerName : DELIVERY_PROVIDER_LABEL[demand.delivery.provider]}
          {demand.delivery.bookingReference ? ` · ref ${demand.delivery.bookingReference}` : ''}
          {demand.delivery.actualFee != null ? ` · fee ${money(demand.delivery.actualFee)}` : ''}
          {demand.delivery.receivedByName ? ` · received by ${demand.delivery.receivedByName}` : ''}
        </p>
      )}

      <h2 className="mt-4 border-b border-black text-xs font-bold uppercase">Payments</h2>
      <table className="mt-1 w-full text-xs">
        <tbody>
          {demand.payments.map((p) => (
            <tr key={p.id} className="border-b border-neutral-300">
              <td className="py-0.5">{p.paymentNo} · {p.method}{p.referenceNo ? ` · ${p.referenceNo}` : ''}</td>
              <td className="py-0.5">{formatDate(p.paidOn)}</td>
              <td className="py-0.5">{SUPPLIER_PAYMENT_STATUS_LABEL[p.status]}{p.voucherNo ? ` (${p.voucherNo})` : ''}</td>
              <td className="py-0.5 text-right">{money(p.amount)}</td>
            </tr>
          ))}
          {demand.payments.length === 0 && (
            <tr><td className="py-0.5">None recorded.</td></tr>
          )}
        </tbody>
      </table>
      <div className="mt-2 grid grid-cols-2 gap-x-6 text-xs sm:grid-cols-4">
        <p>Bill total: <strong>{money(t.billTotal)}</strong></p>
        <p>Posted: <strong>{money(t.paidPosted)}</strong></p>
        <p>Pending Finance: <strong>{money(t.paidPending)}</strong></p>
        <p>Outstanding: <strong>{money(t.outstanding)}</strong></p>
      </div>

      <div className="mt-10 grid grid-cols-2 gap-10 text-xs">
        <div className="border-t border-black pt-1">Received by (Production)</div>
        <div className="border-t border-black pt-1">Checked by (Finance)</div>
      </div>
    </div>
  );
}
