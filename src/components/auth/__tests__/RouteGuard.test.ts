import { describe, expect, test, vi } from 'vitest';

// Only the pure routing rule is under test; the component's hooks are not rendered.
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ replace: () => {} }) }));

import { redirectFor } from '../RouteGuard';

const as = (role: string) => ({ role, mustChangePassword: false });

describe('redirectFor — Production screens', () => {
  test('an admin opening Production from the admin menu stays on the Production Dashboard', () => {
    expect(redirectFor('/production-dashboard', as('super_admin'))).toBeNull();
  });

  test("Production's other screens still send an admin to the Admin Dashboard", () => {
    for (const path of ['/production-orders', '/production-stock', '/production-returns', '/production-discounts', '/production-sales']) {
      expect(redirectFor(path, as('super_admin'))).toBe('/dashboard');
    }
  });

  test('a production user keeps every Production screen', () => {
    expect(redirectFor('/production-dashboard', as('production_user'))).toBeNull();
    expect(redirectFor('/production-orders', as('production_user'))).toBeNull();
  });

  test('branch and finance roles are still kept out of the Production Dashboard', () => {
    expect(redirectFor('/production-dashboard', as('branch_manager'))).toBe('/branch-dashboard');
    expect(redirectFor('/production-dashboard', as('finance_admin'))).toBe('/finance-dashboard');
  });

  test("the admin's own home is unchanged", () => {
    expect(redirectFor('/dashboard', as('super_admin'))).toBeNull();
    expect(redirectFor('/', as('super_admin'))).toBe('/dashboard');
  });

  test('signed out, the Production Dashboard still goes to login', () => {
    expect(redirectFor('/production-dashboard', null)).toBe('/login');
  });
});
