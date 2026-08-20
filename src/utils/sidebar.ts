import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Tag,
  Users,
  Store,
  BarChart3,
  Settings,
  Factory,
  ClipboardList,
  Receipt,
  Boxes,
  Undo2,
  FileSpreadsheet,
  History,
  LifeBuoy,
  Headset,
  Send,
  CalendarDays,
  MapPin,
  BookOpenCheck,
  Wallet,
  Landmark,
  UserCog,
  UserPlus,
  HandCoins,
  ListTree,
  CalendarCheck,
  ShieldCheck,
} from 'lucide-react';
import type { UserRole } from '@mb/shared';
import { ROUTES, normalizePath } from './routes';

export type NavItem = {
  label: string;
  href: string;
  icon: React.ElementType;
};

export const ADMIN_NAV: NavItem[] = [
  { label: 'Dashboard',       href: ROUTES.DASHBOARD,        icon: LayoutDashboard },
  { label: 'Orders',          href: ROUTES.ORDERS,           icon: ShoppingCart },
  { label: 'Products',        href: ROUTES.PRODUCTS,         icon: Package },
  { label: 'Categories',      href: ROUTES.CATEGORIES,       icon: Tag },
  { label: 'Price List',      href: ROUTES.PRICE_LIST,       icon: FileSpreadsheet },
  { label: 'Price History',   href: ROUTES.PRICE_HISTORY,    icon: History },
  { label: 'Customers',       href: ROUTES.CUSTOMERS,        icon: Users },
  { label: 'Branches',        href: ROUTES.BRANCHES,         icon: Store },
  { label: 'Branch Locations', href: ROUTES.BRANCH_LOCATIONS, icon: MapPin },
  { label: 'Branch Stock',    href: ROUTES.STOCK_CONTROL,   icon: Boxes },
  { label: 'Production',      href: ROUTES.PRODUCTION_DASHBOARD, icon: Factory },
  { label: 'Special Events',  href: ROUTES.SPECIAL_EVENTS,   icon: CalendarDays },
  { label: 'Reports',         href: ROUTES.REPORTS,          icon: BarChart3 },
  { label: 'Support Center',  href: ROUTES.SUPPORT_CENTER,   icon: LifeBuoy },
  { label: 'Recipients',      href: ROUTES.NOTIFICATION_RECIPIENTS, icon: Send },
  { label: 'Finance Ledger',  href: ROUTES.FINANCE_DASHBOARD, icon: BookOpenCheck },
  { label: 'Users',           href: ROUTES.USERS,            icon: Users },
  { label: 'Account Requests', href: ROUTES.USER_REQUESTS,   icon: UserPlus },
  { label: 'Settings',        href: ROUTES.SETTINGS,         icon: Settings },
];

/**
 * Finance Ledger navigation.
 *
 * ONE list for all four finance roles. They see the same screens and differ only
 * in which actions are offered once inside — hiding Reports from an Accountant
 * or Settings from an Auditor would leave them staring at a nav that changes
 * shape depending on who is logged in, with no way to tell whether a screen is
 * missing or they simply lack the grant. financeCan() disables the buttons; the
 * nav stays honest.
 *
 * Ordered the way the work flows: see the position, read the book, deal with
 * what is waiting, then the periodic and administrative screens.
 */
export const FINANCE_NAV: NavItem[] = [
  { label: 'Dashboard',        href: ROUTES.FINANCE_DASHBOARD,         icon: LayoutDashboard },
  { label: 'Daily Ledger',     href: ROUTES.FINANCE_LEDGER,            icon: BookOpenCheck },
  { label: 'Branch Income',    href: ROUTES.FINANCE_INCOME,            icon: Landmark },
  { label: 'Income & Expense', href: ROUTES.FINANCE_ENTRIES,           icon: Wallet },
  { label: 'Salaries',         href: ROUTES.FINANCE_SALARIES,          icon: UserCog },
  { label: 'Company Transaction Details', href: ROUTES.FINANCE_PARTNER_EXPENSES,  icon: HandCoins },
  { label: 'Ledger Heads',     href: ROUTES.FINANCE_HEADS,             icon: ListTree },
  { label: 'Daily Closing',    href: ROUTES.FINANCE_CLOSING,           icon: CalendarCheck },
  { label: 'Reports',          href: ROUTES.FINANCE_REPORTS,           icon: BarChart3 },
  { label: 'Audit Trail',      href: ROUTES.FINANCE_AUDIT,             icon: ShieldCheck },
  { label: 'Help Desk',        href: ROUTES.FINANCE_HELP_DESK,         icon: Headset },
  { label: 'Settings',         href: ROUTES.FINANCE_SETTINGS,          icon: Settings },
];

