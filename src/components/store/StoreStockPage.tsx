'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper } from '@tanstack/react-table';
import { toast } from 'sonner';
import { BookOpen, Download, Package, SlidersHorizontal } from 'lucide-react';
import type { StoreAdjustInput, StoreAdjustment, StoreItem, StoreStockRow } from '@mb/shared';
import { STORE_OPENING_REASON, STORE_RETURN_REASON, StoreAdjustInputSchema } from '@mb/shared';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  downloadStoreReport, newSubmissionKey, useAdjustStock, useStoreAdjustments, useStoreItems, useStoreLookups, useStoreStock,
} from '@/lib/store';
import { cn } from '@/lib/utils';
import { ROUTES } from '@/utils/routes';
import {
  Card, CardHead, DateRange, ErrorBlock, Field, FilterSelect, Pill, StorePage,
  errorMessage, fd, inputCls, num, plural, presetRange, qty, rs, stockTone, useStoreSession, type RangePreset,
} from './parts';

/**
 * Store Stock Management (design: "Store Stock Management"). Per-item stock
 * over a date range — Available = Opening + Received + Returned − Issued ±
 * Adjustments — with what approved demand has already committed. Balances come
 * from stock transactions; the only way to change one here is an adjustment.
 */

const col = createColumnHelper<StoreStockRow>();
const adjCol = createColumnHelper<StoreAdjustment>();

const isLow = (r: Pick<StoreStockRow, 'status' | 'availableQty' | 'minStock'>) => r.status === 'active' && r.availableQty <= r.minStock;
const signed = (v: number) => (v ? `${v > 0 ? '+' : '−'}${num(Math.abs(v))}` : '—');
const figure = (v: number) => <span className="tabular-nums">{num(v)}</span>;

