import { ROUTES } from './routes';
import { canAccessFinance, isFinanceRole, USER_ROLES, type UserRole } from '@mb/shared';

/**
 * Every role the app recognises. Anything else is not a valid session.
 *
 * Built from the shared USER_ROLES list rather than a literal, so the four
 * Finance Ledger roles could not be added to the union without also becoming
 * valid here. The literal version fails CLOSED but silently — a correctly
 * provisioned finance account would be signed straight back out with "no role
 * assigned", and nothing would point at this line.
 */
export const VALID_ROLES = new Set<string>(USER_ROLES);

/** Re-exported so screens can gate finance UI without reaching into @mb/shared. */
export { canAccessFinance, isFinanceRole };

export function isValidRole(role: unknown): role is UserRole {
  return typeof role === 'string' && VALID_ROLES.has(role);
}

/**
 * Landing page for each role — the SINGLE source of truth.
 *
 * Imported by both `src/components/auth/RouteGuard.tsx` (for `/` and `/login`
 * redirects) and the login page. These previously disagreed for `production_user`:
 * the guard — then middleware — sent them to /production-queue while the login page
 * sent them to /production-dashboard, so where a production user landed depended on
 * how they arrived. Unified on the dashboard, consistent with the other two roles.
 */
export function getRoleHome(role: string): string {
  switch (role) {
    case 'super_admin':
      return ROUTES.DASHBOARD;
    case 'branch_manager':
      return ROUTES.BRANCH_DASHBOARD;
    // A shift account has no dashboard — the branch dashboard is the manager's
    // overview screen and is not one of the six things a branch_user may open.
    // So it lands on the first item of its own nav instead.
    case 'branch_user':
      return ROUTES.BRANCH_NEW_ORDERS;
    case 'production_user':
      return ROUTES.PRODUCTION_DASHBOARD;
    // All four finance roles share one home. They differ in what they may DO on
    // each screen (financeCan), not in which screens exist — a Read Only Auditor
    // sees the same dashboard as a Finance Admin, with the action buttons gone.
    case 'finance_admin':
    case 'finance_manager':
    case 'accountant':
    case 'finance_auditor':
      return ROUTES.FINANCE_DASHBOARD;
    default:
      return ROUTES.LOGIN;
  }
}
