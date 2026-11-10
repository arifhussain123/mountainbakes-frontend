'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { toast } from 'sonner';
import { AlertTriangle, Pencil, Plus, Power, Tags } from 'lucide-react';
import type { StoreItem, StorePrice, StorePriceInput, StorePriceState } from '@mb/shared';
import { StorePriceInputSchema } from '@mb/shared';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { newSubmissionKey, useAddStorePrice, useDeactivateStorePrice, useStoreItems, useStoreLookups, useStorePrices } from '@/lib/store';
import {
  ConfirmDialog, ErrorBlock, Field, Pill, Segmented, StorePage, errorMessage, fd, inputCls, num, rate, rs, useStoreSession, type Tone,
} from './parts';

/**
 * Store Item Price Control (design: "Store Item Price Control"). The purchase
 * price of one whole package, effective-dated. A change always adds a new row;
 * earlier prices and past receipts keep what they recorded.
 */

const col = createColumnHelper<StorePrice>();

const STATE: Record<StorePriceState, { tone: Tone; label: string }> = {
  active: { tone: 'green', label: 'Active' },
  scheduled: { tone: 'blue', label: 'Scheduled' },
  superseded: { tone: 'muted', label: 'Superseded' },
  inactive: { tone: 'muted', label: 'Inactive' },
};

const isLive = (p: StorePrice) => p.state === 'active' || p.state === 'scheduled';
const pkgLabel = (p: { packageName: string; packageQty: number }, unit: string) => `${p.packageName} of ${num(p.packageQty)} ${unit}`.trim();

/**
 * The price in force for one package of an item on `day` — the API's rule
 * (app.store_price_state): not deactivated, already started, and no newer
 * live price for the same package has started since.
 */
function priceOn(prices: StorePrice[], itemId: string, packageName: string, packageQty: number, day: string): StorePrice | null {
  const live = prices.filter((p) => p.status === 'active' && p.itemId === itemId && p.packageName === packageName
    && Number(p.packageQty) === packageQty && p.effectiveFrom <= day);
  live.sort((a, b) => (a.effectiveFrom === b.effectiveFrom ? (a.createdAt < b.createdAt ? 1 : -1) : a.effectiveFrom < b.effectiveFrom ? 1 : -1));
  return live[0] ?? null;
}

interface PriceForm {
  itemId: string;
  pkg: string;
  pkgQty: string;
  price: string;
  effective: string;
}

