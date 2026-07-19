'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { Session, User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase/client';
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

/** Map a Supabase auth user → the app's AuthUser, reading claims from app_metadata. */
function toAuthUser(u: SupabaseUser): AuthUser {
  const claims = (u.app_metadata ?? {}) as {
    role?: UserRole;
    branchId?: string | null;
    branchName?: string | null;
  };
  const displayName = (u.user_metadata as { displayName?: string } | null)?.displayName;
  return {
    uid: u.id,
    email: u.email ?? '',
    displayName: displayName || u.email || '',
    role: claims.role ?? 'branch_manager',
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
      if (session?.user) {
        setUser(toAuthUser(session.user));
        setToken(session.access_token);
      } else {
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