export function StoreStockPage() {
  const session = useStoreSession();
  const { token, can, today } = session;
  const canAdjust = can('adjust');

  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [range, setRange] = useState<{ from: string; to: string; preset: RangePreset } | null>(null);
  const r = range ?? { ...(presetRange('month', today) ?? { from: '', to: '' }), preset: 'month' as RangePreset };
  const [adjusting, setAdjusting] = useState<{ itemId: string } | null>(null);
  const [exporting, setExporting] = useState(false);

  const stockQ = useStoreStock(token, r.from, r.to);
  const lookupsQ = useStoreLookups(token);
  // Held until the business date is known, so the first call is already the range shown.
  const adjQ = useStoreAdjustments(r.from ? token : '', { from: r.from, to: r.to, limit: 20 });
  const categories = (lookupsQ.data ?? []).filter((l) => l.kind === 'category' && l.isActive).map((l) => l.value);

  const all = useMemo(() => stockQ.data?.rows ?? [], [stockQ.data]);
  const lowCount = all.filter(isLow).length;
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all.filter((x) =>
      (!term || `${x.name} ${x.itemNo} ${x.itemCode}`.toLowerCase().includes(term)) &&
      (!cat || x.category === cat) && (!lowOnly || isLow(x)));
  }, [all, q, cat, lowOnly]);
  const value = rows.reduce((a, x) => a + Number(x.stockValue || 0), 0);

  const columns = useMemo(() => [
    col.accessor('itemNo', { header: 'Item ID', meta: { mobile: 'subtitle' }, cell: (c) => <span className="whitespace-nowrap font-mono text-xs">{c.getValue()}</span> }),
    col.accessor('name', {
      header: 'Item Name',
      meta: { mobile: 'title' },
      cell: (c) => <span className={cn('font-semibold', c.row.original.status !== 'active' && 'opacity-60')}>{c.getValue()}</span>,
    }),
    col.accessor('category', { header: 'Category', meta: { mobile: 'hidden' } }),
    col.accessor('opening', { header: 'Opening', meta: { align: 'center', mobile: 'figure' }, cell: (c) => figure(c.getValue()) }),
    col.accessor('received', {
      header: 'Received',
      meta: { align: 'center', mobile: 'figure' },
      cell: (c) => <span className="tabular-nums text-emerald-700 dark:text-emerald-400">{num(c.getValue())}</span>,
    }),
    col.accessor('issued', { header: 'Issued', meta: { align: 'center', mobile: 'figure' }, cell: (c) => figure(c.getValue()) }),
    col.accessor('returned', { header: 'Returned', meta: { align: 'center', mobile: 'figure' }, cell: (c) => <span className="tabular-nums">{c.getValue() ? num(c.getValue()) : '—'}</span> }),
    col.accessor('adjusted', { header: 'Adjusted', meta: { align: 'center', mobile: 'figure' }, cell: (c) => <span className="tabular-nums">{signed(c.getValue())}</span> }),
    col.accessor('closing', {
      header: 'Available',
      meta: { align: 'center', mobile: 'figure' },
      cell: (c) => <span className={cn('font-extrabold tabular-nums', isLow(c.row.original) && 'text-red-700 dark:text-red-400')}>{num(c.getValue())}</span>,
    }),
    col.accessor('committed', {
      header: 'Committed',
      meta: { align: 'center', mobile: 'figure' },
      cell: (c) => <span className="tabular-nums text-blue-800 dark:text-blue-300">{c.getValue() ? num(c.getValue()) : '—'}</span>,
    }),
    col.accessor((x) => x.availableQty - x.committed, {
      id: 'free',
      header: 'Free now',
      meta: { align: 'center', mobile: 'figure' },
      cell: (c) => <span className="font-semibold tabular-nums">{num(c.getValue())}</span>,
    }),
    col.accessor('baseUnit', { header: 'Unit' }),
    col.accessor('activeBatches', { header: 'Batches', meta: { align: 'center' }, cell: (c) => <span className="tabular-nums">{c.getValue()}</span> }),
    col.accessor('lastReceived', { header: 'Last Received', cell: (c) => <span className="whitespace-nowrap">{fd(c.getValue())}</span> }),
    col.accessor((x) => stockTone(x.status, x.availableQty, x.minStock).label, {
      id: 'status',
      header: 'Status',
      meta: { mobile: 'badge' },
      cell: (c) => {
        const t = stockTone(c.row.original.status, c.row.original.availableQty, c.row.original.minStock);
        return <Pill tone={t.tone}>{t.label}</Pill>;
      },
    }),
    col.display({
      id: 'actions',
      header: '',
      cell: (c) => (
        <div className="flex flex-nowrap gap-1.5">
          <Link
            href={`${ROUTES.STORE_LEDGER}?item=${c.row.original.id}`}
            className="inline-flex h-8 items-center rounded-lg border border-border px-2.5 text-[12.5px] font-semibold text-foreground hover:border-primary/50"
          >
            Ledger
          </Link>
          {canAdjust && (
            <Button size="sm" variant="outline" onClick={() => setAdjusting({ itemId: c.row.original.id })}>Adjust</Button>
          )}
        </div>
      ),
    }),
  ], [canAdjust]);

  const adjColumns = useMemo(() => [
    adjCol.accessor('businessDate', { header: 'Date', meta: { mobile: 'subtitle' }, cell: (c) => <span className="whitespace-nowrap">{fd(c.getValue())}</span> }),
    adjCol.accessor('adjNo', { header: 'Adjustment', cell: (c) => <span className="whitespace-nowrap font-mono text-xs">{c.getValue()}</span> }),
    adjCol.accessor((a) => a.itemName ?? '', {
      id: 'item',
      header: 'Item',
      meta: { mobile: 'title' },
      cell: (c) => (
        <Link href={`${ROUTES.STORE_LEDGER}?item=${c.row.original.itemId}`} className="font-semibold text-foreground hover:text-primary hover:underline">
          {c.getValue() || c.row.original.itemNo || 'Item'}
        </Link>
      ),
    }),
    adjCol.accessor((a) => (a.direction === 'out' ? -a.qty : a.qty), {
      id: 'qty',
      header: 'Quantity',
      meta: { align: 'center', mobile: 'figure' },
      cell: (c) => {
        const v = c.getValue();
        return (
          <span className={cn('whitespace-nowrap font-semibold tabular-nums', v < 0 ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400')}>
            {signed(v)} {c.row.original.baseUnit ?? ''}
          </span>
        );
      },
    }),
    adjCol.accessor('reason', {
      header: 'Reason',
      meta: { mobileFull: true },
      cell: (c) => (
        <span className="min-w-[160px]">
          {c.getValue()}
          {c.row.original.note ? <span className="text-muted-foreground"> · {c.row.original.note}</span> : null}
        </span>
      ),
    }),
    adjCol.accessor('value', { header: 'Value', meta: { align: 'center', mobile: 'figure' }, cell: (c) => <span className="whitespace-nowrap tabular-nums">{rs(c.getValue())}</span> }),
    adjCol.accessor((a) => a.createdByName ?? '', { id: 'by', header: 'By', cell: (c) => <span className="whitespace-nowrap text-muted-foreground">{c.getValue() || '—'}</span> }),
  ], []);

  const exportX = async () => {
    setExporting(true);
    try {
      await downloadStoreReport(token, 'item_stock', r.from, r.to, null);
    } catch (e) {
      toast.error(errorMessage(e, 'Could not export the stock report.'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <StorePage
      session={session}
      subtitle="Available = Opening + Received − Issued ± Adjustments. Balances come from stock transactions and can't be typed in."
      needs="view"
      actions={
        <>
          {canAdjust && (
            <Button onClick={() => setAdjusting({ itemId: '' })}><SlidersHorizontal className="mr-1.5 h-4 w-4" />Stock Adjustment</Button>
          )}
          <Button variant="outline" onClick={() => void exportX()} disabled={exporting || !r.from}>
            <Download className="mr-1.5 h-4 w-4" />{exporting ? 'Exporting…' : 'Export'}
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item…" aria-label="Search" className={cn(inputCls(), 'sm:max-w-xs')} />
        <FilterSelect label="Category" value={cat} onChange={setCat}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </FilterSelect>
        <DateRange today={today} from={r.from} to={r.to} preset={r.preset} onChange={setRange} />
        <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-[13px]">
          <input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} className="h-4 w-4 accent-primary" />
          Low stock only ({lowCount})
        </label>
      </div>

      {stockQ.isError ? (
        <ErrorBlock error={stockQ.error} onRetry={() => void stockQ.refetch()} />
      ) : (
        <div className="flex flex-col gap-2">
          <DataTable
            columns={columns}
            data={rows}
            loading={stockQ.isLoading}
            sortable
            dense
            toolbar={false}
            pageSize={50}
            empty={
              <EmptyState
                icon={Package}
                title={all.length ? 'No items match these filters.' : 'No dry items yet'}
                description={all.length ? 'Clear a filter to see more.' : 'Add items in Store Items, then receive stock.'}
                className="border-0"
              />
            }
          />
          {!stockQ.isLoading && (
            <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl bg-muted/60 px-4 py-2.5 text-sm">
              <span className="text-[12px] font-bold uppercase tracking-wider text-muted-foreground">{plural(rows.length, 'item')} · stock value at cost</span>
              <span className="font-extrabold tabular-nums">{rs(value)}</span>
            </div>
          )}
          <span className="text-[12.5px] text-muted-foreground">Committed is approved production demand not yet issued. Free is what Store can still approve.</span>
        </div>
      )}

      <Card>
        <CardHead
          title="Recent adjustments"
          right={adjQ.data && adjQ.data.total > adjQ.data.rows.length ? (
            <span className="text-xs text-muted-foreground">Latest {adjQ.data.rows.length} of {adjQ.data.total} · full list in Reports</span>
          ) : null}
        />
        <div className="p-3">
          {adjQ.isError ? (
            <ErrorBlock error={adjQ.error} onRetry={() => void adjQ.refetch()} />
          ) : (
            <DataTable
              columns={adjColumns}
              data={adjQ.data?.rows ?? []}
              loading={adjQ.isLoading}
              sortable
              toolbar={false}
              pager={false}
              pageSize={20}
              empty={<EmptyState icon={BookOpen} title="No adjustments in this date range." className="border-0" />}
            />
          )}
        </div>
      </Card>

      {adjusting && (
        <AdjustDialog
          token={token}
          today={today}
          initialItemId={adjusting.itemId}
          canOpening={can('opening')}
          onClose={() => setAdjusting(null)}
        />
      )}
    </StorePage>
  );
}

// ── Stock Adjustment dialog ──────────────────────────────────────────────────

const SPECIAL_IN = new Set([STORE_RETURN_REASON, STORE_OPENING_REASON]);

function AdjustDialog({ token, today, initialItemId, canOpening, onClose }: {
  token: string;
  today: string;
  initialItemId: string;
  canOpening: boolean;
  onClose: () => void;
}) {
  const itemsQ = useStoreItems(token, true);
  const lookupsQ = useStoreLookups(token);
  const adjustM = useAdjustStock(token);
  /** One key per submission; kept while the SAME submission is retried. */
  const last = useRef<{ body: string; key: string } | null>(null);

  const reasons = useMemo(() => {
    const base = (lookupsQ.data ?? []).filter((l) => l.kind === 'adjust_reason' && l.isActive).map((l) => l.value).filter((v) => !SPECIAL_IN.has(v));
    return [...base, STORE_RETURN_REASON, ...(canOpening ? [STORE_OPENING_REASON] : [])];
  }, [lookupsQ.data, canOpening]);

  const [itemId, setItemId] = useState(initialItemId);
  const [dir, setDir] = useState<'in' | 'out'>('out');
  const [qtyS, setQtyS] = useState('');
  const [reasonPick, setReason] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);

  const reason = reasonPick || reasons[0] || '';
  const forcedIn = SPECIAL_IN.has(reason);
  const direction: 'in' | 'out' = forcedIn ? 'in' : dir;
  const items: StoreItem[] = itemsQ.data ?? [];
  const it = items.find((i) => i.id === itemId) ?? null;
  const unit = it?.baseUnit ?? 'base unit';
  const avail = it?.availableQty ?? 0;
  const committed = it?.committedQty ?? 0;
  const n = Number(qtyS) > 0 ? Number(qtyS) : 0;
  const after = avail + (direction === 'out' ? -n : n);

  const input: StoreAdjustInput = { itemId, direction, qty: qtyS === '' ? NaN : Number(qtyS), reason, note: note.trim() || null };
  const parsed = StoreAdjustInputSchema.safeParse(input);
  const errs: Record<string, string> = {};
  if (!itemId) errs.itemId = 'Select an item.';
  if (!parsed.success) for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
  if (!errs.qty && it && direction === 'out' && n > avail) errs.qty = `Only ${qty(avail, unit)} in store. Stock can't go below zero.`;
  if (reason === 'Other' && !note.trim()) errs.note = 'Describe the reason.';
  const e = (k: string) => (tried ? errs[k] ?? null : null);
  // Over-removal is shown at once, not only after Save: it is the one mistake the hint can't hide.
  const qtyErr = e('qty') ?? (it && direction === 'out' && n > avail ? errs.qty : null);
  const warn = !!(it && n && direction === 'out' && after >= 0 && after < committed);

  const save = () => {
    if (Object.keys(errs).length || !parsed.success) { setTried(true); return; }
    const body = JSON.stringify(parsed.data);
    if (!last.current || last.current.body !== body) last.current = { body, key: newSubmissionKey() };
    adjustM.mutate({ input: parsed.data, key: last.current.key }, {
      onSuccess: (adj) => {
        last.current = null;
        const sign = adj.direction === 'out' ? '−' : '+';
        toast.success(`${adj.adjNo} saved. ${adj.itemName ?? it?.name ?? 'Item'} ${sign}${qty(adj.qty, adj.baseUnit ?? unit)}.`);
        onClose();
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !adjustM.isPending && onClose()}>
      <DialogContent className="md:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Stock Adjustment</DialogTitle>
          <DialogDescription>Dated {fd(today)} · adjustment ID assigned on save</DialogDescription>
        </DialogHeader>
        {itemsQ.isError ? (
          <ErrorBlock error={itemsQ.error} onRetry={() => void itemsQ.refetch()} />
        ) : (
          <div className="flex flex-col gap-3">
            <Field
              label="Item"
              required
              error={e('itemId')}
              hint={it ? `${qty(avail, unit)} in store · ${qty(committed, unit)} committed` : itemsQ.isLoading ? 'Loading items…' : undefined}
            >
              <select className={inputCls(!!e('itemId'))} value={itemId} onChange={(x) => setItemId(x.target.value)}>
                <option value="">Select item</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>{i.name} · {i.itemNo}{i.status === 'active' ? '' : ' (inactive)'}</option>
                ))}
              </select>
            </Field>

            <div role="radiogroup" aria-label="Direction" className="grid grid-cols-2 gap-0.5 rounded-lg bg-muted p-0.5">
              {([['out', '− Remove stock'], ['in', '+ Add stock']] as const).map(([k, label]) => {
                const on = direction === k;
                const off = k === 'out' && forcedIn;
                return (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={off}
                    title={off ? `${reason} always adds stock` : undefined}
                    onClick={() => setDir(k)}
                    className={cn(
                      'h-9 rounded-md text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                      on ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label={`Quantity (${unit})`}
                required
                error={qtyErr}
                hint={it && n ? `New balance ${qty(after, unit)}` : 'In the item base unit'}
              >
                <input
                  inputMode="decimal"
                  className={inputCls(!!qtyErr)}
                  value={qtyS}
                  onChange={(x) => setQtyS(x.target.value.replace(/[^\d.]/g, ''))}
                  placeholder="0"
                />
              </Field>
              <Field label="Reason" required error={e('reason')} hint={forcedIn ? 'Adds stock back into the store.' : undefined}>
                <select className={inputCls(!!e('reason'))} value={reason} onChange={(x) => setReason(x.target.value)}>
                  {reasons.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </Field>
            </div>

            <Field label="Note" required={reason === 'Other'} optional={reason !== 'Other'} error={e('note')}>
              <input className={inputCls(!!e('note'))} value={note} onChange={(x) => setNote(x.target.value)} placeholder="What happened" maxLength={300} />
            </Field>

            {warn && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                This leaves {qty(after, unit)}, less than the {qty(committed, unit)} already approved for Production. Store will need to undo an approval.
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={adjustM.isPending}>Cancel</Button>
          <Button onClick={save} disabled={adjustM.isPending || itemsQ.isLoading}>{adjustM.isPending ? 'Saving…' : 'Save Adjustment'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
