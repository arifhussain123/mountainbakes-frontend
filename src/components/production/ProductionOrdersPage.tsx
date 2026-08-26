'use client';

import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import type { BranchProductionOrder } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import {
  useProductionOrders,
  useProductionStock,
  useReviewProductionOrder,
  useMarkPrinted,
  useFinalApproveProductionOrder,
} from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/shared/DataTable';
import { Eye, Sparkles } from 'lucide-react';
import { effectivePackingQty, effectiveQty, isWaitingOrder, liveItems, livePackingItems } from '@/utils/demandLines';
import { OrderPrintPreview, slipReference } from './OrderPrintPreview';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  awaiting_verification: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  verified: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  cancelled: 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
};

const STATUS_LABELS: Record<string, string> = {
  awaiting_verification: 'Awaiting Verification',
  verified: 'Verified — Awaiting Approval',
  // The branch withdrew it. Read as "Deleted" here too, so the word on this
  // screen is the same word the branch pressed.
  cancelled: 'Deleted by Branch',
};

const short = (name: string) => name.replace('Mountain Bakes ', '');
const col = createColumnHelper<BranchProductionOrder>();

export function ProductionOrdersPage() {
  const { token } = useAuth();
  const { settings } = useSettings();
  const ordersQ = useProductionOrders(token);
  // The central pool, for the Production Stock / Balance columns on the summary
  // below — read as TODAY, matching the Production Stock page. Same two roles
  // guard this page and /api/production-stock (super_admin, production_user), so
  // it can be fetched unconditionally here — unlike on a shared screen a branch
  // manager can reach.
  const stockQ = useProductionStock(token);
  const reviewMut = useReviewProductionOrder(token);
  const printedMut = useMarkPrinted(token);
  const finalApproveMut = useFinalApproveProductionOrder(token);

  // Track just the id and derive `selected` from the live query, rather than
  // storing a snapshot — that way, once Production adds a product to an open
  // order, the invalidated refetch is reflected immediately instead of leaving
  // the dialog showing what View originally captured.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  const orders = useMemo(() => ordersQ.data ?? [], [ordersQ.data]);

  // "Waiting" runs until the BRANCH verifies, not until Production reviews —
  // see isWaitingOrder, which the Production Stock page subtracts from the pool
  // using the same definition. Dropping an order off this card at review time
  // hid exactly the demand still in flight: the floor could no longer see what
  // had gone out and not been confirmed.
  //
  // A demand the branch deleted is 'cancelled', so it falls out of here — and
  // therefore out of the whole Demand Summary — while its row stays in the
  // Orders table below carrying the reason. That is the deletion: it stops being
  // work to do without becoming something nobody can account for.
  const waiting = useMemo(() => orders.filter(isWaitingOrder), [orders]);
  const selected = useMemo(() => orders.find((o) => o.id === selectedId) ?? null, [orders, selectedId]);

  // Demand summary pivots: Product × Branch and Packing Material × Branch, both
  // over the waiting set above (not yet verified by the branch).
  //
  // Two pivots rather than one: a packing material is not something the factory
  // bakes, and it has no unit price or amount, so mixing it into the Product column
  // would misstate the production plan. They share one `branches` list so the two
  // tables line up column-for-column.
  //
  // Quantity is `approvedQty ?? qty`, and the fallback is what makes both states
  // read correctly with one expression: a 'pending' line has not been reviewed, so
  // `approvedQty` is null and the branch's request stands; a reviewed line carries
  // the figure Production actually sent, which is the number still to be confirmed.
  // Summing the original request there would overstate a demand that was cut.
  //
  // `sent` tracks the reviewed share of each total, so a row can say how much of it
  // is already out of the door rather than still to make. Same figure, split — it is
  // never added on top of `total`.
  const demand = useMemo(() => {
    const branches = new Set<string>();
    type Row = { total: number; sent: number; byBranch: Record<string, number> };
    const products = new Map<string, Row & { productId: string; productName: string }>();
    const packing = new Map<string, Row & { materialName: string }>();
    const special: {
      orderId: string;
      demandNumber: string;
      branch: string;
      name: string;
      qty: number;
      description: string;
      photoCount: number;
      awaitingVerification: boolean;
    }[] = [];
    let pendingOrders = 0;
    let awaitingOrders = 0;

    for (const o of waiting) {
      const branch = short(o.branchName);
      branches.add(branch);

      // Reviewed and out for delivery — counted, but distinguishable below.
      const sent = o.status === 'awaiting_verification';
      if (sent) awaitingOrders += 1; else pendingOrders += 1;

      for (const it of o.items) {
        const qty = effectiveQty(it);

        // Nothing to make: either the line was never really ordered, or it was
        // reviewed down to "sending none of this". Skipped before it can reach a
        // pivot row, because a product whose only demand is a zero line would
        // otherwise print a whole row of dashes against a total of 0 — a job on
        // the board that is not a job.
        if (qty <= 0) continue;

        // Special items are LISTED, never pivoted — see the note on the section
        // below for why aggregating them would destroy the instruction.
        if (it.isSpecial) {
          special.push({
            orderId: o.id,
            demandNumber: o.demandNumber,
            branch,
            name: it.productName,
            qty,
            description: it.description ?? '',
            photoCount: (it.photos ?? []).length,
            awaitingVerification: sent,
          });
          continue;
        }

        let row = products.get(it.productId);
        if (!row) { row = { productId: it.productId, productName: it.productName, total: 0, sent: 0, byBranch: {} }; products.set(it.productId, row); }
        row.total += qty;
        if (sent) row.sent += qty;
        row.byBranch[branch] = (row.byBranch[branch] ?? 0) + qty;
      }

      // Optional and absent on every demand created before the packing module.
      for (const it of o.packingItems ?? []) {
        const qty = effectivePackingQty(it);
        if (qty <= 0) continue; // same rule as the product lines above
        let row = packing.get(it.packingMaterialId);
        if (!row) { row = { materialName: it.materialName, total: 0, sent: 0, byBranch: {} }; packing.set(it.packingMaterialId, row); }
        row.total += qty;
        if (sent) row.sent += qty;
        row.byBranch[branch] = (row.byBranch[branch] ?? 0) + qty;
      }
    }

    return {
      branches: [...branches].sort(),
      rows: [...products.values()].sort((a, b) => b.total - a.total),
      packingRows: [...packing.values()].sort((a, b) => b.total - a.total),
      specialRows: special,
      pendingOrders,
      awaitingOrders,
    };
  }, [waiting]);

  /**
   * TODAY's pool position per product, and whether it has arrived yet.
   *
   * `balance` is the pool's closing position for the day: opening carried in,
   * plus what was prepared and returned, less what was fulfilled and sold. It is
   * the same figure the Production Stock page prints, so the two screens cannot
   * quote different stock for the same product.
   *
   * It is the RAW balance, NOT `available` — `available` has already had the whole
   * outstanding demand queue subtracted from it, and `poolFor` below subtracts
   * this product's waiting demand itself. Using `available` here would take the
   * same demand off twice.
   *
   * `undefined` for a product means the query has not resolved; 0 means the
   * pool genuinely holds none. The two must not be conflated — rendering an
   * unloaded figure as 0 would print a full-width column of shortfalls for a
   * second on every page load, which is the one thing this column must never
   * cry wolf about.
   *
   * NOTE the API returns only products that MOVED today, so one that did not is
   * absent from this map rather than present with 0. With the pool day-scoped the
   * two mean the same thing — nothing was made and nothing is on the shelf — and
   * `?? 0` in `poolFor` reads them identically.
   */
  const stockByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of stockQ.data ?? []) m.set(r.productId, r.balance);
    return m;
  }, [stockQ.data]);
  const stockLoaded = stockQ.data !== undefined;

  /**
   * What today's pool holds, what the waiting demand will take out of it, and
   * what is left.
   *
   *   balance = today's production stock − total waiting demand
   *
   * The pool figure ALREADY excludes everything a branch has verified: the
   * transfer out of the pool is written at verification (migration 58), not when
   * Production sends the goods. Waiting demand is by definition not yet verified,
   * so the two never double-count and the subtraction is the honest forward
   * figure — what today's pool comes to once every waiting demand has been
   * counted in by its branch.
   *
   * That also makes Balance the column that does NOT jump when a branch
   * verifies: today's pool drops and the demand drops by the same amount, so the
   * number holds still while the two beside it catch up with reality. It moves
   * only when a branch verifies a CORRECTED quantity — fewer goods left the
   * building than were planned to, so the balance rightly goes up.
   *
   * Negative is the whole point of the column, and reading the pool as today
   * makes it more honest, not noisier: a demand raised yesterday and verified
   * this morning debits today while the goods were made yesterday, so the
   * shortfall it prints is real production still to do.
   */
  function poolFor(productId: string, totalDemand: number): { stock: number; balance: number } | null {
    if (!stockLoaded) return null;
    const stock = stockByProduct.get(productId) ?? 0;
    return { stock, balance: stock - totalDemand };
  }

  function openOrder(order: BranchProductionOrder) {
    setSelectedId(order.id);
    setModalOpen(true);
  }

  const columns = [
    col.accessor('demandNumber', { header: 'ID', cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue()}</span> }),
    col.display({ id: 'ref', header: 'Order #', meta: { mobile: 'subtitle' }, cell: ({ row }) => <span className="font-mono text-xs">{slipReference(row.original)}</span> }),
    col.accessor('date', { header: 'Date', cell: (i) => <span className="text-sm">{i.getValue()}</span> }),
    col.accessor('time', { header: 'Time', cell: (i) => <span className="text-sm tabular-nums text-muted-foreground">{i.getValue()}</span> }),
    // What the branch is committing Production to. Emphasised over the raised
    // date beside it — this is the one Production plans against. Blank on
    // demands raised before the field existed; never defaulted to `date`.
    col.accessor((o) => o.requiredDate ?? '', {
      id: 'requiredDate',
      header: 'Required Date',
      cell: (i) => {
        const v = i.getValue<string>();
        return v ? (
          <span className="text-sm font-medium tabular-nums">{v}</span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        );
      },
    }),
    col.accessor('branchName', { header: 'Branch', meta: { mobile: 'title' }, cell: (i) => <span className="font-medium">{short(i.getValue())}</span> }),
    col.accessor('status', {
      header: 'Status',
      meta: { mobile: 'badge' },
      cell: (i) => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[i.getValue()] ?? 'bg-muted text-muted-foreground'}`}>
          {STATUS_LABELS[i.getValue()] ?? i.getValue()}
        </span>
      ),
    }),
    // Why a demand disappeared from the summary above. The branch is required to
    // give one, so on a 'cancelled' row this is never empty — and it is the only
    // thing on this screen that explains work that was planned and then pulled.
    col.accessor((o) => o.cancelReason ?? '', {
      id: 'reason',
      header: 'Reason',
      meta: { mobileFull: true },
      cell: (i) =>
        i.getValue() ? (
          <span className="text-sm text-muted-foreground">{i.getValue()}</span>
        ) : (
          <span className="text-sm text-muted-foreground/50">—</span>
        ),
    }),
    col.display({
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <Button size="sm" variant="outline" className="h-8" onClick={() => openOrder(row.original)}>
          <Eye className="mr-1 h-3.5 w-3.5" /> View
        </Button>
      ),
    }),
    // Hidden, search-only. The global filter can only match what a column accessor
    // exposes, so this is what lets someone find a demand by a product, packing
    // material OR special item name without adding any as a visible column.
    // Special item DESCRIPTIONS are included too — "blue writing" is how someone
    // will look for that cake, and it is not in any name.
    // Zero lines are excluded here too. Matching a demand on a product that was
    // cut to nothing surfaces a row whose product appears on none of the tables
    // or slips behind it — the search would be pointing at something that is not
    // there.
    col.accessor(
      (o) =>
        [
          ...liveItems(o.items).map((i) => `${i.productName} ${i.isSpecial ? (i.description ?? '') : ''}`),
          ...livePackingItems(o.packingItems).map((p) => p.materialName),
        ].join(' '),
      { id: 'contents', header: '' },
    ),
  ];

  return (
    <div className="space-y-6">
      {/* Demand summary */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Demand Summary — Waiting Orders</CardTitle>
          {/* Says which of the two waiting states the numbers below are made of.
              Rendered only when something is waiting, so an empty card keeps its
              single-line header. */}
          {(demand.pendingOrders > 0 || demand.awaitingOrders > 0) && (
            <p className="text-xs text-muted-foreground">
              {demand.pendingOrders > 0 && `${demand.pendingOrders} to review`}
              {demand.pendingOrders > 0 && demand.awaitingOrders > 0 && ' · '}
              {demand.awaitingOrders > 0 && `${demand.awaitingOrders} sent, awaiting branch verification`}
            </p>
          )}
        </CardHeader>
        <CardContent>
          {demand.rows.length === 0 && demand.packingRows.length === 0 && demand.specialRows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No waiting demands right now.</p>
          ) : (
            <>
              {/* ---------- Special order items ----------
                  FIRST on the page, and a LIST rather than a pivot.

                  Not pivoted because aggregating them destroys the only thing
                  that makes them makeable: two branches asking for a "Name
                  cake" want different names piped on them, and a row reading
                  "Name cake — 4" tells the floor to bake four of something it
                  has no instructions for. Each one is its own job, so each one
                  gets its own line with the branch that asked and what they
                  asked for.

                  First because it is the only demand on this page that cannot
                  be filled from the standing plan, so it is the thing worth
                  reading before anything else. Absent entirely on a day with
                  none, leaving the page exactly as it was. */}
              {demand.specialRows.length > 0 && (
                <div className="mb-6">
                  <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5" />
                    Special Order Items
                    {/* "to make" now means the ones NOT yet sent. Counting the whole
                        list would tell the floor to bake cakes already delivered. */}
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold normal-case text-primary">
                      {(() => {
                        const toMake = demand.specialRows.filter((r) => !r.awaitingVerification).length;
                        return toMake === demand.specialRows.length
                          ? `${toMake} to make`
                          : `${toMake} of ${demand.specialRows.length} to make`;
                      })()}
                    </span>
                  </h3>

                  <ul className="divide-y rounded-lg border">
                    {demand.specialRows.map((r, i) => (
                      <li key={`${r.orderId}-${r.name}-${i}`} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                        <span className="mt-0.5 min-w-[2.5rem] shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-center font-bold tabular-nums text-primary">
                          {r.qty}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium leading-tight">{r.name}</p>
                          {/* The instruction. This is the reason the section exists. */}
                          {r.description && (
                            <p className="mt-0.5 text-xs text-muted-foreground">{r.description}</p>
                          )}
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {r.branch} · {r.demandNumber}
                            {r.photoCount > 0 && ` · ${r.photoCount} photo${r.photoCount === 1 ? '' : 's'} — open the order to view`}
                          </p>
                          {/* Each special item is its own job, so "already sent"
                              belongs on the line itself — a pivot total cannot say
                              which of two Name cakes has gone out. */}
                          {r.awaitingVerification && (
                            <span className="mt-1 inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-400">
                              Sent — awaiting verification
                            </span>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Labelled only when there is another section to tell it apart from. */}
              {(demand.packingRows.length > 0 || demand.specialRows.length > 0) && demand.rows.length > 0 && (
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Products</h3>
              )}

              {/* Desktop pivot table. Guarded on rows: a day whose only waiting
                  demand is a special item would otherwise render a table of
                  column headers with nothing under them. */}
              {demand.rows.length > 0 && (
              <div className="hidden overflow-x-auto rounded-lg border md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr data-table-head className="text-left">
                      <th className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">Product</th>
                      {/* Pool → demand → what is left, in the order the sum reads,
                          and ahead of the branch columns because it is the
                          production decision. The branch split answers "who is
                          this for"; these three answer "do we have it". */}
                      <th className="px-3 py-2 text-center text-xs uppercase tracking-wide text-muted-foreground">Today&apos;s Stock</th>
                      <th className="px-3 py-2 text-center text-xs uppercase tracking-wide text-muted-foreground">Total Demand</th>
                      <th className="border-r px-3 py-2 text-center text-xs uppercase tracking-wide text-muted-foreground">Balance Stock</th>
                      {demand.branches.map((b) => (
                        <th key={b} className="px-3 py-2 text-center text-xs uppercase tracking-wide text-muted-foreground">{b}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {demand.rows.map((r) => {
                      const pool = poolFor(r.productId, r.total);
                      return (
                      <tr key={r.productId} className="border-t">
                        {/* Only the name stays left. Every figure is centred under its
                            heading, headers included so the two never drift apart. */}
                        <td className="px-3 py-2 font-medium">{r.productName}</td>
                        <td className="px-3 py-2 text-center tabular-nums">
                          {pool ? pool.stock : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-center font-bold tabular-nums text-primary">
                          {/* Part of that total is already out for delivery — without
                              this the row reads as work still to do. Inline and ahead
                              of the number rather than stacked under it, which doubled
                              the height of every row carrying one. */}
                          {r.sent > 0 && (
                            <span className="mr-2 text-[10px] font-normal text-muted-foreground">
                              {r.sent} sent
                            </span>
                          )}
                          {r.total}
                        </td>
                        {/* Red is not decoration here: a negative balance is the
                            shortfall the floor has to bake before this demand can
                            go out, and it is the one number on the card that is a
                            job rather than a report. */}
                        <td
                          className={`border-r px-3 py-2 text-center font-semibold tabular-nums ${
                            pool && pool.balance < 0 ? 'text-red-600 dark:text-red-400' : ''
                          }`}
                        >
                          {pool ? pool.balance : <span className="font-normal text-muted-foreground">—</span>}
                        </td>
                        {demand.branches.map((b) => (
                          <td key={b} className="px-3 py-2 text-center tabular-nums text-muted-foreground">{r.byBranch[b] ?? '—'}</td>
                        ))}
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              )}

              {/* Mobile cards.

                  Unlike the desktop table above, the per-branch breakdown lists
                  ONLY the branches that actually asked for this product. The
                  table has to print a '—' in every column to keep them aligned;
                  a wrapping chip list has no such constraint, and on a phone a
                  row of "Branch: 0" for branches that ordered nothing is pure
                  noise pushing the real numbers off the screen. */}
              <div className="space-y-3 md:hidden">
                {demand.rows.map((r) => {
                  const ordering = demand.branches.filter((b) => (r.byBranch[b] ?? 0) > 0);
                  const pool = poolFor(r.productId, r.total);
                  return (
                    <div key={r.productId} className="rounded-lg border bg-card p-3">
                      <div className="flex items-center justify-between">
                        <p className="font-medium">{r.productName}</p>
                        <span className="text-right font-bold tabular-nums text-primary">
                          {r.total}
                          {r.sent > 0 && (
                            <span className="block text-[10px] font-normal text-muted-foreground">{r.sent} sent</span>
                          )}
                        </span>
                      </div>
                      {/* The same three figures as the desktop table, as a strip
                          rather than columns — the sum has to survive the phone,
                          because the floor reads this screen on one. */}
                      {pool && (
                        <div className="mt-2 flex items-center gap-3 rounded-md bg-muted/50 px-2 py-1.5 text-xs tabular-nums">
                          <span className="text-muted-foreground">
                            Today <span className="font-medium text-foreground">{pool.stock}</span>
                          </span>
                          <span className="text-muted-foreground">−</span>
                          <span className="text-muted-foreground">
                            Demand <span className="font-medium text-foreground">{r.total}</span>
                          </span>
                          <span className="text-muted-foreground">=</span>
                          <span
                            className={`font-semibold ${
                              pool.balance < 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground'
                            }`}
                          >
                            {pool.balance}
                          </span>
                        </div>
                      )}
                      {ordering.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          {ordering.map((b) => (
                            <span key={b}>{b}: <span className="font-medium text-foreground">{r.byBranch[b]}</span></span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Packing materials — same pivot, its own table. Absent entirely when
                  no waiting demand asked for any, so an ordinary day is unchanged.

                  NO stock columns here, and there never can be: packing materials
                  carry no pool balance at all (migration 39 — Production approves
                  a quantity and the request ends there, with no unmet demand
                  carried forward). A Balance column would have nothing to
                  subtract from. */}
              {demand.packingRows.length > 0 && (
                <>
                  <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Packing Materials
                  </h3>

                  <div className="hidden overflow-x-auto rounded-lg border md:block">
                    <table className="w-full text-sm">
                      <thead>
                        <tr data-table-head className="text-left">
                          <th className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">Packing Material</th>
                          <th className="px-3 py-2 text-center text-xs uppercase tracking-wide text-muted-foreground">Total Demand</th>
                          {demand.branches.map((b) => (
                            <th key={b} className="px-3 py-2 text-center text-xs uppercase tracking-wide text-muted-foreground">{b}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {demand.packingRows.map((r) => (
                          <tr key={r.materialName} className="border-t">
                            <td className="px-3 py-2 font-medium">{r.materialName}</td>
                            {/* Same centring and inline treatment as the products table. */}
                            <td className="whitespace-nowrap px-3 py-2 text-center font-bold tabular-nums text-primary">
                              {r.sent > 0 && (
                                <span className="mr-2 text-[10px] font-normal text-muted-foreground">
                                  {r.sent} sent
                                </span>
                              )}
                              {r.total}
                            </td>
                            {demand.branches.map((b) => (
                              <td key={b} className="px-3 py-2 text-center tabular-nums text-muted-foreground">{r.byBranch[b] ?? '—'}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Zero-ordering branches omitted, same as the product cards above. */}
                  <div className="space-y-3 md:hidden">
                    {demand.packingRows.map((r) => {
                      const ordering = demand.branches.filter((b) => (r.byBranch[b] ?? 0) > 0);
                      return (
                        <div key={r.materialName} className="rounded-lg border bg-card p-3">
                          <div className="flex items-center justify-between">
                            <p className="font-medium">{r.materialName}</p>
                            <span className="text-right font-bold tabular-nums text-primary">
                              {r.total}
                              {r.sent > 0 && (
                                <span className="block text-[10px] font-normal text-muted-foreground">{r.sent} sent</span>
                              )}
                            </span>
                          </div>
                          {ordering.length > 0 && (
                            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                              {ordering.map((b) => (
                                <span key={b}>{b}: <span className="font-medium text-foreground">{r.byBranch[b]}</span></span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Orders list */}
      <div>
        <h2 className="mb-3 text-lg font-semibold">Orders</h2>
        <DataTable
          columns={columns}
          data={orders}
          loading={ordersQ.isLoading}
          searchPlaceholder="Search orders, products, packing materials…"
          columnVisibility={{ contents: false }}
        />
      </div>

      <OrderPrintPreview
        open={modalOpen}
        onOpenChange={setModalOpen}
        order={selected}
        settings={settings}
        token={token}
        review={reviewMut.mutateAsync}
        reviewing={reviewMut.isPending}
        markPrinted={printedMut.mutateAsync}
        finalApprove={finalApproveMut.mutateAsync}
        finalApproving={finalApproveMut.isPending}
      />
    </div>
  );
}
