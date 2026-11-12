'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper } from '@tanstack/react-table';
import { ClipboardCheck, Plus, TrendingDown } from 'lucide-react';
import type { StoreDashboard, StoreStockRow } from '@mb/shared';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { buttonVariants } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useStoreDashboard, useStoreStock } from '@/lib/store';
import { cn } from '@/lib/utils';
import { ROUTES } from '@/utils/routes';
import { canOpenStorePage } from '@/utils/storeAccess';
import {
  Card, DateRange, DemandStatusPill, ErrorBlock, FilterSelect, Kpi, Segmented, StorePage,
  fd, num, plural, presetRange, qty, rs, useStoreSession, type RangePreset,
} from './parts';

/**
 * Store Dashboard (design: "Store Dashboard"). Today's figures, what needs the
 * Store's attention (low stock, demand waiting), and a range section with
 * stock movement, consumption by item and item-wise balance. Values are batch
 * cost — what the stock actually cost — and never reach Finance.
 */

type Tab = 'move' | 'cons' | 'bal';
type Period = 'day' | 'week' | 'month';
type Consumption = StoreDashboard['consumption'][number];

const ledgerHref = (id: string) => `${ROUTES.STORE_LEDGER}?item=${id}`;
const signedRs = (v: number) => (v ? `${v > 0 ? '+' : ''}${rs(v)}` : '—');
const signedNum = (v: number) => (v ? `${v > 0 ? '+' : '−'}${num(Math.abs(v))}` : '—');

