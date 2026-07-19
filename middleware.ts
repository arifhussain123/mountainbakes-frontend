import { NextRequest, NextResponse } from 'next/server';

// Role home pages
function getRoleHome(role: string): string {
  switch (role) {
    case 'super_admin': return '/dashboard';
    case 'branch_manager': return '/branch-dashboard';
    case 'production_user': return '/production-queue';
    default: return '/login';
  }
}

// Public paths that don't need auth (includes PWA assets: manifest, service
// workers, offline page, icons & splash screens must be reachable when logged out)
const PUBLIC_PATHS = [
  '/login',
  // Supabase password-recovery landing page. Must be public: the recovery token
  // arrives in the URL hash (not sent to the server), so a logged-out visitor has
  // no session cookie — guarding it here would bounce them to /login before the
  // client can establish the recovery session.
  '/reset-password',
  // All of /api is exempt, not just login/logout. Requests under /api are either
  // Next's own session routes or are proxied to the Express API (see the rewrite
  // in next.config.ts), which does its own `Authorization: Bearer` check. Letting
  // this middleware guard them would redirect an unauthenticated API call to
  // /login, so `fetch` would resolve with an HTML page instead of the JSON error
  // the client parses.
  '/api',
  '/_next',
  '/favicon.ico',
  '/public',
  '/manifest.webmanifest',
  '/sw.js',
  '/firebase-messaging-sw.js',
  '/offline.html',
  '/icons',
  '/splash',
];

export function middleware(req: NextRequest) {
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

  if (!session) {
    return NextResponse.redirect(new URL('/login', req.url));
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
