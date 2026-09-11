'use client';

import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { businessDateStr, type ProductionStockRow, type ProductionStockStatus } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useProducts, useProductionStock, usePrepareProducts, useProductionAdjustment } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Plus, FileSpreadsheet, PackageOpen, AlertTriangle, History, SlidersHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDate } from '@/utils/date';
import { PrepareProductsModal } from './PrepareProductsModal';
import { PreparedDetailExportModal } from './PreparedDetailExportModal';
import { StockAdjustmentModal } from './StockAdjustmentModal';
import { StockLedgerPanel } from './StockLedgerPanel';
import { ProductStockDetail } from './ProductStockDetail';

const col = createColumnHelper<ProductionStockRow>();

/** A movement figure: dashes when nothing happened, so real numbers stand out. */
function Signed({ v, tone }: { v: number; tone: 'emerald' }) {
  if (!v) return <span className="tabular-nums text-muted-foreground">—</span>;
  return (
    <span className={cn('tabular-nums', tone === 'emerald' && 'text-emerald-600 dark:text-emerald-400')}>
      {v > 0 ? `+${v}` : v}
    </span>
  );
}

/**
 * Where the product stands (§16) — the comparison the floor plans on, stated in
 * words rather than left as arithmetic between two columns.
 *
 * The classification itself lives in `productionStockStatus` in @mb/shared and is
 * computed server-side, so this only chooses the colours.
 */
