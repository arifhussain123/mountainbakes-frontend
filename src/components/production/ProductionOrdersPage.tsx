'use client';

import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import type { BranchProductionOrder } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { useProductionOrders, useReviewProductionOrder, useMarkPrinted, useFinalApproveProductionOrder } from '@/lib/queries';import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DataTable } from '@/components/shared/DataTable';
import { Eye, Sparkles } from 'lucide-react';
import { OrderPrintPreview, slipReference } from './OrderPrintPreview';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  awaiting_verification: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  verified: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
};

const STATUS_LABELS: Record<string, string> = {
  awaiting_verification: 'Awaiting Verification',
  verified: 'Verified — Awaiting Approval',
};

const short = (name: string) => name.replace('Mountain Bakes ', '');
const col = createColumnHelper<BranchProductionOrder>();

export function ProductionOrdersPage() {
  const { token } = useAuth();
  const { settings } = useSettings();
  const ordersQ = useProductionOrders(token);
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

  // "Waiting" runs until the BRANCH verifies, not until Production reviews.
  //
  // 'awaiting_verification' means Production sent the goods out but nobody at the
  // branch has counted them yet — and since migration 58 that step is also where
  // stock actually moves. Dropping those orders off this card at review time hid
  // exactly the demand still in flight: the floor could no longer see what had
  // gone out and not been confirmed. Verification ('verified') is what closes it.
  const waiting = useMemo(
    () => orders.filter((o) => o.status === 'pending' || o.status === 'awaiting_verification'),
    [orders],
  );
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
    const products = new Map<string, Row & { productName: string }>();
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
        const qty = it.approvedQty ?? it.qty;

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
        if (!row) { row = { productName: it.productName, total: 0, sent: 0, byBranch: {} }; products.set(it.productId, row); }
        row.total += qty;
        if (sent) row.sent += qty;
        row.byBranch[branch] = (row.byBranch[branch] ?? 0) + qty;
      }

      // Optional and absent on every demand created before the packing module.
      for (const it of o.packingItems ?? []) {
        const qty = it.approvedQty ?? it.qty;
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

  function openOrder(order: BranchProductionOrder) {
    setSelectedId(order.id);
    setModalOpen(true);
  }

  const columns = [
    col.accessor('demandNumber', { header: 'ID', cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue()}</span> }),
    col.display({ id: 'ref', header: 'Order #', meta: { mobile: 'subtitle' }, cell: ({ row }) => <span className="font-mono text-xs">{slipReference(row.original)}</span> }),
    col.accessor('date', { header: 'Date', cell: (i) => <span className="text-sm">{i.getValue()}</span> }),
    col.accessor('time', { header: 'Time', cell: (i) => <span className="text-sm tabular-nums text-muted-foreground">{i.getValue()}</span> }),
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
    col.accessor(
      (o) =>
        [
          ...o.items.map((i) => `${i.productName} ${i.isSpecial ? (i.description ?? '') : ''}`),
          ...(o.packingItems ?? []).map((p) => p.materialName),
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
                    <tr className="bg-muted/50 text-left">
                      <th className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">Product</th>
                      <th className="px-3 py-2 text-right text-xs uppercase tracking-wide text-muted-foreground">Total Demand</th>
                      {demand.branches.map((b) => (
                        <th key={b} className="px-3 py-2 text-right text-xs uppercase tracking-wide text-muted-foreground">{b}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {demand.rows.map((r) => (
                      <tr key={r.productName} className="border-t">
                        <td className="px-3 py-2 font-medium">{r.productName}</td>
                        <td className="px-3 py-2 text-right font-bold tabular-nums text-primary">
                          {r.total}
                          {/* Part of that total is already out for delivery — without
                              this the row reads as work still to do. */}
                          {r.sent > 0 && (
                            <span className="block text-[10px] font-normal text-muted-foreground">
                              {r.sent} sent
                            </span>
                          )}
                        </td>
                        {demand.branches.map((b) => (
                          <td key={b} className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.byBranch[b] ?? '—'}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              )}

              {/* Mobile cards */}
              <div className="space-y-3 md:hidden">
                {demand.rows.map((r) => (
                  <div key={r.productName} className="rounded-lg border bg-card p-3">
                    <div className="flex items-center justify-between">
                      <p className="font-medium">{r.productName}</p>
                      <span className="text-right font-bold tabular-nums text-primary">
                        {r.total}
                        {r.sent > 0 && (
                          <span className="block text-[10px] font-normal text-muted-foreground">{r.sent} sent</span>
                        )}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      {demand.branches.map((b) => (
                        <span key={b}>{b}: <span className="font-medium text-foreground">{r.byBranch[b] ?? 0}</span></span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Packing materials — same pivot, its own table. Absent entirely when
                  no waiting demand asked for any, so an ordinary day is unchanged. */}
              {demand.packingRows.length > 0 && (
                <>
                  <h3 className="mb-2 mt-6 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Packing Materials
                  </h3>

                  <div className="hidden overflow-x-auto rounded-lg border md:block">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-muted/50 text-left">
                          <th className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">Packing Material</th>
                          <th className="px-3 py-2 text-right text-xs uppercase tracking-wide text-muted-foreground">Total Demand</th>
                          {demand.branches.map((b) => (
                            <th key={b} className="px-3 py-2 text-right text-xs uppercase tracking-wide text-muted-foreground">{b}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {demand.packingRows.map((r) => (
                          <tr key={r.materialName} className="border-t">
                            <td className="px-3 py-2 font-medium">{r.materialName}</td>
                            <td className="px-3 py-2 text-right font-bold tabular-nums text-primary">
                              {r.total}
                              {r.sent > 0 && (
                                <span className="block text-[10px] font-normal text-muted-foreground">
                                  {r.sent} sent
                                </span>
                              )}
                            </td>
                            {demand.branches.map((b) => (
                              <td key={b} className="px-3 py-2 text-right tabular-nums text-muted-foreground">{r.byBranch[b] ?? '—'}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="space-y-3 md:hidden">
                    {demand.packingRows.map((r) => (
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
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                          {demand.branches.map((b) => (
                            <span key={b}>{b}: <span className="font-medium text-foreground">{r.byBranch[b] ?? 0}</span></span>
                          ))}
                        </div>
                      </div>
                    ))}
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
