/**
 * Stable query keys — the single source of truth for every TanStack Query key in
 * the app. Used by the hooks in ./queries and by mutations to target invalidations.
 *
 * These live in their own module (rather than inside ./queries) so non-React code
 * — notably @/utils/productPrice — can reuse the exact same keys without importing
 * the hooks, which would create an import cycle. Anything that reads or writes a
 * cache entry MUST build its key from here; a hand-rolled key that differs by even
 * a shape detail creates a second cache entry that invalidations silently miss.
 *
 * Re-exported from ./queries, so existing `import { qk } from '@/lib/queries'`
 * call sites keep working.
 */
export const qk = {
  settings: () => ['settings'] as const,
  products: (isActive?: boolean) => ['products', { isActive: isActive ?? null }] as const,
  packingMaterials: (includeInactive?: boolean) =>
    ['packingMaterials', { includeInactive: includeInactive ?? false }] as const,
  packingUsage: (filters: { from?: string | null; to?: string | null; branchId?: string | null; packingMaterialId?: string | null }) =>
    ['packingUsage', filters.from ?? null, filters.to ?? null, filters.branchId ?? null, filters.packingMaterialId ?? null] as const,
  categories: () => ['categories'] as const,
  branches: () => ['branches'] as const,
  branchLocations: () => ['branchLocations'] as const,
  geofenceLogs: (filters: { branchId?: string | null; blockedOnly?: boolean }) =>
    ['geofenceLogs', filters.branchId ?? null, filters.blockedOnly ?? false] as const,
  priceHistory: (productId?: string | null) => ['priceHistory', productId ?? 'all'] as const,
  reportSummary: (period: string, branchId?: string | null) =>
    ['reportSummary', period, branchId ?? null] as const,
  stock: (branchId?: string | null) => ['stock', branchId ?? 'me'] as const,
  productionOrders: (branchId?: string | null) => ['productionOrders', branchId ?? 'me'] as const,
  productionBalances: (branchId?: string | null) => ['productionBalances', branchId ?? 'me'] as const,
  productionOverview: () => ['productionOverview'] as const,
  productionStock: (date?: string | null) => ['productionStock', date ?? 'today'] as const,
  productionBranchStock: () => ['productionBranchStock'] as const,
  productionReturns: () => ['productionReturns'] as const,
  productionExpenses: () => ['productionExpenses'] as const,
  productionExpenseSummary: () => ['productionExpenseSummary'] as const,
  // Special Events. The list key carries its filters so switching year/category
  // does not serve a stale page; everything else is keyed by event id so a single
  // event's detail can be invalidated without dropping the list.
  specialEvents: (filters?: { year?: number | null; category?: string | null; status?: string | null }) =>
    ['specialEvents', filters?.year ?? null, filters?.category ?? null, filters?.status ?? null] as const,
  specialEvent: (id: string) => ['specialEvent', id] as const,
  eventCalendar: (year: number, month: number) => ['eventCalendar', year, month] as const,
  eventSummary: () => ['eventSummary'] as const,
  eventDemands: (eventId: string) => ['eventDemands', eventId] as const,
  eventMyDemand: (eventId: string) => ['eventMyDemand', eventId] as const,
  eventConsolidatedDemand: (eventId: string) => ['eventConsolidatedDemand', eventId] as const,
  eventProductionStatus: (eventId: string) => ['eventProductionStatus', eventId] as const,
  eventNotifications: (eventId?: string | null, status?: string | null) =>
    ['eventNotifications', eventId ?? 'all', status ?? null] as const,
};
