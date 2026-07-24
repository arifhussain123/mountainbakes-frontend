/**
 * Base URL for the Express API.
 *
 * Default (single-app deploy): the API shares this dyno behind the `/api/*` rewrite
 * in next.config.ts, so we use a **relative** base in the browser — requests are
 * same-origin, which means no CORS and nothing host-specific baked in at build time.
 * On the server there is no origin to be relative to, so we call the API's loopback
 * port directly instead of hair-pinning back through Next.
 *
 * Setting NEXT_PUBLIC_API_URL overrides both and points at an external API host —
 * the older two-app topology. See DEPLOY.md.
 */
const EXPLICIT_API_URL = (process.env.NEXT_PUBLIC_API_URL || '').trim();

const API_URL =
  EXPLICIT_API_URL ||
  (typeof window === 'undefined' ? `http://127.0.0.1:${process.env.API_PORT || '3001'}` : '');

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

function isLocalHost(url: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(url);
}

/**
 * Guards the one remaining way to misconfigure this: NEXT_PUBLIC_API_URL was set
 * *explicitly* to a localhost URL (copied from .env.local, say) and the app was then
 * deployed to a real domain — so every request fails with ERR_CONNECTION_REFUSED or
 * a mixed-content block. Surface a clear error instead of an empty page.
 *
 * This cannot trigger on the default path: with the variable unset the browser uses
 * a relative base and talks to its own origin.
 */
function assertApiReachable(): void {
  if (typeof window === 'undefined') return;
  if (!EXPLICIT_API_URL) return;
  const onLocalHost = isLocalHost(window.location.origin);
  if (!onLocalHost && isLocalHost(EXPLICIT_API_URL)) {
    throw new ApiError(
      `API is misconfigured for production: NEXT_PUBLIC_API_URL is "${EXPLICIT_API_URL}", ` +
        `which only exists on a developer's machine. Either unset it — the API is served ` +
        `from this same origin by default — or set it to the deployed API's URL, then ` +
        `rebuild (NEXT_PUBLIC_* values are baked in at build time).`,
      0
    );
  }
}

/**
 * Exchange a rejected access token for a current one, or null if there isn't one.
 *
 * A Supabase access token lives an hour. supabase-js refreshes it on a ticker, but
 * the ticker is paused while the tab is hidden — so a tab left in the background
 * (or a sleeping laptop) wakes up holding an expired token, and whatever fires
 * first on focus sends it before the refresh lands. Callers hold the token in
 * React state, which makes that window wider still.
 *
 * getSession() returns the cached session and refreshes it only when expired, so
 * the common case costs no network call. An unchanged token means the server
 * rejected it for some reason other than expiry as supabase-js sees it — clock
 * skew being the plausible one — so force one refresh before giving up. Returning
 * null (no session at all, or the token came back identical twice) tells the
 * caller not to retry: the 401 is real.
 */
type RefreshResult = { token: string } | { token: null; sessionGone: boolean };

async function refreshedAccessToken(staleToken: string): Promise<RefreshResult> {
  if (typeof window === 'undefined') return { token: null, sessionGone: false };
  // Imported lazily so this module stays usable on the server, where the browser
  // Supabase client has no business being constructed.
  const { supabase } = await import('@/lib/supabase/client');

  const { data } = await supabase.auth.getSession();
  const current = data.session?.access_token ?? null;
  if (current && current !== staleToken) return { token: current };
  if (!current) return { token: null, sessionGone: true };

  const { data: refreshed, error } = await supabase.auth.refreshSession();
  const next = refreshed.session?.access_token ?? null;
  if (next && next !== staleToken) return { token: next };

  // `sessionGone` drives endDeadSession(), so only report it when the refresh
  // genuinely failed — no session at all, or the refresh token was rejected. A
  // refresh that succeeded but handed back the SAME token is ambiguous (clock
  // skew is the plausible cause) and must not cost the user their session.
  return { token: null, sessionGone: Boolean(error) || !next };
}

/** Set once, so concurrent 401s tear the session down a single time. */
let sessionTeardown: Promise<void> | null = null;

/**
 * End a session the server will no longer honour.
 *
 * A 401 that survives the refresh above means the Supabase session is gone for
 * good — but nothing bounces the user out, because route guarding runs off the
 * separate first-party `mb_session` cookie (src/proxy.ts), which lives up to
 * seven days of its own. The two expire independently, so the user keeps sitting
 * on a fully rendered page where every single request 401s and no screen ever
 * loads its data. Clear both and send them to the login screen.
 *
 * A hard navigation rather than router.replace(): it re-runs proxy.ts with the
 * cookie gone and drops all the React state built on the dead identity.
 */
