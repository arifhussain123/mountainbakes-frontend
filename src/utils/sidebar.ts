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
} from 'lucide-react';
import type { UserRole } from '@mb/shared';
import { ROUTES } from './routes';

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
  { label: 'Production',      href: ROUTES.PRODUCTION_DASHBOARD, icon: Factory },
  { label: 'Reports',         href: ROUTES.REPORTS,          icon: BarChart3 },
  { label: 'Support Center',  href: ROUTES.TICKETS,          icon: LifeBuoy },
  { label: 'Users',           href: ROUTES.USERS,            icon: Users },
  { label: 'Settings',        href: ROUTES.SETTINGS,         icon: Settings },
];

export const BRANCH_NAV: NavItem[] = [
  { label: 'Dashboard',     href: ROUTES.BRANCH_DASHBOARD,   icon: LayoutDashboard },
  { label: 'New Orders',    href: ROUTES.BRANCH_NEW_ORDERS,  icon: ClipboardList },
  { label: 'Sales',         href: ROUTES.BRANCH_SALES,       icon: ShoppingCart },
  { label: 'Stock',         href: ROUTES.BRANCH_STOCK,       icon: Boxes },
  { label: 'Shop Expenses', href: ROUTES.BRANCH_EXPENSES,    icon: Receipt },
  { label: 'Reports',       href: ROUTES.BRANCH_REPORTS,     icon: BarChart3 },
  { label: 'Help Desk',     href: ROUTES.BRANCH_TICKETS,     icon: LifeBuoy },
];

export const PRODUCTION_NAV: NavItem[] = [
  { label: 'Dashboard',         href: ROUTES.PRODUCTION_DASHBOARD,     icon: LayoutDashboard },
  { label: 'Orders',            href: ROUTES.PRODUCTION_ORDERS,        icon: ClipboardList },
  { label: 'Production Stock',  href: ROUTES.PRODUCTION_STOCK,         icon: Factory },
  { label: 'Branch Stock',      href: ROUTES.PRODUCTION_BRANCH_STOCK,  icon: Boxes },
  { label: 'Returns',           href: ROUTES.PRODUCTION_RETURNS,       icon: Undo2 },
  { label: 'Expenses',          href: ROUTES.PRODUCTION_EXPENSES,      icon: Receipt },
  { label: 'Reports',           href: ROUTES.PRODUCTION_REPORTS,       icon: BarChart3 },
  { label: 'Help Desk',         href: ROUTES.PRODUCTION_TICKETS,       icon: LifeBuoy },
];

export const NAV_MAP: Record<UserRole, NavItem[]> = {
  super_admin:     ADMIN_NAV,
  branch_manager:  BRANCH_NAV,
  production_user: PRODUCTION_NAV,
};

export function getNavItems(role: UserRole): NavItem[] {
  return NAV_MAP[role] ?? [];
}
