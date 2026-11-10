import { describe, expect, test, vi } from 'vitest';

// Only the pure routing rule is under test; the component's hooks are not rendered.
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/', useRouter: () => ({ replace: () => {} }) }));

import { redirectFor } from '../RouteGuard';

const as = (role: string) => ({ role, mustChangePassword: false });

describe('redirectFor — Production screens', () => {
  test("an admin's old Production Dashboard link opens the Admin Dashboard's Production tab", () => {
    expect(redirectFor('/production-dashboard', as('super_admin'))).toBe('/dashboard?section=production');
  });

  test("an admin's old Finance Dashboard link opens the Admin Dashboard's Finance tab", () => {
    expect(redirectFor('/finance-dashboard', as('super_admin'))).toBe('/dashboard?section=finance');
  });

  test('an admin keeps the Finance Ledger screens', () => {
    expect(redirectFor('/finance-ledger', as('super_admin'))).toBeNull();
  });

  test('an accountant is kept off the Daily Ledger; the other finance roles keep it', () => {
    expect(redirectFor('/finance-ledger', as('accountant'))).toBe('/finance-dashboard');
    expect(redirectFor('/finance-ledger/', as('accountant'))).toBe('/finance-dashboard');
    expect(redirectFor('/finance-entries', as('accountant'))).toBeNull();
    for (const role of ['finance_admin', 'finance_manager', 'finance_auditor']) {
      expect(redirectFor('/finance-ledger', as(role))).toBeNull();
    }
  });

  test('finance roles keep their own Finance Dashboard', () => {
    expect(redirectFor('/finance-dashboard', as('finance_admin'))).toBeNull();
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

describe('redirectFor — the supplier portal', () => {
  test('is public: a signed-out supplier is not sent to login', () => {
    expect(redirectFor('/supplier-portal', null)).toBeNull();
    // `trailingSlash: true` serves it as /supplier-portal/; RouteGuard normalises first.
    expect(redirectFor('/supplier-portal/', null)).toBeNull();
  });

  test('stays open to a signed-in staff user instead of bouncing them to their dashboard', () => {
    for (const role of ['super_admin', 'production_user', 'branch_manager', 'finance_admin', 'accountant']) {
      expect(redirectFor('/supplier-portal', as(role))).toBeNull();
    }
  });

  test('is not held behind a pending password change', () => {
    expect(redirectFor('/supplier-portal', { role: 'production_user', mustChangePassword: true })).toBeNull();
  });

  test('does not open a look-alike path', () => {
    expect(redirectFor('/supplier-portal-admin', null)).toBe('/login');
  });
});

describe('redirectFor — Dry Items Store', () => {
  test('a Store keeper lands on the Store Dashboard and keeps every Store page but Accounts and Settings', () => {
    expect(redirectFor('/', as('store_user'))).toBe('/store-dashboard');
    for (const path of ['/store-dashboard', '/store-items', '/store-prices', '/store-receiving', '/store-stock', '/store-approval', '/store-ledger/', '/store-queries', '/store-reports']) {
      expect(redirectFor(path, as('store_user'))).toBeNull();
    }
    expect(redirectFor('/store-accounts', as('store_user'))).toBe('/store-dashboard');
    expect(redirectFor('/store-settings', as('store_user'))).toBe('/store-dashboard');
  });

  test('a Store keeper is kept off admin, branch, production and finance screens', () => {
    for (const path of ['/dashboard', '/users', '/branch-sales', '/production-dry-demand', '/finance-ledger']) {
      expect(redirectFor(path, as('store_user'))).toBe('/store-dashboard');
    }
  });

  test('Admin opens every Store page, Accounts and Settings included', () => {
    for (const path of ['/store-dashboard', '/store-approval', '/store-accounts', '/store-settings']) {
      expect(redirectFor(path, as('super_admin'))).toBeNull();
    }
  });

  test('Finance reads the Store but does not receive, approve or open its accounts', () => {
    for (const path of ['/store-dashboard', '/store-items', '/store-prices', '/store-stock', '/store-ledger', '/store-reports']) {
      expect(redirectFor(path, as('finance_manager'))).toBeNull();
    }
    for (const path of ['/store-receiving', '/store-approval', '/store-queries', '/store-accounts']) {
      expect(redirectFor(path, as('accountant'))).toBe('/finance-dashboard');
    }
  });

  test('Production raises dry-items demand on its own screen and cannot open the Store', () => {
    expect(redirectFor('/production-dry-demand', as('production_user'))).toBeNull();
    expect(redirectFor('/store-approval', as('production_user'))).toBe('/production-dashboard');
    expect(redirectFor('/store-dashboard', as('branch_manager'))).toBe('/branch-dashboard');
  });
});
