'use client';

import { useState } from 'react';
import type { AppSettings, Branch, BranchProductionOrder, BranchProductionOrderItem } from '@mb/shared';
import type { ReviewOrderPayload } from '@/lib/queries';
import { useProductionBalances, useProducts, useBranches, useProductionReturns } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { PrintButton } from '@/components/shared/PrintButton';
import { CheckCircle2, XCircle, Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { COMPANY_NAME } from '@/utils/constants';
import { formatDate, formatTime } from '@/utils/date';

/** Human reference for the slip header (production_orders has no orderNumber field). */
export function slipReference(order: Pick<BranchProductionOrder, 'date' | 'time'>): string {
  return `PO-${(order.date || '').replace(/-/g, '')}-${(order.time || '').replace(':', '')}`;
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

function digits(raw: string): string {
  return raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
}

const fmt = (n: number) => n.toLocaleString();
const money = (n: number, sym: string) => `${sym}${Math.round(n).toLocaleString()}`;

/** One calendar day before a 'YYYY-MM-DD' business-date string. */
function previousDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d! - 1));
  return dt.toISOString().slice(0, 10);
}

export interface OrderPrintPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: BranchProductionOrder | null;
  settings: AppSettings | null;
  token: string;
  review: (payload: ReviewOrderPayload) => Promise<unknown>;
  reviewing: boolean;
  markPrinted: (id: string) => Promise<unknown>;
}

/**
 * Production Order print preview / delivery challan. The on-screen half is the
 * review surface (approve / adjust approved quantities — amounts recalc live).
 * Printing emits TWO copies in one action — Customer Copy + Company Copy — each a
 * professional challan with prices, totals, the previous-day return items and the
 * net amount to collect against the previous demand (the Company Copy also carries
 * the cash-payment acknowledgement).
 */
