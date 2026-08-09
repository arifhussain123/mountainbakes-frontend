'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  evaluateGeofence,
  type GeofenceVerdict,
  type GeoPoint,
  type GeoPosition,
} from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import {
  getCurrentPosition,
  getPermissionState,
  setLastPosition,
  type PositionFailure,
} from '@/lib/geo/position';

/**
 * One location watcher for the whole signed-in app.
 *
 * Mounted once in the dashboard layout, exactly like RealtimeProvider and for the
 * same reason: mounting it per page would restart the GPS ticker on every
 * navigation, re-prompt for permission, and give each screen its own disagreeing
 * idea of where the user is.
 *
 * It owns three things:
 *
 *   1. The freshest device position, mirrored into lib/geo/position so the API
 *      client can stamp `X-Geo-Position` on outgoing requests synchronously.
 *   2. A local verdict, computed with the SAME shared rule the server enforces, so
 *      a screen can refuse an action before the round trip. This is UX, never
 *      security — the server re-checks every guarded request regardless.
 *   3. The periodic re-verification beat, which is what notices a user driving away
 *      mid-session and what feeds the admin dashboard's online/outside tiles.
 */

/** What the server tells us about this user's branch and the rules to apply. */
interface GeofenceConfig {
  exempt: boolean;
  enabled: boolean;
  branch: {
    branchId: string;
    branchName: string | null;
    latitude: number;
    longitude: number;
    radiusKm: number;
  } | null;
  config: {
    verifyIntervalMin: number;
    requireHighAccuracy: boolean;
    gpsTimeoutSec: number;
    maxPositionAgeSec: number;
    defaultRadiusKm: number;
  };
}

export interface GeofenceState {
  /** True while the first fix is still being obtained. */
  loading: boolean;
  /** False when geofencing does not apply to this user at all. */
  applies: boolean;
  verdict: GeofenceVerdict | null;
  position: GeoPosition | null;
  branchCentre: GeoPoint | null;
  branchName: string | null;
  radiusKm: number | null;
  /** Why the last attempt to read a position failed, if it did. */
  failure: PositionFailure | null;
  permission: PermissionState | null;
  lastVerifiedAt: string | null;
  /** Force an immediate re-read. Returns the fresh verdict. */
  refresh: () => Promise<GeofenceVerdict | null>;
}

const GeofenceContext = createContext<GeofenceState | null>(null);

/** Ten minutes is the fallback cadence if the server never answers with a config. */
const FALLBACK_INTERVAL_MIN = 10;

