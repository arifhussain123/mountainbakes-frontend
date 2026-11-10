'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper } from '@tanstack/react-table';
import { toast } from 'sonner';
import { CheckCircle2, Eye, PackageOpen, Plus, Trash2 } from 'lucide-react';
import type { StoreItem, StorePrice, StoreReceipt, StoreReceiptInput } from '@mb/shared';
import { StoreReceiptInputSchema } from '@mb/shared';
import { ApiError } from '@/lib/api/client';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  newSubmissionKey, useReceiveStock, useStoreItems, useStorePrices, useStoreReceipt, useStoreReceipts, useStoreSuppliers,
} from '@/lib/store';
import { ROUTES } from '@/utils/routes';
import {
  ErrorBlock, Field, StorePage, addDays, errorMessage, fd, inputCls, num, qty, rs, useStoreSession,
} from './parts';

/**
 * New Stock Receiving (design: "New Stock Receiving"). One delivery from one
 * supplier, any number of items. Prices come from Price Control on the
 * receiving date; each line becomes its own costed batch.
 */

const OTHER = '__other__';

interface Line {
  key: string;
  itemId: string;
  priceId: string;
  pkgs: string;
  override: string;
  reason: string;
  batch: string;
  expiry: string;
}

interface Form {
  /** null: not touched yet, so the business date applies. */
  date: string | null;
  vendor: string; // supplier id, OTHER, or ''
  otherName: string;
  invoiceNo: string;
  remarks: string;
  lines: Line[];
}

let lineSeq = 0;
const newLine = (): Line => ({ key: `l${++lineSeq}`, itemId: '', priceId: '', pkgs: '', override: '', reason: '', batch: '', expiry: '' });
const emptyForm = (): Form => ({ date: null, vendor: '', otherName: '', invoiceNo: '', remarks: '', lines: [newLine()] });

/**
 * The prices an item can be received at on `day`: the API's rule
 * (app.store_price_state) — not deactivated, started, and no newer live price
 * for the same package has started since. Worked out from the full history so
 * a back-dated receipt is offered the price that was in force on that day.
 */
function activePricesOn(prices: StorePrice[], itemId: string, day: string): StorePrice[] {
  const live = prices.filter((p) => p.status === 'active' && p.itemId === itemId && p.effectiveFrom <= day);
  return live
    .filter((p) => !live.some((o) => o !== p && o.packageName === p.packageName && Number(o.packageQty) === Number(p.packageQty)
      && (o.effectiveFrom > p.effectiveFrom || (o.effectiveFrom === p.effectiveFrom && o.createdAt > p.createdAt))))
    .sort((a, b) => a.packageName.localeCompare(b.packageName) || a.packageQty - b.packageQty);
}

type LineErr = Partial<Record<'item' | 'price' | 'pkgs' | 'override' | 'reason' | 'expiry', string>>;

const duplicateOf = (err: unknown): string | null => {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const d = err.details as { code?: string; duplicateOf?: string } | undefined;
  return d?.code === 'duplicate_receipt' ? d.duplicateOf ?? '' : null;
};

const col = createColumnHelper<StoreReceipt>();

