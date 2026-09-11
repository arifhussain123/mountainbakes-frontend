import type { LoginAttemptReason, LoginSession } from '@mb/shared';
import { supabase } from '@/lib/supabase/client';
import { apiCall } from '@/utils/api';
import { endDeadSession } from '@/lib/api/client';

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
 * EVERY FUNCTION SWALLOWS ITS ERRORS, WITH ONE EXCEPTION. This is bookkeeping
 * running alongside real work: an unreachable API must never stop somebody
 * signing in, working, or — least of all — signing out. A lost ping costs at
 * most a slightly short duration on one row.
 *
 * The exception is a `session_revoked` answer, which is not bookkeeping at all.
 * An admin has signed this browser out, and this is the mechanism that carries
 * that out: a Supabase access token cannot be withdrawn once issued, so the
 * GoTrue session behind it is already deleted but the token in this tab stays
 * valid until it expires — up to an hour of a supposedly-terminated session
 * still working. Signing out locally is what turns the revocation into something
 * that happens within the two-minute ping tick.
 */

/**
 * Did the API say this session has been revoked?
 *
 * Matched on the `code`, never on the message. The API sends both; the prose is
 * for a person and gets reworded, the code does not.
 */
function isRevoked(err: unknown): boolean {
  const e = err as { status?: number; details?: { code?: string } } | null;
  // `details` and not a top-level field: `apiCall` lifts only `body.details`
  // onto ApiError and drops the rest of the body, so this is the one place a
  // machine-readable marker survives the trip.
  //
  // TWO STATUSES, because there are now two places that can say this. The Login
  // History endpoints answer 403 — the token is fine, the SESSION was ended —
  // while `authenticate` answers 401, because from its point of view the
  // credential itself is no longer good. The code is the same on both, and
  // matching on it rather than on either number is what keeps this working
  // whichever one gets there first.
  return (e?.status === 403 || e?.status === 401) && e?.details?.code === 'session_revoked';
}

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

/**
 * '1920x1080', or null where the browser will not say.
 *
 * THE ONLY THING THIS CLIENT VOLUNTEERS ABOUT ITS DEVICE. Everything else on a
 * session row is read from a header or resolved server-side; this cannot be,
 * because no header carries a screen size. It is worth the exception for one
 * reason: it is the field that tells a person's two identical Android sessions
 * apart, which a user agent cannot do.
 *
 * `screen.width` and not `innerWidth`: the window is resized constantly and the
 * screen is not, so the window would make the same device look like a different
 * one on every sign-in. CSS pixels rather than physical ones — no
 * devicePixelRatio multiplication — because the point is to be a stable
 * identifier, not an accurate measurement, and the ratio itself changes when a
 * laptop is plugged into an external display.
 *
 * Guarded and rounded to satisfy the server's `\d{2,5}x\d{2,5}` shape: a
 * fractional or absurd value is dropped here rather than rejected there, since a
 * failed validation would cost the session record over a cosmetic field.
 */
function screenSize(): string | null {
  try {
    if (typeof window === 'undefined' || !window.screen) return null;
    const w = Math.round(window.screen.width);
    const h = Math.round(window.screen.height);
    if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
    if (w < 10 || h < 10 || w > 99999 || h > 99999) return null;
    return `${w}x${h}`;
  } catch {
    return null;
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
  const screen = screenSize();
  try {
    const session = await apiCall<LoginSession>(
      '/api/login-history/start',
      {
        method: 'POST',
        body: JSON.stringify({
          ...(resumeSessionId ? { resumeSessionId } : {}),
          ...(screen ? { screenSize: screen } : {}),
        }),
      },
      token,
    );
    write(session.id);
    return session;
  } catch (err) {
    // The reload case. Without this a revoked browser would refresh, find its
    // access token still valid, open a brand-new session row and reappear in the
    // Active Sessions list as though the revocation had been undone.
    if (isRevoked(err)) {
      write(null);
      endDeadSession();
    }
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
    // Signed out by an admin. Checked BEFORE the 404 branch, and deliberately
    // not answered by opening a fresh session — that is the difference between
    // the two, and getting it backwards would make the revoke button reopen the
    // session it just closed.
    if (isRevoked(err)) {
      write(null);
      endDeadSession();
      return;
    }
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

/**
 * Write down a sign-in that was refused.
 *
 * WHY THE BROWSER HAS TO REPORT THIS. Authentication happens between this page
 * and Supabase; our API is not in that request path and never sees the failure.
 * So either the refusals go unrecorded — which is what left the Login History
 * unable to show the single most useful thing a security screen can, a burst of
 * failures nobody can explain — or the page that saw it posts it. There is no
 * token to send: the whole point is that authentication did not happen.
 *
 * SENDS THE ADDRESS AND A REASON CODE. NEVER THE PASSWORD, not in any form —
 * not the value, not a hash, not its length. There is no parameter here that
 * could carry one and no column on the other end that could hold it.
 *
 * FIRE-AND-FORGET, and silent on every failure. The caller is a login form that
 * is already showing somebody an authentication error; a second error about the
 * bookkeeping would be noise about something they cannot act on, and an await
 * would put this request's latency between them and the message they need. Not
 * awaited by any caller — deliberately returns void, so it cannot be.
 */
export function recordFailedLogin(email: string, reason: LoginAttemptReason): void {
  // An empty form submission is not an attempt worth a row. The `required`
  // attribute on the input makes this rare, but a programmatic submit is not
  // bound by it.
  const address = email.trim();
  if (!address) return;

  void apiCall('/api/login-attempts', {
    method: 'POST',
    body: JSON.stringify({ email: address, reason }),
    // No token argument, and none exists to pass.
  }).catch(() => {
    /* see above — the person is already looking at the error that matters */
  });
}

/**
 * Read a Supabase sign-in failure as one of our reason codes.
 *
 * MAPS FROM SUPABASE'S `code`, falling back to matching its message, because
 * GoTrue only grew stable error codes recently and an older deployment still
 * sends prose. Anything unrecognised becomes 'unknown' rather than being guessed
 * at — a wrong reason in a security log is worse than an honest absence of one.
 *
 * `invalid_credentials` deliberately covers both a wrong address and a wrong
 * password, because Supabase does not distinguish them and neither should this:
 * splitting them would turn the admin's failed-login screen into a way to
 * confirm which addresses are real accounts.
 */
export function loginFailureReason(err: unknown): LoginAttemptReason {
  const code = (err as { code?: string } | null)?.code ?? '';
  const message = (err as { message?: string } | null)?.message ?? '';

  const byCode: Record<string, LoginAttemptReason> = {
    invalid_credentials: 'invalid_credentials',
    email_not_confirmed: 'email_not_confirmed',
    user_banned: 'account_disabled',
    over_request_rate_limit: 'rate_limited',
    over_email_send_rate_limit: 'rate_limited',
    session_expired: 'expired_token',
    session_not_found: 'invalid_session',
  };
  if (byCode[code]) return byCode[code];

  if (/invalid login credentials/i.test(message)) return 'invalid_credentials';
  if (/email not confirmed/i.test(message)) return 'email_not_confirmed';
  if (/banned|disabled/i.test(message)) return 'account_disabled';
  if (/rate limit|too many/i.test(message)) return 'rate_limited';
  if (/no role assigned/i.test(message)) return 'no_role';
  return 'unknown';
}
