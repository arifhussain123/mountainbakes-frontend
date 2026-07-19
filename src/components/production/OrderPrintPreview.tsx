'use client';

import { useState } from 'react';
import type { AppSettings, BranchProductionOrder, BranchProductionOrderItem } from '@mb/shared';
import type { ReviewOrderPayload } from '@/lib/queries';
import { useProductionBalances } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { CheckCircle2, XCircle, Printer, Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { COMPANY_NAME } from '@/utils/constants';

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
 * Clicking "View" on the Production Orders page opens this directly — a professional
 * A4 production slip that IS both the on-screen preview and what prints. Shows the
 * pending-balance carry-forward (Previous Balance + New Demand = Total Required) and
 * lets Production approve/adjust/print in one place.
 */
export function OrderPrintPreview({ open, onOpenChange, order, settings, token, review, reviewing, markPrinted }: OrderPrintPreviewProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !reviewing && onOpenChange(o)}>
      <DialogContent
        showCloseButton
        className="flex h-full w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 top-0 left-0 sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[92vh] sm:w-[90vw] sm:max-w-[90vw] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl lg:w-[80vw] lg:max-w-[920px]"
      >
        {order && (
          // Keyed so state re-initialises cleanly whenever a different order opens.
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
  const frozen = order.status === 'approved'; // carry-forward figures persisted on the item
  const [editing, setEditing] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({}); // productId -> approved qty (only when adjusted)
  const [reason, setReason] = useState(order.changeReason ?? '');

  // Live pending balances for a still-pending order (advisory — the approval
  // transaction recomputes authoritatively). Approved orders read their frozen fields.
  const balancesQ = useProductionBalances(token, { branchId: order.branchId, enabled: order.status === 'pending' });
  const liveBalances = balancesQ.data ?? {};

  function rowFor(it: BranchProductionOrderItem) {
    const newDemand = it.qty;
    const previousBalance = frozen ? (it.previousBalanceQty ?? 0) : (liveBalances[it.productId] ?? 0);
    const totalRequired = frozen ? (it.totalRequiredQty ?? previousBalance + newDemand) : previousBalance + newDemand;
    const approved = frozen
      ? (it.approvedQty ?? totalRequired)
      : (edits[it.productId] !== undefined ? (parseInt(edits[it.productId]!, 10) || 0) : totalRequired);
    const remaining = frozen
      ? (it.remainingBalanceQty ?? Math.max(0, totalRequired - approved))
      : Math.max(0, totalRequired - approved);
    return { newDemand, previousBalance, totalRequired, approved, remaining };
  }

  const rows = order.items.map((it) => ({ it, ...rowFor(it) }));
  const approvedItems = rows.map(({ it, approved }) => ({ productId: it.productId, approvedQty: approved }));
  const changed = rows.some(({ approved, totalRequired }) => approved !== totalRequired);

  async function approve() {
    try {
      await review({ id: order.id, status: 'approved', approvedItems, reason: changed ? reason : undefined });
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

  async function print() {
    try {
      if (order.status === 'pending') {
        await review({ id: order.id, status: 'approved', approvedItems, reason: changed ? reason : undefined });
        toast.success('Order approved');
      }
      setEditing(false); // render plain numbers (not inputs) into the printed slip
      markPrinted(order.id).catch(() => {}); // best-effort flag; never blocks printing
      setTimeout(() => {
        window.print();
        onClose();
      }, 300);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to print slip');
    }
  }

  const logo = settings?.logoUrl;
  const companyName = settings?.companyName || COMPANY_NAME;

  return (
    <>
      {/* Scrollable A4 document — this whole surface is the print target. */}
      <div
        className="min-h-0 flex-1 overflow-y-auto bg-neutral-100 px-3 py-4 sm:px-6 dark:bg-neutral-900"
        style={{ touchAction: 'pan-x pan-y pinch-zoom' }}
      >
        <div className="print-area mx-auto max-w-[820px] bg-white p-5 text-black shadow-sm sm:p-8">
          {/* Header */}
          <div className="flex items-center gap-4 border-b border-neutral-300 pb-4">
            {logo && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logo} alt="logo" className="h-14 w-14 shrink-0 object-contain sm:h-16 sm:w-16" />
            )}
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-xl font-bold sm:text-2xl">{companyName}</h2>
              <p className="text-sm font-medium text-neutral-600">Production Department</p>
            </div>
            <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${STATUS_STYLES[order.status] ?? 'bg-neutral-200 text-neutral-700'}`}>
              {order.status}
            </span>
          </div>

          {/* Meta */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 py-4 text-sm sm:grid-cols-3">
            <Meta label="Order #" value={slipReference(order)} mono />
            <Meta label="Date" value={order.date} />
            <Meta label="Time" value={order.time} />
            <Meta label="Branch" value={order.branchName} />
            <Meta label="Requested By" value={order.createdByName} />
            <Meta label="Status" value={order.status} />
          </div>

          {/* Product table — desktop + always on print */}
          <table className="print-doc-table hidden w-full border-collapse text-sm md:table">
            <thead>
              <tr className="border-y border-neutral-300 text-left">
                <th className="py-2 pr-2 font-semibold">Product</th>
                <th className="px-2 py-2 text-right font-semibold">Previous Balance</th>
                <th className="px-2 py-2 text-right font-semibold">New Demand</th>
                <th className="px-2 py-2 text-right font-semibold">Total Required</th>
                <th className="px-2 py-2 text-right font-semibold">Approved</th>
                <th className="py-2 pl-2 font-semibold">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ it, newDemand, previousBalance, totalRequired, approved }) => (
                <tr key={it.productId} className="border-b border-neutral-200 align-top">
                  <td className="py-2 pr-2 font-medium">{it.productName}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{previousBalance}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{newDemand}</td>
                  <td className="px-2 py-2 text-right font-semibold tabular-nums text-primary">{totalRequired}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {editing && !readOnly ? (
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={edits[it.productId] ?? String(totalRequired)}
                        onChange={(e) => setEdits((p) => ({ ...p, [it.productId]: digits(e.target.value) }))}
                        className="ml-auto h-8 w-20 text-right tabular-nums"
                      />
                    ) : (
                      <span className="font-semibold">{approved}</span>
                    )}
                  </td>
                  <td className="py-2 pl-2 text-neutral-600">{it.remarks || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Product cards — mobile screen only (never on print) */}
          <div className="print-doc-cards space-y-3 md:hidden">
            {rows.map(({ it, newDemand, previousBalance, totalRequired, approved }) => (
              <div key={it.productId} className="rounded-lg border border-neutral-200 p-3">
                <p className="font-semibold">{it.productName}</p>
                <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
                  <Field label="Previous Balance" value={previousBalance} />
                  <Field label="New Demand" value={newDemand} />
                  <Field label="Total Required" value={totalRequired} strong />
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">Approved</p>
                    {editing && !readOnly ? (
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={edits[it.productId] ?? String(totalRequired)}
                        onChange={(e) => setEdits((p) => ({ ...p, [it.productId]: digits(e.target.value) }))}
                        className="mt-0.5 h-8 w-24 text-right tabular-nums"
                      />
                    ) : (
                      <p className="font-semibold tabular-nums">{approved}</p>
                    )}
                  </div>
                </div>
                {it.remarks && <p className="mt-2 text-xs text-neutral-600">Remarks: {it.remarks}</p>}
              </div>
            ))}
          </div>

          {/* Change reason (screen only) */}
          {editing && !readOnly && changed && (
            <div className="no-print mt-4 space-y-1">
              <label className="text-sm font-medium">Reason for change</label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why was the quantity adjusted?" />
            </div>
          )}

          {/* Signatures */}
          <div className="mt-12 grid grid-cols-2 gap-8 text-xs text-neutral-700">
            <div className="text-center">
              <div className="border-t border-neutral-400 pt-1">Prepared By</div>
            </div>
            <div className="text-center">
              <div className="border-t border-neutral-400 pt-1">Approved By</div>
            </div>
          </div>
        </div>
      </div>

      {/* Action bar — fixed at the bottom of the modal, hidden on print */}
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
        <Button variant="secondary" onClick={print} disabled={reviewing}>
          <Printer className="mr-1.5 h-4 w-4" /> Print
        </Button>
      </div>
    </>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
      <p className={`truncate font-medium ${mono ? 'font-mono text-sm' : ''}`} title={value}>{value || '—'}</p>
    </div>
  );
}

function Field({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{label}</p>
      <p className={`tabular-nums ${strong ? 'font-semibold text-primary' : ''}`}>{value}</p>
    </div>
  );
}
