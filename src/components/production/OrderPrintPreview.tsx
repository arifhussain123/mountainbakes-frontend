'use client';

import { useState } from 'react';
import type { AppSettings, Branch, BranchProductionOrder, BranchProductionOrderItem } from '@mb/shared';
import type { ReviewOrderPayload } from '@/lib/queries';
import { useProductionBalances, useProducts, useBranches, useAddProductionOrderItem, usePreviousOrderBalance } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PrintButton } from '@/components/shared/PrintButton';
import { PrintPortal } from '@/components/shared/PrintPortal';
import { CheckCircle2, XCircle, Loader2, Pencil, ClipboardCheck, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { COMPANY_NAME } from '@/utils/constants';
import { formatDate, formatTime } from '@/utils/date';

/** Human reference for the slip header (production_orders has no orderNumber field). */
export function slipReference(order: Pick<BranchProductionOrder, 'date' | 'time'>): string {
  return `PO-${(order.date || '').replace(/-/g, '')}-${(order.time || '').replace(':', '')}`;
}

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  awaiting_verification: 'bg-blue-100 text-blue-700',
  verified: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<string, string> = {
  awaiting_verification: 'Awaiting Verification',
  verified: 'Verified — Awaiting Approval',
};

/** Every other status already reads fine capitalized as-is; only this one needs a real label. */
function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

function digits(raw: string): string {
  return raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
}

const fmt = (n: number) => n.toLocaleString();
const money = (n: number, sym: string) => `${sym}${Math.round(n).toLocaleString()}`;

/** Split into `parts` roughly-equal, contiguous chunks (drops empty tail chunks). */
function chunk<T>(arr: T[], parts: number): T[][] {
  const size = Math.ceil(arr.length / parts);
  return Array.from({ length: parts }, (_, i) => arr.slice(i * size, i * size + size)).filter((c) => c.length > 0);
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
  /** Production's closing sign-off on a branch-verified order. */
  finalApprove: (id: string) => Promise<unknown>;
  finalApproving: boolean;
}

/**
 * Production Order print preview / delivery challan. The on-screen half is the
 * review surface (approve / adjust approved quantities — amounts recalc live).
 * Printing emits TWO copies on ONE sheet — Customer Copy on the top half, Company
 * Copy on the bottom half, split by a cut line — each a challan with prices,
 * totals, the previous-day return items and the net amount to collect against the
 * previous demand (the Company Copy also carries the cash-payment acknowledgement).
 */
export function OrderPrintPreview({ open, onOpenChange, order, settings, token, review, reviewing, markPrinted, finalApprove, finalApproving }: OrderPrintPreviewProps) {
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
            finalApprove={finalApprove}
            finalApproving={finalApproving}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PreviewBody({
  order, settings, token, review, reviewing, markPrinted, finalApprove, finalApproving, onClose,
}: {
  order: BranchProductionOrder;
  settings: AppSettings | null;
  token: string;
  review: (payload: ReviewOrderPayload) => Promise<unknown>;
  reviewing: boolean;
  markPrinted: (id: string) => Promise<unknown>;
  finalApprove: (id: string) => Promise<unknown>;
  finalApproving: boolean;
  onClose: () => void;
}) {
  const readOnly = order.status !== 'pending';
  // Item balance fields (previousBalanceQty/totalRequiredQty/approvedQty) are
  // frozen onto the row by review_production_order the moment the order leaves
  // 'pending', and verification overwrites approvedQty with the counted figure.
  // All three post-review states therefore read the stored values, never live
  // balances — a rejected order has none, so it keeps the live path.
  const frozen =
    order.status === 'awaiting_verification' ||
    order.status === 'verified' ||
    order.status === 'approved';
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [packingEdits, setPackingEdits] = useState<Record<string, string>>({});
  const [reason, setReason] = useState(order.changeReason ?? '');
  // 'slip' = the Customer/Company Copy challan; 'check' = the simplified
  // Production Check sheet (branch, product, qty, amount only).
  const [printMode, setPrintMode] = useState<'slip' | 'check'>('slip');
  const [addingProduct, setAddingProduct] = useState(false);
  const [addProductId, setAddProductId] = useState('');
  const [addQty, setAddQty] = useState('');

  const balancesQ = useProductionBalances(token, { branchId: order.branchId, enabled: order.status === 'pending' });
  const liveBalances = balancesQ.data ?? {};
  const productsQ = useProducts(token);
  const branchesQ = useBranches(token);
  const addItemMut = useAddProductionOrderItem(token);
  const prevBalanceQ = usePreviousOrderBalance(token, order.id);

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

  const now = new Date();
  const printDate = formatDate(now);
  const printTime = formatTime(now);


  // The receivable for the PREVIOUS delivery — server-computed, because
  // company_share_pct lives in finance_settings and production users cannot read
  // it. This is NOT `production_balances`: that is unmet demand (goods owed TO
  // the branch), which is the opposite direction from money to collect.
  const prevBal = prevBalanceQ.data;
  // Itemised by the server from the same rows it totalled, so the lines printed
  // are by construction the ones deducted — a client-side re-filter could drift
  // from the total and make the slip unauditable at the counter.
  const returnRows = prevBal?.returnItems ?? [];
  const returnsQty = returnRows.reduce((a, r) => a + r.qty, 0);
  const deliveredValue = prevBal?.deliveredValue ?? 0;
  const companySharePct = prevBal?.companySharePct ?? 0;
  const companyShareValue = prevBal?.companyShareValue ?? 0;
  const returnsAmount = prevBal?.returnsValue ?? 0;
  const collectionAmount = prevBal?.amountToCollect ?? 0;
  const previousRef = prevBal?.previous ?? null;
  const hasPrevBalance = !!previousRef;

  // Stock still transfers to the branch here, same as the old direct-to-'approved'
  // outcome — only the label changes. The order becomes 'approved' once the
  // branch checks what physically arrived and verifies it (BranchOrderDetail).
  async function submitForVerification() {
    try {
      await review({ id: order.id, status: 'awaiting_verification', approvedItems, approvedPackingItems, reason: changed ? reason : undefined });
      toast.success('Sent to branch for verification — stock transferred');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to submit order');
    }
  }

  async function addProduct() {
    const qty = parseInt(addQty, 10);
    if (!addProductId || !qty || qty <= 0) return;
    try {
      await addItemMut.mutateAsync({ id: order.id, productId: addProductId, qty });
      toast.success('Product added to the demand');
      setAddingProduct(false);
      setAddProductId('');
      setAddQty('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add product');
    }
  }

  // Closing sign-off on an order the branch has already verified. Status only —
  // the stock moved at verification, which is why there is no reject beside it.
  async function approveFinal() {
    try {
      await finalApprove(order.id);
      toast.success('Order approved');
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

  // Wait for the browser's own 'afterprint' signal before closing the dialog,
  // instead of closing right after calling window.print(). window.print() does
  // NOT reliably block script execution across browsers — closing immediately
  // can unmount the print-only content (and the dialog itself) before the
  // browser has actually captured it, which is what made the preview look
  // empty. 'afterprint' fires once the print dialog is dismissed either way
  // (printed or cancelled), so the content is guaranteed to still be in the
  // DOM while printing happens.
  function printAndClose() {
    function done() {
      window.removeEventListener('afterprint', done);
      onClose();
    }
    window.addEventListener('afterprint', done);
    window.print();
  }

  // Print only prints — it no longer submits a pending demand as a side effect.
  // Submission is a deliberate action via the Submit for Verification button;
  // Print previews/prints whatever is currently on screen (requested quantities
  // while still pending).
  function print() {
    setEditing(false);
    setPrintMode('slip');
    markPrinted(order.id).catch(() => {});
    setTimeout(printAndClose, 300);
  }

  // A separate, simplified sheet for the floor — branch, product, qty, amount
  // only, laid out in 2-3 columns when there are many items so a long demand
  // still fits on one page. Doesn't touch markPrinted: that flag tracks the
  // official delivery slip, not this internal stock-check aid.
  function printCheck() {
    setEditing(false);
    setPrintMode('check');
    setTimeout(printAndClose, 300);
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

          {/* Add a product not on the original demand — before submission only;
              once submitted the branch's own verify step is where extra items
              that arrived unrequested get added. */}
          {addingProduct && !readOnly && (
            <div className="mt-4 flex flex-col gap-2 rounded-lg border border-neutral-300 bg-neutral-50 p-3 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1 space-y-1">
                <label className="text-xs font-medium text-neutral-600">Product</label>
                <Select value={addProductId} onValueChange={(v) => v && setAddProductId(v)}>
                  <SelectTrigger className="h-9 w-full bg-white">
                    <SelectValue placeholder={productsQ.isLoading ? 'Loading…' : 'Select a product'} />
                  </SelectTrigger>
                  <SelectContent>
                    {(productsQ.data ?? [])
                      .filter((p) => !order.items.some((it) => it.productId === p.id))
                      .map((p) => (
                        <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 sm:w-28">
                <label className="text-xs font-medium text-neutral-600">Qty</label>
                <Input
                  type="text"
                  inputMode="numeric"
                  value={addQty}
                  onChange={(e) => setAddQty(digits(e.target.value))}
                  className="h-9 bg-white"
                />
              </div>
              <Button
                className="h-9"
                disabled={!addProductId || !addQty || addItemMut.isPending}
                onClick={addProduct}
              >
                {addItemMut.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null} Add
              </Button>
            </div>
          )}

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

          {/* Previous balance & returns — same figures the Company Copy prints,
              shown on screen too so this isn't only visible after clicking Print. */}
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-600">
              Previous Order Balance
            </h3>
            {prevBalanceQ.isLoading ? (
              <p className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-500">Loading…</p>
            ) : hasPrevBalance ? (
              // Every step is shown, not just the total: this is collected in
              // cash at the counter, so the figure has to be checkable by hand.
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs sm:grid-cols-5">
                <Field label="Previous Order" value={`${previousRef!.demandNumber} · ${previousRef!.date}`} />
                <Field label="Delivered Value" value={money(deliveredValue, sym)} />
                <Field label={`Company Share (${companySharePct}%)`} value={money(companyShareValue, sym)} />
                <Field label="Less Returns" value={returnsQty > 0 ? `${fmt(returnsQty)} · ${money(returnsAmount, sym)}` : '—'} />
                <Field label="Amount to Collect" value={money(collectionAmount, sym)} strong />
              </div>
            ) : (
              <p className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-500">
                No previous delivery for this branch — nothing to collect.
              </p>
            )}

            {returnRows.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-y border-neutral-300 text-left">
                      <th className="py-1.5 pr-2 font-semibold">Returned Product (Since Last Order)</th>
                      <th className="px-2 py-1.5 text-right font-semibold">Qty</th>
                      <th className="py-1.5 pl-2 text-right font-semibold">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {returnRows.map((r) => (
                      <tr key={r.productName} className="border-b border-neutral-200">
                        <td className="py-1.5 pr-2 font-medium">{r.productName}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{fmt(r.qty)}</td>
                        <td className="py-1.5 pl-2 text-right font-semibold tabular-nums">{money(r.amount, sym)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {editing && !readOnly && changed && (
            <div className="mt-4 space-y-1">
              <label className="text-sm font-medium">Reason for change</label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why was the quantity adjusted?" />
            </div>
          )}

          <p className="mt-6 text-center text-[11px] text-neutral-400">
            Print produces one page — Customer Copy on top, Company Copy below the cut line.
          </p>
        </div>

      </div>

      {/* ── Print-only: either the Customer/Company Copy pair, or the
          Production Check sheet — whichever printCheck()/print() picked.

          Portalled to <body> deliberately. Left inside the dialog it is an
          absolutely positioned box inside a fixed, translated, overflow-clipped
          ancestor, and the printer only ever gets the part that fits the dialog
          — see PrintPortal. ── */}
      <PrintPortal>
        {printMode === 'slip' ? (
          /* One demand = ONE sheet: Customer Copy on the top half, Company Copy on
             the bottom half, with a cut line between them. See `.print-sheet` /
             `.print-half` in globals.css. */
          <div className="print-sheet">
            <PrintCopy
              copyLabel="Customer Copy"
              logo={logo} companyName={companyName} sym={sym} order={order}
              printRows={printRows} packingPrintRows={packingPrintRows} printDate={printDate} printTime={printTime}
              previousRef={previousRef} deliveredValue={deliveredValue}
              companySharePct={companySharePct} companyShareValue={companyShareValue}
              returnRows={returnRows} returnsQty={returnsQty} returnsAmount={returnsAmount} collectionAmount={collectionAmount}
            />
            <PrintCopy
              copyLabel="Company Copy"
              logo={logo} companyName={companyName} sym={sym} order={order}
              printRows={printRows} packingPrintRows={packingPrintRows} printDate={printDate} printTime={printTime}
              previousRef={previousRef} deliveredValue={deliveredValue}
              companySharePct={companySharePct} companyShareValue={companyShareValue}
              returnRows={returnRows} returnsQty={returnsQty} returnsAmount={returnsAmount} collectionAmount={collectionAmount}
            />
          </div>
        ) : (
          <ProductionCheckSheet order={order} printRows={printRows} sym={sym} printDate={printDate} />
        )}
      </PrintPortal>

      {/* Action bar — hidden on print */}
      <div className="no-print shrink-0 flex flex-wrap items-center justify-end gap-2 border-t bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button variant="outline" onClick={onClose} disabled={reviewing}>Close</Button>
        {/* The branch has counted the goods and stock has already moved; this is
            Production's closing sign-off. No Reject beside it on purpose —
            undoing it would mean clawing stock back out of branch inventory. */}
        {order.status === 'verified' && (
          <Button onClick={approveFinal} disabled={finalApproving}>
            {finalApproving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />} Approve
          </Button>
        )}
        {/* Terminal state, not a control: once approved, Production has nothing
            left to act on, and an empty button row read as "still loading"
            rather than "done". Disabled at full opacity — dimming it would
            undercut the one thing it exists to say. */}
        {order.status === 'approved' && (
          <Button
            variant="outline"
            disabled
            className="border-emerald-300 bg-emerald-50 text-emerald-700 disabled:opacity-100 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-400"
          >
            <CheckCircle2 className="mr-1.5 h-4 w-4" /> Approved
          </Button>
        )}
        {!readOnly && (
          <>
            <Button variant="outline" onClick={() => setAddingProduct((a) => !a)} disabled={reviewing}>
              <Plus className="mr-1.5 h-4 w-4" /> Add Product
            </Button>
            <Button variant="outline" onClick={() => setEditing((e) => !e)} disabled={reviewing}>
              <Pencil className="mr-1.5 h-4 w-4" /> {editing ? 'Done' : 'Change Quantity'}
            </Button>
            <Button variant="outline" className="text-red-600" onClick={reject} disabled={reviewing}>
              <XCircle className="mr-1.5 h-4 w-4" /> Reject
            </Button>
            <Button onClick={submitForVerification} disabled={reviewing}>
              {reviewing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />} Submit for Verification
            </Button>
          </>
        )}
        {/* Simplified branch/product/qty/amount sheet for the production floor —
            not a customer-facing document, so no printer/PDF picker menu. */}
        <Button variant="outline" onClick={printCheck} disabled={reviewing}>
          <ClipboardCheck className="mr-1.5 h-4 w-4" /> Production Check
        </Button>
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
          {statusLabel(status)}
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
      <MetaKV k="Status" v={statusLabel(order.status)} />
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
 * One printed copy (Customer or Company) — HALF of an A4 delivery challan: the two
 * copies share one sheet, Customer on top, Company below the cut line. Both carry
 * identical information (spec); only the corner watermark label differs. The
 * product table lists approved products only, with derived amounts and grand total.
 *
 * Everything here is sized for a half page, so the spacing/type scale is tighter
 * than a standalone document and the column split kicks in far sooner — see `cols`.
 */
function PrintCopy({
  copyLabel, logo, companyName, sym, order, printRows, packingPrintRows, printDate, printTime,
  previousRef, deliveredValue, companySharePct, companyShareValue,
  returnRows, returnsQty, returnsAmount, collectionAmount,
}: {
  copyLabel: string;
  logo?: string;
  companyName: string;
  sym: string;
  order: BranchProductionOrder;
  printRows: PrintRow[];
  /** Approved packing lines. Empty on a products-only demand. */
  packingPrintRows: { materialName: string; qty: number }[];
  printDate: string;
  printTime: string;
  /** The preceding delivered order this slip bills for; null if there isn't one. */
  previousRef: { demandNumber: string; date: string } | null;
  /** That order's delivered goods value (approved qty × unit price). */
  deliveredValue: number;
  companySharePct: number;
  /** deliveredValue × companySharePct. */
  companyShareValue: number;
  /** Accepted returns received since the order being billed, itemised by the server. */
  returnRows: { productName: string; qty: number; amount: number }[];
  returnsQty: number;
  returnsAmount: number;
  /** companyShareValue less returnsAmount — what the rider actually collects. */
  collectionAmount: number;
}) {
  const items = printRows.filter((r) => r.approved > 0);
  // Same rule as products: the slip is a delivery document, so it lists what is
  // actually going out — a line approved down to zero is not delivered.
  const packingItems = packingPrintRows.filter((p) => p.qty > 0);
  const totalQty = items.reduce((a, r) => a + r.approved, 0);
  const grandTotal = items.reduce((a, r) => a + r.amount, 0);
  const hasPrevBalance = !!previousRef;
  const isCompanyCopy = copyLabel === 'Company Copy';
  // A long demand splits into 2-3 side-by-side columns so it still fits its half
  // page instead of a long single-column list; the Totals recap below already
  // covers the grand total, so split tables skip their own <tfoot>. Thresholds are
  // roughly half the full-page ones, because a copy now gets half the height.
  const cols = items.length > 16 ? 3 : items.length > 6 ? 2 : 1;
  const groups = chunk(items, cols);

  return (
    <div className="production-slip print-half relative mx-auto w-full max-w-[720px] bg-white px-5 py-3 text-black">
      {/* Large corner watermark identifying the copy */}
      <span className="copy-watermark pointer-events-none absolute right-2 top-2 select-none text-right text-base font-black uppercase leading-none tracking-widest text-neutral-300">
        {copyLabel}
      </span>

      {/* Header — the branded name/department/order-type lines are dropped on the
          Company Copy, which is an internal working copy, not a customer-facing
          document. The watermark above and the meta grid below still identify it. */}
      <div className="avoid-break border-b-2 border-neutral-800 pb-1.5">
        <div className="flex items-start gap-2">
          {logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt="logo" className="h-9 w-9 shrink-0 object-contain" />
          )}
          {!isCompanyCopy && (
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-bold leading-tight">{companyName}</h2>
              <p className="text-[10px] font-medium leading-tight text-neutral-600">Production Department</p>
              <p className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-neutral-800">Production Order</p>
            </div>
          )}
        </div>
        <div className="mt-1.5 grid grid-cols-3 gap-x-4 pr-20 text-[9px] leading-tight">
          <MetaKV k="Production Order No" v={slipReference(order)} mono />
          <MetaKV k="Business Date" v={order.date} />
          <MetaKV k="Branch" v={order.branchName} />
          <MetaKV k="Print Date" v={printDate} />
          <MetaKV k="Print Time" v={printTime} />
          <div className="min-w-0">
            <span className="text-neutral-500">Status: </span>
            <span className={`rounded-full px-1.5 text-[9px] font-semibold uppercase ${STATUS_STYLES[order.status] ?? 'bg-neutral-200 text-neutral-700'}`}>{statusLabel(order.status)}</span>
          </div>
        </div>
      </div>

      {/* Previous order balance + return netting — Company Copy only. This is
          internal reconciliation between production and the branch; the customer
          doesn't need it on their delivery receipt. */}
      {isCompanyCopy && (
        <>
          <div className="avoid-break mt-1.5 rounded border border-neutral-300 bg-neutral-50 px-2 py-1">
            <p className="text-[9px] font-bold uppercase tracking-wide text-neutral-500">Previous Order Balance</p>
            {hasPrevBalance ? (
              // Full working shown, not just the total — this is counted out in
              // cash at the counter and has to be verifiable line by line.
              <div className="grid grid-cols-3 gap-x-4 text-[9px] leading-tight">
                <MetaKV k="Previous Order No" v={previousRef!.demandNumber} mono />
                <MetaKV k="Previous Business Date" v={previousRef!.date} />
                <MetaKV k="Delivered Value" v={money(deliveredValue, sym)} />
                <MetaKV k={`Company Share (${companySharePct}%)`} v={money(companyShareValue, sym)} />
                <MetaKV k="Less Returns" v={returnsQty > 0 ? `${fmt(returnsQty)} · ${money(returnsAmount, sym)}` : '—'} />
                <MetaKV k="Amount to Collect" v={money(collectionAmount, sym)} />
              </div>
            ) : (
              <p className="text-[9px] font-medium text-neutral-500">
                No previous delivery for this branch — nothing to collect.
              </p>
            )}
          </div>

          {/* Return items — accepted the previous business day. Rendered only when
              the branch actually returned something, so an ordinary slip is
              unchanged. */}
          {returnRows.length > 0 && (
            <div className="avoid-break mt-1.5">
              <p className="text-[9px] font-bold uppercase tracking-wide text-neutral-500">Return Items (Since Last Order)</p>
              <table className="w-full border-collapse text-[9px] leading-tight">
                <thead>
                  <tr className="border-y border-neutral-400 text-left">
                    <th className="py-0.5 pr-1 font-semibold">Product</th>
                    <th className="px-1 py-0.5 text-right font-semibold">Qty</th>
                    <th className="py-0.5 pl-1 text-right font-semibold">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {returnRows.map((r) => (
                    <tr key={r.productName} className="border-b border-neutral-200">
                      <td className="py-0.5 pr-1 font-medium">{r.productName}</td>
                      <td className="px-1 py-0.5 text-right tabular-nums">{fmt(r.qty)}</td>
                      <td className="py-0.5 pl-1 text-right font-semibold tabular-nums">{money(r.amount, sym)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-neutral-400 font-bold">
                    <td className="pt-0.5">Total</td>
                    <td className="px-1 pt-0.5 text-right tabular-nums">{fmt(returnsQty)}</td>
                    <td className="pt-0.5 pl-1 text-right tabular-nums">{money(returnsAmount, sym)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}

      {/* Approved products */}
      {items.length === 0 ? (
        <table className="mt-1.5 w-full border-collapse text-[9px] leading-tight">
          <thead>
            <tr className="border-y border-neutral-400 text-left">
              <th className="py-0.5 pr-1 font-semibold">Product</th>
              <th className="px-1 py-0.5 text-right font-semibold">Approved Qty</th>
              <th className="px-1 py-0.5 text-right font-semibold">Unit Price</th>
              <th className="py-0.5 pl-1 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr><td colSpan={4} className="py-2 text-center text-neutral-500">No approved products.</td></tr>
          </tbody>
        </table>
      ) : cols === 1 ? (
        <table className="mt-1.5 w-full border-collapse text-[9px] leading-tight">
          <thead>
            <tr className="border-y border-neutral-400 text-left">
              <th className="py-0.5 pr-1 font-semibold">Product</th>
              <th className="px-1 py-0.5 text-right font-semibold">Approved Qty</th>
              <th className="px-1 py-0.5 text-right font-semibold">Unit Price</th>
              <th className="py-0.5 pl-1 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.productName} className="border-b border-neutral-200 align-top">
                <td className="py-0.5 pr-1 font-medium">{r.productName}</td>
                <td className="px-1 py-0.5 text-right font-semibold tabular-nums">{fmt(r.approved)}</td>
                <td className="px-1 py-0.5 text-right tabular-nums">{money(r.unitPrice, sym)}</td>
                <td className="py-0.5 pl-1 text-right font-semibold tabular-nums">{money(r.amount, sym)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-neutral-400 font-bold">
              <td className="pt-0.5">Totals</td>
              <td className="px-1 pt-0.5 text-right tabular-nums">{fmt(totalQty)}</td>
              <td className="pt-0.5"></td>
              <td className="pt-0.5 pl-1 text-right tabular-nums">{money(grandTotal, sym)}</td>
            </tr>
          </tfoot>
        </table>
      ) : (
        <div className={`avoid-break mt-1.5 grid gap-x-3 ${cols === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
          {groups.map((group, gi) => (
            <table key={gi} className="w-full border-collapse text-[9px] leading-tight">
              <thead>
                <tr className="border-y border-neutral-400 text-left">
                  <th className="py-0.5 pr-1 font-semibold">Product</th>
                  <th className="px-1 py-0.5 text-right font-semibold">Qty</th>
                  <th className="px-1 py-0.5 text-right font-semibold">Price</th>
                  <th className="py-0.5 pl-1 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {group.map((r) => (
                  <tr key={r.productName} className="border-b border-neutral-200 align-top">
                    <td className="py-0.5 pr-1 font-medium">{r.productName}</td>
                    <td className="px-1 py-0.5 text-right font-semibold tabular-nums">{fmt(r.approved)}</td>
                    <td className="px-1 py-0.5 text-right tabular-nums">{money(r.unitPrice, sym)}</td>
                    <td className="py-0.5 pl-1 text-right font-semibold tabular-nums">{money(r.amount, sym)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      )}

      {/* Totals recap */}
      <div className="avoid-break mt-1 ml-auto w-full max-w-[220px] text-[9px] leading-tight">
        <div className="flex justify-between"><span className="text-neutral-600">Total Qty</span><span className="font-semibold tabular-nums">{fmt(totalQty)}</span></div>
        <div className="flex justify-between border-t border-neutral-300 text-[11px] font-bold"><span>Grand Total Amount</span><span className="tabular-nums">{money(grandTotal, sym)}</span></div>
      </div>

      {/* Packing materials — its own table, below the products and outside the
          money totals. These carry no price, so they must never fold into the
          grand total. Omitted entirely when the demand has none, which keeps an
          ordinary slip byte-identical to before. */}
      {packingItems.length > 0 && (
        <div className="avoid-break mt-1.5">
          <p className="text-[9px] font-bold uppercase tracking-wide text-neutral-500">Packing Materials</p>
          <table className="w-full border-collapse text-[9px] leading-tight">
            <thead>
              <tr className="border-y border-neutral-400 text-left">
                <th className="py-0.5 pr-1 font-semibold">Item</th>
                <th className="py-0.5 pl-1 text-right font-semibold">Qty</th>
              </tr>
            </thead>
            <tbody>
              {packingItems.map((p) => (
                <tr key={p.materialName} className="border-b border-neutral-200">
                  <td className="py-0.5 pr-1 font-medium">{p.materialName}</td>
                  <td className="py-0.5 pl-1 text-right font-semibold tabular-nums">{fmt(p.qty)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-neutral-400 font-bold">
                <td className="pt-0.5">Total</td>
                <td className="pt-0.5 pl-1 text-right tabular-nums">
                  {fmt(packingItems.reduce((a, p) => a + p.qty, 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Payment — internal cash-collection log, Company Copy only. */}
      {isCompanyCopy && (
        <div className="avoid-break mt-1.5 rounded border border-neutral-300 px-2 py-1">
          <p className="text-[9px] font-bold uppercase tracking-wide text-neutral-500">Payment</p>
          <div className="mt-0.5 grid grid-cols-4 gap-x-4">
            <FillField label="Cash Paid" prefix={sym} />
            <FillField label="Payment Status" />
            <FillField label="Received By (Rider)" />
            <FillField label="Signature" />
          </div>
        </div>
      )}

    </div>
  );
}

/**
 * Production Check sheet — a stripped-down stock-check aid for the floor, not a
 * customer/company document: just Branch, Product, Qty, Amount, no prices,
 * balances, returns or sign-offs. When a demand has many line items they're
 * split into 2-3 side-by-side columns so a long list still fits one page.
 */
function ProductionCheckSheet({
  order, printRows, sym, printDate,
}: {
  order: BranchProductionOrder;
  printRows: PrintRow[];
  sym: string;
  printDate: string;
}) {
  const items = printRows.filter((r) => r.approved > 0).map((r) => ({ productName: r.productName, qty: r.approved, amount: r.amount }));
  const cols = items.length > 30 ? 3 : items.length > 12 ? 2 : 1;
  const groups = chunk(items, cols);
  const totalQty = items.reduce((a, r) => a + r.qty, 0);
  const totalAmount = items.reduce((a, r) => a + r.amount, 0);

  return (
    <div className="production-slip print-page relative mx-auto w-full max-w-[720px] bg-white p-6 text-black">
      <div className="avoid-break border-b-2 border-neutral-800 pb-3">
        <h2 className="text-lg font-bold uppercase tracking-wide">Production Check</h2>
        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] sm:grid-cols-4">
          <MetaKV k="Branch" v={order.branchName} />
          <MetaKV k="Production Order No" v={slipReference(order)} mono />
          <MetaKV k="Business Date" v={order.date} />
          <MetaKV k="Print Date" v={printDate} />
        </div>
      </div>

      {items.length === 0 ? (
        <p className="mt-4 text-center text-[11px] text-neutral-500">No approved products.</p>
      ) : (
        <div className={`avoid-break mt-3 grid gap-x-4 ${cols === 3 ? 'grid-cols-3' : cols === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
          {groups.map((group, gi) => (
            <table key={gi} className="w-full border-collapse text-[11px]">
              <thead>
                <tr className="border-y border-neutral-400 text-left">
                  <th className="py-1 pr-1 font-semibold">Product</th>
                  <th className="px-1 py-1 text-right font-semibold">Qty</th>
                  <th className="py-1 pl-1 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {group.map((r) => (
                  <tr key={r.productName} className="border-b border-neutral-200 align-top">
                    <td className="py-1 pr-1 font-medium">{r.productName}</td>
                    <td className="px-1 py-1 text-right tabular-nums">{fmt(r.qty)}</td>
                    <td className="py-1 pl-1 text-right tabular-nums">{money(r.amount, sym)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
        </div>
      )}

      <div className="avoid-break mt-3 flex justify-end gap-6 border-t-2 border-neutral-400 pt-2 text-[11px] font-bold">
        <span>Total Qty: {fmt(totalQty)}</span>
        <span>Total Amount: {money(totalAmount, sym)}</span>
      </div>
    </div>
  );
}

/** A labeled fill-in row: an optional printed value sitting on a signature rule. */
function FillField({ label, value, prefix }: { label: string; value?: string; prefix?: string }) {
  return (
    <div className="text-[10px]">
      <p className="text-[8px] font-semibold uppercase leading-tight tracking-wide text-neutral-500">{label}</p>
      <div className="mt-2 flex min-h-[12px] items-end gap-1 border-b border-neutral-500">
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
