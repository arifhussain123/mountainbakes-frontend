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
  // Admin → Branch Stock. A SEPARATE key from `stock` above because it is
  // date-scoped: the admin page reads any branch on any past business day, and
  // serving one date's figures for another is a reconciliation bug. It still
  // sits under the ['stock'] prefix, so `useStockRealtime`'s prefix
  // invalidation reaches it exactly as it reaches the branch's own page.
  adminStock: (branchId?: string | null, date?: string | null) =>
    ['stock', 'admin', branchId ?? 'none', date ?? 'today'] as const,
  // Branch Dashboard → Branch Stock History. Under the ['stock'] prefix for the
  // same reason `adminStock` is: a sale or a Production approval invalidates the
  // whole prefix, and this card is reading the ledger those movements land in.
  // Keyed by window length as well as branch — 7 days and 30 days are different
  // answers, not the same one at a different zoom.
  stockHistory: (branchId?: string | null, days?: number | null) =>
    ['stock', 'history', branchId ?? 'me', days ?? 7] as const,
  // Admin → Branch Stock, "All branches". Same ['stock'] prefix as its siblings
  // so one invalidation refreshes every stock view; keyed by window length only,
  // because the row set is every branch by definition.
  stockSummary: (days?: number | null) => ['stock', 'summary', days ?? 7] as const,
  // Branch Daily Stock — ONE business day, keyed by that date. Under the
  // ['stock'] prefix with the rest, so a movement invalidates it too.
  stockDay: (branchId?: string | null, date?: string | null) =>
    ['stock', 'day', branchId ?? 'me', date ?? 'today'] as const,
  // Branch → Return Stock. Under the ['stock'] prefix like every key above, and
  // that placement is what keeps the page live: a return moves branch stock, so
  // `useStockRealtime`'s prefix invalidation already refreshes this list — and
  // conversely, correcting a return here invalidates ['stock'] and the Stock
  // page, the history card and the dashboard's Stock Detail all follow.
  // Keyed by window length as well as branch, for the reason `stockHistory` is.
  branchReturns: (branchId?: string | null, days?: number | null) =>
    ['stock', 'returns', branchId ?? 'me', days ?? 90] as const,
  productionOrders: (branchId?: string | null) => ['productionOrders', branchId ?? 'me'] as const,
  productionBalances: (branchId?: string | null) => ['productionBalances', branchId ?? 'me'] as const,
  previousOrderBalance: (orderId: string) => ['previousOrderBalance', orderId] as const,
  productionOverview: () => ['productionOverview'] as const,
  productionStock: (date?: string | null) => ['productionStock', date ?? 'today'] as const,
  productionBranchStock: () => ['productionBranchStock'] as const,
  productionReturns: () => ['productionReturns'] as const,
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

  // Shift-account requests (branch_manager → Admin). One key for both sides of
  // the queue: the endpoint scopes itself from the JWT, so a manager and an
  // admin asking for the same key are asking for different rows and never share
  // a cache entry — the token they read with differs, and signing out clears it.
  branchUserRequests: () => ['branchUserRequests'] as const,

  // Branch Closing. One key for the whole sheet rather than three: the orders,
  // expenses and stock behind it are read together, for one business date, and
  // are only meaningful together — a cache that could serve one date's sales
  // beside another's stock is a reconciliation bug waiting to be filed.
  branchClosing: (businessDate: string) => ['branchClosing', businessDate] as const,

  // ── Finance Ledger ──
  // Every finance key starts with the literal 'finance' so a sign-out or a
  // settings change can drop the whole module with one
  // `invalidateQueries({ queryKey: ['finance'] })` prefix match, without also
  // clearing the operations caches sitting next to it.
  financeDashboard: (businessDate?: string | null) =>
    ['finance', 'dashboard', businessDate ?? 'today'] as const,
  // The ledger key carries its full filter object: the Daily Ledger page changes
  // date, branch and head independently, and a key that dropped any of them
  // would serve one filter's rows under another's heading.
  financeLedger: (filters: Record<string, unknown>) => ['finance', 'ledger', filters] as const,
  financeLedgerEntry: (id: string) => ['finance', 'ledgerEntry', id] as const,
  financeHeads: (includeInactive?: boolean) =>
    ['finance', 'heads', { includeInactive: includeInactive ?? false }] as const,
  financeIncome: (filters: Record<string, unknown>) => ['finance', 'income', filters] as const,
  financeEntries: (filters: Record<string, unknown>) => ['finance', 'entries', filters] as const,
  financeSalaries: (filters: Record<string, unknown>) => ['finance', 'salaries', filters] as const,
  financeEmployees: (includeInactive?: boolean) =>
    ['finance', 'employees', { includeInactive: includeInactive ?? false }] as const,
  financeSalaryRevisions: (employeeId: string) => ['finance', 'salaryRevisions', employeeId] as const,
  financePartnerExpenses: (filters: Record<string, unknown>) =>
    ['finance', 'partnerExpenses', filters] as const,
  financePartners: (includeInactive?: boolean) =>
    ['finance', 'partners', { includeInactive: includeInactive ?? false }] as const,
  financePartnerShareSummary: (from?: string, to?: string) =>
    ['finance', 'partnerShareSummary', { from: from ?? null, to: to ?? null }] as const,
  financeBranchShare: (filters: Record<string, unknown>) => ['finance', 'branchShare', filters] as const,
  /** What each branch is still owed, derived from the ledger rather than stored. */
  financeBranchShareBalances: (branchId?: string) =>
    ['finance', 'branchShareBalances', branchId ?? 'all'] as const,
  financeClosing: (businessDate?: string | null) =>
    ['finance', 'closing', businessDate ?? 'today'] as const,
  financeClosingHistory: (days?: number) => ['finance', 'closingHistory', days ?? 30] as const,
  financeSettings: () => ['finance', 'settings'] as const,
  financeAudit: (filters: Record<string, unknown>) => ['finance', 'audit', filters] as const,
  financeReport: (query: Record<string, unknown>) => ['finance', 'report', query] as const,
  // Help Desk. The queue key carries its filters for the same reason the ledger's
  // does; the lookup is keyed by the reference number so typing a second one does
  // not serve the first one's figures under the new heading.
  financeTickets: (filters: Record<string, unknown>) => ['finance', 'tickets', filters] as const,
  financeTicketLookup: (referenceNo: string) => ['finance', 'ticketLookup', referenceNo] as const,
};

/** Prefix that matches every finance cache entry. See the note above. */
export const FINANCE_QK_ROOT = ['finance'] as const;
