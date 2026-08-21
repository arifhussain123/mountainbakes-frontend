import type { LoginSession } from '@mb/shared';
import { supabase } from '@/lib/supabase/client';
import { apiCall } from '@/utils/api';

/**
 * Client half of Login History.
 *
 * The API cannot see a login. This app is a static export that calls Supabase
 * Auth straight from the browser, so nothing of ours is in that request path —
 * which is why the session is opened, kept alive and closed by explicit calls
 * from here rather than being observed server-side.
 *
 * Deliberately NOT a React hook and not TanStack Query. Two of the three callers
 * are outside React's control flow: the ping rides the refresh tick inside
 * `AppRefreshProvider`'s `setInterval`, and the end runs inside `AuthProvider`'s
 * `logout` just before the session it needs is destroyed. A hook could serve
 * neither. Everything here reads its own token from the Supabase client for the
 * same reason.
 *
 * EVERY FUNCTION SWALLOWS ITS ERRORS. This is bookkeeping running alongside real
 * work: an unreachable API must never stop somebody signing in, working, or —
 * least of all — signing out. A lost ping costs at most a slightly short
 * duration on one row.
 */

/**
 * Where the session id lives between calls.
 *
 * localStorage, not sessionStorage, and that choice is what makes a reload — or
 * a second tab — carry on with the same session instead of opening a new one.
 * sessionStorage is per-tab, so a user with the dashboard open twice would show
 * up as two concurrent logins, and every F5 would add a row.
 *
 * The key is not scoped per user: it is cleared on sign-out, and `startSession`
 * offers the stored id to the server, which honours it only if it really belongs
 * to the caller. So a stale id from another account is refused server-side and a
 * fresh session opens — the storage is a hint, never a claim.
 */
const STORAGE_KEY = 'mb.loginSessionId';

function read(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    // Safari in private mode throws on Web Storage. Falling back to "no stored
    // session" costs an extra row per reload and breaks nothing.
    return null;
  }
}

function write(id: string | null): void {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* see read() */
  }
}

async function currentToken(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  } catch {
    return null;
  }
}

/**
 * Record a sign-in — or resume the session this browser already holds.
 *
 * Called on every dashboard mount, not only after a sign-in, because a static
 * export has no other reliable moment: a hard reload lands straight on the
 * dashboard with a valid session and no auth event to hook. The server decides
 * which of the two this is, from `resumeSessionId`.
 */
export async function startLoginSession(): Promise<LoginSession | null> {
  const token = await currentToken();
  if (!token) return null;

  const resumeSessionId = read();
  try {
    const session = await apiCall<LoginSession>(
      '/api/login-history/start',
      { method: 'POST', body: JSON.stringify(resumeSessionId ? { resumeSessionId } : {}) },
      token,
    );
    write(session.id);
    return session;
  } catch {
    return null;
  }
}

/**
 * Tell the API this tab is still open.
 *
 * A 404 means the held id is no longer live — closed elsewhere, expired, or
 * never ours. Rather than pinging a dead row every two minutes for the rest of
 * the day, the id is dropped and a fresh session opened, so the history stays
 * continuous across a laptop that slept through the stale window.
 */
export async function pingLoginSession(): Promise<void> {
  const sessionId = read();
  if (!sessionId) return;

  const token = await currentToken();
  if (!token) return;

  try {
    await apiCall('/api/login-history/ping', { method: 'POST', body: JSON.stringify({ sessionId }) }, token);
  } catch (err) {
    if ((err as { status?: number })?.status === 404) {
      write(null);
      void startLoginSession();
    }
    // Any other failure is a transient network problem; the next tick retries.
  }
}

/**
 * Close the session on an explicit sign-out.
 *
 * MUST be awaited before `supabase.auth.signOut()`, because it needs the access
 * token that sign-out is about to destroy. The id is cleared either way — a
 * failed end leaves a session the server will read as expired, which is a far
 * better outcome than leaving the id behind for the next account to offer up.
 */
export async function endLoginSession(): Promise<void> {
  const sessionId = read();
  write(null);
  if (!sessionId) return;

  const token = await currentToken();
  if (!token) return;

  try {
    await apiCall('/api/login-history/end', { method: 'POST', body: JSON.stringify({ sessionId }) }, token);
  } catch {
    /* see the module comment — sign-out must not fail on this */
  }
}
