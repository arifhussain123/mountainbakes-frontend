import { ROUTES, normalizePath } from './routes';

/**
 * Topbar heading per route.
 *
 * The Topbar used to be re-rendered by each of the 32 page files purely so it
 * could be handed a `title` prop. It now lives once in the dashboard layout and
 * reads the title from here, which is why this map exists rather than the titles
 * being derived from `NAV_MAP`: several deliberately differ from their nav label
 * ("Orders" → "All Orders", "Reports" → "Reports & Analytics"), and three routes
 * (branch-orders, branch-customers, production-queue) have no nav entry at all.
 *
 * A route missing from this map renders no heading, which is the same thing the
 * old `{title && …}` guard did for a page that passed no title.
 */
export const PAGE_TITLES: Record<string, string> = {
  // Admin
  [ROUTES.DASHBOARD]: 'Dashboard',
  [ROUTES.ORDERS]: 'All Orders',
  [ROUTES.PRODUCTS]: 'Products',
  [ROUTES.CATEGORIES]: 'Categories',
  [ROUTES.PRICE_LIST]: 'Price List',
  [ROUTES.PRICE_HISTORY]: 'Price History',
  [ROUTES.CUSTOMERS]: 'Customers',
  [ROUTES.BRANCHES]: 'Branches',
  [ROUTES.BRANCH_LOCATIONS]: 'Branch Locations',
  [ROUTES.STOCK_CONTROL]: 'Branch Stock Control',
  [ROUTES.REPORTS]: 'Reports & Analytics',
  [ROUTES.SUPPORT_CENTER]: 'Support Center',
  [ROUTES.NOTIFICATION_RECIPIENTS]: 'Notification Recipients',
  // /special-events/<id> is deliberately absent: a dynamic route cannot have a
  // static title here, so EventDetailPage renders its own heading.
  [ROUTES.SPECIAL_EVENTS]: 'Special Events',
  [ROUTES.USERS]: 'Users',
  [ROUTES.SETTINGS]: 'Settings',

  // Branch
  [ROUTES.BRANCH_DASHBOARD]: 'Branch Dashboard',
  [ROUTES.BRANCH_NEW_ORDERS]: 'New Orders',
  [ROUTES.BRANCH_SALES]: 'Sales',
  [ROUTES.BRANCH_STOCK]: 'Stock',
  [ROUTES.BRANCH_RETURN_STOCK]: 'Return Stock',
  [ROUTES.BRANCH_DISCOUNTS]: 'Discounts',
  [ROUTES.BRANCH_EXPENSES]: 'Shop Expenses',
  [ROUTES.BRANCH_ORDERS]: 'Orders',
  [ROUTES.BRANCH_CUSTOMERS]: 'Customers',
  [ROUTES.BRANCH_REPORTS]: 'Branch Reports',
  [ROUTES.BRANCH_HELP_DESK]: 'Help Desk',
  [ROUTES.BRANCH_CLOSING]: 'Branch Closing',
  [ROUTES.BRANCH_USERS]: 'Shift Accounts',
  [ROUTES.USER_REQUESTS]: 'Account Requests',
  [ROUTES.BRANCH_EVENTS]: 'Special Events',

  // Production
  [ROUTES.PRODUCTION_DASHBOARD]: 'Production Dashboard',
  [ROUTES.PRODUCTION_ORDERS]: 'Production Orders',
  [ROUTES.PRODUCTION_SALES]: 'Sales',
  [ROUTES.PRODUCTION_STOCK]: 'Production Stock',
  [ROUTES.PRODUCTION_BRANCH_STOCK]: 'Branch Stock',
  [ROUTES.PRODUCTION_RETURNS]: 'Product Returns',
  [ROUTES.PRODUCTION_DISCOUNTS]: 'Discounts',
  [ROUTES.PRODUCTION_REPORTS]: 'Production Reports',
  [ROUTES.PRODUCTION_HELP_DESK]: 'Help Desk',
  [ROUTES.PRODUCTION_EVENTS]: 'Special Events',
  [ROUTES.PRODUCTION_QUEUE]: 'Production Queue',

  // Finance Ledger. Several deliberately differ from their nav label — the nav
  // has a column of finance items and does not need to say "Finance" eleven
  // times, whereas the page heading is read on its own.
  [ROUTES.FINANCE_DASHBOARD]: 'Finance Dashboard',
  [ROUTES.FINANCE_LEDGER]: 'Daily Ledger',
  [ROUTES.FINANCE_INCOME]: 'Branch Income Approvals',
  [ROUTES.FINANCE_ENTRIES]: 'Income & Expense Entries',
  [ROUTES.FINANCE_SALARIES]: 'Salary Ledger',
  [ROUTES.FINANCE_PARTNER_EXPENSES]: 'Company Transaction Details',
  [ROUTES.FINANCE_HEADS]: 'Ledger Heads',
  [ROUTES.FINANCE_CLOSING]: 'Daily Closing',
  [ROUTES.FINANCE_REPORTS]: 'Finance Reports',
  [ROUTES.FINANCE_AUDIT]: 'Audit Trail',
  [ROUTES.FINANCE_HELP_DESK]: 'Finance Help Desk',
  [ROUTES.FINANCE_SETTINGS]: 'Finance Settings',
};

export function getPageTitle(pathname: string): string | undefined {
  return PAGE_TITLES[normalizePath(pathname)];
}
