import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Set them in frontend/.env.local (see .env.example).'
  );
}

/** Flag that decides which Web Storage the session is written to. Not the session. */
const REMEMBER_KEY = 'mb.rememberMe';

/**
 * Record the login form's "Remember me" choice. Call this BEFORE
 * `signInWithPassword`, so the session it issues is written to the right store.
 */
export function setRememberMe(remember: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (remember) window.localStorage.setItem(REMEMBER_KEY, '1');
    else window.localStorage.removeItem(REMEMBER_KEY);
  } catch {
    // Private mode / storage disabled — fall through to the non-persistent branch.
  }
}

function wantsPersistence(): boolean {
  try {
    return window.localStorage.getItem(REMEMBER_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Session storage adapter implementing "Remember me".
 *
 * This used to be the `maxAge` on the httpOnly `mb_session` cookie: ticked meant a
 * 7-day cookie, unticked meant a browser-session cookie. The app is a static export
 * now — there is no route handler left to mint that cookie, and the Supabase session
 * is the only session there is — so the same distinction is drawn one layer down:
 * localStorage survives a browser restart, sessionStorage does not.
 *
 * Reads check both stores because the choice can change between logins, and writes
 * clear the other one so a stale copy can never resurrect a session the user asked
 * not to keep.
 */
const rememberMeStorage = {
  getItem: (key: string): string | null => {
    try {
      return window.sessionStorage.getItem(key) ?? window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      const [write, clear] = wantsPersistence()
        ? [window.localStorage, window.sessionStorage]
        : [window.sessionStorage, window.localStorage];
      write.setItem(key, value);
      clear.removeItem(key);
    } catch {
      // Nothing to do: the session simply won't survive a reload.
    }
  },
  removeItem: (key: string): void => {
    try {
      window.localStorage.removeItem(key);
      window.sessionStorage.removeItem(key);
    } catch {
      // Already gone as far as the app is concerned.
    }
  },
};

/**
 * Browser Supabase client for authentication.
 *
 * The session (access + refresh token) is persisted in Web Storage and auto
 * refreshed. `detectSessionInUrl` lets the password-recovery redirect
 * (/reset-password) pick up the recovery token from the URL hash.
 *
 * Role / branch claims live in `session.user.app_metadata`. With the middleware
 * gone, those claims are also what the app routes on — see
 * src/components/auth/RouteGuard.tsx.
 *
 * `storage` is supplied only in the browser: this module is imported during the
 * static prerender, where `window` does not exist and supabase-js falls back to its
 * own in-memory store.
 */
export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    ...(typeof window === 'undefined' ? {} : { storage: rememberMeStorage }),
  },
});
