import type { DemandStatus, ReturnReason } from '@mb/shared';

/**
 * The one colour map of the Production Dashboard. Every chart on the page takes
 * its colours from here and nowhere else, so a colour means the same thing in
 * every section: orange is always demand, gold always delivered.
 *
 * Values are CSS variables (`--dash-*` in app/globals.css), so light and dark
 * mode each get their own validated steps without a chart re-rendering.
 */
export const chartColors = {
  demand: 'var(--dash-demand)',
  produced: 'var(--dash-produced)',
  delivered: 'var(--dash-delivered)',
  returned: 'var(--dash-returned)',
  repaired: 'var(--dash-repaired)',
  productionStock: 'var(--dash-prod-stock)',
  branchStock: 'var(--dash-branch-stock)',
  lowStock: 'var(--dash-low)',
  outOfStock: 'var(--dash-out)',
  /** Order states with no series of their own. */
  waiting: 'var(--dash-waiting)',
  verified: 'var(--dash-verified)',
  rejected: 'var(--dash-out)',
  other: 'var(--dash-other)',
  none: 'var(--dash-none)',
  grid: 'var(--border)',
  axis: 'var(--muted-foreground)',
  surface: 'var(--card)',
} as const;

/** Demand by order status, stacked from the bottom in this order. */
export const DEMAND_STATUS_COLORS: Record<DemandStatus, string> = {
  approved: chartColors.delivered,
  verified: chartColors.verified,
  awaiting_verification: chartColors.demand,
  pending: chartColors.waiting,
  rejected: chartColors.rejected,
};

export const DEMAND_STACK_ORDER: DemandStatus[] = ['approved', 'verified', 'awaiting_verification', 'pending', 'rejected'];

export const RETURN_REASON_COLORS: Record<ReturnReason, string> = {
  expired: chartColors.returned,
  damaged: chartColors.demand,
  unsold: chartColors.delivered,
  other: chartColors.other,
  none: chartColors.none,
};
