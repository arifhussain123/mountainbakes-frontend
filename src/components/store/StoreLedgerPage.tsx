'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper } from '@tanstack/react-table';
import { Boxes, Package } from 'lucide-react';
import type { StoreBatch, StoreMovementType, StorePriceState } from '@mb/shared';
import { STORE_MOVEMENT_LABELS } from '@mb/shared';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import { useStoreItemHistory, useStoreItemLedger, useStoreItems } from '@/lib/store';
import { cn } from '@/lib/utils';
import { ROUTES } from '@/utils/routes';
import { canOpenStorePage } from '@/utils/storeAccess';
import {
  Card, DateRange, ErrorBlock, FilterSelect, LINE_LABEL, LINE_TONE, Pill, StorePage,
  addDays, fd, fdt, num, presetRange, qty, rate, rs, stockTone, useStoreSession, type RangePreset, type Tone,
} from './parts';

/**
 * Stock Ledger (design: "Store Stock Ledger"). One item: every movement with a
 * running balance, the batches FIFO will issue from, and the item's change,
 * price and demand history. The item travels in the address bar (`?item=`),
 * read from window.location — the app is a static export, so there is no
 * server-side query string.
 */

type Tab = 'moves' | 'batches' | 'history';

const MOVE_TONE: Record<StoreMovementType, Tone> = {
  receipt: 'green',
  issue: 'green',
  adjustment: 'amber',
  opening: 'muted',
  return: 'blue',
};

const PRICE_STATE: Record<StorePriceState, { tone: Tone; label: string }> = {
  active: { tone: 'green', label: 'Active' },
  scheduled: { tone: 'blue', label: 'Scheduled' },
  superseded: { tone: 'muted', label: 'Superseded' },
  inactive: { tone: 'muted', label: 'Inactive' },
};

const SOURCE_LABEL: Record<StoreBatch['source'], string> = {
  receipt: 'Received',
  opening: 'Opening stock',
  adjustment: 'Adjustment',
  return: 'Returned',
};

const batchValue = (b: StoreBatch) => Math.round(Number(b.remainingQty) * Number(b.unitCost) * 100) / 100;
const fifoOrder = (a: StoreBatch, b: StoreBatch) =>
  a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : a.batchNo.localeCompare(b.batchNo);

