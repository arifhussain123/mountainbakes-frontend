'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { canAccessFinance, getRoleHome } from '@/utils/roleHome';
import { normalizePath } from '@/utils/routes';
import { BRANCH_USER_NAV } from '@/utils/sidebar';
import { isBranchRole } from '@mb/shared';

/**
 * Client-side replacement for the old `src/proxy.ts` middleware.
 *
 * The app is a static export now (next.config.ts, `output: 'export'`), so there is
 * no server in front of a navigation and no first-party `mb_session` cookie to read
 * — the Supabase session in localStorage is the only identity the app has. This
 * component reproduces the middleware's decisions against that session and runs on
 * every route change.
 *
 * SECURITY: this is navigation UX, not an authorisation boundary. Anyone can fetch
 * the static HTML for /dashboard directly; what they cannot do is read any data,
 * because every request goes to the Express API which authorises the Supabase JWT
 * on its own. That was already the case under the middleware — the `mb_session`
 * cookie only ever decided which screen to show. Nothing secret is in the bundle.
 */

/** Paths reachable without a session. Matched by prefix, exactly as the proxy did. */
const PUBLIC_PATHS = [
  '/login',
  // The Finance Ledger's own sign-in. A separate screen because it asks for a
  // Finance User ID rather than an email and refuses any non-finance account —
  // see FinanceLoginPage. It must be public for the same reason /login is.
  '/finance-login',
  // Supabase password-recovery landing page. Must be public: the recovery token
  // arrives in the URL hash and the client exchanges it for a short-lived session,
  // so the visitor is legitimately signed out when they arrive.
  '/reset-password',
];

/**
 * Admin-only routes.
 *
 * An explicit allowlist, NOT derived from the (admin) route group — so a new admin
 * route that matches neither the '/branch-' nor the '/production-' prefix below is
 * unguarded until it is added here. '/special-events' is exactly that case; its
 * branch and production siblings (/branch-events, /production-events) are already
 * covered by the two prefix rules.
 */
const ADMIN_PREFIXES = [
  '/dashboard',
  '/users',
  // The admin side of the shift-account queue. Listed separately because
  // '/user-requests' does NOT start with '/users' — without this line the
  // allowlist would leave it open to every role, which is exactly the failure
  // mode the file header warns about.
  '/user-requests',
  '/branches',
  '/products',
  '/categories',
  '/customers',
  '/orders',
  '/reports',
  '/support',
  '/notification-recipients',
  '/special-events',
  '/settings',
  '/price-list',
  '/price-history',
  // Admin → Branch Stock. Same reason '/geofencing' is spelled out below: the
  // screen edits branch data but is admin-only, and naming it '/branch-…' would
  // have handed it to the '/branch-' rule and locked admins out of it.
  '/stock-control',
  // Admin → Branch Locations. Named '/geofencing' rather than '/branch-locations'
  // precisely so it does not collide with the '/branch-' rule below, which would
  // have bounced super admins off their own screen. See ROUTES.BRANCH_LOCATIONS.
  '/geofencing',
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Where the current identity should be, or null if the current path is already fine.
 * Pure, so the routing rules can be read in one place without the effect around them.
 */
function redirectFor(
  pathname: string,
  user: { role: string; mustChangePassword: boolean } | null
): string | null {
  if (!user) {
    // Not authenticated — everything except the public pages goes to /login.
    return isPublic(pathname) ? null : '/login';
  }

  const home = getRoleHome(user.role);

  // Forced password change gate — blocks all app routes until a new password is
  // set. Must come before normal role routing.
  if (user.mustChangePassword) {
    return pathname === '/change-password' ? null : '/change-password';
  }
  // Not required → keep users out of the change-password screen.
  if (pathname === '/change-password') return home;

  // Signed in: '/', '/login' and '/finance-login' all land on the role's home.
  // Bouncing an already-signed-in finance user off their own login screen is the
  // same courtesy /login gets, and it stops the "sign in, hit back, see the form
  // again" loop.
  if (pathname === '/' || pathname === '/login' || pathname === '/finance-login') return home;

  // /reset-password stays reachable while signed in: recovery establishes a real
  // session, so bouncing it to the role home would break the reset flow.
  if (pathname.startsWith('/reset-password')) return null;

  const wrongRole =
    (ADMIN_PREFIXES.some((p) => pathname.startsWith(p)) && user.role !== 'super_admin') ||
    // '/branch-' admits both shop-floor roles, but NOT equally: a branch_user
    // reaches only the six screens in BRANCH_USER_NAV. The prefix alone would
    // hand it the manager's Dashboard, Reports, Help Desk and the shift-account
    // queue, so the subset is checked explicitly here.
    //
    // Deriving the allowlist from the nav rather than repeating the six paths is
    // deliberate: the two cannot drift into disagreeing, and adding a screen to
    // a shift account is one edit, not two. The guard is still only navigation
    // UX — every one of those endpoints re-decides against the JWT server-side.
    (pathname.startsWith('/branch-') && !isBranchRole(user.role)) ||
    (pathname.startsWith('/branch-') &&
      user.role === 'branch_user' &&
      !BRANCH_USER_NAV.some((item) => pathname.startsWith(item.href))) ||
    (pathname.startsWith('/production-') && user.role !== 'production_user') ||
    // Finance Ledger. The only prefix rule that admits MORE than one role: all
    // four finance roles plus Super Admin, who the brief grants report access.
    // What each may actually do on those screens is decided per action by
    // financeCan(), and independently re-decided by the API — the difference
    // between a Read Only Auditor and a Finance Admin is not a routing concern.
    (pathname.startsWith('/finance-') && !canAccessFinance(user.role));

  return wrongRole ? home : null;
}

function FullScreenLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export function RouteGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  // `trailingSlash: true` means this can arrive as '/login/'; every rule below is
  // written against the unslashed form used in ROUTES.
  const pathname = normalizePath(usePathname());
  const { user, loading } = useAuth();

  const target = loading
    ? null
    : redirectFor(pathname, user ? { role: user.role, mustChangePassword: user.mustChangePassword } : null);

  useEffect(() => {
    if (target) router.replace(target);
  }, [target, router]);

  // Hold the screen while the persisted session is being read, and while a
  // redirect is in flight — rendering the page underneath would flash a
  // dashboard the user is about to be bounced off.
  if (loading || target) return <FullScreenLoader />;

  return <>{children}</>;
}