export const BRANCH_NAV: NavItem[] = [
  { label: 'Dashboard',     href: ROUTES.BRANCH_DASHBOARD,   icon: LayoutDashboard },
  { label: 'New Orders',    href: ROUTES.BRANCH_NEW_ORDERS,  icon: ClipboardList },
  { label: 'Sales',         href: ROUTES.BRANCH_SALES,       icon: ShoppingCart },
  { label: 'Stock',         href: ROUTES.BRANCH_STOCK,       icon: Boxes },
  { label: 'Shop Expenses', href: ROUTES.BRANCH_EXPENSES,    icon: Receipt },
  { label: 'Events',        href: ROUTES.BRANCH_EVENTS,      icon: CalendarDays },
  { label: 'Branch Closing',href: ROUTES.BRANCH_CLOSING,     icon: CalendarCheck },
  { label: 'Shift Accounts',href: ROUTES.BRANCH_USERS,       icon: UserCog },
  { label: 'Reports',       href: ROUTES.BRANCH_REPORTS,     icon: BarChart3 },
  { label: 'Help Desk',     href: ROUTES.BRANCH_HELP_DESK,   icon: Headset },
];

/**
 * A shift account's nav — the six screens the brief names, and nothing else.
 *
 * It is a strict SUBSET of BRANCH_NAV pointing at the very same routes, because
 * a branch_user carries the same `branchId` as the manager who requested it and
 * so reads the same branch's data. What is missing is the point: no Dashboard,
 * no Reports, no Help Desk, and no way back into this queue to request further
 * accounts.
 *
 * This list is presentation only. RouteGuard enforces the same subset on
 * navigation, and the API re-decides every request against the JWT — a shift
 * account that types /branch-reports gets bounced by the guard and would get a
 * 403 from the reports router regardless.
 */
export const BRANCH_USER_NAV: NavItem[] = [
  { label: 'New Orders',     href: ROUTES.BRANCH_NEW_ORDERS, icon: ClipboardList },
  { label: 'Sales',          href: ROUTES.BRANCH_SALES,      icon: ShoppingCart },
  { label: 'Stock',          href: ROUTES.BRANCH_STOCK,      icon: Boxes },
  { label: 'Shop Expenses',  href: ROUTES.BRANCH_EXPENSES,   icon: Receipt },
  { label: 'Events',         href: ROUTES.BRANCH_EVENTS,     icon: CalendarDays },
  { label: 'Branch Closing', href: ROUTES.BRANCH_CLOSING,    icon: CalendarCheck },
];

export const PRODUCTION_NAV: NavItem[] = [
  { label: 'Dashboard',         href: ROUTES.PRODUCTION_DASHBOARD,     icon: LayoutDashboard },
  { label: 'Orders',            href: ROUTES.PRODUCTION_ORDERS,        icon: ClipboardList },
  { label: 'Sales',             href: ROUTES.PRODUCTION_SALES,         icon: ShoppingCart },
  { label: 'Production Stock',  href: ROUTES.PRODUCTION_STOCK,         icon: Factory },
  { label: 'Branch Stock',      href: ROUTES.PRODUCTION_BRANCH_STOCK,  icon: Boxes },
  { label: 'Returns',           href: ROUTES.PRODUCTION_RETURNS,       icon: Undo2 },
  { label: 'Events',            href: ROUTES.PRODUCTION_EVENTS,        icon: CalendarDays },
  { label: 'Reports',           href: ROUTES.PRODUCTION_REPORTS,       icon: BarChart3 },
  { label: 'Help Desk',         href: ROUTES.PRODUCTION_HELP_DESK,     icon: Headset },
];

