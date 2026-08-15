/**
 * Base URL for the Express API.
 *
 * The API is a separate host. next.config.ts proxies nothing, so the browser calls
 * it cross-origin at NEXT_PUBLIC_API_URL and the API's own CORS_ORIGINS allowlist
 * (server/src/app.ts) is what permits those requests. DEPLOY.md marks the variable
 * REQUIRED, and NEXT_PUBLIC_* is inlined at BUILD time — so it has to be set as a
 * config var *before* the web app is built, not merely before it boots.
 *
 * Give it scheme + host with NO trailing slash: it is concatenated straight onto
 * `/api/...` in request() below.
 *
 * Leaving it unset is a misconfiguration, not a default. The browser would otherwise
 * fall back to a relative base and call this app's own origin — which is a static
 * bundle on Firebase Hosting with nothing at all under /api, so every request 404s
 * with an HTML body. DEPLOY.md lists that as a failure mode; assertApiReachable()
 * below rejects the case outright rather than letting it masquerade as a missing
 * route.
 *
 * The server-side loopback fallback below is a leftover from the retired single-dyno
 * deploy, where the API shared this host behind an /api/* rewrite. It survives only
 * because this module is still imported during the static prerender, which never
 * issues a request.
 */
import { encodeGeoPosition, GEO_POSITION_HEADER } from '@mb/shared';
// Safe to import statically: the module has no import-time side effects and guards
// every `navigator` access behind a typeof check, so it survives the static
// prerender where this file is also evaluated.
import { getLastPosition } from '@/lib/geo/position';

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
 * Guards the two ways to misconfigure the base URL, both of which otherwise surface as
 * something that looks like a different bug entirely.
 *
 * 1. Unset. Every request then goes to this app's own origin and 404s with the host's
 *    HTML error page — which reads as "the API route is missing" rather than "the API
 *    was never called". Nothing proxies /api/* any more, so this is broken everywhere,
 *    not just in production.
 * 2. Set *explicitly* to a localhost URL (copied from a dev .env, say) and then deployed
 *    to a real domain — every request fails with ERR_CONNECTION_REFUSED or a mixed-content
 *    block, and the page renders empty with nothing useful in the console.
 *
 * Browser-only: the server-side path legitimately uses the loopback fallback above, so it
 * returns before either check.
 */
function assertApiReachable(): void {
  if (typeof window === 'undefined') return;
  if (!EXPLICIT_API_URL) {
    throw new ApiError(
      `NEXT_PUBLIC_API_URL is unset, so every /api/* request goes to this app's own ` +
        `origin instead of the Express API. This origin is a static bundle with nothing ` +
        `under /api, so every request 404s with an HTML page. Set it to the API's origin ` +
        `(scheme + host, no trailing slash) and REBUILD: NEXT_PUBLIC_* is inlined at ` +
        `build time, so setting it on a running app has no effect.`,
      0
    );
  }
  const onLocalHost = isLocalHost(window.location.origin);
  if (!onLocalHost && isLocalHost(EXPLICIT_API_URL)) {
    throw new ApiError(
      `API is misconfigured for production: NEXT_PUBLIC_API_URL is "${EXPLICIT_API_URL}", ` +
        `which only exists on a developer's machine. Set it to the deployed API's origin ` +
        `(scheme + host, no trailing slash) and REBUILD — NEXT_PUBLIC_* values are baked ` +
        `in at build time, so changing the config var alone will not take effect.`,
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
 * good. Signing out locally is what makes RouteGuard notice: it reads `user` from
 * AuthProvider, so until the Supabase session is actually cleared the user keeps
 * sitting on a fully rendered page where every single request 401s and no screen
 * ever loads its data.
 *
 * A hard navigation rather than router.replace(): it drops all the React state
 * built on the dead identity, which a client-side route change would keep.
 */
function endDeadSession(): void {
  if (typeof window === 'undefined') return;
  if (window.location.pathname.startsWith('/login')) return;

  sessionTeardown ??= (async () => {
    try {
      const { supabase } = await import('@/lib/supabase/client');
      await supabase.auth.signOut();
    } catch {
      // The session is already unusable; leaving the page is what matters.
    }
    window.location.replace('/login');
  })();
}

/**
 * Attach the freshest known device position, when there is one.
 *
 * A header set in ONE place rather than a `geo` field threaded through every
 * mutation schema — the alternative is that each new guarded endpoint has to
 * remember to carry it, and the one that forgets fails open.
 *
 * Read synchronously from the module-level cache in lib/geo/position, never
 * awaited: a GPS fix can take twenty seconds and this runs in front of every
 * request in the app. GeofenceProvider is what keeps that cache warm.
 *
 * Sent on reads as well as writes, which is deliberate — /branch-locations/me
 * returns the caller's live status, and the periodic verify beat is a POST that
 * carries nothing else. Requests made before the first fix simply omit it; the
 * server treats an absent header as "no position", and only the guarded endpoints
 * care.
 */
function geoPositionHeader(): Record<string, string> {
  const position = getLastPosition();
  if (!position) return {};
  return { [GEO_POSITION_HEADER]: encodeGeoPosition(position) };
}

export async function apiCall<T = unknown>(
  endpoint: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  assertApiReachable();

  // Refuse writes with no connection, in the app's own words.
  //
  // Reading offline works — the last synced data is restored from disk (see
  // lib/offline/queryPersist.ts) — but a write has nowhere to go, and nothing
  // queues it: see the disabled Background Sync queue in public/sw.js for why
  // replaying mutations is not safe to switch on as it stands. Failing here
  // rather than in fetch() is what turns an alarming "could not reach the API,
  // check CORS_ORIGINS" into a sentence a branch user can act on.
  //
  // navigator.onLine only reliably tells the truth when it says FALSE — online
  // can still mean a dead captive portal — so this catches the certain case and
  // leaves the rest to the network error below.
  const method = (options.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new ApiError(
      "You're offline. This can't be saved until you reconnect — your entry is still on screen, so nothing is lost.",
      0,
    );
  }

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
    ...geoPositionHeader(),
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

    // Log the full URL, not just the path: a 404 caused by the wrong base URL is
    // indistinguishable from a genuinely missing route unless the origin is visible.
    console.error(
      `[api] ${options.method || 'GET'} ${API_URL}${endpoint} → ${response.status}`,
      message
    );
    throw new ApiError(message, response.status, body.details);
  }

  // Handle file downloads
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/pdf') || contentType.includes('spreadsheet') || contentType.includes('text/csv')) {
    return response.blob() as unknown as T;
  }

  return response.json() as T;
}