const STATUS_STYLE: Record<ProductionStockStatus, { label: string; className: string }> = {
  healthy:  { label: 'Healthy',   className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400' },
  low:      { label: 'Low',       className: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400' },
  out:      { label: 'Out',       className: 'bg-muted text-muted-foreground' },
  shortage: { label: 'Shortage',  className: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400' },
};

/**
 * DEFENSIVE ON PURPOSE.
 *
 * `status` is computed server-side, so a client running against an API that has
 * not been deployed yet receives rows without it — and a bare
 * `STATUS_STYLE[status].className` on an undefined status throws, taking the
 * whole page down with it. During any deploy the two halves of this app are
 * briefly different versions (they are separate repos with separate deploys), so
 * "the API is one release behind" is a state this page must survive rather than
 * white-screen on.
 *
 * A dash is the honest rendering: the status genuinely is not known.
 */
function StatusChip({ status }: { status: ProductionStockStatus | undefined }) {
  const s = status ? STATUS_STYLE[status] : undefined;
  if (!s) return <span className="text-xs text-muted-foreground">—</span>;
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', s.className)}>{s.label}</span>;
}

/** One summary card (§26). Every figure is a fold over the rows below it. */
function StatCard({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' | 'muted' }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn(
        'mt-1 text-xl font-semibold tabular-nums',
        tone === 'good' && 'text-emerald-600 dark:text-emerald-400',
        tone === 'bad' && 'text-red-600 dark:text-red-400',
        tone === 'muted' && 'text-muted-foreground',
      )}>
        {value > 0 && tone === 'good' ? `+${value}` : value}
      </p>
    </div>
  );
}

export function ProductionStockPage() {
  const { token } = useAuth();
  const today = businessDateStr();
  // The pool's day-scoped figures (Prepared / Approved / Sold / Returned) are
  // only ever computed for one business date, so the page needs to say which —
  // and let it be moved back to read a closed day.
  const [date, setDate] = useState(today);
  const isToday = date === today;
  const stockQ = useProductionStock(token, date);
  const productsQ = useProducts(token, { isActive: true });

  // The demand queue is no longer fetched here. `branchDemand` arrives ON the
  // stock row, computed server-side from the same order statuses — which is what
  // stops this page and the Demand Summary from each deriving "what branches are
  // owed" their own way and disagreeing about it.
  const prepareMut = usePrepareProducts(token);
  const adjustMut = useProductionAdjustment(token);
  const [modalOpen, setModalOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustProductId, setAdjustProductId] = useState<string | null>(null);
  /** The row whose full movement trail is open. Null when the dialog is closed. */
  const [detailRow, setDetailRow] = useState<ProductionStockRow | null>(null);

  const balanceById = useMemo(
    () => new Map((stockQ.data ?? []).map((r) => [r.productId, r.balance])),
    [stockQ.data],
  );

  function openAdjust(productId?: string) {
    setAdjustProductId(productId ?? null);
    setAdjustOpen(true);
  }

  // What today already holds per product, so the prepare form can show its
  // entries as the ADDITIONS they are (+5 → 30) rather than as a fresh total.
  // The table is date-scoped, but the form only opens on today (see below), so
  // these figures are always the ones a save will add to.
  /**
   * The products this sheet is about.
   *
   * The API already drops everything that neither moved nor carries a figure, so
   * this is belt-and-braces rather than the load-bearing filter it once was. Left
   * in place because it costs nothing and states the page's rule locally.
   *
   * NOTE it tests the MOVEMENTS and the claim, not `opening` — a product resting
   * on yesterday's balance with nothing happening today is genuinely part of the
   * pool and belongs on the sheet.
   */
  /**
   * Rows, with every figure coerced to a number at the boundary.
   *
   * The API owns these values and normally sends all of them. But the two halves
   * of this app deploy separately, so a browser can hold a build that is ahead of
   * the API for a few minutes — and an absent figure would otherwise propagate
   * `undefined` into the summary cards as NaN and into the status chip as a
   * crash. `n()` makes a missing figure read as 0, which is what a table of
   * numbers should do when a number is not there.
   */
  const dayRows = useMemo(() => {
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return (stockQ.data ?? []).map((r) => ({
      ...r,
      opening: n(r.opening),
      preparedToday: n(r.preparedToday),
      totalStock: n(r.totalStock),
      branchDemand: n(r.branchDemand),
      demandFulfilled: n(r.demandFulfilled),
      soldToday: n(r.soldToday),
      returned: n(r.returned),
      adjustment: n(r.adjustment),
      balance: n(r.balance),
      available: n(r.available),
    }));
  }, [stockQ.data]);

  /**
   * True when the API is answering with a shape this build does not understand —
   * in practice, the server half of a deploy not having landed yet.
   *
   * Detected on `status`, which every row from a current API carries. Reported as
   * a banner rather than left as a table of zeroes, because "every product reads
   * 0" and "the API is a version behind" look identical on screen and lead
   * somewhere very different.
   */
  const staleApi =
    (stockQ.data?.length ?? 0) > 0 && stockQ.data!.every((r) => r.status === undefined);

  const preparedTodayById = useMemo(
    () => Object.fromEntries((stockQ.data ?? []).map((r) => [r.productId, r.preparedToday])),
    [stockQ.data],
  );

  /**
   * The summary cards (§26), totalled from the SAME rows the table renders.
   *
   * Deliberately not a second query. A card fed by its own endpoint is a second
   * definition of the same number, and the first time the two disagree nobody can
   * tell which one is lying — so the cards are a fold over `dayRows` and cannot
   * drift from the table beneath them by construction.
   */
  const totals = useMemo(
    () =>
      dayRows.reduce(
        (t, r) => ({
          opening: t.opening + r.opening,
          prepared: t.prepared + r.preparedToday,
          total: t.total + r.totalStock,
          demand: t.demand + r.branchDemand,
          sold: t.sold + r.soldToday,
          returned: t.returned + r.returned,
          adjustment: t.adjustment + r.adjustment,
          balance: t.balance + r.balance,
        }),
        { opening: 0, prepared: 0, total: 0, demand: 0, sold: 0, returned: 0, adjustment: 0, balance: 0 },
      ),
    [dayRows],
  );

  const shortages = useMemo(() => dayRows.filter((r) => r.status === 'shortage'), [dayRows]);

  const columns = [
    // Card layout below md (§25) is DataTable's own: 'title' + 'subtitle' head the
    // card, 'badge' sits top-right, everything left as the default 'meta' role
    // becomes the two-column figure grid, and the `actions` column becomes the
    // footer — which is what makes the card tappable through to the full history.
    col.accessor('stockCode', { header: 'ID', meta: { mobile: 'subtitle' }, cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue()}</span> }),
    col.accessor('productName', { header: 'Product', meta: { mobile: 'title' }, cell: (i) => <span className="font-medium">{i.getValue()}</span> }),
    // ── The nine figures, left to right as the ledger reads ──────────────────
    //
    //     totalStock = opening + prepared
    //     balance    = opening + prepared + returned + adjustment
    //                  − demandFulfilled − sold
    //
    // Branch Demand is DISPLAYED, not subtracted. A branch asking for goods does
    // not consume them — the units stay on the shelf until the branch verifies
    // the delivery, and that verified quantity is already inside `balance`. The
    // relationship between the two is what the Status column is for.
    col.accessor('opening', { header: 'Opening', meta: { align: 'center' }, cell: (i) => <span className="tabular-nums text-muted-foreground">{i.getValue()}</span> }),
    col.accessor('preparedToday', { header: 'Prepared', meta: { align: 'center' }, cell: (i) => <Signed v={i.getValue()} tone="emerald" /> }),
    col.accessor('totalStock', { header: 'Total Stock', meta: { align: 'center' }, cell: (i) => <span className="font-medium tabular-nums">{i.getValue()}</span> }),
    col.accessor('branchDemand', {
      header: 'Branch Demand',
      meta: { align: 'center' },
      cell: ({ row, getValue }) => {
        const qty = getValue();
        if (!qty) return <span className="tabular-nums text-muted-foreground">—</span>;
        // Red only when the pool cannot cover it: an outstanding demand is normal,
        // an uncoverable one is the thing someone has to act on.
        return (
          <span className={cn('font-medium tabular-nums', row.original.balance < qty && 'text-red-600 dark:text-red-400')}>
            {qty}
          </span>
        );
      },
    }),
    col.accessor('soldToday', { header: 'Sale', meta: { align: 'center', mobileLabel: 'Production sale' }, cell: (i) => <span className="tabular-nums">{i.getValue() || '—'}</span> }),
    col.accessor('returned', { header: 'Return', meta: { align: 'center', mobileLabel: 'Return stock' }, cell: (i) => <span className="tabular-nums text-muted-foreground">{i.getValue() || '—'}</span> }),
    col.accessor('adjustment', {
      header: 'Adjustment',
      meta: { align: 'center' },
      cell: (i) => {
        const v = i.getValue();
        if (!v) return <span className="tabular-nums text-muted-foreground">—</span>;
        return <span className="tabular-nums text-sky-600 dark:text-sky-400">{v > 0 ? `+${v}` : v}</span>;
      },
    }),
    col.accessor('balance', {
      header: 'Balance',
      meta: { align: 'center' },
      cell: (i) => <span className={cn('font-semibold tabular-nums', i.getValue() < 0 && 'text-red-600 dark:text-red-400')}>{i.getValue()}</span>,
    }),
    // 'badge' puts the status chip top-right of the mobile card, beside the
    // product name, which is where the eye lands first — a shortage should be
    // visible without reading the eight figures underneath it.
    col.accessor('status', {
      header: 'Status',
      meta: { align: 'center', mobile: 'badge' },
      cell: (i) => <StatusChip status={i.getValue()} />,
    }),
    // Adjustment is reachable from the row it applies to, so the product is
    // already chosen when the dialog opens — picking it again from a list of a
    // hundred is where the wrong product gets adjusted.
    col.display({
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={(e) => { e.stopPropagation(); setDetailRow(row.original); }}
          >
            <History className="mr-1 h-3.5 w-3.5" /> History
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={(e) => { e.stopPropagation(); openAdjust(row.original.productId); }}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    }),
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold">Production Stock</h2>
          <p className="text-sm text-muted-foreground">
            Central production pool — {isToday ? 'today' : formatDate(date)}. Opening is
            the previous day&apos;s closing balance, carried forward automatically. Every
            figure is folded out of the stock ledger; nothing here is editable by hand.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Date</label>
            <Input
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value || today)}
              className="h-9 w-full sm:w-40"
            />
          </div>
          {/* Unlike the table, which can only ever show one day, this export spans
              a From/To window — so it stays available whichever day is on screen. */}
          <Button variant="outline" className="h-9" onClick={() => setExportOpen(true)}>
            <FileSpreadsheet className="mr-1 h-4 w-4" /> Prepared Detail
          </Button>
          {/* Adjustments always book against the CURRENT business day (the server
              stamps it), so offering this while a past day is on screen would
              write a movement the table cannot show. */}
          {isToday && (
            <Button variant="outline" className="h-9" onClick={() => openAdjust()}>
              <SlidersHorizontal className="mr-1 h-4 w-4" /> Adjustment
            </Button>
          )}
          {/* A prepare always books against the CURRENT business day (the server
              stamps it), so offering the button while a past day is on screen
              would save a figure the table cannot show. */}
          {isToday ? (
            <Button className="h-9" onClick={() => setModalOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> Today&apos;s Prepared Products
            </Button>
          ) : (
            <Button variant="outline" className="h-9" onClick={() => setDate(today)}>
              Back to today
            </Button>
          )}
        </div>
      </div>

      {staleApi && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="text-sm">
            <p className="font-semibold text-amber-800 dark:text-amber-300">
              The API has not been updated yet
            </p>
            <p className="mt-0.5 text-amber-800/80 dark:text-amber-300/80">
              This page is showing what it can, but Opening, Balance and Status will read
              zero until the server release goes out. The figures below are not the real
              pool position — do not plan production against them.
            </p>
          </div>
        </div>
      )}

      {/* ── Summary cards (§26) ────────────────────────────────────────────
          Folded from `dayRows`, the same rows the table renders, so a card can
          never disagree with the column it sits above. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
        <StatCard label="Opening" value={totals.opening} tone="muted" />
        <StatCard label="Prepared" value={totals.prepared} tone="good" />
        <StatCard label="Total Stock" value={totals.total} />
        <StatCard label="Branch Demand" value={totals.demand} />
        <StatCard label="Sale" value={totals.sold} />
        <StatCard label="Return" value={totals.returned} />
        <StatCard label="Adjustment" value={totals.adjustment} tone={totals.adjustment < 0 ? 'bad' : 'muted'} />
        <StatCard label="Balance" value={totals.balance} tone={totals.balance < 0 ? 'bad' : undefined} />
      </div>

      {/* A shortage is the one state on this page that needs someone to DO
          something, so it is stated above the table rather than left to be found
          by scanning a status column. Today only: a shortage against a closed day
          is not actionable, and the demand queue it is measured against is live. */}
      {isToday && shortages.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/40">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600 dark:text-red-400" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold text-red-700 dark:text-red-400">
              Insufficient production stock for {shortages.length} {shortages.length === 1 ? 'product' : 'products'}
            </p>
            <p className="mt-0.5 text-red-700/80 dark:text-red-400/80">
              {shortages
                .slice(0, 4)
                .map((r) => `${r.productName} — need ${r.branchDemand}, have ${r.balance} (short ${r.branchDemand - r.balance})`)
                .join(' · ')}
              {shortages.length > 4 && ` · and ${shortages.length - 4} more`}
            </p>
          </div>
        </div>
      )}

      {/* The API returns only products that carry a figure, so an empty table means
          the pool is untouched for this day rather than "nothing matched". Passed
          ONLY when the data itself is empty: with rows present, an empty table is a
          search miss and DataTable's own "No results found" is the right message. */}
      <DataTable
        columns={columns}
        data={dayRows}
        loading={stockQ.isLoading}
        searchPlaceholder="Search products…"
        empty={
          dayRows.length === 0 ? (
            <EmptyState
              icon={PackageOpen}
              title={isToday ? 'Nothing in the pool yet' : `No stock on ${formatDate(date)}`}
              description={
                isToday
                  ? 'Products appear here once they carry an opening balance or are prepared, returned, sent out or sold.'
                  : 'No product carried a balance or moved on this day.'
              }
              action={
                isToday ? (
                  <Button onClick={() => setModalOpen(true)}>
                    <Plus className="mr-1 h-4 w-4" /> Today&apos;s Prepared Products
                  </Button>
                ) : undefined
              }
            />
          ) : undefined
        }
      />

      {/* The ledger sits under the sheet: the table answers "where does each
          product stand", this answers "how did it get there". */}
      <StockLedgerPanel date={date} />

      <ProductStockDetail
        open={detailRow !== null}
        onOpenChange={(o) => { if (!o) setDetailRow(null); }}
        row={detailRow}
        date={date}
      />

      <StockAdjustmentModal
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        products={productsQ.data ?? []}
        defaultProductId={adjustProductId}
        balanceOf={(id) => balanceById.get(id)}
        submit={adjustMut.mutateAsync}
        submitting={adjustMut.isPending}
      />

      <PreparedDetailExportModal
        open={exportOpen}
        onOpenChange={setExportOpen}
        token={token}
        defaultDate={date}
      />

      <PrepareProductsModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        products={productsQ.data ?? []}
        loadingProducts={productsQ.isLoading}
        submit={prepareMut.mutateAsync}
        submitting={prepareMut.isPending}
        preparedTodayById={preparedTodayById}
      />
    </div>
  );
}
