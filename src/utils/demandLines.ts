import type {
  BranchProductionOrder,
  BranchProductionOrderItem,
  BranchProductionOrderPackingItem,
} from '@mb/shared';

/**
 * Which quantity a demand line actually stands for, at whatever stage it is at.
 *
 * Before review, `approvedQty` is null and the branch's request is the only
 * figure there is. After review it is what Production decided to send, and that
 * is what every downstream screen means by "how much" — the request is history
 * at that point.
 *
 * `?? qty` rather than `|| qty` is the whole point: `0` is a decision
 * (Production is sending none of this), not a missing value, and `||` would
 * quietly resurrect the original request for exactly the lines this module
 * exists to suppress.
 */
export function effectiveQty(it: Pick<BranchProductionOrderItem, 'qty' | 'approvedQty'>): number {
  return Number(it.approvedQty ?? it.qty) || 0;
}

/** Packing equivalent — same rule, no balance carry-forward to consider. */
export function effectivePackingQty(
  it: Pick<BranchProductionOrderPackingItem, 'qty' | 'approvedQty'>,
): number {
  return Number(it.approvedQty ?? it.qty) || 0;
}

/**
 * A line carrying no quantity — nothing to make, send, count or print.
 *
 * Two ways one appears, and both end up here:
 *
 *  - The branch left the box blank or typed 0. The order form already drops
 *    these before submitting and the API's schema requires a positive quantity,
 *    so this should be unreachable from the current app — but demands raised
 *    before those guards are still inside the 7-day window, and a stale PWA tab
 *    can still be running an older bundle.
 *  - Production reviewed the line down to 0, i.e. decided to send none of it.
 *    This is the common case and it is entirely legitimate; the line simply has
 *    no business appearing on a table that asks someone to count, make or
 *    receive it.
 *
 * The line is never deleted — its balance still carries forward, and the print
 * slips have filtered on the same rule since they were written. This only
 * decides what is worth putting in front of someone.
 */
export function isEmptyLine(it: Pick<BranchProductionOrderItem, 'qty' | 'approvedQty'>): boolean {
  return effectiveQty(it) <= 0;
}

/** Packing equivalent of {@link isEmptyLine}. */
export function isEmptyPackingLine(
  it: Pick<BranchProductionOrderPackingItem, 'qty' | 'approvedQty'>,
): boolean {
  return effectivePackingQty(it) <= 0;
}

/** The lines of a demand worth showing — everything with a quantity behind it. */
export function liveItems<T extends Pick<BranchProductionOrderItem, 'qty' | 'approvedQty'>>(
  items: T[] | undefined,
): T[] {
  return (items ?? []).filter((it) => !isEmptyLine(it));
}

/** Packing equivalent of {@link liveItems}. */
export function livePackingItems<
  T extends Pick<BranchProductionOrderPackingItem, 'qty' | 'approvedQty'>,
>(items: T[] | undefined): T[] {
  return (items ?? []).filter((it) => !isEmptyPackingLine(it));
}

// ---------------------------------------------------------------------------
// Waiting demand — what the pool still owes
// ---------------------------------------------------------------------------

/**
 * The two statuses in which a demand is still owed by the production pool.
 *
 * "Waiting" runs until the BRANCH verifies, not until Production reviews.
 * `awaiting_verification` means the goods went out but nobody has counted them
 * in yet, and stock only moves at verification (migration 58) — so the pool
 * still holds those units and still owes them. `verified`, `approved`,
 * `rejected` and `cancelled` are all settled as far as the pool is concerned.
 *
 * Shared rather than repeated, because two screens now subtract this from the
 * same balance and a private copy of "waiting" on either one would let them
 * quietly disagree about the same number.
 */
export const WAITING_ORDER_STATUSES = ['pending', 'awaiting_verification'] as const;

export function isWaitingOrder(order: Pick<BranchProductionOrder, 'status'>): boolean {
  return (WAITING_ORDER_STATUSES as readonly string[]).includes(order.status);
}

/**
 * Waiting demand per productId, across every branch.
 *
 * SPECIAL ITEMS ARE INCLUDED HERE, which is the one place this differs from the
 * Demand Summary's product pivot — and the difference is deliberate, not an
 * oversight in either.
 *
 * A special item is a REAL, active product (migration 69 says so in as many
 * words: "so that stock works"), it gets a row in the pool like any other, and
 * `verify_production_order` returns every line with no special-case filter — so
 * a special item draws the pool down exactly like an ordinary one. Anything
 * subtracting demand from a pool BALANCE therefore has to count it, or the
 * balance on a special product's row is short by a whole cake.
 *
 * The Demand Summary excludes them for an unrelated reason: it is a batching
 * plan, and aggregating two "Name cake" lines into a row reading 2 destroys the
 * instruction that makes them makeable. It lists them individually instead, so
 * they are not missing there either — just not pivoted. No pivot row means no
 * balance is stated for them there, so nothing is misreported on that page.
 *
 * Quantity is `effectiveQty`, so a line reviewed down to "sending none" counts
 * as nothing rather than resurrecting the branch's original request.
 */
export function waitingDemandByProduct(orders: BranchProductionOrder[]): Map<string, number> {
  const byProduct = new Map<string, number>();
  for (const order of orders) {
    if (!isWaitingOrder(order)) continue;
    for (const it of liveItems(order.items)) {
      byProduct.set(it.productId, (byProduct.get(it.productId) ?? 0) + effectiveQty(it));
    }
  }
  return byProduct;
}
