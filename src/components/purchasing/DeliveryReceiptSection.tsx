'use client';

import { useRef, useState } from 'react';
import {
  DELIVERY_PROVIDERS,
  DELIVERY_PROVIDER_LABEL,
  DeliveryInputSchema,
  ReceiptInputSchema,
  businessDateStr,
  type DeliveryProvider,
  type PurchaseDemandDetail,
  type PurchaseItem,
} from '@mb/shared';
import { PackageCheck, PackagePlus, Truck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useCreatePurchaseItem, usePurchaseItems, useRecordReceipt, useSaveDelivery } from '@/lib/purchasing';
import { formatDate, formatDateTime } from '@/utils/date';
import { cn } from '@/lib/utils';
import {
  DELIVERY_STATUS_LABEL,
  DELIVERY_STATUS_TONE,
  SubmissionKey,
  decimalInput,
  defaultStockItemId,
  formatQty,
  stockItemChoices,
  issuesByPath,
  newRequestId,
  parseNumber,
} from './purchasing-model';
import { Check, ConfirmDialog, Facts, Field, Pill, Section, errorMessage, money } from './parts';

/**
 * Delivery and goods receipt.
 *
 * DELIVERY IS A RECORD, NOT A BOOKING. Bykea, inDrive and Yango are listed so
 * the ride can be noted against the demand — reference, fee, who pays — but
 * nothing here calls any of them. The rider is booked in their own app.
 *
 * RECEIPT MOVES INGREDIENT STOCK. Each line books the accepted quantity
 * (received − damaged) into the stock item it names, so the confirmation says
 * so, and the request carries an Idempotency-Key: a retried receipt must not
 * count the same bags twice.
 */