export function OrderPrintPreview({ open, onOpenChange, order, settings, token, review, reviewing, markPrinted }: OrderPrintPreviewProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !reviewing && onOpenChange(o)}>
      <DialogContent
        showCloseButton
        mobile="fullscreen"
        className="flex flex-col gap-0 overflow-hidden p-0 md:max-h-[92vh] md:w-[90vw] md:max-w-[90vw] md:rounded-2xl lg:w-[80vw] lg:max-w-[960px]"
      >
        {order && (
          <PreviewBody
            key={order.id}
            order={order}
            settings={settings}
            token={token}
            review={review}
            reviewing={reviewing}
            markPrinted={markPrinted}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({
  order, settings, token, review, reviewing, markPrinted, onClose,
}: {
  order: BranchProductionOrder;
  settings: AppSettings | null;
  token: string;
  review: (payload: ReviewOrderPayload) => Promise<unknown>;
  reviewing: boolean;
  markPrinted: (id: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const readOnly = order.status !== 'pending';
  const frozen = order.status === 'approved';
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [packingEdits, setPackingEdits] = useState<Record<string, string>>({});
  const [reason, setReason] = useState(order.changeReason ?? '');

  const balancesQ = useProductionBalances(token, { branchId: order.branchId, enabled: order.status === 'pending' });
  const liveBalances = balancesQ.data ?? {};
  const productsQ = useProducts(token);
  const branchesQ = useBranches(token);
  const returnsQ = useProductionReturns(token);

  const priceById = new Map((productsQ.data ?? []).map((p) => [p.id, p.price]));
  const branch = (branchesQ.data ?? []).find((b) => b.id === order.branchId) ?? null;
  const sym = settings?.currencySymbol || 'Rs.';

  function rowFor(it: BranchProductionOrderItem) {
    const newDemand = it.qty;
    const previousBalance = frozen ? (it.previousBalanceQty ?? 0) : (liveBalances[it.productId] ?? 0);
    const totalDemand = frozen ? (it.totalRequiredQty ?? previousBalance + newDemand) : previousBalance + newDemand;
    const approved = frozen
      ? (it.approvedQty ?? totalDemand)
      : (edits[it.productId] !== undefined ? (parseInt(edits[it.productId]!, 10) || 0) : totalDemand);
    const unitPrice = priceById.get(it.productId) ?? 0;
    const amount = approved * unitPrice;
    return { newDemand, previousBalance, totalDemand, approved, unitPrice, amount };
  }

  const rows = order.items.map((it) => ({ it, ...rowFor(it) }));
  const approvedItems = rows.map(({ it, approved }) => ({ productId: it.productId, approvedQty: approved }));

  // Packing materials. Much simpler than products: no previous balance and no
  // carry-forward, so requested is the only baseline and approved defaults to it.
  const packingItems = order.packingItems ?? [];
  const packingRows = packingItems.map((it) => {
    const approved = frozen
      ? (it.approvedQty ?? it.qty)
      : (packingEdits[it.packingMaterialId] !== undefined
          ? (parseInt(packingEdits[it.packingMaterialId]!, 10) || 0)
          : it.qty);
    return { it, requested: it.qty, approved };
  });
  const approvedPackingItems = packingRows.map(({ it, approved }) => ({
    packingMaterialId: it.packingMaterialId,
    approvedQty: approved,
  }));

  const changed =
    rows.some(({ approved, totalDemand }) => approved !== totalDemand) ||
    packingRows.some(({ approved, requested }) => approved !== requested);

  const printRows: PrintRow[] = rows.map(({ it, ...r }) => ({ productName: it.productName, ...r }));
  // The slip prints the APPROVED quantity, which is what actually ships.
  const packingPrintRows = packingRows.map(({ it, approved }) => ({ materialName: it.materialName, qty: approved }));
  const totals = printRows.reduce(
    (a, r) => ({ demand: a.demand + r.totalDemand, approved: a.approved + r.approved, amount: a.amount + r.amount }),
    { demand: 0, approved: 0, amount: 0 },
  );

  // Print stamp (when the slip is generated) and the aggregate carried-forward
  // balance. Amount is derived (qty × unit price) since only a quantity balance
  // is tracked — there is no stored monetary balance or previous-order reference.
  const now = new Date();
  const printDate = formatDate(now);
  const printTime = formatTime(now);
  const prevBalanceQty = printRows.reduce((a, r) => a + r.previousBalance, 0);
  const prevBalanceAmount = printRows.reduce((a, r) => a + r.previousBalance * r.unitPrice, 0);

  // Items this branch returned the day before this demand, accepted back into the
  // production pool. Valued at today's price — same caveat as prevBalanceAmount:
  // no historical price is stored against either the balance or the return.
  const prevDate = previousDate(order.date);
  const returnRows = (returnsQ.data ?? [])
    .filter((r) => r.branchId === order.branchId && r.status === 'accepted' && r.date === prevDate)
    .map((r) => ({ productName: r.productName, qty: r.qty, amount: r.qty * (priceById.get(r.productId) ?? 0) }));
  const returnsQty = returnRows.reduce((a, r) => a + r.qty, 0);
  const returnsAmount = returnRows.reduce((a, r) => a + r.amount, 0);
  // What the shop actually owes for the carried-forward balance, net of what it
  // already returned — the figure the rider collects against the previous demand.
  const collectionAmount = prevBalanceAmount - returnsAmount;

  async function approve() {
    try {
      await review({ id: order.id, status: 'approved', approvedItems, approvedPackingItems, reason: changed ? reason : undefined });
      toast.success('Order approved — stock transferred to branch');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve order');
    }
  }

  async function reject() {
    try {
      await review({ id: order.id, status: 'rejected' });
      toast.success('Order rejected');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reject order');
    }
  }

  // Print only prints — it no longer approves a pending demand as a side effect.
  // Approval is a deliberate action via the Approve button; Print previews/prints
  // whatever is currently on screen (requested quantities while still pending).
  function print() {
    setEditing(false);
    markPrinted(order.id).catch(() => {});
    setTimeout(() => {
      window.print();
      onClose();
    }, 300);
  }

  const logo = settings?.logoUrl ?? undefined;
  const companyName = settings?.companyName || COMPANY_NAME;

  return (
    <>
      <div
        className="min-h-0 flex-1 overflow-y-auto bg-neutral-100 px-3 py-4 sm:px-6 dark:bg-neutral-900"
        style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
      >
        {/* ── On-screen review (never prints) — edit Approved, Amount recalcs live ── */}
        <div className="no-print mx-auto max-w-[880px] bg-white p-5 text-black shadow-sm sm:p-7">
          <SlipHeader logo={logo} companyName={companyName} status={order.status} branch={branch} />
          <OrderMeta order={order} />

          {/* Review table — desktop */}
          <div className="mt-3 overflow-x-auto">
            <table className="hidden w-full border-collapse text-xs md:table">
              <thead>
                <tr className="border-y border-neutral-400 text-left">
                  <th className="py-1.5 pr-2 font-semibold">Product</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Prev. Bal.</th>
                  <th className="px-2 py-1.5 text-right font-semibold">New Demand</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Total Demand</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Approved</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Unit Price</th>
                  <th className="py-1.5 pl-2 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ it, newDemand, previousBalance, totalDemand, approved, unitPrice, amount }) => (
                  <tr key={it.productId} className="border-b border-neutral-200 align-top">
                    <td className="py-1.5 pr-2 font-medium">{it.productName}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(previousBalance)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{fmt(newDemand)}</td>
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{fmt(totalDemand)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {editing && !readOnly ? (
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={edits[it.productId] ?? String(totalDemand)}
                          onChange={(e) => setEdits((p) => ({ ...p, [it.productId]: digits(e.target.value) }))}
                          className="ml-auto h-8 w-20 text-right tabular-nums"
                        />
                      ) : (
                        <span className="font-semibold">{fmt(approved)}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-neutral-600">{money(unitPrice, sym)}</td>
                    <td className="py-1.5 pl-2 text-right font-semibold tabular-nums">{money(amount, sym)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-neutral-400 font-semibold">
                  <td className="pt-2" colSpan={3}>Totals</td>
                  <td className="px-2 pt-2 text-right tabular-nums">{fmt(totals.demand)}</td>
                  <td className="px-2 pt-2 text-right tabular-nums">{fmt(totals.approved)}</td>
                  <td className="px-2 pt-2 text-right"></td>
                  <td className="pt-2 pl-2 text-right tabular-nums">{money(totals.amount, sym)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Review cards — mobile */}
          <div className="mt-3 space-y-3 md:hidden">
            {rows.map(({ it, newDemand, previousBalance, totalDemand, approved, unitPrice, amount }) => (
              <div key={it.productId} className="rounded-lg border border-neutral-200 p-3">
                <p className="font-semibold">{it.productName}</p>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                  <Field label="Prev. Balance" value={fmt(previousBalance)} />
                  <Field label="New Demand" value={fmt(newDemand)} />
                  <Field label="Total Demand" value={fmt(totalDemand)} strong />
                  <Field label="Unit Price" value={money(unitPrice, sym)} />
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Approved</p>
                    {editing && !readOnly ? (
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={edits[it.productId] ?? String(totalDemand)}
                        onChange={(e) => setEdits((p) => ({ ...p, [it.productId]: digits(e.target.value) }))}
                        className="mt-0.5 h-8 w-24 text-right tabular-nums"
                      />
                    ) : (
                      <p className="font-semibold tabular-nums">{fmt(approved)}</p>
                    )}
                  </div>
                  <Field label="Amount" value={money(amount, sym)} strong />
                </div>
              </div>
            ))}
            <div className="rounded-lg bg-neutral-100 p-3 text-xs">
              <div className="flex justify-between"><span>Total Demand</span><span className="font-semibold tabular-nums">{fmt(totals.demand)}</span></div>
              <div className="flex justify-between"><span>Total Approved</span><span className="font-semibold tabular-nums">{fmt(totals.approved)}</span></div>
              <div className="flex justify-between"><span>Total Amount</span><span className="font-bold tabular-nums">{money(totals.amount, sym)}</span></div>
            </div>
          </div>

          {/* ── Packing Material Demand ──────────────────────────────────────
              A separate section, not extra rows in the product table: these have
              no previous balance, no unit price and no amount, so they would leave
              four columns empty. Rendered only when the demand has packing lines,
              so an ordinary order looks exactly as it did. */}
          {packingRows.length > 0 && (
            <div className="mt-6">
              <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-600">
                Packing Material Demand
              </h3>

              <div className="overflow-x-auto">
                <table className="hidden w-full border-collapse text-xs md:table">
                  <thead>
                    <tr className="border-y border-neutral-400 text-left">
                      <th className="py-1.5 pr-2 font-semibold">Packing Material</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Requested Qty</th>
                      <th className="py-1.5 pl-2 text-right font-semibold">Approved Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {packingRows.map(({ it, requested, approved }) => (
                      <tr key={it.packingMaterialId} className="border-b border-neutral-200 align-top">
                        <td className="py-1.5 pr-2 font-medium">{it.materialName}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmt(requested)}</td>
                        <td className="py-1.5 pl-2 text-right tabular-nums">
                          {editing && !readOnly ? (
                            <Input
                              type="text"
                              inputMode="numeric"
                              value={packingEdits[it.packingMaterialId] ?? String(requested)}
                              onChange={(e) =>
                                setPackingEdits((p) => ({ ...p, [it.packingMaterialId]: digits(e.target.value) }))
                              }
                              className="ml-auto h-8 w-20 text-right tabular-nums"
                            />
                          ) : (
                            <span className="font-semibold">{fmt(approved)}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards */}
              <div className="space-y-3 md:hidden">
                {packingRows.map(({ it, requested, approved }) => (
                  <div key={it.packingMaterialId} className="rounded-lg border border-neutral-200 p-3">
                    <p className="font-semibold">{it.materialName}</p>
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      <Field label="Requested Qty" value={fmt(requested)} />
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Approved Qty</p>
                        {editing && !readOnly ? (
                          <Input
                            type="text"
                            inputMode="numeric"
                            value={packingEdits[it.packingMaterialId] ?? String(requested)}
                            onChange={(e) =>
                              setPackingEdits((p) => ({ ...p, [it.packingMaterialId]: digits(e.target.value) }))
                            }
                            className="mt-0.5 h-8 w-24 text-right tabular-nums"
                          />
                        ) : (
                          <p className="font-semibold tabular-nums">{fmt(approved)}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {editing && !readOnly && changed && (
            <div className="mt-4 space-y-1">
              <label className="text-sm font-medium">Reason for change</label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why was the quantity adjusted?" />
            </div>
          )}

          <p className="mt-6 text-center text-[11px] text-neutral-400">
            Print produces a Customer Copy and a Company Copy in one action.
          </p>
        </div>

        {/* ── Print-only: Customer Copy + Company Copy (two pages, one click) ── */}
        <div className="print-area print-only">
          <PrintCopy
            copyLabel="Customer Copy"
            logo={logo} companyName={companyName} sym={sym} order={order} branch={branch}
            printRows={printRows} packingPrintRows={packingPrintRows} printDate={printDate} printTime={printTime}
            prevBalanceQty={prevBalanceQty} prevBalanceAmount={prevBalanceAmount}
            returnRows={returnRows} returnsQty={returnsQty} returnsAmount={returnsAmount} collectionAmount={collectionAmount}
            receiptFooter={settings?.receiptFooter ?? null}
          />
          <PrintCopy
            copyLabel="Company Copy"
            logo={logo} companyName={companyName} sym={sym} order={order} branch={branch}
            printRows={printRows} packingPrintRows={packingPrintRows} printDate={printDate} printTime={printTime}
            prevBalanceQty={prevBalanceQty} prevBalanceAmount={prevBalanceAmount}
            returnRows={returnRows} returnsQty={returnsQty} returnsAmount={returnsAmount} collectionAmount={collectionAmount}
            receiptFooter={settings?.receiptFooter ?? null}
          />
        </div>
      </div>

      {/* Action bar — hidden on print */}
      <div className="no-print shrink-0 flex flex-wrap items-center justify-end gap-2 border-t bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button variant="outline" onClick={onClose} disabled={reviewing}>Close</Button>
        {!readOnly && (
          <>
            <Button variant="outline" onClick={() => setEditing((e) => !e)} disabled={reviewing}>
              <Pencil className="mr-1.5 h-4 w-4" /> {editing ? 'Done' : 'Change Quantity'}
            </Button>
            <Button variant="outline" className="text-red-600" onClick={reject} disabled={reviewing}>
              <XCircle className="mr-1.5 h-4 w-4" /> Reject
            </Button>
            <Button onClick={approve} disabled={reviewing}>
              {reviewing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />} Approve
            </Button>
          </>
        )}
        {/* Says "Print" or "Save as PDF" depending on the device — same action either way. */}
        <PrintButton variant="secondary" onPrint={print} disabled={reviewing} />
      </div>
    </>
  );
}

interface PrintRow {
  productName: string;
  previousBalance: number;
  newDemand: number;
  totalDemand: number;
  approved: number;
  unitPrice: number;
  amount: number;
}

function SlipHeader({ logo, companyName, status, branch, copyLabel }: { logo?: string; companyName: string; status: string; branch: Branch | null; copyLabel?: string }) {
  return (
    <div className="border-b border-neutral-300 pb-3">
      {copyLabel && <p className="text-center text-[11px] font-bold uppercase tracking-[0.25em] text-neutral-500">{copyLabel}</p>}
      <div className={`flex items-start gap-3 ${copyLabel ? 'mt-1' : ''}`}>
        {logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logo} alt="logo" className="h-14 w-14 shrink-0 object-contain sm:h-16 sm:w-16" />
        )}
        <div className="min-w-0 flex-1 text-center">
          <h2 className="text-lg font-bold leading-tight sm:text-xl">{companyName}</h2>
          <p className="text-xs font-medium text-neutral-600">Production Department</p>
          {branch?.name && <p className="text-[11px] text-neutral-600">{branch.name}</p>}
          {branch?.address && <p className="text-[11px] text-neutral-600">{branch.address}{branch.city ? `, ${branch.city}` : ''}</p>}
          {branch?.phone && <p className="text-[11px] text-neutral-600">Phone: {branch.phone}</p>}
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${STATUS_STYLES[status] ?? 'bg-neutral-200 text-neutral-700'}`}>
          {status}
        </span>
      </div>
    </div>
  );
}

function OrderMeta({ order }: { order: BranchProductionOrder }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1 pt-3 text-[11px] sm:grid-cols-3">
      <MetaKV k="Order #" v={slipReference(order)} mono />
      <MetaKV k="Business Date" v={order.date} />
      <MetaKV k="Time" v={order.time} />
      <MetaKV k="Branch" v={order.branchName} />
      <MetaKV k="Requested By" v={order.createdByName} />
      <MetaKV k="Status" v={order.status} />
    </div>
  );
}

function MetaKV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <span className="text-neutral-500">{k}: </span>
      <span className={`font-medium break-words ${mono ? 'font-mono' : ''}`}>{v || '—'}</span>
    </div>
  );
}

/**
 * One printed copy (Customer or Company) — a full A4 delivery challan. Both copies
 * carry identical information (spec); only the corner watermark label differs. The
 * product table lists approved products only, with derived amounts and grand total.
 */
function PrintCopy({
  copyLabel, logo, companyName, sym, order, branch, printRows, packingPrintRows, printDate, printTime,
  prevBalanceQty, prevBalanceAmount, returnRows, returnsQty, returnsAmount, collectionAmount, receiptFooter,
}: {
  copyLabel: string;
  logo?: string;
  companyName: string;
  sym: string;
  order: BranchProductionOrder;
  branch: Branch | null;
  printRows: PrintRow[];
  /** Approved packing lines. Empty on a products-only demand. */
  packingPrintRows: { materialName: string; qty: number }[];
  printDate: string;
  printTime: string;
  prevBalanceQty: number;
  prevBalanceAmount: number;
  /** Items this branch returned the previous business day, accepted into the pool. */
  returnRows: { productName: string; qty: number; amount: number }[];
  returnsQty: number;
  returnsAmount: number;
  /** prevBalanceAmount net of returnsAmount — what the rider actually collects. */
  collectionAmount: number;
  receiptFooter: string | null;
}) {
  const items = printRows.filter((r) => r.approved > 0);
  // Same rule as products: the slip is a delivery document, so it lists what is
  // actually going out — a line approved down to zero is not delivered.
  const packingItems = packingPrintRows.filter((p) => p.qty > 0);
  const totalQty = items.reduce((a, r) => a + r.approved, 0);
  const grandTotal = items.reduce((a, r) => a + r.amount, 0);
  const hasPrevBalance = prevBalanceQty > 0;

  return (
    <div className="production-slip print-page relative mx-auto w-full max-w-[720px] bg-white p-6 text-black">
      {/* Large corner watermark identifying the copy */}
      <span className="copy-watermark pointer-events-none absolute right-3 top-3 select-none text-right text-2xl font-black uppercase leading-none tracking-widest text-neutral-200 sm:text-3xl">
        {copyLabel}
      </span>

      {/* Header */}
      <div className="avoid-break border-b-2 border-neutral-800 pb-3">
        <div className="flex items-start gap-3">
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="logo" className="h-16 w-16 shrink-0 object-contain" />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="text-xl font-bold leading-tight">{companyName}</h2>
            <p className="text-xs font-medium text-neutral-600">Production Department</p>
            <p className="mt-0.5 text-sm font-semibold uppercase tracking-wide text-neutral-800">Production Order</p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 pr-24 text-[11px] sm:grid-cols-3">
          <MetaKV k="Production Order No" v={slipReference(order)} mono />
          <MetaKV k="Business Date" v={order.date} />
          <MetaKV k="Branch" v={order.branchName} />
          <MetaKV k="Print Date" v={printDate} />
          <MetaKV k="Print Time" v={printTime} />
          <div className="min-w-0">
            <span className="text-neutral-500">Status: </span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${STATUS_STYLES[order.status] ?? 'bg-neutral-200 text-neutral-700'}`}>{order.status}</span>
          </div>
        </div>
      </div>

      {/* Previous order balance — above the product table */}
      <div className="avoid-break mt-3 rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2">
        <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-500">Previous Order Balance</p>
        {hasPrevBalance ? (
          <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-0.5 text-[11px] sm:grid-cols-4">
            <MetaKV k="Previous Pending Qty" v={fmt(prevBalanceQty)} />
            <MetaKV k="Previous Pending Amount" v={money(prevBalanceAmount, sym)} />
            <MetaKV k="Previous Order No" v="—" />
            <MetaKV k="Previous Business Date" v="—" />
            <MetaKV k="Returned (Prev. Day)" v={returnsQty > 0 ? `${fmt(returnsQty)} · ${money(returnsAmount, sym)}` : '—'} />
            <MetaKV k="Amount to Collect" v={money(collectionAmount, sym)} />
          </div>
        ) : (
          <p className="mt-1 text-[11px] font-medium text-neutral-500">No Previous Balance</p>
        )}
      </div>

      {/* Return items — accepted the previous business day. Rendered only when the
          branch actually returned something, so an ordinary slip is unchanged. */}
      {returnRows.length > 0 && (
        <div className="avoid-break mt-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-500">Return Items (Previous Day)</p>
          <table className="mt-1 w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-y border-neutral-400 text-left">
                <th className="py-1 pr-1 font-semibold">Product</th>
                <th className="px-1 py-1 text-right font-semibold">Qty</th>
                <th className="py-1 pl-1 text-right font-semibold">Value</th>
              </tr>
            </thead>
            <tbody>
              {returnRows.map((r) => (
                <tr key={r.productName} className="border-b border-neutral-200">
                  <td className="py-1 pr-1 font-medium">{r.productName}</td>
                  <td className="px-1 py-1 text-right tabular-nums">{fmt(r.qty)}</td>
                  <td className="py-1 pl-1 text-right font-semibold tabular-nums">{money(r.amount, sym)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-neutral-400 font-bold">
                <td className="pt-1.5">Total</td>
                <td className="px-1 pt-1.5 text-right tabular-nums">{fmt(returnsQty)}</td>
                <td className="pt-1.5 pl-1 text-right tabular-nums">{money(returnsAmount, sym)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Approved products */}
      <table className="mt-3 w-full border-collapse text-[11px]">
        <thead>
          <tr className="border-y border-neutral-400 text-left">
            <th className="py-1 pr-1 font-semibold">Product</th>
            <th className="px-1 py-1 text-right font-semibold">Approved Qty</th>
            <th className="px-1 py-1 text-right font-semibold">Unit Price</th>
            <th className="py-1 pl-1 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {items.length === 0 ? (
            <tr><td colSpan={4} className="py-3 text-center text-neutral-500">No approved products.</td></tr>
          ) : items.map((r) => (
            <tr key={r.productName} className="border-b border-neutral-200 align-top">
              <td className="py-1 pr-1 font-medium">{r.productName}</td>
              <td className="px-1 py-1 text-right font-semibold tabular-nums">{fmt(r.approved)}</td>
              <td className="px-1 py-1 text-right tabular-nums">{money(r.unitPrice, sym)}</td>
              <td className="py-1 pl-1 text-right font-semibold tabular-nums">{money(r.amount, sym)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-neutral-400 font-bold">
            <td className="pt-1.5">Totals</td>
            <td className="px-1 pt-1.5 text-right tabular-nums">{fmt(totalQty)}</td>
            <td className="pt-1.5"></td>
            <td className="pt-1.5 pl-1 text-right tabular-nums">{money(grandTotal, sym)}</td>
          </tr>
        </tfoot>
      </table>

      {/* Totals recap */}
      <div className="avoid-break mt-2 ml-auto w-full max-w-[240px] space-y-0.5 text-[11px]">
        <div className="flex justify-between"><span className="text-neutral-600">Total Qty</span><span className="font-semibold tabular-nums">{fmt(totalQty)}</span></div>
        <div className="flex justify-between border-t border-neutral-300 pt-0.5 text-sm font-bold"><span>Grand Total Amount</span><span className="tabular-nums">{money(grandTotal, sym)}</span></div>
      </div>

      {/* Packing materials — its own table, below the products and outside the
          money totals. These carry no price, so they must never fold into the
          grand total. Omitted entirely when the demand has none, which keeps an
          ordinary slip byte-identical to before. */}
      {packingItems.length > 0 && (
        <div className="avoid-break mt-5">
          <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-500">Packing Materials</p>
          <table className="mt-1 w-full border-collapse text-[11px]">
            <thead>
              <tr className="border-y border-neutral-400 text-left">
                <th className="py-1 pr-1 font-semibold">Item</th>
                <th className="py-1 pl-1 text-right font-semibold">Qty</th>
              </tr>
            </thead>
            <tbody>
              {packingItems.map((p) => (
                <tr key={p.materialName} className="border-b border-neutral-200">
                  <td className="py-1 pr-1 font-medium">{p.materialName}</td>
                  <td className="py-1 pl-1 text-right font-semibold tabular-nums">{fmt(p.qty)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-neutral-400 font-bold">
                <td className="pt-1.5">Total</td>
                <td className="pt-1.5 pl-1 text-right tabular-nums">
                  {fmt(packingItems.reduce((a, p) => a + p.qty, 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Payment */}
      <div className="avoid-break mt-5 rounded-md border border-neutral-300 p-3">
        <p className="text-[10px] font-bold uppercase tracking-wide text-neutral-500">Payment</p>
        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <FillField label="Cash Paid" prefix={sym} />
          <FillField label="Payment Status" />
          <FillField label="Received By (Rider)" />
          <FillField label="Signature" />
        </div>
      </div>

      {/* Footer */}
      <div className="mt-6 border-t border-neutral-300 pt-3 text-center text-[10px] text-neutral-600">
        <p className="text-xs font-semibold text-neutral-800">{companyName}</p>
        <p className="font-medium">{receiptFooter || 'Thank you'}</p>
        {branch?.phone && <p>Phone: {branch.phone}</p>}
      </div>
    </div>
  );
}

/** A labeled fill-in row: an optional printed value sitting on a signature rule. */
function FillField({ label, value, prefix }: { label: string; value?: string; prefix?: string }) {
  return (
    <div className="text-[11px]">
      <p className="text-[9px] font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
      <div className="mt-3 flex min-h-[18px] items-end gap-1 border-b border-neutral-500 pb-0.5">
        {prefix && value == null && <span className="text-neutral-400">{prefix}</span>}
        <span className="font-medium">{value ?? ''}</span>
      </div>
    </div>
  );
}

function Field({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
      <p className={`tabular-nums ${strong ? 'font-semibold text-primary' : ''}`}>{value}</p>
    </div>
  );
}
