import type { BillInput, QuotationInput, SupplierPortalView } from '@mb/shared';
import { API_URL } from '@/lib/api/client';

/**
 * The supplier portal's own transport — deliberately NOT apiCall().
 *
 * A supplier reaches /supplier-portal/ from a WhatsApp link and has no Mountain
 * Bakes account. The link's token is the whole authorization, so three things
 * the staff client does would be wrong here:
 *
 *  - apiCall attaches whatever staff session the browser holds and, on a 401,
 *    refreshes it or signs it out. A staff member who opens a supplier link on
 *    their own phone must not send their access token next to the supplier's
 *    token, and a refused supplier token must not end their session.
 *  - It adds the device-position header the geofence uses. Nothing about a
 *    supplier's location belongs in this request.
 *  - Its error body parsing drops the server's `code` (expired / revoked /
 *    invalid), which is what this page decides its screen from.
 *
 * THE TOKEN. It arrives in the URL FRAGMENT (`#t=…`, services/purchasing/
 * common.ts on the API), which browsers never send to a web server, so it is
 * in no hosting log. takeLinkToken() moves it out of the address bar into this
 * tab's sessionStorage (so a refresh keeps working, and closing the tab forgets
 * it) and strips the fragment with history.replaceState, so the link is not
 * left on screen to be copied or screenshotted. From then on it travels only
 * in the X-Supplier-Token header — never a query string, never a log line.
 */

const TOKEN_KEY = 'mb.supplierPortal.link';

/** The API's own shape check (resolveToken in portal.service.ts). */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{40,60}$/;

/**
 * The token for this tab: from the link's fragment if it carries one (and then
 * the fragment is removed from the address bar), else the one this tab already
 * holds, else null.
 */
export function takeLinkToken(): string | null {
  if (typeof window === 'undefined') return null;
  const hash = window.location.hash.replace(/^#/, '');
  const fromLink = hash ? new URLSearchParams(hash).get('t') : null;
  if (hash) {
    // Whatever the fragment held, it does not stay visible.
    window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }
  if (fromLink) {
    try {
      sessionStorage.setItem(TOKEN_KEY, fromLink);
    } catch {
      // Private mode / storage blocked: the token lives in memory only, and a
      // refresh asks for the link again. Nothing else changes.
    }
    return fromLink;
  }
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Forget a token the server has refused for good (expired, revoked, invalid). */
export function forgetLinkToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing stored, or storage blocked — nothing to forget.
  }
}

export function looksLikeToken(token: string): boolean {
  return TOKEN_SHAPE.test(token);
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * What went wrong, as the screen needs to know it:
 *   link        the link itself is dead (expired, revoked, invalid, demand gone)
 *   validation  the server refused the form — `fieldErrors` says where
 *   conflict    the demand moved on (Production decided meanwhile) — reload
 *   rate_limited too many requests from this address
 *   network     no answer at all — retry
 *   server      anything else
 */
export type PortalErrorKind = 'link' | 'validation' | 'conflict' | 'rate_limited' | 'network' | 'server';

export class SupplierPortalError extends Error {
  constructor(
    message: string,
    readonly kind: PortalErrorKind,
    readonly status: number,
    readonly code: string | null = null,
    /** Validation detail keyed by the field path the API reports, e.g. `items.2.unitRate`. */
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'SupplierPortalError';
  }
}

const LINK_CODES = new Set(['invalid', 'expired', 'revoked', 'missing']);

function toError(status: number, body: { error?: string; code?: string; details?: unknown }): SupplierPortalError {
  const code = typeof body.code === 'string' ? body.code : null;
  const message = body.error || `Something went wrong (HTTP ${status}). Please try again.`;
  if (code && LINK_CODES.has(code)) return new SupplierPortalError(message, 'link', status, code);
  if (status === 400) {
    const fieldErrors: Record<string, string> = {};
    if (Array.isArray(body.details)) {
      for (const d of body.details as Array<{ field?: string; message?: string }>) {
        if (d.field && !fieldErrors[d.field]) fieldErrors[d.field] = d.message ?? 'Check this value';
      }
    }
    const summary = Object.keys(fieldErrors).length > 0 ? 'Some details need fixing — see the highlighted fields.' : message;
    return new SupplierPortalError(summary, 'validation', status, code, fieldErrors);
  }
  if (status === 409) return new SupplierPortalError(message, 'conflict', status, code);
  if (status === 429) return new SupplierPortalError(message, 'rate_limited', status, code);
  return new SupplierPortalError(
    status >= 500 ? 'Mountain Bakes could not process this just now. Please try again in a minute.' : message,
    'server',
    status,
    code,
  );
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

async function portalRequest<T>(token: string, path: string, body?: unknown): Promise<T> {
  if (!API_URL) {
    throw new SupplierPortalError('This page is not set up correctly. Please tell Mountain Bakes.', 'server', 0);
  }
  const method = body === undefined ? 'GET' : 'POST';
  if (method === 'POST' && typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new SupplierPortalError(
      "You're offline. Nothing was sent — your entries are still here. Reconnect and try again.",
      'network',
      0,
    );
  }

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/supplier-portal${path}`, {
      method,
      headers: {
        'X-Supplier-Token': token,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      // No cookies, no cached copy, and no Referer: nothing but the header
      // above identifies this request.
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    // Deliberately not logged: the request carried the token.
    throw new SupplierPortalError(
      method === 'POST'
        ? 'Could not reach Mountain Bakes. Check your internet connection — your entries are still here.'
        : 'Could not reach Mountain Bakes. Check your internet connection and try again.',
      'network',
      0,
    );
  }

  const raw = await res.text().catch(() => '');
  let parsed: unknown = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }
  }
  if (!res.ok) throw toError(res.status, parsed as { error?: string; code?: string; details?: unknown });
  return parsed as T;
}

export interface QuotationSubmitResult {
  version: number;
  total: number;
  replayed: boolean;
  demand: SupplierPortalView;
}

export interface BillSubmitResult {
  supplierBillNo: string;
  grandTotal: number;
  differsFromQuotation: boolean;
  replayed: boolean;
  demand: SupplierPortalView;
}

export const supplierPortalApi = {
  demand: (token: string) => portalRequest<SupplierPortalView>(token, '/demand'),
  submitQuotation: (token: string, input: QuotationInput) =>
    portalRequest<QuotationSubmitResult>(token, '/quotation', input),
  submitBill: (token: string, input: BillInput) => portalRequest<BillSubmitResult>(token, '/bill', input),
};

// ---------------------------------------------------------------------------
// Form helpers
// ---------------------------------------------------------------------------

/**
 * A retry key for one submission. Minted when the supplier reaches the review
 * step and kept until they change something, so a Submit that timed out after
 * the server saved it, pressed again, returns the first quotation instead of
 * creating a second version.
 */
export function newClientRequestId(): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return `portal-${c.randomUUID()}`;
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return `portal-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** A typed figure as a number: '' → null, '1,250.5' → 1250.5, junk → NaN. */
export function parseFigure(value: string): number | null {
  const s = value.replace(/,/g, '').trim();
  if (s === '') return null;
  return /^\d*\.?\d+$|^\d+\.$/.test(s) ? Number(s) : Number.NaN;
}

/** Rupees to the paisa, for the on-screen preview only — the server's figure is the real one. */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
