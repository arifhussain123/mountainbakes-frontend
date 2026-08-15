'use client';

import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import { isValidRole } from '@/utils/roleHome';
import { forgetIdentity, readIdentity, rememberIdentity } from '@/lib/offline/lastSession';
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
 * Map a Supabase auth user → the app's AuthUser, reading claims from app_metadata.
 *
 * Returns null when the account carries no recognised `role` claim. This is
 * deliberately fail-closed — it previously defaulted to 'branch_manager', which
 * would hand branch-level UI to any account whose claim was missing (e.g. a
 * self-signup, if email sign-ups are ever enabled).
 */
function toAuthUser(u: SupabaseUser): AuthUser | null {
  const claims = (u.app_metadata ?? {}) as {
    role?: UserRole;
    branchId?: string | null;
    branchName?: string | null;
    mustChangePassword?: boolean;
  };
  if (!isValidRole(claims.role)) return null;

  const displayName = (u.user_metadata as { displayName?: string } | null)?.displayName;
  return {
    uid: u.id,
    email: u.email ?? '',
    displayName: displayName || u.email || '',
    role: claims.role,
    branchId: claims.branchId ?? null,
    branchName: claims.branchName ?? null,
    mustChangePassword: claims.mustChangePassword === true,
  };
}

/**
 * Single source of Supabase auth state for the whole app.
 *
 * Mounting one provider at the root runs the auth listener exactly once and shares
 * `{ user, token }` with all consumers (previously ~48 call sites each opened their
 * own listener). `token` is the Supabase access-token JWT, sent as the Bearer token
 * on API calls; role/branch come from the user's `app_metadata`.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string>('');
  const [loading, setLoading] = useState(true);

  /**
   * Set for the duration of a deliberate sign-out.
   *
   * Supabase reports a real sign-out and a refresh it could not complete the
   * same way: a null session. Offline those mean opposite things, so the one
   * case the app can be certain about is the one it started itself.
   */
  const signingOut = useRef(false);

  useEffect(() => {
    let active = true;

    const applySession = (session: Session | null) => {
      const authUser = session?.user ? toAuthUser(session.user) : null;
      if (session?.user && authUser) {
        setUser(authUser);
        setToken(session.access_token);
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
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        applySession(data.session);
      })
      .catch(() => {
        // Offline cold start: getSession can reject trying to refresh an expired
        // token. applySession(null) takes the held-identity path above rather
        // than leaving the app stuck on its loading screen.
        if (active) applySession(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    // …then keep in sync (sign-in, sign-out, token refresh).
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      applySession(session);
      setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  /**
   * Turn a held identity back into a real session the moment the network is back.
   *
   * Without this the app would sit on the held identity — signed in, but with no
   * token, so every query stays gated and the screens keep showing what was
   * cached — until Supabase's own refresh ticker happened to come round. Asking
   * directly on the `online` event makes recovery immediate and predictable.
   *
   * Guarded on `!token`, so this does nothing for the ordinary case of a
   * connection blipping while the session was valid all along.
   */
  useEffect(() => {
    const onOnline = () => {
      if (token) return;
      void supabase.auth.refreshSession(); // onAuthStateChange applies the result
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [token]);

  const logout = useCallback(async () => {
    // Signing out of Supabase is the whole of it: the app is a static export, so
    // there is no server session and no `mb_session` cookie left to invalidate.
    //
    // The flag is what tells applySession that the null session about to arrive
    // was asked for, so it clears the held identity instead of restoring it —
    // otherwise signing out while offline would put the user straight back in.
    signingOut.current = true;
    try {
      forgetIdentity();
      await supabase.auth.signOut();
    } finally {
      signingOut.current = false;
    }
  }, []);

  const refreshToken = useCallback(async () => {
    const { data } = await supabase.auth.refreshSession();
    const newToken = data.session?.access_token ?? '';
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
