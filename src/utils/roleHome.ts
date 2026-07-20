import { ROUTES } from './routes';
import type { UserRole } from '@mb/shared';

/** The three roles the app recognises. Anything else is not a valid session. */
export const VALID_ROLES = new Set<string>(['super_admin', 'branch_manager', 'production_user']);

export function isValidRole(role: unknown): role is UserRole {
  return typeof role === 'string' && VALID_ROLES.has(role);
}

/**
 * Landing page for each role — the SINGLE source of truth.
 *
 * Imported by both `src/proxy.ts` (for `/` and `/login` redirects) and the login
 * page. These previously disagreed for `production_user`: the proxy sent them to
 * /production-queue while the login page sent them to /production-dashboard, so
 * where a production user landed depended on how they arrived. Unified on the
 * dashboard, consistent with the other two roles.
 */
export function getRoleHome(role: string): string {
  switch (role) {
    case 'super_admin':
      return ROUTES.DASHBOARD;
    case 'branch_manager':
      return ROUTES.BRANCH_DASHBOARD;
    case 'production_user':
      return ROUTES.PRODUCTION_DASHBOARD;
    default:
      return ROUTES.LOGIN;
  }
}