function endDeadSession(): void {
  if (typeof window === 'undefined') return;
  if (window.location.pathname.startsWith('/login')) return;

  sessionTeardown ??= (async () => {
    try {
      const { supabase } = await import('@/lib/supabase/client');
      await supabase.auth.signOut();
    } catch {
      // The session is already unusable; clearing the cookie is what matters.
    }
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    window.location.replace('/login');
  })();
}

export async function apiCall<T = unknown>(
  endpoint: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  assertApiReachable();
  return request<T>(endpoint, options, token, true);
}

/**
 * `mayRetry` is spent by the one 401 refresh-and-replay below, so a token that is
 * still rejected after a genuine refresh surfaces as an error instead of looping.
 */
async function request<T>(
  endpoint: string,
  options: RequestInit,
  token: string | undefined,
  mayRetry: boolean
): Promise<T> {
  const headers: Record<string, string> = {
    ...(!(options.body instanceof FormData) && { 'Content-Type': 'application/json' }),
    ...(token && { Authorization: `Bearer ${token}` }),
    ...(options.headers as Record<string, string>),
  };

  let response: Response;
  try {
    response = await fetch(`${API_URL}${endpoint}`, { ...options, headers });
  } catch (error) {
    // Network-level failure: server unreachable, DNS failure, blocked by CORS,
    // or mixed content. fetch() rejects before we ever get a status code.
    console.error(`[api] ${options.method || 'GET'} ${API_URL}${endpoint} — network error:`, error);
    throw new ApiError(
      `Could not reach the API at ${API_URL}. It may be offline, or blocking this ` +
        `origin via CORS. Check the Network tab and the API server's CORS_ORIGINS.`,
      0,
      error
    );
  }

  if (!response.ok) {
    // Read the body once as text, then try to parse it as JSON. This surfaces the
    // real message whether the server sent {error}, an empty body, or non-JSON
    // (e.g. an HTML 404 from an unmounted route) — instead of a generic failure.
    //
    // Drained BEFORE the 401 refresh below, not after. Refreshing is a network
    // round-trip (two, when the first token comes back unchanged), and a response
    // whose body is still unread across it can have its stream torn down by the
    // time we finally ask — .text() rejects, the catch swallows it, and the API's
    // perfectly clear "Unauthorized: Invalid or expired token" gets logged and
    // thrown as an empty `{}`, which is exactly the wrong moment to lose detail.
    const raw = await response.text().catch(() => '');
    let body: { error?: string; details?: unknown } = {};
    if (raw) {
      try {
        body = JSON.parse(raw);
      } catch {
        body = { error: raw.slice(0, 300) };
      }
    }
    let message = body.error || `Request failed (HTTP ${response.status})`;
    // A validation failure (middleware/validate.ts) carries per-field detail.
    // Fold it into the message: on its own, "Validation error" tells the user
    // nothing about WHICH field the server rejected, and callers only surface
    // `message` in their toast.
    if (Array.isArray(body.details) && body.details.length > 0) {
      const fields = (body.details as { field?: string; message?: string }[])
        .map((d) => (d.field ? `${d.field} — ${d.message ?? 'invalid'}` : d.message))
        .filter(Boolean);
      if (fields.length > 0) message = `${message}: ${fields.join('; ')}`;
    }

    // An expired access token is a recoverable condition, not a failure to report:
    // refresh it and replay the request once. Without this the user sees a raw
    // "Unauthorized: Invalid or expired token" from whatever happened to fire first
    // after the tab regained focus. AuthProvider picks the new token up on its own —
    // supabase-js emits TOKEN_REFRESHED, which its onAuthStateChange listener maps
    // into context — so subsequent calls carry it without going through here.
    if (response.status === 401 && token) {
      if (mayRetry) {
        const fresh = await refreshedAccessToken(token);
        if (fresh.token !== null) return request<T>(endpoint, options, fresh.token, false);
        if (fresh.sessionGone) endDeadSession();
      } else {
        // Already replayed with a genuinely fresh token and still rejected.
        endDeadSession();
      }
    }

    console.error(`[api] ${options.method || 'GET'} ${endpoint} → ${response.status}`, message);
    throw new ApiError(message, response.status, body.details);
  }

  // Handle file downloads
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/pdf') || contentType.includes('spreadsheet') || contentType.includes('text/csv')) {
    return response.blob() as unknown as T;
  }

  return response.json() as T;
}
