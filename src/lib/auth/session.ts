import type { UserRole } from '@mb/shared';
import { API_URL } from '@/lib/api/client';
import { isStandalone } from '@/utils/pwa';

/**
 * The browser's signed-in session, held against the API's own sign-in.
 *
 * A session is two tokens and the person they belong to. The ACCESS token goes
 * on every API call and lasts a quarter of an hour; the REFRESH token is
 * exchanged for the next pair, and each one works once. Both are kept in Web
 * Storage (which of the two stores is "Remember me", below) and nothing here
 * talks to anything but `/api/auth/*`.
 *
 * WHAT ENDS A SESSION, AND WHAT DOES NOT. Only the API saying so does: a
 * refresh it REJECTS (signed out elsewhere, deactivated, the token spent twice)
 * clears the session and tells the app. A refresh that could not be ASKED — no
 * network, a dead socket on a resumed phone, a 5xx — leaves the session exactly
 * where it was, to be tried again. Treating the second like the first is how a
 * shop with a bad connection gets signed out every morning.
 */

export interface SessionUser {
  id: string;
  email: string;
  displayName: string | null;
  username: string | null;
  role: UserRole;
  branchId: string | null;
  branchName: string | null;
  mustChangePassword: boolean;
}

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  /** When the access token expires, in Unix seconds. */
  expiresAt: number;
  user: SessionUser;
}

export type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED';
type Listener = (event: AuthEvent, session: AuthSession | null) => void;

/** A refusal from the API, with the code the screens branch on. */
export class AuthApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
    this.name = 'AuthApiError';
  }
}

const SESSION_KEY = 'mb.auth.session';
/** Flag that decides which Web Storage the session is written to. Not the session. */
const REMEMBER_KEY = 'mb.rememberMe';
const REFRESH_LOCK = 'mb.auth.refresh';

/** Treat a token with less than this left as already expired: it would not survive the request. */
const EXPIRY_MARGIN_S = 10;
/** Renew in the background once this little is left. */
const RENEW_WITHIN_S = 90;
const RENEW_CHECK_MS = 30_000;
const REQUEST_TIMEOUT_MS = 15_000;

// ── "Remember me" ───────────────────────────────────────────────────────────

/**
 * Record the login form's "Remember me" choice. Call this BEFORE `signIn`, so
 * the session it issues is written to the right store.
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
  // An INSTALLED app always keeps its session. sessionStorage belongs to the
  // browsing context, and iOS throws a Home Screen app's context away whenever
  // it reclaims the app — switching to the camera is enough — so an unticked
  // "Remember me" there meant signing in again on almost every launch. Android
  // keeps the context far longer, which is why this only ever showed on iPhone.
  // "Don't remember me" is a promise about a shared BROWSER; an app someone put
  // on their own Home Screen is not that, and a tab still honours the choice.
  if (isStandalone()) return true;
  try {
    return window.localStorage.getItem(REMEMBER_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Where the session lives: localStorage survives a browser restart,
 * sessionStorage does not, and "Remember me" picks between them.
 *
 * Reads check both stores because the choice can change between logins, and
 * writes clear the other one so a stale copy can never resurrect a session the
 * user asked not to keep.
 */
function readStored(): AuthSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY) ?? window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthSession> | null;
    if (!parsed?.accessToken || !parsed.refreshToken || !parsed.user?.id) return null;
    return parsed as AuthSession;
  } catch {
    return null;
  }
}

function writeStored(session: AuthSession): void {
  try {
    const [write, clear] = wantsPersistence()
      ? [window.localStorage, window.sessionStorage]
      : [window.sessionStorage, window.localStorage];
    write.setItem(SESSION_KEY, JSON.stringify(session));
    clear.removeItem(SESSION_KEY);
  } catch {
    // Nothing to do: the session simply won't survive a reload.
  }
}

function clearStored(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY);
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Already gone as far as the app is concerned.
  }
}

// ── telling the app ─────────────────────────────────────────────────────────

const listeners = new Set<Listener>();

function emit(event: AuthEvent, session: AuthSession | null): void {
  for (const listener of [...listeners]) {
    try {
      listener(event, session);
    } catch (err) {
      console.error('[auth] a session listener threw', err);
    }
  }
}

/**
 * Be told when this browser signs in, signs out, or renews its token — in this
 * tab or, for a remembered session, in another one. Returns the unsubscribe.
 */
export function onAuthStateChange(listener: Listener): () => void {
  listeners.add(listener);
  startBackgroundWork();
  return () => listeners.delete(listener);
}

// ── talking to the API ──────────────────────────────────────────────────────

const nowSeconds = () => Math.floor(Date.now() / 1000);

