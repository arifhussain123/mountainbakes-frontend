import { NextRequest, NextResponse } from 'next/server';
import { getRoleHome, isValidRole } from '@/utils/roleHome';

// Public paths that don't need auth (includes PWA assets: manifest, service
// workers, offline page, icons & splash screens must be reachable when logged out)
const PUBLIC_PATHS = [
  '/login',
  // Supabase password-recovery landing page. Must be public: the recovery token
  // arrives in the URL hash (not sent to the server), so a logged-out visitor has
  // no session cookie — guarding it here would bounce them to /login before the
  // client can establish the recovery session.
  '/reset-password',
  // All of /api is exempt, not just login/logout. What lives under /api here is
  // only this app's own route handlers (src/app/api/login, /logout) — the Express
  // API is a separate host called directly at NEXT_PUBLIC_API_URL, and does its
  // own `Authorization: Bearer` check. Guarding /api here would redirect an
  // unauthenticated call to /login, so `fetch` would resolve with an HTML page
  // instead of the JSON error the client parses.
  '/api',
  '/_next',
  '/favicon.ico',
  '/public',
  '/manifest.webmanifest',
  '/sw.js',
  '/offline.html',
  '/icons',
  '/splash',
];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Allow public paths
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // Read role from cookie (set on login via /api/login)
  const sessionCookie = req.cookies.get('mb_session');

  if (!sessionCookie?.value) {
    // Not authenticated
    if (pathname === '/') return NextResponse.redirect(new URL('/login', req.url));
    if (!pathname.startsWith('/login')) return NextResponse.redirect(new URL('/login', req.url));
    return NextResponse.next();
  }

  let session: { role: string; uid: string; mustChangePassword?: boolean } | null = null;
  try {
    session = JSON.parse(Buffer.from(sessionCookie.value, 'base64').toString());
  } catch {
    const res = NextResponse.redirect(new URL('/login', req.url));
    res.cookies.delete('mb_session');
    return res;
  }

  // Fail closed: a cookie with no recognised role is treated as no session at all.
  if (!session || !isValidRole(session.role)) {
    const res = NextResponse.redirect(new URL('/login', req.url));
    res.cookies.delete('mb_session');
    return res;
  }

  // Forced password change gate — blocks all app routes until a new password is
  // set. Must come before normal role routing.
  if (session.mustChangePassword) {
    if (pathname === '/change-password') return NextResponse.next();
    return NextResponse.redirect(new URL('/change-password', req.url));
  }
  // Not required → keep users out of the change-password screen.
  if (pathname === '/change-password') {
    return NextResponse.redirect(new URL(getRoleHome(session.role), req.url));
  }

  const role = session.role;
  const home = getRoleHome(role);

  // Redirect / to role home
  if (pathname === '/') return NextResponse.redirect(new URL(home, req.url));

  // Redirect /login → role home (already signed in)
  if (pathname === '/login') return NextResponse.redirect(new URL(home, req.url));

  // Admin-only routes
  if (
    (pathname.startsWith('/dashboard') ||
      pathname.startsWith('/users') ||
      pathname.startsWith('/branches') ||
      pathname.startsWith('/products') ||
      pathname.startsWith('/categories') ||
      pathname.startsWith('/customers') ||
      pathname.startsWith('/orders') ||
      pathname.startsWith('/reports') ||
      pathname.startsWith('/support') ||
      pathname.startsWith('/notification-recipients') ||
      pathname.startsWith('/settings')) &&
    role !== 'super_admin'
  ) {
    return NextResponse.redirect(new URL(home, req.url));
  }

  // Branch manager routes
  if (pathname.startsWith('/branch-') && role !== 'branch_manager') {
    return NextResponse.redirect(new URL(home, req.url));
  }

  // Production routes
  if (pathname.startsWith('/production-') && role !== 'production_user') {
    return NextResponse.redirect(new URL(home, req.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.svg$).*)'],
};