function periodLabel(k: string, period: Period): string {
  if (period === 'month') {
    const d = new Date(`${k.slice(0, 7)}-01T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? k : d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  }
  return period === 'week' ? `Week of ${fd(k)}` : fd(k);
}

const consCol = createColumnHelper<Consumption>();
const balCol = createColumnHelper<StoreStockRow>();

function ItemLink({ id, name, sub }: { id: string; name: string; sub: string }) {
  return (
    <div className="min-w-[140px]">
      <Link href={ledgerHref(id)} className="font-semibold text-foreground hover:text-primary hover:underline">{name}</Link>
      <div className="font-mono text-[11.5px] text-muted-foreground">{sub}</div>
    </div>
  );
}

export function StoreDashboardPage() {
  const session = useStoreSession();
  const { token, can, today, role } = session;

  const [tab, setTab] = useState<Tab>('move');
  const [period, setPeriod] = useState<Period>('day');
  const [q, setQ] = useState('');
  const [range, setRange] = useState<{ from: string; to: string; preset: RangePreset } | null>(null);
  const r = range ?? { ...(presetRange('month', today) ?? { from: '', to: '' }), preset: 'month' as RangePreset };

  // The KPI tiles and the two attention cards are "today" and must not blink
  // while the range below changes, so they read their own (today-only) call.
  const todayQ = useStoreDashboard(token, today, today, 'day');
  const rangeQ = useStoreDashboard(token, r.from, r.to, period);
  const stockQ = useStoreStock(token, tab === 'bal' ? r.from : '', r.to);

  const open = (href: string) => (canOpenStorePage(role, href) ? href : undefined);
  const d = todayQ.data;

  const term = q.trim().toLowerCase();
  const consumption = useMemo(
    () => (rangeQ.data?.consumption ?? []).filter((c) => !term || `${c.name} ${c.itemNo}`.toLowerCase().includes(term)),
    [rangeQ.data, term],
  );
  const balance = useMemo(
    () => (stockQ.data?.rows ?? []).filter((s) => !term || `${s.name} ${s.itemNo} ${s.itemCode}`.toLowerCase().includes(term)),
    [stockQ.data, term],
  );

  const consColumns = useMemo(() => [
    consCol.accessor('name', {
      header: 'Item',
      meta: { mobile: 'title' },
      cell: (c) => <ItemLink id={c.row.original.id} name={c.getValue()} sub={c.row.original.itemNo} />,
    }),
    consCol.accessor('qty', {
      header: 'Issued',
      meta: { align: 'center', mobile: 'figure' },
      cell: (c) => <span className="whitespace-nowrap font-bold tabular-nums">{qty(c.getValue(), c.row.original.baseUnit)}</span>,
    }),
    consCol.accessor('days', { header: 'Issue days', meta: { align: 'center', mobile: 'figure' }, cell: (c) => <span className="tabular-nums">{c.getValue()}</span> }),
    consCol.accessor((x) => (x.days ? x.qty / x.days : 0), {
      id: 'avg',
      header: 'Avg per issue day',
      meta: { align: 'center', mobile: 'figure' },
      cell: (c) => <span className="whitespace-nowrap tabular-nums">{qty(c.getValue(), c.row.original.baseUnit)}</span>,
    }),
    consCol.accessor('lastIssued', { header: 'Last issued', cell: (c) => <span className="whitespace-nowrap">{fd(c.getValue())}</span> }),
    consCol.accessor('value', { header: 'Value', meta: { align: 'center', mobile: 'figure' }, cell: (c) => <span className="whitespace-nowrap tabular-nums">{rs(c.getValue())}</span> }),
  ], []);

  const balColumns = useMemo(() => [
    balCol.accessor('name', {
      header: 'Item',
      meta: { mobile: 'title' },
      cell: (c) => <ItemLink id={c.row.original.id} name={c.getValue()} sub={`${c.row.original.itemNo} · ${c.row.original.baseUnit}`} />,
    }),
    balCol.accessor('opening', { header: 'Opening', meta: { align: 'center', mobile: 'figure' }, cell: (c) => <span className="tabular-nums">{num(c.getValue())}</span> }),
    balCol.accessor('received', {
      header: 'Received',
      meta: { align: 'center', mobile: 'figure' },
      cell: (c) => <span className="tabular-nums text-emerald-700 dark:text-emerald-400">{num(c.getValue())}</span>,
    }),
    balCol.accessor('issued', { header: 'Issued', meta: { align: 'center', mobile: 'figure' }, cell: (c) => <span className="tabular-nums">{num(c.getValue())}</span> }),
    balCol.accessor((x) => x.adjusted + x.returned, {
      id: 'adjusted',
      header: 'Adjusted',
      meta: { align: 'center', mobile: 'figure' },
      cell: (c) => <span className="tabular-nums">{signedNum(c.getValue())}</span>,
    }),
    balCol.accessor('closing', {
      header: 'Closing',
      meta: { align: 'center', mobile: 'figure' },
      cell: (c) => {
        const x = c.row.original;
        const low = x.status === 'active' && x.closing <= x.minStock;
        return <span className={cn('font-extrabold tabular-nums', low && 'text-red-700 dark:text-red-400')}>{num(c.getValue())}</span>;
      },
    }),
    balCol.accessor('stockValue', { header: 'Value', meta: { align: 'center', mobile: 'figure' }, cell: (c) => <span className="whitespace-nowrap tabular-nums">{rs(c.getValue())}</span> }),
  ], []);

  const actions = (
    <>
      {can('receive') && (
        <Link href={ROUTES.STORE_RECEIVING} className={buttonVariants()}>
          <Plus className="mr-1.5 h-4 w-4" />Receive Stock
        </Link>
      )}
      {can('demand.review') && (
        <Link href={ROUTES.STORE_APPROVAL} className={buttonVariants({ variant: 'outline' })}>
          <ClipboardCheck className="mr-1.5 h-4 w-4" />Review demand
        </Link>
      )}
    </>
  );

  const rangeText = r.from === r.to ? fd(r.from) : `${fd(r.from)} – ${fd(r.to)}`;

  return (
    <StorePage
      session={session}
      subtitle={<>Business date {fd(today)}</>}
      needs="reports"
      actions={can('receive') || can('demand.review') ? actions : null}
    >
      {/* ── KPI tiles ─────────────────────────────────────────────────── */}
      {todayQ.isError ? (
        <ErrorBlock error={todayQ.error} onRetry={() => void todayQ.refetch()} />
      ) : !d ? (
        <div className="grid grid-cols-2 gap-3 min-[1100px]:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[92px] rounded-2xl" />)}
        </div>
      ) : (
        <KpiGrid
          d={d}
          rejected={rangeQ.data?.rejected}
          rangeText={rangeText}
          open={open}
        />
      )}

      {/* ── Attention cards ───────────────────────────────────────────── */}
      {d && (
        <div className="grid gap-3 min-[900px]:grid-cols-2">
          <Card className="flex flex-col gap-2 px-4 py-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[15px] font-bold">Low stock</span>
              {open(ROUTES.STORE_STOCK) && <Link href={ROUTES.STORE_STOCK} className="text-[13px] font-semibold text-primary hover:underline">Open stock</Link>}
            </div>
            {[...d.outOfStock, ...d.low].map((x) => (
              <Link
                key={x.id}
                href={ledgerHref(x.id)}
                className="flex items-center justify-between gap-2.5 rounded-xl bg-red-50 px-3 py-2.5 text-foreground transition-colors hover:bg-red-100 dark:bg-red-500/10 dark:hover:bg-red-500/15"
              >
                <span className="min-w-0">
                  <b className="block truncate text-sm">{x.name}</b>
                  <span className="text-xs text-muted-foreground">{x.itemNo} · reorder at {qty(x.minStock, x.baseUnit)}</span>
                </span>
                <span className="whitespace-nowrap text-sm font-extrabold tabular-nums text-red-700 dark:text-red-400">
                  {x.availableQty <= 0 ? 'Out of stock' : qty(x.availableQty, x.baseUnit)}
                </span>
              </Link>
            ))}
            {!d.outOfStock.length && !d.low.length && (
              <span className="text-[13.5px] text-muted-foreground">All active items are above their reorder level.</span>
            )}
          </Card>
          <Card className="flex flex-col gap-2 px-4 py-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[15px] font-bold">Production demand waiting for Store</span>
              {open(ROUTES.STORE_APPROVAL) && <Link href={ROUTES.STORE_APPROVAL} className="shrink-0 text-[13px] font-semibold text-primary hover:underline">Open queue</Link>}
            </div>
            {d.waiting.map((w) => {
              const body = (
                <>
                  <span className="min-w-0">
                    <b className="block font-mono text-sm font-medium">{w.demandNo}</b>
                    <span className="text-xs text-muted-foreground">{plural(w.lines, 'item')} · needed by {fd(w.requiredDate)}</span>
                  </span>
                  <DemandStatusPill status={w.status} />
                </>
              );
              const cls = 'flex items-center justify-between gap-2.5 rounded-xl border border-border px-3 py-2.5 text-foreground';
              return open(ROUTES.STORE_APPROVAL) ? (
                <Link key={w.id} href={ROUTES.STORE_APPROVAL} className={cn(cls, 'transition-colors hover:border-primary/50')}>{body}</Link>
              ) : (
                <div key={w.id} className={cls}>{body}</div>
              );
            })}
            {!d.waiting.length && (
              <span className="text-[13.5px] text-muted-foreground">Nothing waiting. All demand has been decided and issued.</span>
            )}
          </Card>
        </div>
      )}

      {/* ── Range section ─────────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border px-3.5 py-3">
          <Segmented<Tab>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'move', label: 'Stock movement' },
              { value: 'cons', label: 'Consumption by item' },
              { value: 'bal', label: 'Item-wise balance' },
            ]}
          />
          <div className="flex flex-wrap items-center gap-2">
            <DateRange today={today} from={r.from} to={r.to} preset={r.preset} onChange={setRange} />
            {tab === 'move' ? (
              <FilterSelect label="Group by" value={period} onChange={(v) => setPeriod(v as Period)}>
                <option value="day">Daily</option>
                <option value="week">Weekly</option>
                <option value="month">Monthly</option>
              </FilterSelect>
            ) : (
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search item…"
                aria-label="Search item"
                className="h-9 w-full min-w-0 rounded-lg border border-border bg-card px-2.5 text-[13.5px] text-foreground sm:w-[180px]"
              />
            )}
          </div>
        </div>

        {tab === 'move' ? (
          rangeQ.isError ? (
            <div className="p-3"><ErrorBlock error={rangeQ.error} onRetry={() => void rangeQ.refetch()} /></div>
          ) : (
            <MovementTable rows={rangeQ.data?.movement} period={period} />
          )
        ) : tab === 'cons' ? (
          rangeQ.isError ? (
            <div className="p-3"><ErrorBlock error={rangeQ.error} onRetry={() => void rangeQ.refetch()} /></div>
          ) : (
            <div className="p-3">
              <DataTable
                columns={consColumns}
                data={consumption}
                loading={rangeQ.isLoading}
                sortable
                toolbar={false}
                pageSize={25}
                empty={
                  <EmptyState
                    icon={TrendingDown}
                    title={term && rangeQ.data?.consumption.length ? 'No item matches this search' : 'Nothing was issued to Production in this range.'}
                    className="border-0"
                  />
                }
              />
            </div>
          )
        ) : stockQ.isError ? (
          <div className="p-3"><ErrorBlock error={stockQ.error} onRetry={() => void stockQ.refetch()} /></div>
        ) : (
          <div className="p-3">
            <DataTable
              columns={balColumns}
              data={balance}
              loading={stockQ.isLoading}
              sortable
              toolbar={false}
              pageSize={25}
              empty={<EmptyState title={term ? 'No item matches this search' : 'No store items yet'} className="border-0" />}
            />
          </div>
        )}
      </Card>
    </StorePage>
  );
}

function KpiGrid({ d, rejected, rangeText, open }: {
  d: StoreDashboard;
  rejected: StoreDashboard['rejected'] | undefined;
  rangeText: string;
  open: (href: string) => string | undefined;
}) {
  const remaining = d.stockValue - d.committedValue;
  const names = (xs: Array<{ name: string }>, none: string) => (xs.length ? xs.map((x) => x.name).join(', ') : none);
  return (
    <div className="grid grid-cols-2 gap-3 min-[1100px]:grid-cols-4">
      <Kpi label="Total Store Items" value={String(d.itemsActive)} sub={`${d.itemsInactive} inactive`} href={open(ROUTES.STORE_ITEMS)} />
      <Kpi hero label="Total Available Stock" value={rs(d.stockValue)} sub={`${plural(d.itemsInStock, 'item')} in stock, at cost`} href={open(ROUTES.STORE_STOCK)} />
      <Kpi
        label="Today's Received Stock"
        value={rs(d.receivedToday.amount)}
        sub={`${plural(d.receivedToday.receipts, 'receipt')} · ${plural(d.receivedToday.lines, 'line')}`}
        tone="good"
        href={open(ROUTES.STORE_RECEIVING)}
      />
      <Kpi label="Today's Issued Stock" value={rs(d.issuedToday.value)} sub={`${plural(d.issuedToday.lines, 'line')} to Production`} href={open(ROUTES.STORE_APPROVAL)} />
      <Kpi
        label="Pending Production Demand"
        value={plural(d.pending.lines, 'line')}
        sub={`${plural(d.pending.demands, 'demand')} waiting for review`}
        tone={d.pending.lines ? 'warn' : undefined}
        href={open(ROUTES.STORE_APPROVAL)}
      />
      <Kpi
        label="Approved Demand"
        value={plural(d.approved.lines, 'line')}
        sub={`${plural(d.approved.demands, 'demand')} ready to issue`}
        tone="info"
        href={open(ROUTES.STORE_APPROVAL)}
      />
      <Kpi
        label="Rejected Demand"
        value={rejected ? plural(rejected.lines, 'line') : '…'}
        sub={rejected ? `${plural(rejected.demands, 'demand')} · ${rangeText}` : rangeText}
        href={open(ROUTES.STORE_APPROVAL)}
      />
      <Kpi
        label="Low Stock Items"
        value={String(d.low.length)}
        sub={names(d.low, 'All above reorder level')}
        tone={d.low.length ? 'bad' : undefined}
        href={open(ROUTES.STORE_STOCK)}
      />
      <Kpi
        label="Out of Stock Items"
        value={String(d.outOfStock.length)}
        sub={names(d.outOfStock, 'Every active item has stock')}
        tone={d.outOfStock.length ? 'bad' : undefined}
        href={open(ROUTES.STORE_STOCK)}
      />
      <Kpi
        label="Today's Remaining Stock"
        value={rs(remaining)}
        sub={`after ${rs(d.committedValue)} set aside for approved demand`}
        href={open(ROUTES.STORE_STOCK)}
      />
    </div>
  );
}

function MovementTable({ rows, period }: { rows: StoreDashboard['movement'] | undefined; period: Period }) {
  if (!rows) {
    return (
      <div className="flex flex-col gap-2 p-3.5">
        {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
      </div>
    );
  }
  const max = Math.max(1, ...rows.map((m) => Math.max(m.received, m.issued)));
  const tot = rows.reduce((a, m) => ({ rec: a.rec + m.received, iss: a.iss + m.issued, adj: a.adj + m.adjusted }), { rec: 0, iss: 0, adj: 0 });
  const th = 'px-3.5 py-2.5 text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap';
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-[13.5px]">
        <thead>
          <tr>
            <th className={cn(th, 'text-left')}>Period</th>
            <th className={cn(th, 'text-left')}>Received</th>
            <th className={cn(th, 'text-left')}>Issued to Production</th>
            <th className={cn(th, 'text-center')}>Adjustments</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.k} className="border-t border-border/70">
              <td className="whitespace-nowrap px-3.5 py-2.5 font-semibold">{periodLabel(m.k, period)}</td>
              <td className="min-w-[200px] px-3.5 py-2.5"><Bar v={m.received} n={m.receivedLines} max={max} color="bg-emerald-600" /></td>
              <td className="min-w-[200px] px-3.5 py-2.5"><Bar v={m.issued} n={m.issuedLines} max={max} color="bg-primary" /></td>
              <td className="whitespace-nowrap px-3.5 py-2.5 text-center tabular-nums">{signedRs(m.adjusted)}</td>
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={4} className="px-3.5 py-7 text-center text-muted-foreground">No stock movement in this date range.</td>
            </tr>
          )}
          <tr className="border-t-2 border-border bg-muted/50">
            <td className="px-3.5 py-2.5 text-[11.5px] font-bold uppercase tracking-wider text-muted-foreground">Total</td>
            <td className="px-3.5 py-2.5 font-extrabold tabular-nums">{rs(tot.rec)}</td>
            <td className="px-3.5 py-2.5 font-extrabold tabular-nums">{rs(tot.iss)}</td>
            <td className="px-3.5 py-2.5 text-center font-extrabold tabular-nums">{signedRs(tot.adj)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** Amount + line count over a thin bar proportional to the busiest period. */
function Bar({ v, n, max, color }: { v: number; n: number; max: number; color: string }) {
  return (
    <>
      <div className="flex justify-between gap-2 tabular-nums">
        <b>{rs(v)}</b>
        <span className="text-xs text-muted-foreground">{plural(n, 'line')}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-muted">
        <div className={cn('h-1.5 rounded-full', color)} style={{ width: `${(Math.max(0, v) / max) * 100}%` }} />
      </div>
    </>
  );
}
