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

export async function apiCall<T = unknown>(
  endpoint: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  assertApiReachable();

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
    console.error(`[api] ${options.method || 'GET'} ${endpoint} → ${response.status}`, body);
    throw new ApiError(message, response.status, body.details);
  }

  // Handle file downloads
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/pdf') || contentType.includes('spreadsheet') || contentType.includes('text/csv')) {
    return response.blob() as unknown as T;
  }

  return response.json() as T;
}
