'use client';

import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Eye, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import type { StoreItem, StorePoInput, StorePoStatus, StorePurchaseOrder } from '@mb/shared';
import { STORE_PO_STATUSES, STORE_PO_STATUS_LABELS, StorePoInputSchema } from '@mb/shared';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import {
  useCreateStorePurchaseOrder, useStoreItems, useStorePurchaseOrder, useStorePurchaseOrders, useStoreSuppliers, useTransitionStorePurchaseOrder,
} from '@/lib/store';
import { cn } from '@/lib/utils';
import {
  Denied, ErrorBlock, Fact, Field, Pill, StorePage, errorMessage, fd, inputCls, num, rs, titleCase, useStoreSession, type Tone,
} from './parts';

/**
 * Purchase Orders (Phase 3, behind the `purchase_orders` module). Raise an order
 * to a supplier, move it draft → submitted → approved → sent, and cancel or
 * short-close with a reason. Receiving (next) fills what's received against it.
 */

const col = createColumnHelper<StorePurchaseOrder>();

const PO_TONE: Record<StorePoStatus, Tone> = {
  draft: 'muted', pending_approval: 'amber', approved: 'blue', sent: 'blue',
  partially_received: 'amber', received: 'green', closed: 'muted', cancelled: 'red',
};

const PoStatusPill = ({ status }: { status: StorePoStatus }) => <Pill tone={PO_TONE[status]}>{STORE_PO_STATUS_LABELS[status]}</Pill>;

export function StorePurchaseOrdersPage() {
  const session = useStoreSession();
  const { token, can, me } = session;
  const featureOn = Boolean(me.data?.features?.purchase_orders);
  const canWrite = can('receive') || can('accounts');

  const [status, setStatus] = useState<StorePoStatus | ''>('');
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);

  const ordersQ = useStorePurchaseOrders(token, { status: status || undefined }, featureOn);
  const rows = useMemo(() => ordersQ.data?.rows ?? [], [ordersQ.data]);

  const columns = useMemo(() => [
    col.accessor('poNo', { header: 'PO No', meta: { mobile: 'title' }, cell: (c) => <span className="whitespace-nowrap font-mono text-xs">{c.getValue()}</span> }),
    col.accessor('supplierName', { header: 'Supplier', meta: { mobile: 'subtitle' } }),
    col.accessor('orderDate', { header: 'Order date', cell: (c) => <span className="whitespace-nowrap">{fd(c.getValue())}</span> }),
    col.accessor((o) => o.expectedDate, { id: 'expected', header: 'Expected', cell: (c) => <span className="whitespace-nowrap">{c.getValue() ? fd(c.getValue()!) : '—'}</span> }),
    col.accessor('totalAmount', { header: 'Total', meta: { align: 'center', mobile: 'figure' }, cell: (c) => <span className="tabular-nums">{rs(c.getValue())}</span> }),
    col.accessor('status', { header: 'Status', meta: { mobile: 'badge' }, cell: (c) => <PoStatusPill status={c.getValue()} /> }),
    col.display({ id: 'actions', header: '', cell: (c) => <Button size="sm" variant="outline" onClick={() => setViewing(c.row.original.id)}><Eye className="mr-1 h-3.5 w-3.5" />Open</Button> }),
  ], []);

  return (
    <StorePage
      session={session}
      needs="receive"
      subtitle="Order stock from suppliers. Receiving fills what arrives against each order."
      actions={featureOn && canWrite ? <Button onClick={() => setCreating(true)}><Plus className="mr-1.5 h-4 w-4" />New PO</Button> : null}
    >
      {!featureOn ? (
        <Denied text="The Purchase Orders module is off for this store. An Admin can turn it on in Store Settings → Modules." />
      ) : (
        <>
          <nav className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" aria-label="Status">
            {([['', 'All'], ...STORE_PO_STATUSES.map((s) => [s, STORE_PO_STATUS_LABELS[s]] as const)] as const).map(([val, label]) => (
              <button
                key={val || 'all'}
                type="button"
                onClick={() => setStatus(val as StorePoStatus | '')}
                className={cn(
                  'h-8 shrink-0 whitespace-nowrap rounded-full border px-3 text-[13px] transition-colors',
                  status === val ? 'border-secondary bg-secondary font-semibold text-secondary-foreground' : 'border-border bg-card hover:border-primary/50',
                )}
              >
                {label}
              </button>
            ))}
          </nav>

          {ordersQ.isError ? (
            <ErrorBlock error={ordersQ.error} onRetry={() => void ordersQ.refetch()} />
          ) : (
            <DataTable
              columns={columns}
              data={rows}
              loading={ordersQ.isLoading}
              sortable
              toolbar={false}
              stickyFirstColumn
              pageSize={25}
              empty={<EmptyState icon={ShoppingCart} title={status ? 'No orders in this status' : 'No purchase orders yet'} description={canWrite ? 'Raise one to order stock from a supplier.' : undefined} />}
            />
          )}
        </>
      )}

      {creating && <PoCreateDialog token={token} onClose={() => setCreating(false)} />}
      {viewing && <PoDetailDialog token={token} id={viewing} canWrite={canWrite} onClose={() => setViewing(null)} />}
    </StorePage>
  );
}

