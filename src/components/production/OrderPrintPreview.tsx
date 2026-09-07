'use client';

import { useState } from 'react';
import type { AppSettings, Branch, BranchProductionOrder } from '@mb/shared';
import type { ReviewOrderPayload } from '@/lib/queries';
import { useProducts, useBranches, useAddProductionOrderItem, usePreviousOrderBalance, useCreateReturn } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PrintButton } from '@/components/shared/PrintButton';
import { PrintPortal } from '@/components/shared/PrintPortal';
import { useDocumentPrint } from '@/hooks/useDocumentPrint';
import { useCachedLogo } from '@/lib/print/logoCache';
import { printTrace } from '@/lib/print/diagnostics';
import { PopPrintButton, type PrintHooks } from '@/components/print/PopPrintButton';
import { PosPrintError, printProductionOrder } from '@/lib/print/systemPrinter';
import type { ProductionOrderDoc } from '@/lib/print/receipt/types';
import { InvalidDocumentError } from '@/lib/print/receipt/validate';
import {
  getPrintData,
  isFrozenOrder,
  isPrintableLine,
  orderReference,
  resolvePackingLine,
  resolveProductLine,
  slipReference,
  statusLabel,
  type PrintQuantityEdits,
} from '@/lib/print/productionOrderPrintData';
import { AttachmentGallery } from '@/components/shared/AttachmentGallery';
import { CheckCircle2, XCircle, Loader2, Pencil, ClipboardCheck, Plus, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { COMPANY_NAME } from '@/utils/constants';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  awaiting_verification: 'bg-blue-100 text-blue-700',
  verified: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
  approved: 'bg-emerald-100 text-emerald-700',
  rejected: 'bg-red-100 text-red-700',
};

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
  /**
   * The order as the server has it NOW. Every print starts here — a slip is
   * printed from what this returns, never from the `order` prop, which is what
   * the dialog was given when it opened. Returns null when the order is gone;
   * throws when it cannot be fetched.
   */
  refreshOrder: (id: string) => Promise<BranchProductionOrder | null>;
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
export function OrderPrintPreview({ open, onOpenChange, order, settings, token, review, reviewing, markPrinted, refreshOrder, finalApprove, finalApproving }: OrderPrintPreviewProps) {
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
            refreshOrder={refreshOrder}
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
  order, settings, token, review, reviewing, markPrinted, refreshOrder, finalApprove, finalApproving, onClose,
}: {
  order: BranchProductionOrder;
  settings: AppSettings | null;
  token: string;
  review: (payload: ReviewOrderPayload) => Promise<unknown>;
  reviewing: boolean;
  markPrinted: (id: string) => Promise<unknown>;
  refreshOrder: (id: string) => Promise<BranchProductionOrder | null>;
  finalApprove: (id: string) => Promise<unknown>;
  finalApproving: boolean;
  onClose: () => void;
}) {
  const readOnly = order.status !== 'pending';
  // `approvedQty` is frozen onto the row by review_production_order the moment
  // the order leaves 'pending', and verification overwrites it with the counted
  // figure. All three post-review states therefore read the stored value.
  //
  // The pending-balance carry-forward is GONE (server migration 74). A demand is
  // the fresh demand: Production no longer sees a Prev. Balance / Total Demand
  // pair, and approval is against `qty` alone. `previousBalanceQty` /
  // `totalRequiredQty` still exist on historical rows — orders reviewed before
  // that migration were genuinely approved against prev + new — but nothing
  // computes with them any more, so they are not read here.
  const frozen = isFrozenOrder(order);
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [packingEdits, setPackingEdits] = useState<Record<string, string>>({});
  const [reason, setReason] = useState(order.changeReason ?? '');
  // 'slip' = the Customer/Company Copy challan; 'check' = the simplified
  // Production Check sheet (branch, product, qty, amount only).
  const [printMode, setPrintMode] = useState<'slip' | 'check'>('slip');
  // The document the A4 portal prints. Set on the press from a FRESH fetch of
  // the order (`preparePrintData`), never from what this dialog already had.
  const [printDoc, setPrintDoc] = useState<ProductionOrderDoc | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [addingProduct, setAddingProduct] = useState(false);
  const [addProductId, setAddProductId] = useState('');
  const [addQty, setAddQty] = useState('');
  const [returning, setReturning] = useState(false);
  const [returnProductId, setReturnProductId] = useState('');
  const [returnQty, setReturnQty] = useState('');
  const [returnReason, setReturnReason] = useState('');

  // The A4 print DOM is mounted only for the duration of a print — see
  // useDocumentPrint. Until the press it does not exist, so editing quantities
  // re-renders the review, not two invisible copies of the slip as well.
  const { printing: documentPrinting, print: printViaBrowser } = useDocumentPrint();
  // Fetched once per session and inlined, so the preview never waits on the
  // storage host for the logo.
  const logo = useCachedLogo(settings?.logoUrl);

  const productsQ = useProducts(token);
  const branchesQ = useBranches(token);
  const addItemMut = useAddProductionOrderItem(token);
  const createReturnMut = useCreateReturn(token);
  const prevBalanceQ = usePreviousOrderBalance(token, order.id);

  /**
   * FALLBACK ONLY. The rate a printed challan bills at is the SNAPSHOT on the
   * order line (`unitPrice`, §18) — this map covers lines raised before that
   * column existed, and lines Production added at review, which never went
   * through order creation and so were never snapshotted.
   *
   * It must not be the primary source. Pricing a challan from the live list means
   * reprinting a six-week-old delivery note produces a different total than the
   * one the branch was given, silently, every time Admin edits a rate.
   */
  const livePriceById = new Map((productsQ.data ?? []).map((p) => [p.id, p.price]));
  const branch = (branchesQ.data ?? []).find((b) => b.id === order.branchId) ?? null;
  const sym = settings?.currencySymbol || 'Rs.';

  // The quantities Production is typing, as numbers. Only meaningful while the
  // order is still pending; the resolver ignores them after that.
  const quantityEdits: PrintQuantityEdits = {
    products: Object.fromEntries(Object.entries(edits).map(([id, raw]) => [id, parseInt(raw, 10) || 0])),
    packing: Object.fromEntries(Object.entries(packingEdits).map(([id, raw]) => [id, parseInt(raw, 10) || 0])),
  };
  const lineCtx = { frozen, edits: order.status === 'pending' ? quantityEdits : undefined, livePriceById };

  // ONE resolver for the screen and the paper. `resolveProductLine` is the same
  // function `getPrintData` runs when a slip is printed, so the Demand / Approved
  // / Amount the review table shows are by construction the figures that print.
  //
  //   newDemand  what the BRANCH asked for — 0 on a line Production added
  //   approved   what ships: stored once frozen, else what is being typed
  //
  // See the resolver for why the two are read apart on an added line.
  const rows = order.items.map((it) => {
    const line = resolveProductLine(it, lineCtx);
    return {
      it,
      line,
      newDemand: line.demandQty ?? 0,
      approved: line.changedQty,
      unitPrice: line.unitPrice,
      amount: line.amount,
      isAdded: line.isAdded === true,
    };
  });
  const approvedItems = rows.map(({ it, approved }) => ({ productId: it.productId, approvedQty: approved }));

  // Packing materials. Much simpler than products: no previous balance and no
  // carry-forward, so requested is the only baseline and approved defaults to it.
  const packingRows = (order.packingItems ?? []).map((it) => {
    const line = resolvePackingLine(it, lineCtx);
    return { it, line, requested: line.demandQty, approved: line.changedQty };
  });
  const approvedPackingItems = packingRows.map(({ it, approved }) => ({
    packingMaterialId: it.packingMaterialId,
    approvedQty: approved,
  }));

  const changed =
    rows.some(({ approved, newDemand }) => approved !== newDemand) ||
    packingRows.some(({ approved, requested }) => approved !== requested);

  // What the on-screen review table shows, as opposed to what gets submitted.
  //
  // Filtered ONLY once the order is frozen. While it is still 'pending' every
  // line has to stay on screen — that table is the control Production sets the
  // quantities with, and hiding a line would remove the only way to give it one.
  // After review, the screen shows exactly the lines the slip prints
  // (`isPrintableLine` — the same rule `getPrintData` applies), so the screen
  // the slip is generated from is never the one place a line differs.
  //
  // `rows` / `packingRows` above are left whole on purpose: `approvedItems` is
  // built from them, and a short override list would let the RPC fall back to
  // its own default for the missing lines — silently re-approving in full
  // exactly what somebody had cut to zero. (That default is now the fresh
  // demand rather than prev + new, but the hazard is identical.)
  const visibleRows = frozen ? rows.filter(({ line }) => isPrintableLine(line)) : rows;
  const visiblePackingRows = frozen ? packingRows.filter(({ line }) => isPrintableLine(line)) : packingRows;

  const totals = rows.reduce(
    (a, r) => ({ demand: a.demand + r.newDemand, approved: a.approved + r.approved, amount: a.amount + r.amount }),
    { demand: 0, approved: 0, amount: 0 },
  );


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
  const companyShareValue = prevBal?.companyShareValue ?? 0;
  const returnsAmount = prevBal?.returnsValue ?? 0;
  // The second deduction from the company share, netted server-side exactly as
  // returns are. No quantity: a claim is an amount, not units.
  const discountRows = prevBal?.discountItems ?? [];
  const discountsAmount = prevBal?.discountsValue ?? 0;
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

  // Records goods coming back against this delivery. Goes through the ordinary
  // production_returns flow (created 'pending', accepted separately), so the pool
  // is only credited once someone reviews it — this button records the claim, it
  // does not move stock.
  async function recordReturn() {
    const qty = parseInt(returnQty, 10);
    if (!returnProductId || !qty || qty <= 0 || !returnReason.trim()) return;
    try {
      await createReturnMut.mutateAsync({
        branchId: order.branchId,
        productId: returnProductId,
        qty,
        reason: returnReason.trim(),
      });
      toast.success('Return recorded — awaiting review');
      setReturning(false);
      setReturnProductId('');
      setReturnQty('');
      setReturnReason('');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record return');
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

  // The A4 challan — a real document on a real sheet, so the browser dialog is
  // the right tool and stays. The receipt is a different document with a
  // different reader and goes through POP Print below.
  function printAndClose() {
    // `printDocument` (behind useDocumentPrint) owns the afterprint cleanup — see
    // its header for why the close has to wait for the browser's own signal. The
    // hook mounts the print DOM first and prints once it has laid out.
    printViaBrowser({
      onAfterPrint: () => {
        printTrace('closing order dialog');
        onClose();
      },
    });
  }

  /**
   * The canonical print document, from a FRESH fetch.
   *
   *   refreshOrder() + previous balance  →  getPrintData()  →  validatePrintData()
   *
   * Every print — POP, A4 challan, check sheet — starts here, and none of them
   * prints the `order` prop: that is what the dialog was handed when it opened,
   * and anything reviewed, added or verified since is not in it. The fetch is
   * awaited, and a fetch that fails is a print that does not happen; a slip
   * printed from the cache "because the network was down" is exactly the stale
   * document this exists to rule out.
   *
   * The one screen input that survives is the quantities being typed into a
   * still-pending order — those are what Production is about to submit, and
   * `getPrintData` applies them only while the fresh order is still pending.
   */
  async function preparePrintData(): Promise<ProductionOrderDoc> {
    printTrace('refreshing order before print');
    const [fresh, prevBal] = await Promise.all([
      refreshOrder(order.id),
      prevBalanceQ.refetch({ throwOnError: true }),
    ]);
    if (!fresh) throw new Error('This order could not be found on the server. Refresh the page and try again.');
    printTrace('order refreshed', {
      status: fresh.status,
      items: fresh.items.length,
      packing: (fresh.packingItems ?? []).length,
    });
    return getPrintData({
      order: fresh,
      edits: quantityEdits,
      livePriceById,
      branchName: branch?.name,
      companyName: settings?.companyName ?? COMPANY_NAME,
      currencySymbol: sym,
      // Only when already inlined as bytes — the receipt never waits on a fetch.
      logo: logo ?? null,
      // The same server figures the screen's collection block shows, passed
      // through rather than re-derived. `null` = no previous delivery.
      previousBalance: prevBal.data ?? null,
    });
  }

  /** One sentence for the toast, naming what stopped the print. */
  function printProblem(err: unknown): string {
    if (err instanceof InvalidDocumentError) return err.message;
    const detail = err instanceof Error && err.message ? ` (${err.message})` : '';
    return `Could not refresh the order before printing${detail}. Check the connection and try again.`;
  }

  // Print only prints — it no longer submits a pending demand as a side effect.
  // Submission is a deliberate action via the Submit for Verification button;
  // Print prints the order as the server has it (with the quantities being
  // typed, while still pending).
  async function print() {
    setEditing(false);
    setPreparing(true);
    let doc: ProductionOrderDoc;
    try {
      doc = await preparePrintData();
    } catch (err) {
      toast.error('Nothing was printed', { description: printProblem(err) });
      return;
    } finally {
      setPreparing(false);
    }
    setPrintDoc(doc);
    setPrintMode('slip');
    printTrace('markPrinted requested');
    markPrinted(order.id).then(() => printTrace('markPrinted done')).catch(() => printTrace('markPrinted failed'));
    printAndClose();
  }

  // A separate, simplified sheet for the floor — branch, product, qty, amount
  // only, laid out in 2-3 columns when there are many items so a long demand
  // still fits on one page. Doesn't touch markPrinted: that flag tracks the
  // official delivery slip, not this internal stock-check aid.
  async function printCheck() {
    setEditing(false);
    setPreparing(true);
    let doc: ProductionOrderDoc;
    try {
      doc = await preparePrintData();
    } catch (err) {
      toast.error('Nothing was printed', { description: printProblem(err) });
      return;
    } finally {
      setPreparing(false);
    }
    setPrintDoc(doc);
    setPrintMode('check');
    printAndClose();
  }

  /**
   * POP Print — the same canonical document, sent to the printer this computer
   * has installed. `printProductionOrder` validates it again and reads the
   * rendered frame back before any paper moves (systemPrinter.ts).
   */
  async function printPop(hooks: PrintHooks) {
    setEditing(false);
    let doc: ProductionOrderDoc;
    try {
      doc = await preparePrintData();
    } catch (err) {
      // Named for what it is: a document problem is not a printer problem, and
      // neither is a network one — the button's generic "check the printer"
      // advice would send someone to the wrong machine.
      if (err instanceof InvalidDocumentError) throw new PosPrintError('invalid-document', err.message);
      throw new PosPrintError('print-failed', printProblem(err));
    }
    // Queued, not awaited on the main thread: systemPrinter hands this to the
    // print queue and the hooks let the button say Queued / Printing as it moves.
    const result = await printProductionOrder(doc, { paper: hooks.paper, onJobUpdate: hooks.onJobUpdate });
    printTrace('markPrinted requested');
    // Same flag the A4 slip sets, and set the same way — fire and forget, because
    // a failed bookkeeping call must not turn a receipt that DID print into an
    // error the counter has to interpret.
    markPrinted(order.id).catch(() => {});
    return result;
  }

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

          {/* The branch's photos, on screen only — inside the `no-print` block,
              so the slip that goes out with the delivery is unchanged.
              The verification set is what Production checks before signing off:
              stock has already moved on the branch's own count, and this is the
              only independent record of a delivery nobody here can re-inspect. */}
          {((order.demandPhotos?.length ?? 0) > 0 || (order.verificationPhotos?.length ?? 0) > 0) && (
            <div className="mt-4 grid gap-3 rounded-lg border border-neutral-300 bg-neutral-50 p-3 sm:grid-cols-2">
              {(order.demandPhotos?.length ?? 0) > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Demand Photo
                  </p>
                  <AttachmentGallery attachments={order.demandPhotos} title="Demand photo" />
                </div>
              )}
              {(order.verificationPhotos?.length ?? 0) > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
                    Delivery Photo · verified by {order.verifiedByName ?? '—'}
                  </p>
                  <AttachmentGallery attachments={order.verificationPhotos} title="Delivery photo" />
                </div>
              )}
            </div>
          )}

          {/* Goods coming back against this delivery. Scoped to what was actually
              delivered — a product that never went out cannot come back — and
              filed as an ordinary pending return for review, not an instant
              credit to the pool. */}
          {returning && order.status === 'verified' && (
            <div className="mt-4 space-y-2 rounded-lg border border-neutral-300 bg-neutral-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Record a Return</p>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="min-w-0 flex-1 space-y-1">
                  <label className="text-xs font-medium text-neutral-600">Product</label>
                  <Select value={returnProductId} onValueChange={(v) => v && setReturnProductId(v)}>
                    <SelectTrigger className="h-9 w-full bg-white">
                      <SelectValue placeholder="Select a delivered product" />
                    </SelectTrigger>
                    <SelectContent>
                      {order.items
                        .filter((it) => (it.approvedQty ?? 0) > 0)
                        .map((it) => (
                          <SelectItem key={it.productId} value={it.productId}>{it.productName}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 sm:w-24">
                  <label className="text-xs font-medium text-neutral-600">Qty</label>
                  <Input
                    type="text"
                    inputMode="numeric"
                    value={returnQty}
                    onChange={(e) => setReturnQty(digits(e.target.value))}
                    className="h-9 bg-white"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-neutral-600">Reason</label>
                <Input
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  placeholder="Why is this coming back?"
                  className="h-9 bg-white"
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" className="h-9" onClick={() => setReturning(false)}>Cancel</Button>
                <Button
                  className="h-9"
                  disabled={!returnProductId || !returnQty || !returnReason.trim() || createReturnMut.isPending}
                  onClick={recordReturn}
                >
                  {createReturnMut.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null} Record Return
                </Button>
              </div>
            </div>
          )}

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
                  <th className="px-2 py-1.5 text-right font-semibold">Demand</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Approved</th>
                  <th className="px-2 py-1.5 text-right font-semibold">Unit Price</th>
                  <th className="py-1.5 pl-2 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(({ it, newDemand, approved, unitPrice, amount, isAdded }) => (
                  <tr key={it.productId} className="border-b border-neutral-200 align-top">
                    <td className="py-1.5 pr-2 font-medium">
                      {it.productName}
                      {/* Production cannot pick this off a shelf — it has to be
                          made to the branch's description. Flagged on the slip
                          itself, which is what the floor actually works from. */}
                      {it.isSpecial && (
                        <span className="ml-1.5 rounded border border-neutral-400 px-1 py-px text-[9px] font-bold uppercase">
                          Special
                        </span>
                      )}
                      {/* Says why Demand reads '—' on this row. Without it the
                          dash looks like missing data rather than the fact that
                          nobody demanded this line. */}
                      {isAdded && (
                        <span className="ml-1.5 rounded border border-neutral-400 px-1 py-px text-[9px] font-bold uppercase text-neutral-600">
                          Added
                        </span>
                      )}
                      {it.isSpecial && it.description && (
                        <p className="mt-0.5 text-[10px] font-normal italic text-neutral-600">{it.description}</p>
                      )}
                    </td>
                    {/* An added line has no branch demand to show. A dash, not a
                        0 — the branch did not ask for none of this, it was never
                        asked at all, and a 0 in a column of quantities reads as a
                        cut line rather than an addition. */}
                    <td className="px-2 py-1.5 text-right font-semibold tabular-nums">
                      {isAdded ? <span className="font-normal text-neutral-400">—</span> : fmt(newDemand)}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">
                      {editing && !readOnly ? (
                        <Input
                          type="text"
                          inputMode="numeric"
                          value={edits[it.productId] ?? String(newDemand)}
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
                  <td className="pt-2">Totals</td>
                  <td className="px-2 pt-2 text-right tabular-nums">{fmt(totals.demand)}</td>
                  <td className="px-2 pt-2 text-right tabular-nums">{fmt(totals.approved)}</td>
                  <td className="px-2 pt-2 text-right"></td>
                  <td className="pt-2 pl-2 text-right tabular-nums">{money(totals.amount, sym)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Review cards — mobile.

              ONE row per item: product · Approved · Amount, and nothing else.
              Those three are what the slip is read for on a phone — what are we
              sending, and what does it come to. Demand and Unit Price are
              deliberately NOT here: they are desk-work figures, they are both
              still on the desktop table above (which is what a reviewer sitting
              down actually uses), and a wider grid under every product turned a
              ten-line order into a page of scrolling. The order-level totals
              still close the list below.

              Approved keeps its input in that row while editing — w-16 so the
              product name, the input and the amount all fit one line. */}
          <div className="mt-3 space-y-3 md:hidden">
            {visibleRows.map(({ it, newDemand, approved, amount }) => (
              <div key={it.productId} className="rounded-lg border border-neutral-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold leading-tight">
                      {it.productName}
                      {it.isSpecial && (
                        <span className="ml-1.5 rounded border border-neutral-400 px-1 py-px text-[9px] font-bold uppercase">
                          Special
                        </span>
                      )}
                    </p>
                    {it.isSpecial && it.description && (
                      <p className="mt-0.5 text-[11px] italic text-neutral-600">{it.description}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Approved</p>
                    {editing && !readOnly ? (
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={edits[it.productId] ?? String(newDemand)}
                        onChange={(e) => setEdits((p) => ({ ...p, [it.productId]: digits(e.target.value) }))}
                        className="mt-0.5 h-8 w-16 text-right tabular-nums"
                      />
                    ) : (
                      <p className="font-semibold tabular-nums">{fmt(approved)}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Amount</p>
                    <p className="font-semibold tabular-nums text-primary">{money(amount, sym)}</p>
                  </div>
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
          {visiblePackingRows.length > 0 && (
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
                    {visiblePackingRows.map(({ it, requested, approved }) => (
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

              {/* Mobile cards — material and Approved share one row, matching the
                  product cards above. There is no Amount here: packing materials
                  carry no unit price (see the section note). */}
              <div className="space-y-3 md:hidden">
                {visiblePackingRows.map(({ it, requested, approved }) => (
                  <div key={it.packingMaterialId} className="rounded-lg border border-neutral-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 flex-1 font-semibold leading-tight">{it.materialName}</p>
                      <div className="shrink-0 text-right">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Approved Qty</p>
                        {editing && !readOnly ? (
                          <Input
                            type="text"
                            inputMode="numeric"
                            value={packingEdits[it.packingMaterialId] ?? String(requested)}
                            onChange={(e) =>
                              setPackingEdits((p) => ({ ...p, [it.packingMaterialId]: digits(e.target.value) }))
                            }
                            className="mt-0.5 h-8 w-16 text-right tabular-nums"
                          />
                        ) : (
                          <p className="font-semibold tabular-nums">{fmt(approved)}</p>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 border-t border-neutral-100 pt-2 text-xs">
                      <Field label="Requested Qty" value={fmt(requested)} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Previous balance & returns — the same figures both printed copies
              carry, shown on screen too so this isn't only visible after clicking
              Print. The itemised tables below print on the Company Copy only. */}
          <div className="mt-6">
            <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-600">
              Previous Order Balance
            </h3>
            {prevBalanceQ.isLoading ? (
              <p className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-500">Loading…</p>
            ) : hasPrevBalance ? (
              // Every step is shown, not just the total: this is collected in
              // cash at the counter, so the figure has to be checkable by hand.
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-xs sm:grid-cols-6">
                <Field label="Previous Order" value={`${previousRef!.demandNumber} · ${previousRef!.date}`} />
                <Field label="Delivered Value" value={money(deliveredValue, sym)} />
                <Field label="Company Share" value={money(companyShareValue, sym)} />
                <Field label="Less Returns" value={returnsQty > 0 ? `${fmt(returnsQty)} · ${money(returnsAmount, sym)}` : '—'} />
                {/* Beside Less Returns, and before the total, because the two are
                    the same kind of thing: deductions from the company share.
                    Money only — there are no units behind a discount. */}
                <Field label="Less Discount" value={discountsAmount > 0 ? money(discountsAmount, sym) : '—'} />
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

            {/* Which claims made up the deduction. Rendered only when there are
                any, so an ordinary slip is unchanged — the same rule the return
                table above follows. Two columns, not three: a discount has no
                quantity behind it. */}
            {discountRows.length > 0 && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-y border-neutral-300 text-left">
                      <th className="py-1.5 pr-2 font-semibold">Discount Against (Since Last Order)</th>
                      <th className="py-1.5 pl-2 text-right font-semibold">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {discountRows.map((d, i) => (
                      // Keyed by index alongside the demand number: a branch can
                      // raise more than one approved claim against the same
                      // demand, so the number alone is not unique.
                      <tr key={`${d.demandNumber}-${i}`} className="border-b border-neutral-200">
                        <td className="py-1.5 pr-2 font-medium">{d.demandNumber}</td>
                        <td className="py-1.5 pl-2 text-right font-semibold tabular-nums">{money(d.amount, sym)}</td>
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
            POP Print sends the receipt to this computer&apos;s printer. A4 Challan prints one page — Customer Copy on top, Company Copy below the cut line.
          </p>
        </div>

      </div>

      {/* ── Print-only: either the Customer/Company Copy pair, or the
          Production Check sheet — whichever printCheck()/print() picked.

          Portalled to <body> deliberately. Left inside the dialog it is an
          absolutely positioned box inside a fixed, translated, overflow-clipped
          ancestor, and the printer only ever gets the part that fits the dialog
          — see PrintPortal.

          Mounted only while a print is in progress. ── */}
      <PrintPortal active={documentPrinting}>
        {printDoc &&
          (printMode === 'slip' ? (
            /* One demand = ONE sheet: Customer Copy on the top half, Company Copy on
               the bottom half, with a cut line between them. Both copies are the
               same `printDoc`. See `.print-sheet` / `.print-half` in globals.css. */
            <div className="print-sheet">
              <PrintCopy copyLabel="Customer Copy" doc={printDoc} />
              <PrintCopy copyLabel="Company Copy" doc={printDoc} />
            </div>
          ) : (
            <ProductionCheckSheet doc={printDoc} />
          ))}
      </PrintPortal>

      {/* Action bar — hidden on print */}
      <div className="no-print shrink-0 flex flex-wrap items-center justify-end gap-2 border-t bg-card px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button variant="outline" onClick={onClose} disabled={reviewing}>Close</Button>
        {/* The branch has counted the goods and stock has already moved; this is
            Production's closing sign-off. No Reject beside it on purpose —
            undoing it would mean clawing stock back out of branch inventory. */}
        {order.status === 'verified' && (
          <>
            <Button variant="outline" onClick={() => setReturning((r) => !r)} disabled={finalApproving}>
              <Undo2 className="mr-1.5 h-4 w-4" /> Return
            </Button>
            <Button onClick={approveFinal} disabled={finalApproving}>
              {finalApproving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1.5 h-4 w-4" />} Approve
            </Button>
          </>
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
            not a customer-facing document, so no printer/PDF picker menu.
            Only while the demand is still pending: it is the sheet used to check
            and prepare stock against a newly received order, so it has no purpose
            once the goods have gone out. */}
        {order.status === 'pending' && (
          <Button variant="outline" onClick={printCheck} disabled={reviewing || preparing}>
            <ClipboardCheck className="mr-1.5 h-4 w-4" /> Production Check
          </Button>
        )}
        {/* Two documents, two buttons, and neither falls back to the other.

            POP Print sends the receipt — the canonical print document — to the
            printer this computer has installed. No setup, no printer to pick:
            the operating system's default printer is the printer.

            A4 Challan is the signed delivery document on a sheet, two copies
            per page, and keeps the browser dialog because that is the right
            tool for a sheet. Its menu is where a device with no printer says
            so and gets "Save as PDF" wording instead. */}
        <PopPrintButton
          label="POP Print"
          print={printPop}
          disabled={reviewing || preparing}
        />
        <PrintButton
          variant="secondary"
          onPrint={print}
          disabled={reviewing || preparing}
          printLabel="A4 Challan"
          saveLabel="Save A4 PDF"
        />
      </div>
    </>
  );
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
      <MetaKV k="Order #" v={orderReference(order)} mono />
      <MetaKV k="Ref" v={slipReference(order)} mono />
      <MetaKV k="Demand Date" v={order.date} />
      {/* Beside the date it was RAISED, because the pair is the point: one is
          when the branch asked, the other is when they need it. Empty on demands
          predating the field — MetaKV prints '—' rather than falling back to
          order.date, which would show a commitment nobody made. */}
      <MetaKV k="Required Date" v={order.requiredDate ?? ''} />
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
 * identical information (spec); only the corner watermark label differs and the
 * Company Copy adds the itemised deductions and the cash-collection log.
 *
 * Rendered from the canonical `ProductionOrderDoc` and nothing else — the same
 * document the roll receipt prints. Every quantity, rate, amount and total is
 * read off it; none is recomputed here.
 *
 * Everything here is sized for a half page, so the spacing/type scale is tighter
 * than a standalone document and the column split kicks in far sooner — see `cols`.
 */
function PrintCopy({ copyLabel, doc }: { copyLabel: string; doc: ProductionOrderDoc }) {
  const sym = doc.currencySymbol;
  const companyName = doc.companyName?.trim() || COMPANY_NAME;
  const items = doc.items;
  const packingItems = doc.packingItems;
  const totalDemand = items.reduce((a, r) => a + (r.demandQty ?? 0), 0);
  const totalQty = items.reduce((a, r) => a + r.changedQty, 0);
  const pc = doc.previousCollection;
  const returnRows = pc?.returnItems ?? [];
  const returnsQty = returnRows.reduce((a, r) => a + r.qty, 0);
  const discountRows = pc?.discountItems ?? [];
  const isCompanyCopy = copyLabel === 'Company Copy';
  // A long demand splits into two side-by-side tables so it still fits its half
  // page; the Totals recap below already carries the totals, so split tables
  // skip their own <tfoot>. Five columns now, so two is the most that stays
  // legible at this size.
  const cols = items.length > 8 ? 2 : 1;
  const groups = chunk(items, cols);

  const productHead = (
    <thead>
      <tr className="border-y border-neutral-400 text-left">
        <th className="py-0.5 pr-1 font-semibold">Product</th>
        <th className="px-1 py-0.5 text-right font-semibold">Demand Qty</th>
        <th className="px-1 py-0.5 text-right font-semibold">Changed Qty</th>
        <th className="px-1 py-0.5 text-right font-semibold">Unit Price</th>
        <th className="py-0.5 pl-1 text-right font-semibold">Amount</th>
      </tr>
    </thead>
  );
  const productRow = (r: ProductionOrderDoc['items'][number]) => (
    <tr key={r.productId ?? r.productName} className="border-b border-neutral-200 align-top">
      <td className="py-0.5 pr-1 font-medium">
        {r.productName}
        {r.isSpecial && (
          <span className="ml-1 rounded border border-neutral-400 px-1 py-px text-[7px] font-bold uppercase">Special</span>
        )}
        {r.isAdded && (
          <span className="ml-1 rounded border border-neutral-400 px-1 py-px text-[7px] font-bold uppercase text-neutral-600">Added</span>
        )}
        {r.isSpecial && r.description && <p className="text-[8px] font-normal italic text-neutral-600">{r.description}</p>}
      </td>
      {/* An added line has no branch demand to show — a dash, not a 0. */}
      <td className="px-1 py-0.5 text-right tabular-nums">{r.demandQty === null ? '—' : fmt(r.demandQty)}</td>
      <td className="px-1 py-0.5 text-right font-semibold tabular-nums">{fmt(r.changedQty)}</td>
      <td className="px-1 py-0.5 text-right tabular-nums">{money(r.unitPrice, sym)}</td>
      <td className="py-0.5 pl-1 text-right font-semibold tabular-nums">{money(r.amount, sym)}</td>
    </tr>
  );

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
          {doc.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={doc.logo} alt="logo" className="h-9 w-9 shrink-0 object-contain" />
          )}
          {!isCompanyCopy && (
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-bold leading-tight">{companyName}</h2>
              <p className="text-[10px] font-medium leading-tight text-neutral-600">Production Department</p>
              <p className="text-[11px] font-semibold uppercase leading-tight tracking-wide text-neutral-800">Production Order</p>
            </div>
          )}
        </div>
        <div className="mt-1.5 grid grid-cols-4 gap-x-4 pr-20 text-[9px] leading-tight">
          <MetaKV k="Production Order No" v={doc.orderNumber} mono />
          <MetaKV k="Ref" v={doc.refText ?? ''} mono />
          <MetaKV k="Business Date" v={doc.dateText} />
          <MetaKV k="Required Date" v={doc.requiredDateText} />
          <MetaKV k="Branch" v={doc.branchName} />
          <MetaKV k="Print Date" v={doc.printDateText} />
          <MetaKV k="Print Time" v={doc.printTimeText} />
          <MetaKV k="Status" v={doc.statusText} />
        </div>
      </div>

      {/* Previous Order Balance — on BOTH copies.

          The rider COLLECTS this amount in cash at the counter, and the branch
          handing the money over needs a printed statement of what it is for.
          Asking somebody to pay against a figure they can only see on the other
          party's copy is not a document, it is a request to take their word for it.

          The itemised Return Items and Discounts tables below stay Company Copy
          only. They are the working behind the two "Less …" lines, each copy gets
          half a page, and two more tables on the customer half would push the
          product list onto a second sheet — the summary lines are what the branch
          needs to check the total, and the detail is one question away.

          Left off entirely (rather than printed as zeros) when the figures were
          not loaded — which `preparePrintData` makes unreachable, since it waits
          for them; the guard is here so a partial document can never print a
          collection of zero against a delivery that has one. */}
      {pc !== undefined && (
        <div className="avoid-break mt-1.5 rounded border border-neutral-300 bg-neutral-50 px-2 py-1">
          <p className="text-[9px] font-bold uppercase tracking-wide text-neutral-500">Previous Order Balance</p>
          {pc ? (
            // Full working shown, not just the total — this is counted out in
            // cash at the counter and has to be verifiable line by line.
            <div className="grid grid-cols-4 gap-x-4 text-[9px] leading-tight">
              <MetaKV k="Previous Order No" v={pc.reference} mono />
              <MetaKV k="Previous Demand Date" v={pc.dateText} />
              <MetaKV k="Previous Order" v={money(pc.orderedValue, sym)} />
              <MetaKV k="Delivered Value" v={money(pc.deliveredValue, sym)} />
              <MetaKV k="Company Share" v={money(pc.companyShare, sym)} />
              <MetaKV k="Less Returns" v={pc.returnsAmount > 0 ? `${returnsQty > 0 ? `${fmt(returnsQty)} · ` : ''}${money(pc.returnsAmount, sym)}` : '—'} />
              <MetaKV k="Less Discount" v={pc.discountsAmount > 0 ? money(pc.discountsAmount, sym) : '—'} />
              <MetaKV k="Amount to Collect" v={money(pc.amountToCollect, sym)} />
            </div>
          ) : (
            <p className="text-[9px] font-medium text-neutral-500">
              No previous delivery for this branch — nothing to collect.
            </p>
          )}
        </div>
      )}

      {isCompanyCopy && pc && (
        <>
          {/* Return items — accepted since the previous order. Rendered only when
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
                  {returnRows.map((r, i) => (
                    <tr key={`${r.productName}-${i}`} className="border-b border-neutral-200">
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
                    <td className="pt-0.5 pl-1 text-right tabular-nums">{money(pc.returnsAmount, sym)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* Discounts, itemised the way returns are — this is counted out in
              cash at the counter, so every line of the deduction has to be
              checkable by hand rather than appearing as one total. */}
          {discountRows.length > 0 && (
            <div className="avoid-break mt-1.5">
              <p className="text-[9px] font-bold uppercase tracking-wide text-neutral-500">Discounts (Since Last Order)</p>
              <table className="w-full border-collapse text-[9px] leading-tight">
                <thead>
                  <tr className="border-y border-neutral-400 text-left">
                    <th className="py-0.5 pr-1 font-semibold">Against Demand</th>
                    <th className="py-0.5 pl-1 text-right font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {discountRows.map((d, i) => (
                    <tr key={`${d.demandNumber}-${i}`} className="border-b border-neutral-200">
                      <td className="py-0.5 pr-1 font-medium">{d.demandNumber}</td>
                      <td className="py-0.5 pl-1 text-right font-semibold tabular-nums">{money(d.amount, sym)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-neutral-400 font-bold">
                    <td className="pt-0.5">Total</td>
                    <td className="pt-0.5 pl-1 text-right tabular-nums">{money(pc.discountsAmount, sym)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}

      {/* PRODUCTS — Demand beside Changed, so the branch reads what it asked for
          and what is coming in one glance. */}
      <p className="mt-1.5 text-[9px] font-bold uppercase tracking-wide text-neutral-500">Products</p>
      {items.length === 0 ? (
        <table className="w-full border-collapse text-[9px] leading-tight">
          {productHead}
          <tbody>
            <tr><td colSpan={5} className="py-2 text-center text-neutral-500">No products on this order.</td></tr>
          </tbody>
        </table>
      ) : cols === 1 ? (
        <table className="w-full border-collapse text-[9px] leading-tight">
          {productHead}
          <tbody>{items.map(productRow)}</tbody>
          <tfoot>
            <tr className="border-t-2 border-neutral-400 font-bold">
              <td className="pt-0.5">Totals</td>
              <td className="px-1 pt-0.5 text-right tabular-nums">{fmt(totalDemand)}</td>
              <td className="px-1 pt-0.5 text-right tabular-nums">{fmt(totalQty)}</td>
              <td className="pt-0.5"></td>
              <td className="pt-0.5 pl-1 text-right tabular-nums">{money(doc.grandTotal, sym)}</td>
            </tr>
          </tfoot>
        </table>
      ) : (
        <div className="avoid-break grid grid-cols-2 gap-x-3">
          {groups.map((group, gi) => (
            <table key={gi} className="w-full border-collapse text-[9px] leading-tight">
              {/* Headings match the single-column table above WORD FOR WORD, on
                  a document whose whole job is to be checked against goods. */}
              {productHead}
              <tbody>{group.map(productRow)}</tbody>
            </table>
          ))}
        </div>
      )}

      {/* Totals recap — the document's own figures, never re-added here. */}
      <div className="avoid-break mt-1 ml-auto w-full max-w-[240px] text-[9px] leading-tight">
        <div className="flex justify-between"><span className="text-neutral-600">Total Demand Qty</span><span className="font-semibold tabular-nums">{fmt(totalDemand)}</span></div>
        <div className="flex justify-between"><span className="text-neutral-600">Total Changed Qty</span><span className="font-semibold tabular-nums">{fmt(totalQty)}</span></div>
        <div className="flex justify-between border-t border-neutral-300 text-[11px] font-bold"><span>Total Order Amount</span><span className="tabular-nums">{money(doc.grandTotal, sym)}</span></div>
      </div>

      {/* PACKING MATERIALS — its own table, below the products and outside the
          money totals. These carry no price, so they never fold into the total.
          Omitted entirely when the branch requested none: no heading, no empty
          table. When it did, every requested line prints at its exact figures. */}
      {packingItems.length > 0 && (
        <div className="avoid-break mt-1.5">
          <p className="text-[9px] font-bold uppercase tracking-wide text-neutral-500">Packing Materials</p>
          <table className="w-full border-collapse text-[9px] leading-tight">
            <thead>
              <tr className="border-y border-neutral-400 text-left">
                <th className="py-0.5 pr-1 font-semibold">Packing Material</th>
                <th className="px-1 py-0.5 text-right font-semibold">Demand Qty</th>
                <th className="py-0.5 pl-1 text-right font-semibold">Changed Qty</th>
              </tr>
            </thead>
            <tbody>
              {packingItems.map((p) => (
                <tr key={p.packingMaterialId || p.materialName} className="border-b border-neutral-200">
                  <td className="py-0.5 pr-1 font-medium">{p.materialName}</td>
                  <td className="px-1 py-0.5 text-right tabular-nums">{fmt(p.demandQty)}</td>
                  <td className="py-0.5 pl-1 text-right font-semibold tabular-nums">{fmt(p.changedQty)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-neutral-400 font-bold">
                <td className="pt-0.5">Total</td>
                <td className="px-1 pt-0.5 text-right tabular-nums">{fmt(packingItems.reduce((a, p) => a + p.demandQty, 0))}</td>
                <td className="pt-0.5 pl-1 text-right tabular-nums">{fmt(packingItems.reduce((a, p) => a + p.changedQty, 0))}</td>
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

      {/* Signatures — on both copies: the copy the branch keeps is the one it
          signs for, and the one Production keeps is the one it signs out. */}
      <div className="avoid-break mt-2 grid grid-cols-3 gap-x-6">
        <FillField label="Prepared By (Production)" />
        <FillField label="Collected By (Rider)" />
        <FillField label="Received By (Branch)" />
      </div>
    </div>
  );
}

/**
 * Production Check sheet — a stripped-down stock-check aid for the floor, not a
 * customer/company document: just Branch, Product, Qty, Amount and the packing
 * materials to gather, no balances, returns or sign-offs. When a demand has many
 * line items they're split into 2-3 side-by-side columns so a long list still
 * fits one page. Read off the same canonical document as the challan.
 */
function ProductionCheckSheet({ doc }: { doc: ProductionOrderDoc }) {
  const sym = doc.currencySymbol;
  // The floor makes what is going out; a line changed to zero is not made.
  const items = doc.items.filter((r) => r.changedQty > 0);
  const packing = doc.packingItems.filter((p) => p.changedQty > 0);
  const cols = items.length > 30 ? 3 : items.length > 12 ? 2 : 1;
  const groups = chunk(items, cols);
  const totalQty = items.reduce((a, r) => a + r.changedQty, 0);

  return (
    <div className="production-slip print-page relative mx-auto w-full max-w-[720px] bg-white p-6 text-black">
      <div className="avoid-break border-b-2 border-neutral-800 pb-3">
        <h2 className="text-lg font-bold uppercase tracking-wide">Production Check</h2>
        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[11px] sm:grid-cols-4">
          <MetaKV k="Branch" v={doc.branchName} />
          <MetaKV k="Production Order No" v={doc.orderNumber} mono />
          <MetaKV k="Business Date" v={doc.dateText} />
          <MetaKV k="Required Date" v={doc.requiredDateText} />
          <MetaKV k="Print Date" v={doc.printDateText} />
          <MetaKV k="Print Time" v={doc.printTimeText} />
          <MetaKV k="Status" v={doc.statusText} />
        </div>
      </div>

      {items.length === 0 ? (
        <p className="mt-4 text-center text-[11px] text-neutral-500">No products to make on this order.</p>
      ) : (
        <div className={`avoid-break print-cols mt-3 grid gap-x-4 ${cols === 3 ? 'grid-cols-3' : cols === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
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
                  <tr key={r.productId ?? r.productName} className="border-b border-neutral-200 align-top">
                    <td className="py-1 pr-1 font-medium">{r.productName}</td>
                    <td className="px-1 py-1 text-right tabular-nums">{fmt(r.changedQty)}</td>
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
        <span>Total Amount: {money(doc.grandTotal, sym)}</span>
      </div>

      {/* Packing materials to gather alongside — only when the branch asked. */}
      {packing.length > 0 && (
        <div className="avoid-break mt-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-neutral-500">Packing Materials</p>
          <table className="w-full max-w-[360px] border-collapse text-[11px]">
            <thead>
              <tr className="border-y border-neutral-400 text-left">
                <th className="py-1 pr-1 font-semibold">Packing Material</th>
                <th className="py-1 pl-1 text-right font-semibold">Qty</th>
              </tr>
            </thead>
            <tbody>
              {packing.map((p) => (
                <tr key={p.packingMaterialId || p.materialName} className="border-b border-neutral-200">
                  <td className="py-1 pr-1 font-medium">{p.materialName}</td>
                  <td className="py-1 pl-1 text-right tabular-nums">{fmt(p.changedQty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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