async function post(path: string, body: unknown, accessToken?: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function refusal(res: Response, fallback: string): Promise<AuthApiError> {
  const body = (await res.json().catch(() => null)) as { error?: string; code?: string; details?: { code?: string } } | null;
  const code = body?.details?.code ?? body?.code ?? (res.status === 429 ? 'rate_limited' : '');
  return new AuthApiError(body?.error || fallback, res.status, code);
}

function toSession(body: AuthSession & { expiresIn?: number }): AuthSession {
  return { accessToken: body.accessToken, refreshToken: body.refreshToken, expiresAt: body.expiresAt, user: body.user };
}

/**
 * Sign in with an email address (or a username) and a password.
 *
 * Rejects with an `AuthApiError` the API refused with — wrong credentials, a
 * deactivated account, too many attempts — or with the browser's own error when
 * the request never got an answer.
 */
export async function signIn(identifier: string, password: string): Promise<AuthSession> {
  const res = await post('/api/auth/login', { identifier, password, client: 'web' });
  if (!res.ok) throw await refusal(res, 'Login failed. Please try again.');
  const session = toSession(await res.json());
  writeStored(session);
  emit('SIGNED_IN', session);
  return session;
}

/**
 * Sign this browser out. The API is told on a best-effort basis; the session is
 * cleared here whether or not it heard, because someone who taps "sign out"
 * with no signal is still signing out.
 */
export async function signOut(): Promise<void> {
  const session = readStored();
  if (session) {
    try {
      await post('/api/auth/logout', {}, session.accessToken);
    } catch {
      // Offline, or the token had already lapsed. The server-side session ends
      // on its own when its refresh token is never used again.
    }
  }
  clearStored();
  emit('SIGNED_OUT', null);
}

export interface RefreshOutcome {
  session: AuthSession | null;
  /** True only when the API refused the refresh — the session is over. */
  rejected: boolean;
}

let refreshing: Promise<RefreshOutcome> | null = null;

/** One refresh at a time across every tab of this browser, where the browser can arrange that. */
function exclusively<T>(work: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? (locks.request(REFRESH_LOCK, work) as Promise<T>) : work();
}

/**
 * Exchange the refresh token for a new pair.
 *
 * Concurrent callers in this tab share one request. Across tabs a Web Lock
 * serialises them, and whoever gets the lock second finds the session the first
 * one stored and simply uses it — which matters, because a refresh token works
 * once and the second request would otherwise be presenting a spent one. (The
 * API forgives that for a few seconds, for browsers without Web Locks.)
 */
export function refreshSession(): Promise<RefreshOutcome> {
  if (typeof window === 'undefined') return Promise.resolve({ session: null, rejected: false });
  if (refreshing) return refreshing;

  const before = readStored();
  refreshing = exclusively(async (): Promise<RefreshOutcome> => {
    const stored = readStored();
    if (!stored) return { session: null, rejected: true };

    // Another tab renewed it while this one waited for the lock.
    if (before && stored.refreshToken !== before.refreshToken && stored.expiresAt - nowSeconds() > EXPIRY_MARGIN_S) {
      emit('TOKEN_REFRESHED', stored);
      return { session: stored, rejected: false };
    }

    let res: Response;
    try {
      res = await post('/api/auth/refresh', { refreshToken: stored.refreshToken });
    } catch {
      return { session: null, rejected: false }; // never reached the API
    }

    if (res.ok) {
      const session = toSession(await res.json());
      writeStored(session);
      emit('TOKEN_REFRESHED', session);
      return { session, rejected: false };
    }
    if (res.status === 401 || res.status === 403) {
      clearStored();
      emit('SIGNED_OUT', null);
      return { session: null, rejected: true };
    }
    return { session: null, rejected: false }; // 429, 5xx: the API's problem, not the session's
  }).finally(() => {
    refreshing = null;
  });
  return refreshing;
}

/**
 * The current session, renewed first if its access token has run out.
 *
 * Null means there is no usable token right now — either nobody is signed in,
 * or the token has expired and could not be renewed. `hasStoredSession()` tells
 * the two apart.
 */
export async function getSession(): Promise<AuthSession | null> {
  const stored = readStored();
  if (!stored) return null;
  if (stored.expiresAt - nowSeconds() > EXPIRY_MARGIN_S) return stored;
  return (await refreshSession()).session;
}

/** Whether this browser holds a session at all, usable right now or not. */
export function hasStoredSession(): boolean {
  return readStored() !== null;
}

/** The access token to send, or null — for the few callers outside React that need just that. */
export async function getAccessToken(): Promise<string | null> {
  return (await getSession())?.accessToken ?? null;
}

// ── forgotten passwords ─────────────────────────────────────────────────────

/** Ask for a reset link to be emailed. Administrator accounts only; the API decides. */
export async function requestPasswordReset(email: string): Promise<void> {
  const res = await post('/api/auth/forgot-password', { email, deliver: true });
  if (!res.ok) throw await refusal(res, 'Could not send a reset link. Please try again.');
}

/** Choose a new password with the token from a reset link. */
export async function confirmPasswordReset(token: string, newPassword: string): Promise<void> {
  const res = await post('/api/auth/password-reset/confirm', { token, newPassword });
  if (!res.ok) throw await refusal(res, 'Failed to update password. The reset link may have expired.');
}

// ── keeping it alive ────────────────────────────────────────────────────────

let started = false;

/**
 * Renew the token a little before it runs out, while the tab is on screen, and
 * mirror what another tab does to a remembered session.
 *
 * Nothing runs while the tab is hidden — a background tab renewing every
 * quarter-hour for a week is wasted work, and it wakes holding an expired token
 * either way; `getSession()` and the API client's own 401 handling cover that.
 */
function startBackgroundWork(): void {
  if (started || typeof window === 'undefined') return;
  started = true;

  const renewIfDue = () => {
    if (document.visibilityState !== 'visible') return;
    const stored = readStored();
    if (stored && stored.expiresAt - nowSeconds() < RENEW_WITHIN_S) void refreshSession();
  };
  window.setInterval(renewIfDue, RENEW_CHECK_MS);
  document.addEventListener('visibilitychange', renewIfDue);

  // Only localStorage raises this, and only in OTHER tabs — which is exactly
  // the case to mirror: a session kept in sessionStorage belongs to one tab.
  window.addEventListener('storage', (event) => {
    if (event.key !== SESSION_KEY) return;
    const session = readStored();
    if (!session) emit('SIGNED_OUT', null);
    else emit(event.oldValue ? 'TOKEN_REFRESHED' : 'SIGNED_IN', session);
  });
}