// ─── Create ───────────────────────────────────────────────────────────────────

interface LineRow { itemId: string; qtyPackages: string; expectedPrice: string }

function PoCreateDialog({ token, onClose }: { token: string; onClose: () => void }) {
  const createM = useCreateStorePurchaseOrder(token);
  const suppliersQ = useStoreSuppliers(token);
  const itemsQ = useStoreItems(token);
  const items = useMemo(() => (itemsQ.data ?? []).filter((i) => i.status === 'active'), [itemsQ.data]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  const [tried, setTried] = useState(false);
  const [supplierId, setSupplierId] = useState('');
  const [orderDate, setOrderDate] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<LineRow[]>([{ itemId: '', qtyPackages: '', expectedPrice: '' }]);

  const setLine = (idx: number, patch: Partial<LineRow>) => setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, { itemId: '', qtyPackages: '', expectedPrice: '' }]);
  const removeLine = (idx: number) => setLines((ls) => (ls.length === 1 ? ls : ls.filter((_, i) => i !== idx)));
  const onPickItem = (idx: number, itemId: string) => {
    const it = itemById.get(itemId);
    const price = it?.unitPrice != null ? String(Math.round(it.unitPrice * it.conversionQty * 100) / 100) : '';
    setLine(idx, { itemId, expectedPrice: price });
  };

  const input: StorePoInput = {
    supplierId,
    orderDate: orderDate || undefined,
    expectedDate: expectedDate || null,
    notes: notes.trim() || null,
    lines: lines.filter((l) => l.itemId).map((l) => {
      const it = itemById.get(l.itemId)!;
      return {
        itemId: l.itemId,
        packageName: it.purchaseUnit,
        packageQty: it.conversionQty,
        qtyPackages: Number(l.qtyPackages),
        expectedPrice: l.expectedPrice === '' ? 0 : Number(l.expectedPrice),
      };
    }),
  };
  const parsed = StorePoInputSchema.safeParse(input);
  const total = input.lines.reduce((a, l) => a + (Number.isFinite(l.qtyPackages) ? l.qtyPackages * (l.expectedPrice ?? 0) : 0), 0);

  const save = () => {
    if (!parsed.success) { setTried(true); return; }
    createM.mutate(parsed.data, {
      onSuccess: (o) => { toast.success(`${o.poNo} created as a draft.`); onClose(); },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !createM.isPending && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto md:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>New purchase order</DialogTitle>
          <DialogDescription>Starts as a draft. Submit it for approval, then send it to the supplier.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Supplier" required error={tried && !supplierId ? 'Pick a supplier' : null}>
            <select className={inputCls(tried && !supplierId)} value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">Select…</option>
              {(suppliersQ.data ?? []).filter((s) => s.isActive).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Order date"><input type="date" className={inputCls()} value={orderDate} onChange={(e) => setOrderDate(e.target.value)} /></Field>
          <Field label="Expected date"><input type="date" className={inputCls()} value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></Field>
        </div>

        <div className="mt-1 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Lines</span>
            <Button size="sm" variant="outline" onClick={addLine}><Plus className="mr-1 h-3.5 w-3.5" />Add line</Button>
          </div>
          {lines.map((l, idx) => {
            const it = itemById.get(l.itemId);
            return (
              <div key={idx} className="grid grid-cols-[1fr_auto] items-end gap-2 rounded-lg border border-border p-2 sm:grid-cols-[2fr_1fr_1fr_auto]">
                <Field label="Item">
                  <select className={inputCls()} value={l.itemId} onChange={(e) => onPickItem(idx, e.target.value)}>
                    <option value="">Select an item…</option>
                    {items.map((i) => <option key={i.id} value={i.id}>{titleCase(i.name)} · {i.itemCode}</option>)}
                  </select>
                </Field>
                <Field label={it ? `Packages (${it.purchaseUnit})` : 'Packages'}>
                  <input inputMode="decimal" className={inputCls()} value={l.qtyPackages} onChange={(e) => setLine(idx, { qtyPackages: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0" />
                </Field>
                <Field label={it ? `Price / ${it.purchaseUnit}` : 'Price / package'}>
                  <input inputMode="decimal" className={inputCls()} value={l.expectedPrice} onChange={(e) => setLine(idx, { expectedPrice: e.target.value.replace(/[^\d.]/g, '') })} placeholder="0" />
                </Field>
                <Button size="sm" variant="ghost" className="text-red-700" aria-label="Remove line" disabled={lines.length === 1} onClick={() => removeLine(idx)}><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            );
          })}
          {tried && !parsed.success && <p className="text-xs text-destructive">{parsed.error.issues[0]?.message}</p>}
        </div>

        <Field label="Notes" optional><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-sm text-muted-foreground">Total: <b className="tabular-nums text-foreground">{rs(total)}</b></span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={createM.isPending}>Cancel</Button>
            <Button onClick={save} disabled={createM.isPending}>{createM.isPending ? 'Saving…' : 'Create PO'}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Detail ───────────────────────────────────────────────────────────────────

/** Which workflow buttons each status offers. Cancel/short-close need a reason. */
const ACTIONS_BY_STATUS: Record<StorePoStatus, Array<{ action: 'submit' | 'approve' | 'send' | 'cancel' | 'short_close'; label: string; reason?: boolean }>> = {
  draft: [{ action: 'submit', label: 'Submit for approval' }, { action: 'cancel', label: 'Cancel', reason: true }],
  pending_approval: [{ action: 'approve', label: 'Approve' }, { action: 'cancel', label: 'Cancel', reason: true }],
  approved: [{ action: 'send', label: 'Mark sent' }, { action: 'cancel', label: 'Cancel', reason: true }],
  sent: [{ action: 'short_close', label: 'Short-close', reason: true }, { action: 'cancel', label: 'Cancel', reason: true }],
  partially_received: [{ action: 'short_close', label: 'Short-close', reason: true }, { action: 'cancel', label: 'Cancel', reason: true }],
  received: [],
  closed: [],
  cancelled: [],
};

function PoDetailDialog({ token, id, canWrite, onClose }: { token: string; id: string; canWrite: boolean; onClose: () => void }) {
  const poQ = useStorePurchaseOrder(token, id);
  const transM = useTransitionStorePurchaseOrder(token);
  const po = poQ.data;
  const [reasonFor, setReasonFor] = useState<'cancel' | 'short_close' | null>(null);
  const [reason, setReason] = useState('');

  const run = (action: 'submit' | 'approve' | 'send' | 'cancel' | 'short_close', needsReason?: boolean) => {
    if (needsReason && !reasonFor) { setReasonFor(action as 'cancel' | 'short_close'); return; }
    transM.mutate({ id, input: { action, reason: reason.trim() || undefined } }, {
      onSuccess: (o) => { toast.success(`${o.poNo} is now ${STORE_PO_STATUS_LABELS[o.status].toLowerCase()}.`); setReasonFor(null); setReason(''); },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !transM.isPending && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto md:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>{po?.poNo ?? 'Purchase order'}</DialogTitle>
          <DialogDescription>{po ? po.supplierName : ''}</DialogDescription>
        </DialogHeader>

        {poQ.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : poQ.isError || !po ? (
          <ErrorBlock error={poQ.error} onRetry={() => void poQ.refetch()} />
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Fact k="Status" v={<PoStatusPill status={po.status} />} />
              <Fact k="Order date" v={fd(po.orderDate)} />
              <Fact k="Expected" v={po.expectedDate ? fd(po.expectedDate) : '—'} />
              <Fact k="Total" v={rs(po.totalAmount)} />
              <Fact k="Created by" v={po.createdByName ?? '—'} />
              <Fact k="Approved by" v={po.approvedByName ?? '—'} />
              {po.cancelReason ? <Fact k="Cancel reason" v={po.cancelReason} className="col-span-2 sm:col-span-3" /> : null}
              {po.shortCloseReason ? <Fact k="Short-close reason" v={po.shortCloseReason} className="col-span-2 sm:col-span-3" /> : null}
              {po.notes ? <Fact k="Notes" v={po.notes} className="col-span-2 sm:col-span-3" /> : null}
            </div>

            <div className="divide-y overflow-hidden rounded-lg border">
              <div className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 bg-muted/40 px-3 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                <span>Item</span><span className="text-right">Qty</span><span className="text-right">Price</span><span className="text-right">Total</span>
              </div>
              {(po.lines ?? []).map((l) => (
                <div key={l.id} className="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 px-3 py-2 text-sm">
                  <span><b>{titleCase(l.itemName)}</b></span>
                  <span className="text-right tabular-nums">{num(l.qtyPackages)} {l.packageName}</span>
                  <span className="text-right tabular-nums">{rs(l.expectedPrice)}</span>
                  <span className="text-right font-semibold tabular-nums">{rs(l.lineTotal)}</span>
                </div>
              ))}
            </div>

            {canWrite && reasonFor && (
              <Field label={reasonFor === 'cancel' ? 'Reason to cancel' : 'Reason to short-close'} required>
                <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required" />
              </Field>
            )}

            {canWrite && ACTIONS_BY_STATUS[po.status].length > 0 && (
              <div className="flex flex-wrap gap-2">
                {reasonFor ? (
                  <>
                    <Button variant="outline" onClick={() => { setReasonFor(null); setReason(''); }} disabled={transM.isPending}>Back</Button>
                    <Button disabled={transM.isPending || !reason.trim()} onClick={() => run(reasonFor, false)}>{transM.isPending ? 'Saving…' : 'Confirm'}</Button>
                  </>
                ) : (
                  ACTIONS_BY_STATUS[po.status].map((a) => (
                    <Button key={a.action} variant={a.action === 'cancel' || a.action === 'short_close' ? 'outline' : 'default'}
                      className={a.action === 'cancel' ? 'text-red-700' : undefined}
                      disabled={transM.isPending} onClick={() => run(a.action, a.reason)}>
                      {a.label}
                    </Button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={transM.isPending}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
