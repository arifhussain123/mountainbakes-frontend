import type { GeoPosition } from '@mb/shared';

/**
 * Browser geolocation, wrapped.
 *
 * Kept apart from React so the same module is usable from a plain event handler,
 * and so the eventual React Native client only has to replace THIS file — the
 * geofence rule it feeds (shared/utils/geo) stays untouched.
 *
 * Everything here is best-effort by nature. A browser can refuse, stall
 * indefinitely, or hand back a fix from a cell tower three suburbs away, and none
 * of those are error conditions the caller can fix. So the API is
 * "always resolves, never rejects" and the reason lives in the result.
 */

export type PositionFailure =
  /** The user (or a permissions policy) said no. Will not resolve by retrying. */
  | 'denied'
  /** No fix within the timeout — indoors, airplane mode, no GPS hardware. */
  | 'timeout'
  /** The device has the capability but could not get a fix right now. */
  | 'unavailable'
  /** navigator.geolocation missing entirely, or a non-secure context. */
  | 'unsupported';

export type PositionResult =
  | { ok: true; position: GeoPosition }
  | { ok: false; failure: PositionFailure };

export interface PositionOptions {
  /** Seconds to wait for a fix before giving up. */
  timeoutSec?: number;
  /**
   * Ask the platform for its best available fix (GPS rather than wifi/cell
   * trilateration). Costs battery and time, which is why it is a setting.
   */
  highAccuracy?: boolean;
  /**
   * Seconds a cached platform fix may be reused for. Zero forces a fresh reading.
   *
   * Set well below the verification interval on purpose: accepting a cached fix
   * older than the interval would let the browser answer every check with the same
   * stale position, which is precisely what the periodic check exists to prevent.
   */
  maxAgeSec?: number;
}

const DEFAULTS = { timeoutSec: 20, highAccuracy: true, maxAgeSec: 30 };

/**
 * Geolocation requires a secure context. On http:// (other than localhost) the API
 * is either absent or permanently denied — worth distinguishing, because it looks
 * exactly like a user refusal and sends people to the wrong fix.
 */
export function isGeolocationSupported(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

/** Map the browser's numeric error codes onto our reasons. */
function failureFor(error: GeolocationPositionError): PositionFailure {
  if (error.code === error.PERMISSION_DENIED) return 'denied';
  if (error.code === error.TIMEOUT) return 'timeout';
  return 'unavailable';
}

/**
 * One position reading.
 *
 * `capturedAt` comes from the browser's own `timestamp` rather than Date.now(), so
 * the age the server checks is the age of the FIX, not the age of the request. A
 * device that took eighteen seconds to get a lock should not have those eighteen
 * seconds counted twice.
 */
export function getCurrentPosition(options: PositionOptions = {}): Promise<PositionResult> {
  const { timeoutSec, highAccuracy, maxAgeSec } = { ...DEFAULTS, ...options };

  if (!isGeolocationSupported()) {
    return Promise.resolve({ ok: false, failure: 'unsupported' });
  }

  return new Promise((resolve) => {
    // getCurrentPosition's own timeout is not always honoured — Safari in
    // particular can sit on a prompt indefinitely, and a promise that never
    // settles would hang whatever awaited it. This is the backstop.
    let settled = false;
    const finish = (result: PositionResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const timer = setTimeout(() => finish({ ok: false, failure: 'timeout' }), (timeoutSec + 2) * 1000);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        clearTimeout(timer);
        finish({
          ok: true,
          position: {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
            capturedAt: new Date(pos.timestamp).toISOString(),
          },
        });
      },
      (error) => {
        clearTimeout(timer);
        finish({ ok: false, failure: failureFor(error) });
      },
      {
        enableHighAccuracy: highAccuracy,
        timeout: timeoutSec * 1000,
        maximumAge: maxAgeSec * 1000,
      },
    );
  });
}

/**
 * Current permission state without prompting, or null where the Permissions API is
 * unavailable (Safari until recently).
 *
 * Used to tell "has not been asked yet" apart from "has refused", so the UI can
 * offer a button that will actually do something instead of one that silently
 * no-ops against a standing denial.
 */
export async function getPermissionState(): Promise<PermissionState | null> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return null;
  try {
    const status = await navigator.permissions.query({ name: 'geolocation' as PermissionName });
    return status.state;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Last-known position, shared with the API client.
// ---------------------------------------------------------------------------
//
// The API client attaches `X-Geo-Position` to every request, and it cannot await a
// GPS fix to do it — that would put up to twenty seconds in front of every call in
// the app. So the provider writes the freshest reading here and the client reads it
// synchronously.
//
// A module-level variable rather than React state precisely BECAUSE the client is
// not a component and must not be re-rendered into. Its lifetime is the tab.

let lastPosition: GeoPosition | null = null;

export function setLastPosition(position: GeoPosition | null): void {
  lastPosition = position;
}

export function getLastPosition(): GeoPosition | null {
  return lastPosition;
}
