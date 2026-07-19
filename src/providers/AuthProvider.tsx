'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
import { isValidRole } from '@/utils/roleHome';
import type { UserRole } from '@mb/shared';

export interface AuthUser {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
  branchId: string | null;
  branchName: string | null;
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

  useEffect(() => {
    let active = true;

    const applySession = (session: Session | null) => {
      const authUser = session?.user ? toAuthUser(session.user) : null;
      if (session?.user && authUser) {
        setUser(authUser);
        setToken(session.access_token);
      } else {
        // No session, or a session whose account has no valid role — clear the token
        // too, so no API call goes out on behalf of an identity we won't honour.
        setUser(null);
        setToken('');
      }
    };

    // Prime from any persisted session…
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      applySession(data.session);
      setLoading(false);
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

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    // Invalidate server cookie
    await fetch('/api/logout', { method: 'POST' });
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
