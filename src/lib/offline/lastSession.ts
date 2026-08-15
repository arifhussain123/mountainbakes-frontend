import type { AuthUser } from '@/providers/AuthProvider';

/**
 * The last signed-in identity, kept so the app stays usable offline once the
 * access token has aged out.
 *
 * The problem this solves: a Supabase access token lasts about an hour. Offline,
 * the refresh that would renew it cannot reach the network, so Supabase drops
 * the session — and the app, doing as it was told, sent a branch user who had
 * been working for an hour to a login screen that cannot sign anyone in without
 * a connection. Everything they had was on the device; they just could not get
 * back to it.
 *
 * WHAT THIS IS NOT: a credential. No access token and no refresh token is
 * written here — Supabase owns those and keeps them where it always did. This
 * holds only who the person is, so the app can render the screens their role
 * uses and show the data already cached on this device.
 *
 * That distinction is what makes holding it safe. The API re-decides every
 * request against the JWT, so a held identity buys exactly nothing from the
 * server: with no valid token, no request can fetch anything new. It governs
 * which local screens open — the same job RouteGuard already does, which its own
 * notes describe as navigation UX rather than an authorisation boundary.
 *
 * Cleared on a real sign-out, and whenever Supabase ends the session while the
 * device is ONLINE — that is a genuine ending (signed out elsewhere, account
 * disabled, refresh token rejected) rather than a network failure.
 */

const KEY = 'mb.lastSession';

interface StoredIdentity {
  user: AuthUser;
  savedAt: number;
}

/**
 * How long a held identity stays usable without ever reaching the server.
 *
 * Seven days. Long enough to cover a phone left in a dead spot over a weekend,
 * short enough that a device lost off the back of a van is not still opening
 * its branch's figures a month later.
 */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** Written from localStorage only: it must survive the app being closed, which is the case it exists for. */
export function rememberIdentity(user: AuthUser): void {
  try {
    const stored: StoredIdentity = { user, savedAt: Date.now() };
    window.localStorage.setItem(KEY, JSON.stringify(stored));
  } catch {
    // Private mode or a full disk. Costs offline sign-in only, never correctness.
  }
}

/** The held identity, if there is a fresh one. */
export function readIdentity(): AuthUser | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;

    const stored = JSON.parse(raw) as StoredIdentity;
    if (!stored?.user?.uid || Date.now() - stored.savedAt > MAX_AGE_MS) {
      forgetIdentity();
      return null;
    }
    return stored.user;
  } catch {
    return null;
  }
}

export function forgetIdentity(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing stored, or no storage — either way there is nothing to remove */
  }
}