/** `?item=<id>` in the address bar, kept in sync without a navigation. */
function useItemParam(): [string, (id: string) => void] {
  const [itemId, setItemId] = useState('');
  useEffect(() => {
    const read = () => setItemId(new URLSearchParams(window.location.search).get('item') ?? '');
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, []);
  const set = useCallback((id: string) => {
    setItemId(id);
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('item', id);
    else url.searchParams.delete('item');
    window.history.replaceState(window.history.state, '', url);
  }, []);
  return [itemId, set];
}

export function StoreLedgerPage() {
  const session = useStoreSession();
  const { token, today, role } = session;
  const itemsQ = useStoreItems(token, true);
  const items = useMemo(() => itemsQ.data ?? [], [itemsQ.data]);
  const [param, setParam] = useItemParam();
  const it = items.find((i) => i.id === param) ?? items[0] ?? null;

  const [tab, setTab] = useState<Tab>('moves');
  const [type, setType] = useState<'' | StoreMovementType>('');
  const [range, setRange] = useState<{ from: string; to: string; preset: RangePreset } | null>(null);
  const r = range ?? { ...(presetRange('month', today) ?? { from: '', to: '' }), preset: 'month' as RangePreset };

  const ledgerQ = useStoreItemLedger(token, it?.id ?? null, r.from, r.to);
  const historyQ = useStoreItemHistory(token, it?.id ?? null);

  const u = it?.baseUnit ?? '';
  const avail = it?.availableQty ?? 0;
  const committed = it?.committedQty ?? 0;
  const tone = it ? stockTone(it.status, avail, it.minStock) : null;
  const low = !!it && it.status === 'active' && avail <= it.minStock;
  const stockValue = historyQ.data ? historyQ.data.batches.reduce((a, b) => a + batchValue(b), 0) : null;

  const picker = (
    <FilterSelect
      label="Item"
      value={it?.id ?? ''}
      onChange={setParam}
      className="h-10 w-full sm:w-80"
    >
      {!items.length && <option value="">{itemsQ.isLoading ? 'Loading items…' : 'No items'}</option>}
      {items.map((i) => (
        <option key={i.id} value={i.id}>{i.name} · {i.itemNo}{i.status === 'active' ? '' : ' (inactive)'}</option>
      ))}
    </FilterSelect>
  );

  return (
    <StorePage session={session} subtitle="Every movement of one item, with a running balance." needs="view" actions={picker}>
      {itemsQ.isError ? (
        <ErrorBlock error={itemsQ.error} onRetry={() => void itemsQ.refetch()} />
      ) : itemsQ.isLoading ? (
        <div className="grid gap-3">
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      ) : !it ? (
        <EmptyState icon={Package} title="No dry items yet" description="Add items in Store Items, then receive stock. Their movements show here." />
      ) : (
        <>
          {/* ── Item header ─────────────────────────────────────────── */}
          <Card className="flex flex-col gap-3 px-4 py-3.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-lg font-bold">{it.name}</div>
                <div className="text-[13px] text-muted-foreground">
                  {it.itemNo} · {it.itemCode} · {it.category} · 1 {it.purchaseUnit} = {num(it.conversionQty)} {u}
                </div>
              </div>
              {tone && <Pill tone={tone.tone}>{tone.label}</Pill>}
            </div>
            <div className="grid grid-cols-2 gap-2.5 min-[560px]:grid-cols-3 min-[1100px]:grid-cols-6">
              <Stat k="In store" v={qty(avail, u)} className={low ? 'text-red-700 dark:text-red-400' : undefined} />
              <Stat k="Committed" v={qty(committed, u)} className="text-blue-800 dark:text-blue-300" />
              <Stat k="Free" v={qty(avail - committed, u)} />
              <Stat k="Low-stock level" v={qty(it.minStock, u)} />
              <Stat k="Unit price now" v={it.unitPrice != null ? rate(it.unitPrice, u) : 'No price'} />
              <Stat k="Stock value" v={stockValue == null ? (historyQ.isError ? '—' : '…') : rs(stockValue)} />
            </div>
          </Card>

          {/* ── Tabs ────────────────────────────────────────────────── */}
          <div role="tablist" className="flex gap-0.5 overflow-x-auto border-b border-border">
            {([['moves', 'Stock movements'], ['batches', 'Batches (FIFO)'], ['history', 'Item & price history']] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={cn(
                  'h-11 shrink-0 whitespace-nowrap px-4 text-sm transition-colors',
                  tab === k ? 'font-bold text-secondary shadow-[inset_0_-3px_0_var(--primary)] dark:text-foreground' : 'font-medium text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'moves' && (
            <Movements
              ledgerQ={ledgerQ}
              unit={u}
              today={today}
              range={r}
              onRange={setRange}
              type={type}
              onType={setType}
            />
          )}
          {tab === 'batches' && (
            historyQ.isError ? (
              <ErrorBlock error={historyQ.error} onRetry={() => void historyQ.refetch()} />
            ) : (
              <Batches batches={historyQ.data?.batches} loading={historyQ.isLoading} unit={u} today={today} />
            )
          )}
          {tab === 'history' && (
            historyQ.isError ? (
              <ErrorBlock error={historyQ.error} onRetry={() => void historyQ.refetch()} />
            ) : !historyQ.data ? (
              <div className="grid gap-4 lg:grid-cols-2">
                <Skeleton className="h-48 rounded-2xl" />
                <Skeleton className="h-48 rounded-2xl" />
              </div>
            ) : (
              <History h={historyQ.data} unit={u} canOpenApproval={canOpenStorePage(role, ROUTES.STORE_APPROVAL)} />
            )
          )}
        </>
      )}
    </StorePage>
  );
}

function Stat({ k, v, className }: { k: string; v: string; className?: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-muted/50 px-3 py-2.5">
      <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">{k}</div>
      <div className={cn('truncate text-lg font-extrabold tabular-nums', className)} title={v}>{v}</div>
    </div>
  );
}

// ── Stock movements ──────────────────────────────────────────────────────────

function Movements({ ledgerQ, unit, today, range, onRange, type, onType }: {
  ledgerQ: ReturnType<typeof useStoreItemLedger>;
  unit: string;
  today: string;
  range: { from: string; to: string; preset: RangePreset };
  onRange: (r: { from: string; to: string; preset: RangePreset }) => void;
  type: '' | StoreMovementType;
  onType: (t: '' | StoreMovementType) => void;
}) {
  const L = ledgerQ.data;
  const shown = (L?.rows ?? []).filter((x) => !type || x.type === type);
  const th = 'px-3 py-2.5 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap';
  const td = 'px-3 py-2.5';
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <DateRange today={today} from={range.from} to={range.to} preset={range.preset} onChange={onRange} />
        <FilterSelect label="Type" value={type} onChange={(v) => onType(v as '' | StoreMovementType)}>
          <option value="">All movements</option>
          {(['receipt', 'issue', 'adjustment', 'return', 'opening'] as const).map((t) => (
            <option key={t} value={t}>{STORE_MOVEMENT_LABELS[t]}</option>
          ))}
        </FilterSelect>
      </div>

      {ledgerQ.isError ? (
        <ErrorBlock error={ledgerQ.error} onRetry={() => void ledgerQ.refetch()} />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-collapse text-[13.5px]">
            <thead>
              <tr>
                <th className={cn(th, 'text-left')}>Date</th>
                <th className={cn(th, 'text-left')}>Type</th>
                <th className={cn(th, 'text-left')}>Reference</th>
                <th className={cn(th, 'text-left')}>Detail</th>
                <th className={cn(th, 'text-center')}>In</th>
                <th className={cn(th, 'text-center')}>Out</th>
                <th className={cn(th, 'text-center')}>Balance</th>
                <th className={cn(th, 'text-left')}>By</th>
              </tr>
            </thead>
            <tbody>
              {!L ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-t border-border/70">
                    <td colSpan={8} className={td}><Skeleton className="h-4 w-full" /></td>
                  </tr>
                ))
              ) : (
                <>
                  <tr className="bg-muted/50">
                    <td colSpan={6} className={cn(td, 'text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground')}>
                      Opening balance on {fd(range.from)}
                    </td>
                    <td className={cn(td, 'whitespace-nowrap text-center font-bold tabular-nums')}>{qty(L.opening, unit)}</td>
                    <td />
                  </tr>
                  {shown.map((x) => (
                    <tr key={x.id} className="border-t border-border/70">
                      <td className={cn(td, 'whitespace-nowrap')}>{fd(x.businessDate)}</td>
                      <td className={td}><Pill tone={MOVE_TONE[x.type] ?? 'muted'}>{STORE_MOVEMENT_LABELS[x.type] ?? x.type}</Pill></td>
                      <td className={cn(td, 'whitespace-nowrap font-mono text-[12.5px]')}>{x.refNo}</td>
                      <td className={cn(td, 'min-w-[220px] text-foreground/80')}>{x.detail || '—'}</td>
                      <td className={cn(td, 'whitespace-nowrap text-center tabular-nums text-emerald-700 dark:text-emerald-400')}>{x.qtyDelta > 0 ? num(x.qtyDelta) : ''}</td>
                      <td className={cn(td, 'whitespace-nowrap text-center tabular-nums text-red-700 dark:text-red-400')}>{x.qtyDelta < 0 ? num(-x.qtyDelta) : ''}</td>
                      <td className={cn(td, 'whitespace-nowrap text-center font-bold tabular-nums')}>{qty(x.balance, unit)}</td>
                      <td className={cn(td, 'whitespace-nowrap text-[12.5px] text-muted-foreground')}>{x.createdByName ?? '—'}</td>
                    </tr>
                  ))}
                  {!shown.length && (
                    <tr className="border-t border-border/70">
                      <td colSpan={8} className="px-3 py-7 text-center text-muted-foreground">No movements in this range.</td>
                    </tr>
                  )}
                  <tr className="border-t-2 border-border bg-muted/50">
                    <td colSpan={4} className={cn(td, 'text-[11.5px] font-bold uppercase tracking-wider text-muted-foreground')}>
                      Closing balance on {fd(range.to)}
                    </td>
                    <td className={cn(td, 'whitespace-nowrap text-center font-bold tabular-nums text-emerald-700 dark:text-emerald-400')}>{qty(L.totalIn, unit)}</td>
                    <td className={cn(td, 'whitespace-nowrap text-center font-bold tabular-nums text-red-700 dark:text-red-400')}>{qty(L.totalOut, unit)}</td>
                    <td className={cn(td, 'whitespace-nowrap text-center font-extrabold tabular-nums')}>{qty(L.closing, unit)}</td>
                    <td />
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </Card>
      )}
      {type && <span className="text-[12.5px] text-muted-foreground">Filtered to one movement type. Balances still include every movement.</span>}
    </div>
  );
}

// ── Batches (FIFO) ───────────────────────────────────────────────────────────

const bCol = createColumnHelper<StoreBatch & { nextOut: boolean }>();

function Batches({ batches, loading, unit, today }: { batches: StoreBatch[] | undefined; loading: boolean; unit: string; today: string }) {
  const [showUsed, setShowUsed] = useState(false);
  const { rows, usedCount } = useMemo(() => {
    const fifo = [...(batches ?? [])].sort(fifoOrder);
    const next = fifo.find((b) => Number(b.remainingQty) > 0)?.id;
    const used = fifo.filter((b) => Number(b.remainingQty) <= 0).length;
    return {
      rows: fifo.filter((b) => showUsed || Number(b.remainingQty) > 0).map((b) => ({ ...b, nextOut: b.id === next })),
      usedCount: used,
    };
  }, [batches, showUsed]);
  const soon = today ? addDays(today, 30) : '';

  const columns = useMemo(() => [
    bCol.accessor('batchNo', {
      header: 'Batch',
      meta: { mobile: 'title' },
      cell: (c) => (
        <span className={cn('flex items-center gap-1.5 whitespace-nowrap', Number(c.row.original.remainingQty) <= 0 && 'opacity-60')}>
          <span className="font-mono text-[12.5px]">{c.getValue()}</span>
          {c.row.original.nextOut && <Pill tone="blue">Next out</Pill>}
        </span>
      ),
    }),
    bCol.accessor((b) => SOURCE_LABEL[b.source] ?? b.source, { id: 'source', header: 'Source', meta: { mobile: 'subtitle' } }),
    bCol.accessor((b) => b.receiptNo ?? '', { id: 'receipt', header: 'Receipt', cell: (c) => <span className="whitespace-nowrap font-mono text-xs">{c.getValue() || '—'}</span> }),
    bCol.accessor('receivedAt', { header: 'Received date', cell: (c) => <span className="whitespace-nowrap">{fd(c.getValue())}</span> }),
    bCol.accessor((b) => b.supplierBatchNo ?? '', { id: 'supplierBatch', header: 'Supplier batch', cell: (c) => c.getValue() || '—' }),
    bCol.accessor((b) => b.expiryDate ?? '', {
      id: 'expiry',
      header: 'Expiry',
      cell: (c) => {
        const v = c.getValue();
        const open = Number(c.row.original.remainingQty) > 0;
        const cls = !v || !open || !today ? '' : v < today ? 'font-semibold text-red-700 dark:text-red-400' : v <= soon ? 'font-semibold text-amber-700 dark:text-amber-400' : '';
        return <span className={cn('whitespace-nowrap', cls)}>{v ? fd(v) : '—'}</span>;
      },
    }),
    bCol.accessor('receivedQty', {
      header: 'Received qty',
      meta: { align: 'center', mobile: 'figure' },
      cell: (c) => <span className="whitespace-nowrap tabular-nums">{num(c.getValue())}</span>,
      footer: () => <span className="text-[11.5px] font-bold uppercase tracking-wider text-muted-foreground">Total</span>,
    }),
    bCol.accessor('remainingQty', {
      header: 'Remaining',
      meta: { align: 'center', mobile: 'figure' },
      cell: (c) => <span className="whitespace-nowrap font-bold tabular-nums">{qty(c.getValue(), unit)}</span>,
      footer: ({ table }) => (
        <span className="whitespace-nowrap tabular-nums">
          {qty(table.getFilteredRowModel().rows.reduce((a, x) => a + Number(x.original.remainingQty), 0), unit)}
        </span>
      ),
    }),
    bCol.accessor('unitCost', {
      header: 'Unit cost',
      meta: { align: 'center', mobile: 'figure' },
      cell: (c) => <span className="whitespace-nowrap tabular-nums">{rate(c.getValue(), unit)}</span>,
    }),
    bCol.accessor((b) => batchValue(b), {
      id: 'value',
      header: 'Value',
      meta: { align: 'center', mobile: 'figure' },
      cell: (c) => <span className="whitespace-nowrap tabular-nums">{rs(c.getValue())}</span>,
      footer: ({ table }) => (
        <span className="whitespace-nowrap tabular-nums">{rs(table.getFilteredRowModel().rows.reduce((a, x) => a + batchValue(x.original), 0))}</span>
      ),
    }),
  ], [unit, today, soon]);

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12.5px] text-muted-foreground">Oldest stock goes out first. Value is what each batch cost.</span>
        {usedCount > 0 && (
          <label className="flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-border bg-card px-2.5 text-[13px]">
            <input type="checkbox" checked={showUsed} onChange={(e) => setShowUsed(e.target.checked)} className="h-4 w-4 accent-primary" />
            Include used-up batches ({usedCount})
          </label>
        )}
      </div>
      <DataTable
        columns={columns}
        data={rows}
        loading={loading}
        sortable
        toolbar={false}
        pageSize={50}
        empty={<EmptyState icon={Boxes} title="No stock in store" description={usedCount ? 'Every batch of this item has been issued.' : 'This item has never been received.'} className="border-0" />}
      />
    </div>
  );
}