export function StorePricesPage() {
  const session = useStoreSession();
  const { token, can, today } = session;
  const canEdit = can('prices.edit');

  const [q, setQ] = useState('');
  const [show, setShow] = useState<'current' | 'all'>('current');
  const [editing, setEditing] = useState<PriceForm | null>(null);
  const [deactivating, setDeactivating] = useState<StorePrice | null>(null);

  const currentQ = useStorePrices(token);
  // Fetched only while "Full history" is on.
  const historyQ = useStorePrices(show === 'all' ? token : '', { history: true });
  const itemsQ = useStoreItems(token);
  const deactivateM = useDeactivateStorePrice(token);

  const listQ = show === 'all' ? historyQ : currentQ;
  const current = useMemo(() => currentQ.data ?? [], [currentQ.data]);
  const activeItems = useMemo(() => (itemsQ.data ?? []).filter((i) => i.status === 'active'), [itemsQ.data]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const all = listQ.data ?? [];
    return term ? all.filter((p) => `${p.itemName} ${p.priceNo} ${p.itemNo}`.toLowerCase().includes(term)) : all;
  }, [listQ.data, q]);

  const missing = useMemo(() => {
    const priced = new Set(current.filter((p) => p.state === 'active').map((p) => p.itemId));
    return activeItems.filter((i) => !priced.has(i.id)).map((i) => i.name);
  }, [current, activeItems]);

  const columns = useMemo(() => {
    const fade = (p: StorePrice, node: ReactNode) => <div className={cn(!isLive(p) && 'opacity-60')}>{node}</div>;
    return [
      col.accessor('priceNo', { header: 'Price ID', meta: { mobile: 'subtitle' }, cell: (c) => fade(c.row.original, <span className="font-mono text-xs">{c.getValue()}</span>) }),
      col.accessor('itemNo', { header: 'Item ID', cell: (c) => fade(c.row.original, <span className="font-mono text-xs">{c.getValue()}</span>) }),
      col.accessor('itemName', { header: 'Item Name', meta: { mobile: 'title' }, cell: (c) => fade(c.row.original, <span className="font-semibold">{c.getValue()}</span>) }),
      col.accessor((p) => `${p.packageName} ${String(p.packageQty).padStart(12, '0')}`, {
        id: 'package',
        header: 'Purchase Package',
        cell: (c) => fade(c.row.original, <span className="whitespace-nowrap">{pkgLabel(c.row.original, c.row.original.baseUnit)}</span>),
      }),
      col.accessor('packageQty', { header: 'Package Qty', meta: { align: 'center', mobile: 'hidden' }, cell: (c) => fade(c.row.original, <span className="tabular-nums">{num(c.getValue())}</span>) }),
      col.accessor('baseUnit', { header: 'Package Unit', meta: { mobile: 'hidden' }, cell: (c) => fade(c.row.original, c.getValue()) }),
      col.accessor('price', { header: 'Purchase Price', meta: { align: 'center', mobile: 'figure' }, cell: (c) => fade(c.row.original, <span className="whitespace-nowrap font-semibold tabular-nums">{rs(c.getValue())}</span>) }),
      col.accessor((p) => (p.packageQty > 0 ? p.price / p.packageQty : 0), {
        id: 'perUnit',
        header: 'Per Unit',
        meta: { align: 'center', mobile: 'figure' },
        cell: (c) => fade(c.row.original, <span className="whitespace-nowrap tabular-nums">{rate(c.getValue(), c.row.original.baseUnit)}</span>),
      }),
      col.accessor('effectiveFrom', { header: 'Effective Date', meta: { align: 'center', mobile: 'figure' }, cell: (c) => fade(c.row.original, <span className="whitespace-nowrap tabular-nums">{fd(c.getValue())}</span>) }),
      col.accessor('state', {
        header: 'Status',
        meta: { mobile: 'badge' },
        cell: (c) => <Pill tone={STATE[c.getValue()].tone} className={cn(!isLive(c.row.original) && 'opacity-60')}>{STATE[c.getValue()].label}</Pill>,
      }),
      col.display({
        id: 'actions',
        header: 'Actions',
        cell: (c) => {
          const p = c.row.original;
          if (!canEdit || !isLive(p)) return <span className="text-xs text-muted-foreground">{p.createdByName ?? '—'}</span>;
          return (
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="outline" onClick={() => setEditing({ itemId: p.itemId, pkg: p.packageName, pkgQty: String(p.packageQty), price: '', effective: today })}>
                <Pencil className="mr-1 h-3.5 w-3.5" />Change price
              </Button>
              <Button size="sm" variant="outline" className="text-red-700" onClick={() => setDeactivating(p)}>
                <Power className="mr-1 h-3.5 w-3.5" />Deactivate
              </Button>
            </div>
          );
        },
      }),
    ];
  }, [canEdit, today]);

  const openNew = () => setEditing({ itemId: '', pkg: '', pkgQty: '', price: '', effective: today });

  return (
    <StorePage
      session={session}
      subtitle="Purchase price per package. A new price never changes earlier prices or past receipts."
      needs="view"
      actions={canEdit ? <Button onClick={openNew}><Plus className="mr-1.5 h-4 w-4" />New Price</Button> : null}
    >
      {!canEdit && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 px-3.5 py-2.5 text-[13.5px] text-blue-900 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200">
          View only. Finance and Admin set prices.
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item or price ID…" aria-label="Search" className={cn(inputCls(), 'max-w-xs')} />
        <Segmented<'current' | 'all'>
          value={show}
          onChange={setShow}
          options={[{ value: 'current', label: 'Current & scheduled' }, { value: 'all', label: 'Full history' }]}
        />
        <span className="ml-auto text-[13px] text-muted-foreground">{listQ.isLoading ? 'Loading…' : `${rows.length} price${rows.length === 1 ? '' : 's'}`}</span>
      </div>

      {listQ.isError ? (
        <ErrorBlock error={listQ.error} onRetry={() => void listQ.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          loading={listQ.isLoading}
          sortable
          toolbar={false}
          pageSize={25}
          empty={
            <EmptyState
              icon={Tags}
              title={(listQ.data ?? []).length ? 'No prices match' : 'No prices yet'}
              description={(listQ.data ?? []).length ? 'Try a different search.' : 'Set a price before an item can be received.'}
              action={!(listQ.data ?? []).length && canEdit ? <Button size="sm" onClick={openNew}><Plus className="mr-1.5 h-4 w-4" />New Price</Button> : undefined}
            />
          }
        />
      )}

      {!currentQ.isLoading && !itemsQ.isLoading && missing.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13.5px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>No active price, so these can&apos;t be received: {missing.join(', ')}</span>
        </div>
      )}

      {editing && (
        <PriceFormDialog
          token={token}
          today={today}
          initial={editing}
          items={activeItems}
          current={current}
          onClose={() => setEditing(null)}
        />
      )}

      <ConfirmDialog
        open={!!deactivating}
        onOpenChange={(o) => !o && setDeactivating(null)}
        title={`Deactivate ${deactivating?.priceNo ?? ''}?`}
        description={deactivating ? (
          <>
            {deactivating.itemName}, {pkgLabel(deactivating, deactivating.baseUnit)} at {rs(deactivating.price)} can no longer be used for new receipts.
            {' '}Past receipts keep their recorded price.
          </>
        ) : 'Past receipts keep their recorded price.'}
        confirmLabel="Deactivate"
        destructive
        pending={deactivateM.isPending}
        onConfirm={() => {
          if (!deactivating) return;
          const p = deactivating;
          deactivateM.mutate(p.id, {
            onSuccess: () => { toast.success(`${p.priceNo} deactivated. Past receipts keep their recorded price.`); setDeactivating(null); },
            onError: (e) => { toast.error(errorMessage(e)); setDeactivating(null); },
          });
        }}
      />
    </StorePage>
  );
}

