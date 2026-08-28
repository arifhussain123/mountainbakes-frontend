// Centralised route definitions — import from here, never hardcode paths
export const ROUTES = {
  // Auth
  LOGIN: '/login',

  // Admin
  DASHBOARD: '/dashboard',
  ORDERS: '/orders',
  PRODUCTS: '/products',
  CATEGORIES: '/categories',
  PRICE_LIST: '/price-list',
  PRICE_HISTORY: '/price-history',
  CUSTOMERS: '/customers',
  BRANCHES: '/branches',
  /**
   * Admin → Branch Locations. The path is '/geofencing', NOT '/branch-locations':
   * RouteGuard maps every '/branch-*' prefix to the branch_manager role, so an
   * admin route under that prefix would bounce a super admin to their own home
   * page — silently, and only once deployed. The API path is still
   * /api/branch-locations; only this app's own URL had to move.
   */
  BRANCH_LOCATIONS: '/geofencing',
  /**
   * Admin → Branch Stock. Direct control over any branch's stock ledger.
   *
   * The path is '/stock-control', NOT '/branch-stock-admin' or anything else
   * beginning '/branch-': RouteGuard maps every '/branch-' prefix to the branch
   * roles, so an admin screen under it would bounce a super admin to their own
   * home page — the exact trap BRANCH_LOCATIONS documents above. '/branch-stock'
   * itself is taken by the branch's own read-only page.
   */
  STOCK_CONTROL: '/stock-control',
  PRODUCTION_QUEUE: '/production-queue',
  REPORTS: '/reports',
  SUPPORT_CENTER: '/support',
  NOTIFICATION_RECIPIENTS: '/notification-recipients',
  SPECIAL_EVENTS: '/special-events',

  // Production module
  PRODUCTION_DASHBOARD: '/production-dashboard',
  PRODUCTION_ORDERS: '/production-orders',
  PRODUCTION_SALES: '/production-sales',
  PRODUCTION_STOCK: '/production-stock',
  PRODUCTION_BRANCH_STOCK: '/production-branch-stock',
  PRODUCTION_RETURNS: '/production-returns',
  /**
   * Production → Discounts. The board of money branches are claiming back
   * against demands, reviewed exactly as returns are.
   *
   * The '/production-' prefix is doing real work here, not naming: RouteGuard
   * maps it to production_user, so this screen is guarded by being called this
   * and would be open to every role under any other name — the same rule
   * ROUTES.BRANCH_LOCATIONS documents from the other direction. There is no
   * branch sibling to confuse it with; a branch raises and corrects its claims
   * inside the New Orders page rather than on a page of their own.
   */
  PRODUCTION_DISCOUNTS: '/production-discounts',
  PRODUCTION_REPORTS: '/production-reports',
  PRODUCTION_HELP_DESK: '/production-help-desk',
  PRODUCTION_EVENTS: '/production-events',
  USERS: '/users',
  SETTINGS: '/settings',

  // Branch
  BRANCH_DASHBOARD: '/branch-dashboard',
  BRANCH_NEW_ORDERS: '/branch-new-orders',
  BRANCH_SALES: '/branch-sales',
  BRANCH_STOCK: '/branch-stock',
  /**
   * Branch → Return Stock. The branch's own log of stock it has sent back to
   * production, and the only place it can correct one.
   *
   * The path deliberately starts '/branch-' so RouteGuard's prefix rule covers
   * it. Note the sibling it is NOT: '/production-returns' is Production's board
   * of every branch's returns, behind a production-only router — these two read
   * the same table and are not interchangeable.
   */
  BRANCH_RETURN_STOCK: '/branch-return-stock',
  BRANCH_EXPENSES: '/branch-expenses',
  BRANCH_ORDERS: '/branch-orders',
  BRANCH_CUSTOMERS: '/branch-customers',
  BRANCH_REPORTS: '/branch-reports',
  BRANCH_HELP_DESK: '/branch-help-desk',
  BRANCH_EVENTS: '/branch-events',
  // Read-only end-of-day summary for the branch. Composed on the client from the
  // sales / expenses / stock a branch account can already read — it is a view of
  // the day, not the business-day *closure*, which stays admin-only.
  BRANCH_CLOSING: '/branch-closing',
  // Where a manager asks Admin for a shift account, and watches the outcome.
  BRANCH_USERS: '/branch-users',
  // The admin side of that same queue.
  USER_REQUESTS: '/user-requests',

  /**
   * Finance Ledger.
   *
   * Every path is under the '/finance-' prefix, which RouteGuard maps to the
   * finance roles the same way '/branch-' and '/production-' work. That is the
   * reason there is no '/ledger' or '/salaries' here: an unprefixed finance
   * route would fall through to the admin allowlist and be unguarded, exactly
   * the trap ROUTES.BRANCH_LOCATIONS documents from the other direction.
   */
  FINANCE_LOGIN: '/finance-login',
  FINANCE_DASHBOARD: '/finance-dashboard',
  FINANCE_LEDGER: '/finance-ledger',
  FINANCE_INCOME: '/finance-income',
  FINANCE_ENTRIES: '/finance-entries',
  FINANCE_SALARIES: '/finance-salaries',
  FINANCE_PARTNER_EXPENSES: '/finance-partner-expenses',
  FINANCE_HEADS: '/finance-heads',
  FINANCE_CLOSING: '/finance-closing',
  FINANCE_REPORTS: '/finance-reports',
  FINANCE_AUDIT: '/finance-audit',
  FINANCE_HELP_DESK: '/finance-help-desk',
  FINANCE_SETTINGS: '/finance-settings',
} as const;


/**
 * Strip the trailing slash so a live pathname can be compared against ROUTES.
 *
 * next.config.ts sets `trailingSlash: true` (the static export emits directories,
 * not .html files), which means `usePathname()` can hand back '/dashboard/' while
 * every path in ROUTES is written without the slash. Left unnormalised, that is a
 * silent failure: nav items stop highlighting, page headings vanish, and RouteGuard
 * stops recognising '/login'. Normalise wherever a pathname meets a ROUTES value.
 *
 * '/' is preserved — it is the one route whose slash is the path.
 */
export function normalizePath(pathname: string): string {
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
}

/**
 * The single id the /special-events/[id] shell is built at under `output: 'export'`.
 *
 * A static export must know every path it emits, and event ids are runtime data, so
 * one shell is emitted here and Firebase Hosting rewrites every real event URL onto
 * it (see `rewrites` in firebase.json); EventDetailRoute then reads the actual id
 * back out of the address bar.
 *
 * It lives in this module — not next to the component that consumes it — because
 * `generateStaticParams` runs on the server: importing it from a `'use client'`
 * file hands the build a client reference instead of the string, which fails with
 * "a required parameter (id) was not provided as a string".
 *
 * Underscores keep it from ever colliding with a real UUID.
 */
export const EVENT_ID_PLACEHOLDER = '__event__';
