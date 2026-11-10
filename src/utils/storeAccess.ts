import { isFinanceRole } from '@mb/shared';
import { ROUTES, normalizePath } from './routes';

/**
 * Which Dry Items Store pages a role may open — the routing half of storeCan()
 * (shared/types/store.types.ts). Navigation UX only: the API re-decides every
 * call against the caller's role and account switches.
 *
 *   Admin        every page, including Accounts and Settings.
 *   Store keeper every page but Accounts and Settings.
 *   Finance      reads: dashboard, items, prices, stock, ledger, reports.
 *   anyone else  none (Production's screen is /production-dry-demand).
 */
const ADMIN_ONLY = new Set<string>([ROUTES.STORE_ACCOUNTS, ROUTES.STORE_SETTINGS]);
const FINANCE_READ = new Set<string>([
  ROUTES.STORE_DASHBOARD,
  ROUTES.STORE_ITEMS,
  ROUTES.STORE_PRICES,
  ROUTES.STORE_STOCK,
  ROUTES.STORE_LEDGER,
  ROUTES.STORE_REPORTS,
]);

export function canOpenStorePage(role: string, pathname: string): boolean {
  const path = normalizePath(pathname);
  if (role === 'super_admin') return true;
  if (role === 'store_user') return !ADMIN_ONLY.has(path);
  if (isFinanceRole(role)) return FINANCE_READ.has(path);
  return false;
}
