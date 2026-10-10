'use client';

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getSession,
  onAuthStateChange,
  refreshSession,
  signOut,
  type AuthSession,
  type SessionUser,
} from '@/lib/auth/session';
import { isValidRole } from '@/utils/roleHome';
import { forgetIdentity, readIdentity, rememberIdentity } from '@/lib/offline/lastSession';
import { endLoginSession } from '@/lib/loginHistory';
import type { UserRole } from '@mb/shared';

export interface AuthUser {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  branchId: string | null;
  branchName: string | null;
  /**
   * Admin has flagged this account for a forced password change. Read here rather
   * than from a cookie because the app is a static export with no middleware —
   * RouteGuard uses it to pin the user to /change-password.
   */
  mustChangePassword: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string;
  loading: boolean;
  logout: () => Promise<void>;
  refreshToken: () => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * How long session restore may take before the app stops waiting on it. Long
 * enough for a token refresh on a poor branch connection; short enough that a
 * request that will never answer does not look like a frozen app.
 */
const SESSION_RESTORE_TIMEOUT_MS = 10_000;

/**
 * Map the user the API signed in → the app's AuthUser.
 *
 * Returns null when the account carries no recognised role. This is
 * deliberately fail-closed — it previously defaulted to 'branch_manager', which
 * would hand branch-level UI to any account whose role was missing.
 */
function toAuthUser(u: SessionUser): AuthUser | null {
  if (!isValidRole(u.role)) return null;
  return {
    uid: u.id,
    email: u.email ?? '',
    displayName: u.displayName || u.email || '',
    role: u.role,
    branchId: u.branchId ?? null,
    branchName: u.branchName ?? null,
    mustChangePassword: u.mustChangePassword === true,
  };
}

/**
 * Single source of auth state for the whole app.
 *
 * Mounting one provider at the root runs the auth listener exactly once and shares
 * `{ user, token }` with all consumers (previously ~48 call sites each opened their
 * own listener). `token` is the API's access token, sent as the Bearer token on
 * API calls; role/branch are what the API returned with it and are re-read by
 * the API from its own records on every request.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string>('');
  const [loading, setLoading] = useState(true);

  /**
   * Set for the duration of a deliberate sign-out.
   *
   * A real sign-out and a refresh that could not be completed both leave this
   * provider holding a null session. Offline those mean opposite things, so
   * the one case the app can be certain about is the one it started itself.
   */
  const signingOut = useRef(false);

  useEffect(() => {
    let active = true;

    const applySession = (session: AuthSession | null) => {
      const authUser = session?.user ? toAuthUser(session.user) : null;
      if (session?.user && authUser) {
        setUser(authUser);
        setToken(session.accessToken);
        // The identity to fall back on when the token later ages out with no
        // network to renew it. Refreshed on every valid session, so a role or
        // branch change is picked up rather than held stale.
        rememberIdentity(authUser);
        return;
      }

      // No session. Which of the two is it?
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      if (offline && !signingOut.current) {
        // A refresh that could not reach the network. Hold the last known
        // identity so an hour into a dead spot the user keeps the screens and
        // the cached data they already had, instead of being put in front of a
        // login form that cannot work without a connection.
        //
        // The token is deliberately NOT held: it is expired and useless, and
        // every query is gated on it, so nothing goes to the API on behalf of a
        // session the server would refuse. What renders is what this device
        // already fetched.
        const held = readIdentity();
        if (held) {
          setUser(held);
          setToken('');
          return;
        }
      }

      // A genuine ending — signed out here, signed out elsewhere, account
      // disabled, refresh token rejected — or a session whose account has no
      // valid role. Clear the token too, so no API call goes out on behalf of an
      // identity we won't honour.
      setUser(null);
      setToken('');
      forgetIdentity();
    };

    // Prime from any persisted session…
    //
    // …but not for ever. `getSession()` refreshes an expired token before it
    // answers, and iOS resumes a Home Screen app with its sockets dead: that
    // request can then neither succeed nor fail, `navigator.onLine` still says
    // true, and the app sat on its loading spinner until it was force-quit. So
    // the wait is bounded. Past the bound the last known identity is shown with
    // no token (exactly the offline path below — nothing goes to the API), and
    // when the refresh does land, onAuthStateChange applies the real session.
    const stalled = window.setTimeout(() => {
      if (!active) return;
      const held = readIdentity();
      if (held) {
        setUser(held);
        setToken('');
      }
      setLoading(false);
    }, SESSION_RESTORE_TIMEOUT_MS);

    getSession()
      .then((session) => {
        if (!active) return;
        applySession(session);
      })
      .catch(() => {
        // Offline cold start: getSession can reject trying to refresh an expired
        // token. applySession(null) takes the held-identity path above rather
        // than leaving the app stuck on its loading screen.
        if (active) applySession(null);
      })
      .finally(() => {
        window.clearTimeout(stalled);
        if (active) setLoading(false);
      });

    // …then keep in sync (sign-in, sign-out, token refresh).
    const unsubscribe = onAuthStateChange((_event, session) => {
      applySession(session);
      setLoading(false);
    });

    return () => {
      active = false;
      window.clearTimeout(stalled);
      unsubscribe();
    };
  }, []);

  /**
   * Turn a held identity back into a real session the moment the network is back.
   *
   * Without this the app would sit on the held identity — signed in, but with no
   * token, so every query stays gated and the screens keep showing what was
   * cached — until the background renewal happened to come round. Asking
   * directly on the `online` event makes recovery immediate and predictable.
   *
   * Guarded on `!token`, so this does nothing for the ordinary case of a
   * connection blipping while the session was valid all along.
   */
  useEffect(() => {
    const onOnline = () => {
      if (token) return;
      void refreshSession(); // onAuthStateChange applies the result
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [token]);

  const logout = useCallback(async () => {
    // Ending the API session and dropping the tokens is the whole of it: the app
    // is a static export, so there is no cookie left to invalidate.
    //
    // The flag is what tells applySession that the null session about to arrive
    // was asked for, so it clears the held identity instead of restoring it —
    // otherwise signing out while offline would put the user straight back in.
    signingOut.current = true;
    try {
      forgetIdentity();
      // BEFORE signOut, not after: closing the session needs the access token
      // that signOut is about to destroy. It never throws and never blocks —
      // see lib/loginHistory.ts — so sign-out cannot fail on its account.
      await endLoginSession();
      await signOut();
      // AFTER signOut succeeds, not before or in `finally`: a failed sign-out
      // should leave a still-valid session's cache alone. Without this, the
      // QueryClient (a singleton that outlives the sign-out/sign-in boundary —
      // there is no page reload) keeps every cached query in memory, so the
      // next person to sign in on this device/tab — a shared branch till,
      // say — can briefly be served the previous user's cached orders,
      // customers or finance figures before the next background refetch
      // corrects it. Mirrors RealtimeProvider's own per-user clearing on this
      // same boundary.
      queryClient.clear();
    } finally {
      signingOut.current = false;
    }
  }, [queryClient]);

  const refreshToken = useCallback(async () => {
    const { session } = await refreshSession();
    const newToken = session?.accessToken ?? '';
    setToken(newToken);
    return newToken;
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, logout, refreshToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within <AuthProvider>');
  }
  return ctx;
}