export function GeofenceProvider({ children }: { children: React.ReactNode }) {
  const { user, token } = useAuth();
  const [config, setConfig] = useState<GeofenceConfig | null>(null);
  const [verdict, setVerdict] = useState<GeofenceVerdict | null>(null);
  const [position, setPosition] = useState<GeoPosition | null>(null);
  const [failure, setFailure] = useState<PositionFailure | null>(null);
  const [permission, setPermission] = useState<PermissionState | null>(null);
  const [lastVerifiedAt, setLastVerifiedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * `refresh` legitimately changes whenever the config does — it reads the radius,
   * accuracy rule and timeout out of it. But it is also what the interval calls,
   * and a ticker that restarts on every config change would drift.
   *
   * So the ticker calls through a ref instead of depending on the function, and the
   * ref is updated in an EFFECT rather than during render. Assigning a ref while
   * rendering is a genuine violation, not a lint technicality: with concurrent
   * rendering React may render this component and discard the result, which would
   * leave the ref pointing at a closure that was never committed.
   */
  const refreshRef = useRef<() => Promise<GeofenceVerdict | null>>(async () => null);

  // Load the rules for this identity. Re-runs on sign-in and on a branch change.
  useEffect(() => {
    if (!token) {
      setConfig(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await apiCall<GeofenceConfig>('/api/branch-locations/me', {}, token);
        if (!cancelled) setConfig(data);
      } catch {
        // An API that cannot describe the rules must not lock the user out of the
        // app. The SERVER still refuses guarded requests on its own terms, so the
        // safe client-side failure is to stop showing a status, not to start
        // blocking screens the user may legitimately be allowed to use.
        if (!cancelled) setConfig(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token, user?.branchId]);

  const applies = Boolean(config && config.enabled && !config.exempt);

  /**
   * Take a reading, publish it for the API client, and evaluate it locally.
   *
   * The local verdict deliberately mirrors the server's inputs — same rule, same
   * radius, same accuracy setting — so the screen and the API agree. Where they
   * cannot agree (a clock that is wrong, a config that just changed) the server
   * wins, because it is the one that refuses the request.
   */
  const refresh = useCallback(async (): Promise<GeofenceVerdict | null> => {
    const current = config;
    if (!current || !current.enabled || current.exempt) {
      setVerdict(null);
      return null;
    }

    const result = await getCurrentPosition({
      timeoutSec: current.config.gpsTimeoutSec,
      highAccuracy: current.config.requireHighAccuracy,
      // Never reuse a platform fix older than a third of the verification interval,
      // or the ticker just re-reads the same cached coordinates forever.
      maxAgeSec: Math.max(10, Math.round((current.config.verifyIntervalMin * 60) / 3)),
    });

    const nextPosition = result.ok ? result.position : null;
    setPosition(nextPosition);
    setFailure(result.ok ? null : result.failure);
    // Published even when null: a failed read must CLEAR the stale header rather
    // than let the last good position keep authorising requests indefinitely.
    setLastPosition(nextPosition);

    const nextVerdict = evaluateGeofence({
      branch: current.branch
        ? { latitude: current.branch.latitude, longitude: current.branch.longitude }
        : null,
      position: nextPosition,
      radiusKm: current.branch?.radiusKm ?? current.config.defaultRadiusKm,
      enabled: true,
      requireHighAccuracy: current.config.requireHighAccuracy,
      maxAgeSeconds: current.config.maxPositionAgeSec,
      nowMs: Date.now(),
    });
    setVerdict(nextVerdict);
    if (result.ok) setLastVerifiedAt(new Date().toISOString());

    // Report it. This is what populates the admin tiles and puts a drift outside the
    // area into the audit trail when it happens, rather than at the next sale.
    // Fire-and-forget — a failed beat must not disturb the user's screen.
    if (token) {
      void apiCall('/api/branch-locations/verify', { method: 'POST', body: '{}' }, token).catch(
        () => undefined,
      );
    }

    return nextVerdict;
  }, [token, config]);

  // Keep the ticker's handle on `refresh` current, without making the ticker itself
  // depend on it.
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const intervalMin = config?.config.verifyIntervalMin ?? FALLBACK_INTERVAL_MIN;

  // First fix, then the ticker. Depends only on whether the rule applies and how
  // often — NOT on `refresh` — so a config refetch cannot restart the cycle.
  useEffect(() => {
    if (!applies) {
      setLastPosition(null);
      return;
    }
    let stopped = false;

    void getPermissionState().then((state) => { if (!stopped) setPermission(state); });
    void refreshRef.current();

    const id = setInterval(() => { void refreshRef.current(); }, Math.max(1, intervalMin) * 60_000);

    // A backgrounded tab has its timers throttled, so a user who returns after an
    // hour would otherwise be carrying an hour-old position — which the server
    // rejects as stale, blocking a sale they should be allowed to make. Re-read on
    // the way back in.
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshRef.current(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [applies, intervalMin]);

  const value = useMemo<GeofenceState>(
    () => ({
      loading,
      applies,
      verdict,
      position,
      branchCentre: config?.branch
        ? { latitude: config.branch.latitude, longitude: config.branch.longitude }
        : null,
      branchName: config?.branch?.branchName ?? null,
      radiusKm: config?.branch?.radiusKm ?? config?.config.defaultRadiusKm ?? null,
      failure,
      permission,
      lastVerifiedAt,
      refresh,
    }),
    [loading, applies, verdict, position, config, failure, permission, lastVerifiedAt, refresh],
  );

  return <GeofenceContext.Provider value={value}>{children}</GeofenceContext.Provider>;
}

/**
 * Geofence state for the current user.
 *
 * Returns an inert, permissive state when no provider is mounted — the admin and
 * production route groups have no reason to carry one, and a hook that threw there
 * would force every shared component to know which group it was rendering under.
 */
export function useGeofence(): GeofenceState {
  return (
    useContext(GeofenceContext) ?? {
      loading: false,
      applies: false,
      verdict: null,
      position: null,
      branchCentre: null,
      branchName: null,
      radiusKm: null,
      failure: null,
      permission: null,
      lastVerifiedAt: null,
      refresh: async () => null,
    }
  );
}