function PriceFormDialog({ token, today, initial, items, current, onClose }: {
  token: string;
  today: string;
  initial: PriceForm;
  items: StoreItem[];
  /** Current & scheduled prices — what the new one is compared against. */
  current: StorePrice[];
  onClose: () => void;
}) {
  const addM = useAddStorePrice(token);
  const lookupsQ = useStoreLookups(token);
  const [tried, setTried] = useState(false);
  const [f, setF] = useState<PriceForm>(() => {
    if (initial.itemId && !initial.pkg) {
      const it = items.find((i) => i.id === initial.itemId);
      if (it) return { ...initial, pkg: it.purchaseUnit, pkgQty: String(it.conversionQty) };
    }
    return { ...initial, pkg: initial.pkg || 'Bag' };
  });
  // One key per submission; a retry of the identical submission reuses it.
  const keyRef = useRef<{ key: string; sig: string } | null>(null);

  const item = items.find((i) => i.id === f.itemId) ?? null;
  const unit = item?.baseUnit ?? '';
  const units = useMemo(() => {
    const v = (lookupsQ.data ?? []).filter((l) => l.kind === 'purchase_unit' && l.isActive).map((l) => l.value);
    return f.pkg && !v.includes(f.pkg) ? [f.pkg, ...v] : v;
  }, [lookupsQ.data, f.pkg]);

  const set = (k: keyof PriceForm) => (v: string) => setF((x) => {
    const nf = { ...x, [k]: v };
    if (k === 'itemId' && v) {
      const it = items.find((i) => i.id === v);
      if (it) { nf.pkg = it.purchaseUnit; nf.pkgQty = String(it.conversionQty); }
    }
    return nf;
  });

  const qtyN = Number(f.pkgQty);
  const priceN = Number(f.price);
  const day = f.effective || today;
  const cur = item && qtyN > 0 ? priceOn(current, item.id, f.pkg, qtyN, day) : null;

  const errs: Partial<Record<'item' | 'pkgQty' | 'price' | 'effective', string>> = {};
  if (!f.itemId) errs.item = 'Select an item.';
  if (!(qtyN > 0)) errs.pkgQty = 'Enter how much one package holds.';
  if (!(priceN > 0)) errs.price = 'Enter a price above 0.';
  if (!f.effective) errs.effective = 'Select the date the price starts.';
  else if (f.effective < today) errs.effective = 'Must be today or later. Past prices stay as recorded.';
  else if (current.some((p) => p.status === 'active' && p.itemId === f.itemId && p.packageName === f.pkg && Number(p.packageQty) === qtyN && p.effectiveFrom === f.effective)) {
    errs.effective = 'A price for this package already starts on this date.';
  }
  const input: StorePriceInput = { itemId: f.itemId, packageName: f.pkg, packageQty: qtyN, price: priceN, effectiveFrom: f.effective };
  const parsed = StorePriceInputSchema.safeParse(input);
  if (!parsed.success) {
    // The schema's limits (decimals, maximums) after the design's own checks.
    const map: Record<string, keyof typeof errs> = { itemId: 'item', packageQty: 'pkgQty', price: 'price', effectiveFrom: 'effective' };
    for (const i of parsed.error.issues) { const k = map[String(i.path[0])]; if (k) errs[k] ??= i.message; }
  }
  const e = (k: keyof typeof errs) => (tried ? errs[k] ?? null : null);

  let compare = 'Pick an item to see its current price for this package.';
  if (item) {
    const size = `${f.pkg} of ${f.pkgQty || '?'} ${unit}`;
    compare = cur
      ? `Current price ${rs(cur.price)} (${cur.priceNo}, from ${fd(cur.effectiveFrom)}).${priceN > 0 ? ` New price is ${priceN >= cur.price ? '+' : ''}${(((priceN - cur.price) / cur.price) * 100).toFixed(1)}%, ${rate(priceN / (qtyN || 1))} per ${unit}.` : ''} The current price stays in history.`
      : `No current price for a ${size}. This adds a new package size.`;
  }

  const save = () => {
    if (Object.keys(errs).length || !parsed.success) { setTried(true); return; }
    const sig = JSON.stringify(parsed.data);
    if (!keyRef.current || keyRef.current.sig !== sig) keyRef.current = { key: newSubmissionKey(), sig };
    addM.mutate({ input: parsed.data, key: keyRef.current.key }, {
      onSuccess: (p) => {
        keyRef.current = null;
        toast.success(`${p.priceNo} saved. ${p.effectiveFrom > today ? `It starts on ${fd(p.effectiveFrom)}.` : 'Used for new receipts from today.'}`);
        onClose();
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !addM.isPending && onClose()}>
      <DialogContent className="md:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>New Price</DialogTitle>
          <DialogDescription>Price ID is assigned when you save</DialogDescription>
        </DialogHeader>
        <div className="flex max-h-[65vh] flex-col gap-3 overflow-y-auto">
          <Field label="Item" required error={e('item')}>
            <select className={inputCls(!!e('item'))} value={f.itemId} onChange={(x) => set('itemId')(x.target.value)}>
              <option value="">Select item</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.name} · {i.itemNo}</option>)}
            </select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Purchase Package">
              <select className={inputCls()} value={f.pkg} onChange={(x) => set('pkg')(x.target.value)}>
                {units.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </Field>
            <Field label="Package Quantity" required error={e('pkgQty')} hint={unit ? `${unit} in one ${f.pkg}` : undefined}>
              <input inputMode="decimal" className={cn(inputCls(!!e('pkgQty')), 'tabular-nums')} value={f.pkgQty}
                onChange={(x) => set('pkgQty')(x.target.value.replace(/[^\d.]/g, ''))} placeholder="e.g. 50" />
            </Field>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-[12.5px] font-semibold text-foreground">Package Unit</span>
              <div className="flex h-10 items-center rounded-lg bg-muted px-3 text-sm text-muted-foreground md:h-9">{unit || '—'}</div>
            </div>
            <Field label="Purchase Price (Rs.)" required error={e('price')}>
              <input inputMode="decimal" className={cn(inputCls(!!e('price')), 'tabular-nums')} value={f.price}
                onChange={(x) => set('price')(x.target.value.replace(/[^\d.]/g, ''))} placeholder="Price of one whole package" />
            </Field>
            <Field label="Effective Date" required error={e('effective')}>
              <input type="date" className={cn(inputCls(!!e('effective')), 'tabular-nums')} value={f.effective} min={today}
                onChange={(x) => set('effective')(x.target.value)} />
            </Field>
          </div>
          <div className="rounded-lg bg-muted px-3 py-2.5 text-[13px] leading-relaxed text-muted-foreground">{compare}</div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={addM.isPending}>Cancel</Button>
          <Button onClick={save} disabled={addM.isPending}>{addM.isPending ? 'Saving…' : 'Save Price'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
