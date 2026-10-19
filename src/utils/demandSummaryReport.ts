import type { BranchProductionOrder, Product } from '@mb/shared';
import { rateOf } from '@mb/shared';
import { effectiveQty, effectivePackingQty, isWaitingOrder } from './demandLines';

/** Strips the shared "Mountain Bakes " prefix every branch name carries. Same rule the Demand Summary card uses. */
function shortBranchName(name: string): string {
  return name.replace('Mountain Bakes ', '');
}

export interface DemandSummaryProductRow {
  productId: string;
  productName: string;
  qty: number;
  /** Keyed by the same short branch name as `byBranch` everywhere else in this snapshot. */
  byBranch: Record<string, number>;
  /** Today's production stock. `null` only while the stock query has not resolved yet. */
  stock: number | null;
  /** `stock - qty`. `null` under the same condition as `stock` — never computed from a half-loaded figure. */
  balance: number | null;
}

export interface DemandSummaryPackingRow {
  packingMaterialId: string;
  materialName: string;
  qty: number;
  byBranch: Record<string, number>;
}

export interface DemandSummaryBranchRow {
  branchId: string;
  branchName: string;
  qty: number;
  /** `null` when some line going to this branch could not be priced — see {@link buildDemandSummarySnapshot}. */
  amount: number | null;
}

export interface DemandSummarySnapshot {
  pendingOrders: number;
  awaitingOrders: number;
  /** Every branch with waiting demand, in the order first encountered — drives the per-branch columns. */
  branchNames: string[];
  /** In the order the waiting orders list them — no automatic sort, same as the Demand Summary card. */
  products: DemandSummaryProductRow[];
  packing: DemandSummaryPackingRow[];
  branches: DemandSummaryBranchRow[];
  totals: {
    distinctProducts: number;
    totalProductQty: number;
    distinctPacking: number;
    totalPackingQty: number;
    /** Σ of each listed product's OWN today's stock, counted once — never summed across its branch columns. `null` while stock is still loading. */
    totalStock: number | null;
    /** `totalStock - totalProductQty`. `null` under the same condition as `totalStock`. */
    balanceStock: number | null;
    /** `null` when any branch's amount is unknown, so the total is never understated silently. */
    grandAmount: number | null;
  };
}

/**
 * The ONE snapshot every section of the print document is built from —
 * product pivot (with today's stock and balance), packing pivot, and
 * branch-wise quantity/amount, all read off the same waiting-order list in a
 * single pass. That is what keeps the sections and the grand totals from
 * ever disagreeing with each other, and with the Demand Summary card itself.
 *
 * Reuses the exact rules the card is built from: `isWaitingOrder` (pending +
 * awaiting_verification), `effectiveQty`/`effectivePackingQty` (the approved
 * figure once reviewed, the branch's ask until then), and special items are
 * excluded from the product pivot for the same reason the card excludes them
 * — see `demandLines.ts`.
 *
 * `stockByProduct`/`stockLoaded` are passed in rather than fetched here — the
 * Production Orders page already holds today's production stock
 * (`useProductionStock`), and re-querying it just to print would be the same
 * figure fetched twice.
 *
 * Pricing follows the same snapshot-first rule the A4 challan uses
 * (`OrderPrintPreview.rowFor`): the line's own `unitPrice` snapshot, falling
 * back to the live catalogue price only for lines raised before that column
 * existed. A line with neither — e.g. its product has since been deleted from
 * the catalogue — makes its branch's amount (and so the grand amount) `null`
 * rather than silently pricing it at 0.
 */