export function DeliveryReceiptSection({ token, demand }: { token: string; demand: PurchaseDemandDetail }) {
  const [editingDelivery, setEditingDelivery] = useState(false);
  const [receiving, setReceiving] = useState(false);
  const d = demand.delivery;

  return (
    <div className="space-y-4">
      <Section
        title="Delivery"
        actions={
          <>
            <Pill tone={DELIVERY_STATUS_TONE[demand.deliveryStatus]}>{DELIVERY_STATUS_LABEL[demand.deliveryStatus]}</Pill>
            {demand.actions.saveDelivery && (
              <Button size="sm" variant="outline" onClick={() => setEditingDelivery(true)}>
                <Truck className="mr-1.5 h-4 w-4" /> {d ? 'Update delivery' : 'Record delivery'}
              </Button>
            )}
          </>
        }
      >
        {d ? (
          <Facts
            rows={[
              ['Service', d.provider === 'other' ? d.providerName ?? 'Other' : DELIVERY_PROVIDER_LABEL[d.provider]],
              ['Booking reference', d.bookingReference ?? '—'],
              ['Estimated fee', money(d.estimatedFee)],
              ['Actual fee', money(d.actualFee)],
              ['Fee paid by', d.feePaidBy === 'supplier' ? 'Supplier' : 'Mountain Bakes'],
              ...(d.pickupDetails ? ([['Pickup', d.pickupDetails]] as Array<[string, string]>) : []),
              ...(d.deliveryNotes ? ([['Notes', d.deliveryNotes]] as Array<[string, string]>) : []),
              ['Dispatched', d.dispatchedAt ? formatDateTime(d.dispatchedAt) : '—'],
              ['Delivered', d.deliveredAt ? formatDateTime(d.deliveredAt) : '—'],
              ['Received by', d.receivedByName ?? '—'],
              ['Last updated', `${formatDateTime(d.updatedAt)}${d.updatedByName ? ` · ${d.updatedByName}` : ''}`],
            ]}
          />
        ) : (
          <p className="text-sm text-muted-foreground">No delivery recorded yet.</p>
        )}
      </Section>

      <Section
        title="Goods receipt"
        actions={
          demand.actions.receive && (
            <Button size="sm" onClick={() => setReceiving(true)}>
              <PackageCheck className="mr-1.5 h-4 w-4" /> Receive goods
            </Button>
          )
        }
      >
        {demand.receiptProgress.length === 0 ? (
          <p className="text-sm text-muted-foreground">Goods can be received once a bill is approved.</p>
        ) : (
          <div className="-mx-1 overflow-x-auto px-1">
            <table className="w-full min-w-[28rem] text-sm">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="py-1.5 pr-2 font-medium">Item</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Billed</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Received</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Damaged</th>
                  <th className="py-1.5 text-right font-medium">Still owed</th>
                </tr>
              </thead>
              <tbody>
                {demand.receiptProgress.map((p) => (
                  <tr key={p.billItemId} className="border-b last:border-0">
                    <td className="py-1.5 pr-2">{p.itemName}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{formatQty(p.billed)} {p.unit}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{formatQty(p.received)}</td>
                    <td className={cn('py-1.5 pr-2 text-right tabular-nums', p.damaged > 0 && 'text-red-600')}>{formatQty(p.damaged)}</td>
                    <td className={cn('py-1.5 text-right font-medium tabular-nums', p.outstanding > 0 && 'text-amber-700 dark:text-amber-400')}>{formatQty(p.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {demand.receipts.length > 0 && (
          <ul className="space-y-2">
            {demand.receipts.map((r) => (
              <li key={r.id} className="rounded-md bg-muted/40 p-2.5 text-sm">
                <p className="flex flex-wrap items-center gap-2 font-medium">
                  {r.receiptNo}
                  {r.isFinal && <Pill tone="neutral">Final</Pill>}
                  <span className="text-xs font-normal text-muted-foreground">
                    {formatDate(r.businessDate)} · {formatDateTime(r.receivedAt)}
                    {r.receivedByName ? ` · ${r.receivedByName}` : ''}
                  </span>
                </p>
                <ul className="mt-1 text-xs">
                  {r.items.map((i) => (
                    <li key={i.id}>
                      {i.itemName}: {formatQty(i.receivedQty)} {i.unit} received
                      {i.damagedQty > 0 ? `, ${formatQty(i.damagedQty)} damaged` : ''} → {formatQty(i.acceptedQty)} into stock
                      {i.note ? ` (${i.note})` : ''}
                    </li>
                  ))}
                </ul>
                {r.notes && <p className="mt-1 text-xs text-muted-foreground">{r.notes}</p>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <DeliveryDialog token={token} demand={demand} open={editingDelivery} onOpenChange={setEditingDelivery} />
      <ReceiptDialog token={token} demand={demand} open={receiving} onOpenChange={setReceiving} />
    </div>
  );
}

// ── Delivery form ───────────────────────────────────────────────────────────

function DeliveryDialog({ token, demand, open, onOpenChange }: { token: string; demand: PurchaseDemandDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const save = useSaveDelivery(token);
  const blank = {
    provider: 'bykea' as DeliveryProvider,
    providerName: '',
    bookingReference: '',
    estimatedFee: '',
    actualFee: '',
    feePaidBy: 'mountain_bakes' as 'mountain_bakes' | 'supplier',
    pickupDetails: '',
    deliveryNotes: '',
    status: 'booked' as 'booked' | 'dispatched' | 'delivered',
    receivedByName: '',
  };
  const [f, setF] = useState(blank);
  const [attempted, setAttempted] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const d = demand.delivery;
      setF(
        d
          ? {
              provider: d.provider,
              providerName: d.providerName ?? '',
              bookingReference: d.bookingReference ?? '',
              estimatedFee: d.estimatedFee == null ? '' : String(d.estimatedFee),
              actualFee: d.actualFee == null ? '' : String(d.actualFee),
              feePaidBy: d.feePaidBy,
              pickupDetails: d.pickupDetails ?? '',
              deliveryNotes: d.deliveryNotes ?? '',
              status: d.status,
              receivedByName: d.receivedByName ?? '',
            }
          : blank,
      );
      setAttempted(false);
    }
  }
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const body = {
    provider: f.provider,
    providerName: f.providerName.trim() || null,
    bookingReference: f.bookingReference.trim() || null,
    estimatedFee: f.estimatedFee.trim() ? parseNumber(f.estimatedFee) : null,
    actualFee: f.actualFee.trim() ? parseNumber(f.actualFee) : null,
    feePaidBy: f.feePaidBy,
    pickupDetails: f.pickupDetails.trim() || null,
    deliveryNotes: f.deliveryNotes.trim() || null,
    status: f.status,
    receivedByName: f.receivedByName.trim() || null,
  };
  const parsed = DeliveryInputSchema.safeParse(body);
  const errors = parsed.success ? {} : issuesByPath(parsed.error.issues);
  const err = (k: string) => (attempted ? errors[k] : undefined);

  async function submit() {
    setAttempted(true);
    if (!parsed.success || save.isPending) return;
    try {
      await save.mutateAsync({ id: demand.id, body: parsed.data });
      toast.success('Delivery saved');
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save the delivery'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className="md:max-w-xl">
        <DialogHeader>
          <DialogTitle>Delivery · {demand.demandNo}</DialogTitle>
          <DialogDescription>A record of how the goods travel. Book the rider in the service&apos;s own app — nothing is booked from here.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Service" htmlFor="del-provider">
            <Select value={f.provider} onValueChange={(v) => v && set('provider', v as DeliveryProvider)}>
              <SelectTrigger id="del-provider" className="h-10 w-full">
                <SelectValue>{(v: string) => DELIVERY_PROVIDER_LABEL[v as DeliveryProvider]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {DELIVERY_PROVIDERS.map((p) => (
                  <SelectItem key={p} value={p}>{DELIVERY_PROVIDER_LABEL[p]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {f.provider === 'other' ? (
            <Field label="Service name" htmlFor="del-pname" error={err('providerName')}>
              <Input id="del-pname" value={f.providerName} maxLength={80} onChange={(e) => set('providerName', e.target.value)} className="h-10" />
            </Field>
          ) : (
            <Field label="Booking reference (optional)" htmlFor="del-ref" error={err('bookingReference')}>
              <Input id="del-ref" value={f.bookingReference} maxLength={80} onChange={(e) => set('bookingReference', e.target.value)} className="h-10" />
            </Field>
          )}
          {f.provider === 'other' && (
            <Field label="Booking reference (optional)" htmlFor="del-ref2">
              <Input id="del-ref2" value={f.bookingReference} maxLength={80} onChange={(e) => set('bookingReference', e.target.value)} className="h-10" />
            </Field>
          )}
          <Field label="Estimated fee (optional)" htmlFor="del-est" error={err('estimatedFee')}>
            <Input id="del-est" inputMode="decimal" value={f.estimatedFee} onChange={(e) => set('estimatedFee', decimalInput(e.target.value))} className="h-10" placeholder="Rs." />
          </Field>
          <Field label="Actual fee (optional)" htmlFor="del-act" error={err('actualFee')}>
            <Input id="del-act" inputMode="decimal" value={f.actualFee} onChange={(e) => set('actualFee', decimalInput(e.target.value))} className="h-10" placeholder="Rs." />
          </Field>
          <Field label="Fee paid by" htmlFor="del-payer">
            <Select value={f.feePaidBy} onValueChange={(v) => v && set('feePaidBy', v as 'mountain_bakes' | 'supplier')}>
              <SelectTrigger id="del-payer" className="h-10 w-full">
                <SelectValue>{(v: string) => (v === 'supplier' ? 'Supplier' : 'Mountain Bakes')}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mountain_bakes">Mountain Bakes</SelectItem>
                <SelectItem value="supplier">Supplier</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="Status" htmlFor="del-status">
            <Select value={f.status} onValueChange={(v) => v && set('status', v as 'booked' | 'dispatched' | 'delivered')}>
              <SelectTrigger id="del-status" className="h-10 w-full">
                <SelectValue>{(v: string) => ({ booked: 'Booked', dispatched: 'Dispatched', delivered: 'Delivered' })[v] ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="booked">Booked</SelectItem>
                <SelectItem value="dispatched">Dispatched</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          {f.status === 'delivered' && (
            <Field label="Received by" htmlFor="del-recv" error={err('receivedByName')} className="sm:col-span-2">
              <Input id="del-recv" value={f.receivedByName} maxLength={120} onChange={(e) => set('receivedByName', e.target.value)} className="h-10" />
            </Field>
          )}
          <Field label="Pickup details (optional)" htmlFor="del-pickup">
            <Textarea id="del-pickup" rows={2} maxLength={500} value={f.pickupDetails} onChange={(e) => set('pickupDetails', e.target.value)} />
          </Field>
          <Field label="Delivery notes (optional)" htmlFor="del-notes">
            <Textarea id="del-notes" rows={2} maxLength={500} value={f.deliveryNotes} onChange={(e) => set('deliveryNotes', e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={save.isPending}>
            {save.isPending ? 'Saving…' : 'Save delivery'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Receipt form ────────────────────────────────────────────────────────────

interface RLine {
  billItemId: string;
  itemName: string;
  unit: string;
  outstanding: number;
  /**
   * The stock item chosen. `undefined` = not touched, so the default (see
   * defaultStockItemId) applies — resolved at render, because the catalog may
   * still be loading when the dialog opens.
   */
  itemId: string | null | undefined;
  received: string;
  damaged: string;
  note: string;
}

function ReceiptDialog({ token, demand, open, onOpenChange }: { token: string; demand: PurchaseDemandDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const record = useRecordReceipt(token);
  const createItem = useCreatePurchaseItem(token);
  const itemsQ = usePurchaseItems(token);
  const catalog = itemsQ.data ?? [];
  const approvedBill = demand.bills.find((b) => b.id === demand.approvedBillId) ?? null;

  const [lines, setLines] = useState<RLine[]>([]);
  const [final, setFinal] = useState(false);
  const [notes, setNotes] = useState('');
  const [date, setDate] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [clientRequestId, setClientRequestId] = useState('');
  const key = useRef(new SubmissionKey('receipt'));

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setLines(
        demand.receiptProgress
          .filter((p) => p.outstanding > 0)
          .map((p) => ({
              billItemId: p.billItemId,
              itemName: p.itemName,
              unit: p.unit,
              outstanding: p.outstanding,
              itemId: undefined,
              received: String(p.outstanding),
              damaged: '0',
              note: '',
            })),
      );
      setFinal(false);
      setNotes('');
      setDate(businessDateStr());
      setAttempted(false);
      setConfirming(false);
      setClientRequestId(newRequestId('rcpt'));
    }
  }
  const setLine = (id: string, patch: Partial<RLine>) => setLines((p) => p.map((l) => (l.billItemId === id ? { ...l, ...patch } : l)));
  const billLineOf = (l: RLine) => approvedBill?.items.find((i) => i.id === l.billItemId) ?? { quotationItemId: null, itemName: l.itemName, unit: l.unit };
  const choicesOf = (l: RLine) => stockItemChoices(billLineOf(l), demand.quotations, demand.items, catalog);
  const stockItemOf = (l: RLine): string | null => {
    if (l.itemId !== undefined) return l.itemId;
    return defaultStockItemId(billLineOf(l), demand.quotations, demand.items, catalog);
  };

  // Lines left at 0 received and 0 damaged are not sent: "nothing arrived" is
  // the absence of a line, and a zero line would be a receipt of nothing.
  const sent = lines.filter((l) => !(parseNumber(l.received) === 0 && parseNumber(l.damaged || '0') === 0));
  const body = {
    items: sent.map((l) => ({
      billItemId: l.billItemId,
      itemId: stockItemOf(l) ?? '',
      receivedQty: parseNumber(l.received),
      damagedQty: l.damaged.trim() ? parseNumber(l.damaged) : 0,
      note: l.note.trim() || null,
    })),
    final,
    notes: notes.trim() || null,
    businessDate: date,
    clientRequestId: clientRequestId,
  };
  const parsed = ReceiptInputSchema.safeParse(body);
  const errors = parsed.success ? {} : issuesByPath(parsed.error.issues);
  const lineErr = (billItemId: string, field: string) => {
    if (!attempted) return undefined;
    const i = sent.findIndex((l) => l.billItemId === billItemId);
    return i === -1 ? undefined : errors[`items.${i}.${field}`];
  };
  const over = sent.filter((l) => parseNumber(l.received) > l.outstanding);
  const nothing = sent.length === 0 && !final;

  function review() {
    setAttempted(true);
    if (!parsed.success || over.length > 0 || nothing) {
      if (nothing) toast.error('Enter what arrived, or tick "close the receipt" if nothing more is coming.');
      return;
    }
    setConfirming(true);
  }

  async function submit() {
    if (!parsed.success || record.isPending) return;
    try {
      const r = await record.mutateAsync({ id: demand.id, body: parsed.data, key: key.current.keyFor(JSON.stringify(parsed.data)) });
      key.current.reset();
      toast.success(r.replayed ? `Receipt ${r.receiptNo} was already recorded` : `Receipt ${r.receiptNo} recorded — stock updated`);
      setConfirming(false);
      onOpenChange(false);
    } catch (e) {
      setConfirming(false);
      toast.error(errorMessage(e, 'Could not record the receipt'));
    }
  }

  async function addToCatalog(l: RLine) {
    try {
      const item = await createItem.mutateAsync({ name: l.itemName, unit: l.unit });
      setLine(l.billItemId, { itemId: item.id });
      toast.success(`${item.name} added to the ingredient catalog`);
    } catch (e) {
      toast.error(errorMessage(e, 'Could not add the item to the catalog'));
    }
  }

  return (
    <>
      <Dialog open={open && !confirming} onOpenChange={(o) => !record.isPending && onOpenChange(o)}>
        <DialogContent mobile="fullscreen" className="md:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Receive goods · {demand.demandNo}</DialogTitle>
            <DialogDescription>
              Count what arrived against bill {approvedBill?.supplierBillNo ?? ''}. Received minus damaged goes into ingredient stock.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {lines.map((l) => (
              <div key={l.billItemId} className="space-y-2 rounded-lg border p-2.5">
                <p className="text-sm font-medium">
                  {l.itemName} <span className="font-normal text-muted-foreground">· {formatQty(l.outstanding)} {l.unit} still owed</span>
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_minmax(0,2fr)]">
                  <Field label="Received" error={lineErr(l.billItemId, 'receivedQty') ?? (attempted && parseNumber(l.received) > l.outstanding ? `At most ${formatQty(l.outstanding)}` : undefined)}>
                    <Input inputMode="decimal" value={l.received} aria-label={`Received quantity of ${l.itemName}`} onChange={(e) => setLine(l.billItemId, { received: decimalInput(e.target.value) })} className="h-10" />
                  </Field>
                  <Field label="Damaged" error={lineErr(l.billItemId, 'damagedQty')}>
                    <Input inputMode="decimal" value={l.damaged} aria-label={`Damaged quantity of ${l.itemName}`} onChange={(e) => setLine(l.billItemId, { damaged: decimalInput(e.target.value) })} className="h-10" />
                  </Field>
                  <Field
                    label="Into stock item"
                    className="col-span-2 sm:col-span-1"
                    error={lineErr(l.billItemId, 'itemId')}
                    hint={choicesOf(l).locked ? 'The catalog item this demand line was raised for.' : `Catalog items in ${l.unit}.`}
                  >
                    <StockItemSelect
                      catalog={choicesOf(l).choices}
                      value={stockItemOf(l)}
                      disabled={choicesOf(l).locked}
                      onChange={(id) => setLine(l.billItemId, { itemId: id })}
                      label={l.itemName}
                    />
                  </Field>
                </div>
                {choicesOf(l).locked && choicesOf(l).choices.length === 0 && (
                  <p className="text-xs text-destructive">
                    The catalog item this line was raised for is inactive or missing. Reactivate it before receiving.
                  </p>
                )}
                {!choicesOf(l).locked && !stockItemOf(l) && !choicesOf(l).choices.some((c) => c.name.trim().toLowerCase() === l.itemName.trim().toLowerCase()) && (
                  <Button size="sm" variant="ghost" disabled={createItem.isPending} onClick={() => void addToCatalog(l)}>
                    <PackagePlus className="mr-1.5 h-4 w-4" /> Add &ldquo;{l.itemName}&rdquo; ({l.unit}) to the catalog
                  </Button>
                )}
                <Input aria-label={`Note for ${l.itemName}`} placeholder="Note (optional)" value={l.note} maxLength={300} onChange={(e) => setLine(l.billItemId, { note: e.target.value })} className="h-9" />
              </div>
            ))}
            {lines.length === 0 && <p className="text-sm text-muted-foreground">Everything billed has been received.</p>}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Business date" htmlFor="rcpt-date" error={attempted ? errors['businessDate'] : undefined}>
                <Input id="rcpt-date" type="date" value={date} max={businessDateStr()} onChange={(e) => setDate(e.target.value)} className="h-10" />
              </Field>
              <Field label="Notes (optional)" htmlFor="rcpt-notes">
                <Textarea id="rcpt-notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </Field>
            </div>
            <Check id="rcpt-final" checked={final} onChange={setFinal}>
              Close the receipt — nothing more is coming, even though some billed quantity did not arrive.
            </Check>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={record.isPending}>
              Cancel
            </Button>
            <Button onClick={review} disabled={record.isPending}>
              Review receipt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Record this receipt?"
        description={
          <>
            {sent.length === 0
              ? 'No goods are booked. '
              : `${sent.map((l) => `${formatQty(Math.max(0, parseNumber(l.received) - (parseNumber(l.damaged) || 0)))} ${l.unit} ${l.itemName}`).join(', ')} go into ingredient stock. `}
            {final ? 'The receipt is closed; anything still owed is recorded as short. ' : ''}
            Stock movements cannot be undone from here.
          </>
        }
        confirmLabel="Record receipt"
        pending={record.isPending}
        onConfirm={() => void submit()}
      />
    </>
  );
}

function StockItemSelect({
  catalog,
  value,
  onChange,
  label,
  disabled,
}: {
  catalog: PurchaseItem[];
  value: string | null;
  onChange: (id: string | null) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange((v as string) ?? null)} disabled={disabled}>
      <SelectTrigger className="h-10 w-full" aria-label={`Stock item for ${label}`}>
        <SelectValue placeholder="Choose stock item…">
          {(v: string | null) => {
            const c = catalog.find((x) => x.id === v);
            return c ? `${c.name} (${c.unit})` : 'Choose stock item…';
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {catalog.map((c) => (
          <SelectItem key={c.id} value={c.id}>
            {c.name} ({c.unit}) · {formatQty(c.balance)} on hand
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
