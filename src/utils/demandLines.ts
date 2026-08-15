import type { BranchProductionOrderItem, BranchProductionOrderPackingItem } from '@mb/shared';

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