export function buildDemandSummarySnapshot(
  orders: BranchProductionOrder[],
  products: Pick<Product, 'id' | 'price'>[],
  stockByProduct: Map<string, number>,
  stockLoaded: boolean,
): DemandSummarySnapshot {
  const livePriceById = new Map(products.map((p) => [p.id, p.price]));
  const waiting = orders.filter(isWaitingOrder);

  const branchNames: string[] = [];
  const productRows = new Map<string, Omit<DemandSummaryProductRow, 'stock' | 'balance'>>();
  const packingRows = new Map<string, DemandSummaryPackingRow>();
  const branchRows = new Map<string, DemandSummaryBranchRow & { amountKnown: boolean }>();
  let pendingOrders = 0;
  let awaitingOrders = 0;

  for (const o of waiting) {
    const sent = o.status === 'awaiting_verification';
    if (sent) awaitingOrders += 1;
    else pendingOrders += 1;

    const branchName = shortBranchName(o.branchName);
    if (!branchNames.includes(branchName)) branchNames.push(branchName);

    let branch = branchRows.get(o.branchId);
    if (!branch) {
      branch = { branchId: o.branchId, branchName, qty: 0, amount: 0, amountKnown: true };
      branchRows.set(o.branchId, branch);
    }

    for (const it of o.items) {
      const qty = effectiveQty(it);
      if (qty <= 0 || it.isSpecial) continue; // not pivoted — see demandLines.ts

      let row = productRows.get(it.productId);
      if (!row) { row = { productId: it.productId, productName: it.productName, qty: 0, byBranch: {} }; productRows.set(it.productId, row); }
      row.qty += qty;
      row.byBranch[branchName] = (row.byBranch[branchName] ?? 0) + qty;

      branch.qty += qty;
      const rate = rateOf(it) ?? livePriceById.get(it.productId) ?? null;
      if (rate === null) branch.amountKnown = false;
      else branch.amount = (branch.amount ?? 0) + qty * rate;
    }

    for (const it of o.packingItems ?? []) {
      const qty = effectivePackingQty(it);
      if (qty <= 0) continue;
      let row = packingRows.get(it.packingMaterialId);
      if (!row) { row = { packingMaterialId: it.packingMaterialId, materialName: it.materialName, qty: 0, byBranch: {} }; packingRows.set(it.packingMaterialId, row); }
      row.qty += qty;
      row.byBranch[branchName] = (row.byBranch[branchName] ?? 0) + qty;
    }
  }

  const products_ = [...productRows.values()].map((row) => {
    const stock = stockLoaded ? (stockByProduct.get(row.productId) ?? 0) : null;
    const balance = stock === null ? null : stock - row.qty;
    return { ...row, stock, balance };
  });

  const branches = [...branchRows.values()].map(({ amountKnown, ...b }) => ({ ...b, amount: amountKnown ? b.amount : null }));
  const totalProductQty = products_.reduce((sum, r) => sum + r.qty, 0);
  const totalPackingQty = [...packingRows.values()].reduce((sum, r) => sum + r.qty, 0);
  const totalStock = stockLoaded ? products_.reduce((sum, r) => sum + (r.stock ?? 0), 0) : null;
  const balanceStock = totalStock === null ? null : totalStock - totalProductQty;
  const grandAmount = branches.some((b) => b.amount === null)
    ? null
    : branches.reduce((sum, b) => sum + (b.amount ?? 0), 0);

  return {
    pendingOrders,
    awaitingOrders,
    branchNames,
    products: products_,
    packing: [...packingRows.values()],
    branches,
    totals: {
      distinctProducts: productRows.size,
      totalProductQty,
      distinctPacking: packingRows.size,
      totalPackingQty,
      totalStock,
      balanceStock,
      grandAmount,
    },
  };
}

/** The same "to review / sent, awaiting verification" sentence the Demand Summary card shows. */
export function demandStatusText(snapshot: Pick<DemandSummarySnapshot, 'pendingOrders' | 'awaitingOrders'>): string {
  const parts: string[] = [];
  if (snapshot.pendingOrders > 0) parts.push(`${snapshot.pendingOrders} to review`);
  if (snapshot.awaitingOrders > 0) parts.push(`${snapshot.awaitingOrders} sent, awaiting branch verification`);
  return parts.join(' · ');
}