// ── Item & price history ─────────────────────────────────────────────────────

function History({ h, unit, canOpenApproval }: {
  h: NonNullable<ReturnType<typeof useStoreItemHistory>['data']>;
  unit: string;
  canOpenApproval: boolean;
}) {
  const prices = [...h.prices].sort((a, b) => (a.effectiveFrom < b.effectiveFrom ? 1 : a.effectiveFrom > b.effectiveFrom ? -1 : b.createdAt.localeCompare(a.createdAt)));
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card className="flex flex-col gap-2 px-4 py-3.5">
        <span className="text-[15px] font-bold">Item changes</span>
        {h.events.map((ev) => (
          <div key={ev.id} className="border-l-[3px] border-primary/40 bg-muted/40 px-2.5 py-2 text-[13px] leading-snug">
            <b className="capitalize">{ev.action}</b> · {ev.actorName ?? '—'} · {fdt(ev.createdAt)}
            {ev.detail ? <div className="text-muted-foreground">{ev.detail}</div> : null}
          </div>
        ))}
        {!h.events.length && <span className="text-[13px] text-muted-foreground">No changes recorded.</span>}
      </Card>

      <Card className="flex flex-col gap-2 px-4 py-3.5">
        <span className="text-[15px] font-bold">Price history</span>
        {prices.map((p) => {
          const st = PRICE_STATE[p.state] ?? PRICE_STATE.inactive;
          return (
            <div key={p.id} className="flex items-center justify-between gap-2.5 rounded-lg bg-muted/40 px-2.5 py-2 text-[13px]">
              <span className="min-w-0">
                <b className="tabular-nums">{rs(p.price)}</b> · {p.packageName} of {num(p.packageQty)} {p.baseUnit || unit}
                <span className="block text-xs text-muted-foreground">
                  <span className="font-mono">{p.priceNo}</span> · from {fd(p.effectiveFrom)} · {p.createdByName ?? '—'}
                </span>
              </span>
              <Pill tone={st.tone} className="shrink-0">{st.label}</Pill>
            </div>
          );
        })}
        {!prices.length && <span className="text-[13px] text-muted-foreground">No prices set.</span>}
      </Card>

      <Card className="flex flex-col gap-2 px-4 py-3.5 lg:col-span-2">
        <span className="text-[15px] font-bold">Production demand references</span>
        {h.demandLines.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-[13px]">
              <thead>
                <tr className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="px-2.5 py-2 text-left">Demand</th>
                  <th className="px-2.5 py-2 text-left">Date</th>
                  <th className="px-2.5 py-2 text-center">Requested</th>
                  <th className="px-2.5 py-2 text-center">Approved</th>
                  <th className="px-2.5 py-2 text-center">Issued</th>
                  <th className="px-2.5 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody>
                {h.demandLines.map((l) => (
                  <tr key={l.id} className="border-t border-border/70">
                    <td className="whitespace-nowrap px-2.5 py-2 font-mono text-[12.5px]">
                      {canOpenApproval ? <Link href={ROUTES.STORE_APPROVAL} className="hover:text-primary hover:underline">{l.demandNo}</Link> : l.demandNo}
                    </td>
                    <td className="whitespace-nowrap px-2.5 py-2">{fd(l.demandDate)}</td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-center tabular-nums">{qty(l.requestedQty, unit)}</td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-center tabular-nums">{l.approvedQty == null ? '—' : qty(l.approvedQty, unit)}</td>
                    <td className="whitespace-nowrap px-2.5 py-2 text-center tabular-nums">{l.issuedQty ? qty(l.issuedQty, unit) : '—'}</td>
                    <td className="px-2.5 py-2"><Pill tone={LINE_TONE[l.status] ?? 'muted'}>{LINE_LABEL[l.status] ?? l.status}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <span className="text-[13px] text-muted-foreground">No production demand has asked for this item yet.</span>
        )}
      </Card>
    </div>
  );
}