export const NAV_MAP: Record<UserRole, NavItem[]> = {
  super_admin:     ADMIN_NAV,
  branch_manager:  BRANCH_NAV,
  branch_user:     BRANCH_USER_NAV,
  production_user: PRODUCTION_NAV,
  finance_admin:   FINANCE_NAV,
  finance_manager: FINANCE_NAV,
  accountant:      FINANCE_NAV,
  finance_auditor: FINANCE_NAV,
};

export function getNavItems(role: UserRole): NavItem[] {
  return NAV_MAP[role] ?? [];
}

/**
 * The four destinations that get a permanent tab in the mobile bottom nav.
 *
 * The full nav is 14 / 7 / 9 items depending on role, which does not fit a bottom
 * bar — four tabs plus a "More" tab is the most that stays tappable at 360px. So
 * these are the daily-driver screens per role; everything else is one tap further
 * away behind More, which shows the complete `NAV_MAP` list.
 *
 * Order matters: it is the left-to-right tab order. Hrefs must exist in that
 * role's NAV_MAP — `getPrimaryNavItems` drops any that don't rather than
 * rendering a tab that 404s or that RouteGuard would bounce.
 */
const FINANCE_PRIMARY: string[] = [
  ROUTES.FINANCE_DASHBOARD,
  ROUTES.FINANCE_LEDGER,
  ROUTES.FINANCE_INCOME,
  ROUTES.FINANCE_ENTRIES,
];

export const PRIMARY_NAV: Record<UserRole, string[]> = {
  super_admin: [ROUTES.DASHBOARD, ROUTES.ORDERS, ROUTES.PRODUCTS, ROUTES.REPORTS],
  branch_manager: [
    ROUTES.BRANCH_DASHBOARD,
    ROUTES.BRANCH_SALES,
    ROUTES.BRANCH_NEW_ORDERS,
    ROUTES.BRANCH_STOCK,
  ],
  // No dashboard to lead with, so the four are the shift's actual work: take an
  // order, ring a sale, check the shelf, close the day.
  branch_user: [
    ROUTES.BRANCH_SALES,
    ROUTES.BRANCH_NEW_ORDERS,
    ROUTES.BRANCH_STOCK,
    ROUTES.BRANCH_CLOSING,
  ],
  production_user: [
    ROUTES.PRODUCTION_DASHBOARD,
    ROUTES.PRODUCTION_ORDERS,
    ROUTES.PRODUCTION_STOCK,
    ROUTES.PRODUCTION_SALES,
  ],
  // The four screens a finance user opens every day. Everything else — heads,
  // audit, settings — is configuration or investigation and lives behind More.
  finance_admin:   FINANCE_PRIMARY,
  finance_manager: FINANCE_PRIMARY,
  accountant:      FINANCE_PRIMARY,
  finance_auditor: FINANCE_PRIMARY,
};

/**
 * Whether a nav item should render as the current page.
 *
 * Prefix matching is what makes a nested route keep its parent tab highlighted,
 * but the dashboards are excluded from it: their hrefs are prefixes of nothing
 * useful, and `/production-dashboard`.startsWith() would light up alongside the
 * real match. Shared by the sidebar and the bottom nav so the two can never
 * disagree about which item is active.
 */
export function isNavItemActive(pathname: string, href: string): boolean {
  const path = normalizePath(pathname);
  if (path === href) return true;
  if (href.endsWith('-dashboard') || href === ROUTES.DASHBOARD) return false;
  return path.startsWith(href);
}

/** The bottom-nav tabs for a role, resolved against NAV_MAP and in PRIMARY_NAV order. */
export function getPrimaryNavItems(role: UserRole): NavItem[] {
  const items = getNavItems(role);
  return (PRIMARY_NAV[role] ?? [])
    .map((href) => items.find((item) => item.href === href))
    .filter((item): item is NavItem => item !== undefined);
}