export function StoreReceivingPage() {
  const session = useStoreSession();
  const { token, can, today, userName, me } = session;
  const store = me.data?.store;
  const canOverride = can('receive.override');

  const itemsQ = useStoreItems(token);
  const pricesQ = useStorePrices(token, { history: true });
  const suppliersQ = useStoreSuppliers(token);
  const recentQ = useStoreReceipts(token, { limit: 8 });
  const receiveM = useReceiveStock(token);

  const [f, setF] = useState<Form>(emptyForm);
  const [tried, setTried] = useState(false);
  const [dup, setDup] = useState<string | null>(null);
  const [confirmDup, setConfirmDup] = useState(false);
  const [last, setLast] = useState<StoreReceipt | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const keyRef = useRef<{ key: string; sig: string } | null>(null);

  const items = useMemo(() => (itemsQ.data ?? []).filter((i) => i.status === 'active'), [itemsQ.data]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const prices = useMemo(() => pricesQ.data ?? [], [pricesQ.data]);
  const suppliers = useMemo(() => suppliersQ.data ?? [], [suppliersQ.data]);

  const date = f.date ?? today;

  // ── calc (the design's calc(), against live data) ─────────────────────────
  const seen = new Set<string>();
  const lines = f.lines.map((l) => {
    const it: StoreItem | null = l.itemId ? itemById.get(l.itemId) ?? null : null;
    const ps = it ? activePricesOn(prices, it.id, date || today) : [];
    const P = ps.find((p) => p.id === l.priceId) ?? null;
    const pkgs = Number(l.pkgs);
    const ok = l.pkgs !== '' && Number.isInteger(pkgs) && pkgs >= 1;
    const ovr = canOverride && l.override !== '' ? Number(l.override) : null;
    const ppp = ovr != null && ovr > 0 ? ovr : P ? P.price : 0;
    const received = P && ok ? pkgs * P.packageQty : 0;
    const amount = P && ok ? pkgs * ppp : 0;
    const e: LineErr = {};
    if (!it) e.item = 'Select an item.';
    else if (!ps.length) e.item = 'No active price. Ask Finance to set one in Price Control.';
    if (it && ps.length && !P) e.price = 'Select the package delivered.';
    if (!ok) e.pkgs = 'Whole number, 1 or more.';
    if (ovr != null && !(ovr > 0)) e.override = 'Enter a price above 0.';
    if (ovr != null && !l.reason.trim()) e.reason = 'Give a reason for the override.';
    if (l.reason.trim() && ovr == null && canOverride) e.override = 'Enter the override price, or clear the reason.';
    if (l.expiry && l.expiry <= (date || today)) e.expiry = 'Must be after the receiving date.';
    let dupLine = false;
    if (P) { const k = `${l.itemId}|${l.priceId}`; if (seen.has(k)) dupLine = true; seen.add(k); }
    return { l, it, ps, P, pkgs, ok, ovr, ppp, received, amount, e, dupLine };
  });

  const head: { date?: string; vendor?: string } = {};
  if (!f.vendor) head.vendor = 'Select the supplier.';
  else if (f.vendor === OTHER && !f.otherName.trim()) head.vendor = 'Type the supplier name.';
  if (!date) head.date = 'Select the date.';
  else if (today && date > today) head.date = "Can't be in the future.";
  else if (store?.openingDate && date < store.openingDate) head.date = 'Before the store went live.';
  const anyLine = lines.some((x) => Object.keys(x.e).length > 0);
  const dupLine = lines.some((x) => x.dupLine);
  const total = lines.reduce((a, x) => a + x.amount, 0);
  const lineCount = lines.filter((x) => x.P).length;
  const pkgCount = lines.reduce((a, x) => a + (x.ok ? x.pkgs : 0), 0);
  const lineErr = tried && (anyLine || dupLine)
    ? (dupLine ? 'The same item and package appears twice. Combine them into one line.' : 'Fix the highlighted items before saving.')
    : '';

  // ── edits ─────────────────────────────────────────────────────────────────
  const setLine = (key: string, patch: Partial<Line>) =>
    setF((x) => ({ ...x, lines: x.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const pickItem = (key: string, itemId: string) => {
    const ps = itemId ? activePricesOn(prices, itemId, date || today) : [];
    setLine(key, { itemId, priceId: ps.length === 1 ? ps[0].id : '' });
  };
  const clear = () => {
    setF(emptyForm());
    setTried(false);
    setDup(null);
    setConfirmDup(false);
    keyRef.current = null;
  };

  const save = () => {
    if (receiveM.isPending) return;
    if (Object.keys(head).length || anyLine || dupLine || (dup && !confirmDup)) { setTried(true); return; }
    const known = suppliers.find((s) => s.id === f.vendor);
    const input: StoreReceiptInput = {
      receiptDate: date,
      supplierId: f.vendor !== OTHER ? f.vendor : null,
      supplierName: f.vendor === OTHER ? f.otherName.trim() : known?.name ?? null,
      invoiceNo: f.invoiceNo.trim() || null,
      remarks: f.remarks.trim() || null,
      ...(dup && confirmDup ? { confirmDuplicate: true } : {}),
      lines: lines.map((x) => ({
        itemId: x.l.itemId,
        priceId: x.l.priceId,
        packages: x.pkgs,
        overridePrice: x.ovr != null ? x.ovr : null,
        overrideReason: x.ovr != null ? x.l.reason.trim() : null,
        batchNo: x.l.batch.trim() || null,
        expiryDate: x.l.expiry || null,
      })),
    };
    const parsed = StoreReceiptInputSchema.safeParse(input);
    if (!parsed.success) { setTried(true); toast.error(parsed.error.issues[0]?.message ?? 'Check the receipt and try again.'); return; }
    // One key per submission; a retry of the identical submission reuses it.
    const sig = JSON.stringify(parsed.data);
    if (!keyRef.current || keyRef.current.sig !== sig) keyRef.current = { key: newSubmissionKey(), sig };
    receiveM.mutate({ input: parsed.data, key: keyRef.current.key }, {
      onSuccess: (r) => {
        toast.success(`${r.receiptNo} saved · ${rs(r.totalAmount)}`);
        setLast(r);
        clear();
      },
      onError: (err) => {
        const d = duplicateOf(err);
        if (d !== null) {
          setDup(d || 'an earlier receipt');
          setConfirmDup(false);
          setTried(true);
          toast.warning(errorMessage(err));
        } else {
          toast.error(errorMessage(err));
        }
      },
    });
  };

  const columns = useMemo(() => [
    col.accessor('receiptNo', { header: 'Receiving ID', meta: { mobile: 'subtitle' }, cell: (c) => <span className="whitespace-nowrap font-mono text-xs">{c.getValue()}</span> }),
    col.accessor('receiptDate', { header: 'Date', meta: { mobile: 'figure' }, cell: (c) => <span className="whitespace-nowrap tabular-nums">{fd(c.getValue())}</span> }),
    col.accessor('supplierName', { header: 'Supplier', meta: { mobile: 'title' }, cell: (c) => <span className="font-semibold">{c.getValue()}</span> }),
    col.accessor((r) => r.lines.map((l) => l.itemName ?? l.itemNo ?? '').join(', '), {
      id: 'items',
      header: 'Items',
      meta: { mobileFull: true },
      cell: (c) => <span className="text-muted-foreground">{c.getValue()}</span>,
    }),
    col.accessor('totalAmount', { header: 'Amount', meta: { align: 'center', mobile: 'figure' }, cell: (c) => <span className="whitespace-nowrap font-bold tabular-nums">{rs(c.getValue())}</span> }),
    col.accessor((r) => r.receivedByName ?? '—', { id: 'by', header: 'Received By', cell: (c) => <span className="whitespace-nowrap text-muted-foreground">{c.getValue()}</span> }),
    col.display({
      id: 'actions',
      header: '',
      cell: (c) => <Button size="sm" variant="ghost" onClick={() => setViewing(c.row.original.id)}><Eye className="mr-1 h-3.5 w-3.5" />View</Button>,
    }),
  ], []);

  const formLoading = itemsQ.isLoading || pricesQ.isLoading;
  const formError = itemsQ.isError ? itemsQ : pricesQ.isError ? pricesQ : null;
  const vendorErr = tried ? head.vendor ?? null : null;
  const dateErr = tried ? head.date ?? null : null;
  const roBox = 'flex h-10 min-w-0 items-center truncate rounded-lg bg-muted px-3 text-sm text-muted-foreground md:h-9';

  return (
    <StorePage
      session={session}
      subtitle="Record dry items delivered to the store. Prices come from Price Control and are saved with the receipt."
      needs="receive"
    >
      {last && (
        <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-3 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
          <span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0" /><span><b className="font-mono">{last.receiptNo}</b> saved. Store stock has been updated.</span></span>
          <div className="flex gap-3 font-semibold">
            <button type="button" className="underline-offset-2 hover:underline" onClick={() => setViewing(last.id)}>View receipt</button>
            <Link className="underline-offset-2 hover:underline" href={ROUTES.STORE_STOCK}>Open stock</Link>
          </div>
        </div>
      )}

      {formError ? (
        <ErrorBlock error={formError.error} onRetry={() => void formError.refetch()} />
      ) : formLoading ? (
        <div className="grid gap-3 rounded-2xl border border-border bg-card p-4">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-48 w-full" />
          <Skeleton className="h-10 w-1/2" />
        </div>
      ) : (
        <section className="flex min-w-0 flex-col gap-3.5 rounded-2xl border border-border bg-card p-3 sm:p-4">
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,190px),1fr))]">
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-[12.5px] font-semibold">Receiving ID</span>
              <div className={cn(roBox, 'font-mono text-[13px]')}>Assigned on save</div>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-[12.5px] font-semibold">Store ID</span>
              <div className={cn(roBox, 'font-mono text-[13px]')}>{store?.storeCode ?? '—'}</div>
            </div>
            <Field label="Receiving Date" required error={dateErr}>
              <input type="date" className={cn(inputCls(!!dateErr), 'tabular-nums')} value={date} max={today || undefined} min={store?.openingDate ?? undefined}
                onChange={(e) => { setF((x) => ({ ...x, date: e.target.value })); setDup(null); setConfirmDup(false); }} />
            </Field>
            <Field label="Supplier / Vendor" required error={vendorErr}
              hint={suppliersQ.isError ? 'Could not load the supplier list. Choose Other and type the name.' : undefined}>
              <select className={inputCls(!!vendorErr && f.vendor !== OTHER)} value={f.vendor}
                onChange={(e) => { const v = e.target.value; setF((x) => ({ ...x, vendor: v })); setDup(null); setConfirmDup(false); }}>
                <option value="">{suppliersQ.isLoading ? 'Loading suppliers…' : 'Select supplier'}</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                <option value={OTHER}>Other (type name)</option>
              </select>
              {f.vendor === OTHER && (
                <input className={cn(inputCls(!!vendorErr), 'mt-1.5')} value={f.otherName} maxLength={120} placeholder="Supplier name" autoFocus
                  onChange={(e) => { const v = e.target.value; setF((x) => ({ ...x, otherName: v })); setDup(null); setConfirmDup(false); }} />
              )}
            </Field>
            <Field label="Invoice Number" optional>
              <input className={inputCls()} value={f.invoiceNo} maxLength={60} onChange={(e) => { const v = e.target.value; setF((x) => ({ ...x, invoiceNo: v })); }} />
            </Field>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="text-[12.5px] font-semibold">Received By</span>
              <div className={roBox}>{userName || '—'}</div>
            </div>
          </div>

          <div className="flex flex-col gap-2.5">
            {lines.map((x, i) => {
              const { l, it, ps, P } = x;
              const u = it?.baseUnit ?? '';
              const bad = tried && (Object.keys(x.e).length > 0 || x.dupLine);
              const err = (k: keyof LineErr) => (tried ? x.e[k] ?? null : null);
              const noPrice = !!it && !ps.length;
              const overridden = x.ovr != null && x.ovr > 0;
              return (
                <div key={l.key} className={cn('flex min-w-0 flex-col gap-2.5 rounded-xl border p-3',
                  bad ? 'border-red-300 bg-red-50/40 dark:border-red-500/40 dark:bg-red-500/5' : 'border-border bg-card')}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Item {i + 1}</span>
                    {f.lines.length > 1 && (
                      <Button size="sm" variant="ghost" className="h-7 text-red-700"
                        onClick={() => setF((s) => ({ ...s, lines: s.lines.filter((y) => y.key !== l.key) }))}>
                        <Trash2 className="mr-1 h-3.5 w-3.5" />Remove
                      </Button>
                    )}
                  </div>
                  <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,170px),1fr))]">
                    <label className="flex min-w-0 flex-col gap-1 min-[1100px]:col-span-2">
                      <span className="text-[12.5px] font-semibold">Item Name <span className="text-red-600">*</span></span>
                      <select className={inputCls(!!err('item'))} value={l.itemId} onChange={(e) => pickItem(l.key, e.target.value)}>
                        <option value="">Select item</option>
                        {items.map((o) => <option key={o.id} value={o.id}>{o.name} · {o.itemCode}</option>)}
                      </select>
                      <span className={cn('text-xs',
                        err('item') ? 'font-semibold text-red-700 dark:text-red-400' : noPrice ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
                        {err('item') ?? (it ? (noPrice ? 'No active price. Ask Finance to set one in Price Control.' : `Code ${it.itemCode} · ${qty(it.availableQty, u)} in store`) : 'Active items only')}
                      </span>
                    </label>
                    <Field label="Purchase Package" required error={err('price')}>
                      <select className={inputCls(!!err('price'))} value={l.priceId} disabled={!it || noPrice}
                        onChange={(e) => setLine(l.key, { priceId: e.target.value })}>
                        <option value="">{it ? (ps.length ? 'Select package' : 'No active price') : 'Select item first'}</option>
                        {ps.map((p) => <option key={p.id} value={p.id}>{p.packageName} of {num(p.packageQty)} {u}</option>)}
                      </select>
                    </Field>
                    <Field label="Number of Packages" required error={err('pkgs')}>
                      <input inputMode="numeric" placeholder="0" className={cn(inputCls(!!err('pkgs')), 'text-[15px] font-semibold tabular-nums')} value={l.pkgs}
                        onChange={(e) => setLine(l.key, { pkgs: e.target.value.replace(/[^\d]/g, '') })} />
                    </Field>
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="text-[12.5px] font-semibold">Total Received</span>
                      <div className={cn(roBox, 'text-[15px] font-bold tabular-nums text-foreground')}>{x.received ? qty(x.received, u) : '—'}</div>
                      <span className="text-xs text-muted-foreground">{P && x.ok ? `${x.pkgs} × ${num(P.packageQty)} ${u}` : 'Packages × package quantity'}</span>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="text-[12.5px] font-semibold">Price per Package</span>
                      <div className={cn(roBox, 'tabular-nums text-foreground', overridden && 'line-through decoration-red-600/70')}>{P ? rs(P.price) : '—'}</div>
                      <span className={cn('text-xs', overridden ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>
                        {P ? (overridden ? `Overridden to ${rs(x.ovr)}` : `${P.priceNo} · from ${fd(P.effectiveFrom)}`) : 'From Price Control'}
                      </span>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="text-[12.5px] font-semibold">Total Purchase Amount</span>
                      <div className={cn(roBox, 'text-[15px] font-extrabold tabular-nums text-foreground')}>{x.amount ? rs(x.amount) : '—'}</div>
                    </div>
                    <Field label="Batch Number" optional>
                      <input className={inputCls()} value={l.batch} maxLength={60} onChange={(e) => setLine(l.key, { batch: e.target.value })} />
                    </Field>
                    <Field label="Expiry Date" optional error={err('expiry')}>
                      <input type="date" className={cn(inputCls(!!err('expiry')), 'tabular-nums')} value={l.expiry} min={date ? addDays(date, 1) : undefined}
                        onChange={(e) => setLine(l.key, { expiry: e.target.value })} />
                    </Field>
                  </div>
                  {canOverride && (
                    <div className="grid gap-2.5 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-2.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr))] dark:border-amber-500/40 dark:bg-amber-500/10">
                      <label className="flex min-w-0 flex-col gap-1">
                        <span className="text-[12.5px] font-semibold text-amber-800 dark:text-amber-300">Override price per package (Admin)</span>
                        <input inputMode="decimal" className={cn(inputCls(!!err('override')), 'tabular-nums')} value={l.override} placeholder="Leave empty to use Price Control"
                          onChange={(e) => setLine(l.key, { override: e.target.value.replace(/[^\d.]/g, '') })} />
                        {err('override') && <span className="text-xs font-semibold text-red-700 dark:text-red-400">{err('override')}</span>}
                      </label>
                      <label className="flex min-w-0 flex-col gap-1">
                        <span className="text-[12.5px] font-semibold text-amber-800 dark:text-amber-300">Reason for override</span>
                        <input className={inputCls(!!err('reason'))} value={l.reason} maxLength={200} placeholder="e.g. Supplier discount on invoice"
                          onChange={(e) => setLine(l.key, { reason: e.target.value })} />
                        {err('reason') && <span className="text-xs font-semibold text-red-700 dark:text-red-400">{err('reason')}</span>}
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
            <button type="button" onClick={() => setF((s) => ({ ...s, lines: [...s.lines, newLine()] }))}
              className="flex h-10 items-center gap-1.5 self-start rounded-lg border border-dashed border-primary/50 bg-card px-3.5 text-[13.5px] font-semibold text-primary hover:bg-primary/5">
              <Plus className="h-4 w-4" />Add another item
            </button>
          </div>

          <Field label="Remarks" optional>
            <Textarea rows={2} maxLength={500} value={f.remarks} placeholder="Delivery note, vehicle, condition of goods…"
              onChange={(e) => { const v = e.target.value; setF((x) => ({ ...x, remarks: v })); }} />
          </Field>

          {dup !== null && (
            <div className={cn('flex flex-col gap-2 rounded-xl border px-3 py-3 text-[13.5px] text-amber-900 dark:text-amber-200',
              tried && !confirmDup ? 'border-amber-400 bg-amber-100 dark:border-amber-500/50 dark:bg-amber-500/15' : 'border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10')}>
              <span><b>This looks like {dup}</b>, already saved for the same supplier, date and items.</span>
              <label className="flex items-center gap-2 font-medium">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={confirmDup} onChange={(e) => setConfirmDup(e.target.checked)} />
                This is a separate delivery. Save it anyway.
              </label>
            </div>
          )}
          {lineErr && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] font-semibold text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{lineErr}</div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13.5px] text-muted-foreground">
              <span>Items <b className="tabular-nums text-foreground">{lineCount}</b></span>
              <span>Packages <b className="tabular-nums text-foreground">{pkgCount}</b></span>
              <span>Total <b className="text-[17px] tabular-nums text-foreground">{rs(total)}</b></span>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="lg" onClick={clear} disabled={receiveM.isPending}>Clear</Button>
              <Button size="lg" className="font-bold" onClick={save} disabled={receiveM.isPending}>{receiveM.isPending ? 'Saving…' : 'Save Receiving'}</Button>
            </div>
          </div>
        </section>
      )}

      <section className="flex min-w-0 flex-col gap-2.5">
        <span className="text-base font-bold">Recent receipts</span>
        {recentQ.isError ? (
          <ErrorBlock error={recentQ.error} onRetry={() => void recentQ.refetch()} />
        ) : (
          <DataTable
            columns={columns}
            data={recentQ.data?.rows ?? []}
            loading={recentQ.isLoading}
            sortable
            toolbar={false}
            pager={false}
            pageSize={8}
            empty={<EmptyState icon={PackageOpen} title="No receipts yet" description="Saved receipts show here." />}
          />
        )}
      </section>

      {viewing && <ReceiptDialog token={token} id={viewing} storeCode={store?.storeCode ?? ''} onClose={() => setViewing(null)} />}
    </StorePage>
  );
}

function ReceiptDialog({ token, id, storeCode, onClose }: { token: string; id: string; storeCode: string; onClose: () => void }) {
  const q = useStoreReceipt(token, id);
  const r = q.data;
  const sub = r
    ? [fd(r.receiptDate), r.supplierName, r.invoiceNo ? `Invoice ${r.invoiceNo}` : null, r.receivedByName, storeCode || null].filter(Boolean).join(' · ')
    : '';
  const th = 'px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="md:max-w-[760px]">
        <DialogHeader>
          <DialogTitle className="font-mono">{r?.receiptNo ?? 'Receipt'}</DialogTitle>
          <DialogDescription>{sub}</DialogDescription>
        </DialogHeader>
        {q.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : q.isError || !r ? (
          <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <div className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[640px] border-collapse text-[13px]">
                <thead>
                  <tr>
                    <th className={cn(th, 'text-left')}>Item</th>
                    <th className={cn(th, 'text-left')}>Package</th>
                    <th className={cn(th, 'text-center')}>Packages</th>
                    <th className={cn(th, 'text-center')}>Quantity</th>
                    <th className={cn(th, 'text-center')}>Price / pkg</th>
                    <th className={cn(th, 'text-center')}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {r.lines.map((l) => {
                    const u = l.baseUnit ?? '';
                    const meta = [l.itemNo, l.batchNo, l.supplierBatchNo ? `batch ${l.supplierBatchNo}` : null, l.expiryDate ? `exp ${fd(l.expiryDate)}` : null].filter(Boolean).join(' · ');
                    return (
                      <tr key={l.id} className="border-t border-border">
                        <td className="px-2.5 py-2 align-top"><b className="font-semibold">{l.itemName}</b><div className="text-[11.5px] text-muted-foreground">{meta}</div></td>
                        <td className="whitespace-nowrap px-2.5 py-2 align-top">{l.packageName ? `${l.packageName} of ${num(l.packageQty)} ${u}` : '—'}</td>
                        <td className="px-2.5 py-2 text-center align-top tabular-nums">{l.packages ?? '—'}</td>
                        <td className="whitespace-nowrap px-2.5 py-2 text-center align-top tabular-nums">{qty(l.receivedQty, u)}</td>
                        <td className="whitespace-nowrap px-2.5 py-2 text-center align-top tabular-nums">
                          {rs(l.pricePerPackage)}
                          {l.overrideReason ? <div className="text-[11px] text-amber-800 dark:text-amber-300">List {rs(l.listPrice)} · {l.overrideReason}</div> : null}
                        </td>
                        <td className="whitespace-nowrap px-2.5 py-2 text-center align-top font-bold tabular-nums">{rs(l.amount)}</td>
                      </tr>
                    );
                  })}
                  <tr className="border-t-2 border-border bg-muted/60">
                    <td colSpan={5} className="px-2.5 py-2 font-bold">Total</td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-center font-extrabold tabular-nums">{rs(r.totalAmount)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            {r.remarks ? <span className="text-[13px] text-muted-foreground">Remarks: {r.remarks}</span> : null}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
