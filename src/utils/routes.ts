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
  PRODUCTION_EXPENSES: '/production-expenses',
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
  BRANCH_EXPENSES: '/branch-expenses',
  BRANCH_ORDERS: '/branch-orders',
  BRANCH_CUSTOMERS: '/branch-customers',
  BRANCH_REPORTS: '/branch-reports',
  BRANCH_HELP_DESK: '/branch-help-desk',
  BRANCH_EVENTS: '/branch-events',
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];

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
