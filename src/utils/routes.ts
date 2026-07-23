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
  PRODUCTION_QUEUE: '/production-queue',
  REPORTS: '/reports',
  SUPPORT_CENTER: '/support',

  // Production module
  PRODUCTION_DASHBOARD: '/production-dashboard',
  PRODUCTION_ORDERS: '/production-orders',
  PRODUCTION_STOCK: '/production-stock',
  PRODUCTION_BRANCH_STOCK: '/production-branch-stock',
  PRODUCTION_RETURNS: '/production-returns',
  PRODUCTION_EXPENSES: '/production-expenses',
  PRODUCTION_REPORTS: '/production-reports',
  PRODUCTION_HELP_DESK: '/production-help-desk',
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

  // Chat (future deep-link support)
  CHAT: '/chat',
} as const;

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES];
