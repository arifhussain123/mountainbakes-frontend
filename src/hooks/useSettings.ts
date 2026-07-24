'use client';

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { apiCall, ApiError } from '@/utils/api';
import { qk } from '@/lib/queryKeys';
import type { AppSettings } from '@mb/shared';

/**
 * App-wide settings.
 *
 * Backed by TanStack Query like the rest of the app's server state, rather than
 * the hand-rolled effect + zustand slice this replaced. That earns its keep twice
 * here: the hook is mounted from ~8 places at once (Sidebar, plus whatever page
 * is open), so one shared cache entry collapses those into a single request; and
 * a transient failure now retries with backoff instead of wedging. The old effect
 * ran on `token && !settings` and re-ran only when one of those changed — so a
 * single blip (API restarting mid-dev, a 5xx) left `settings` null for the rest
 * of the session with nothing able to re-trigger the fetch.
 */

/**
 * Settings are edited by hand, from one admin screen, and read on nearly every
 * page — so don't pay for a round-trip on each navigation. SettingsPage refetches
 * explicitly after it saves, which is what actually keeps this current.
 */
const STALE_TIME_MS = 5 * 60 * 1000;

/** Initial attempt plus three retries — roughly 7s of backoff before giving up. */
const MAX_ATTEMPTS = 4;

export function useSettings() {
  const { token } = useAuth();

  const { data, refetch } = useQuery({
    queryKey: qk.settings(),
    queryFn: () => apiCall<{ settings: AppSettings }>('/api/settings', {}, token),
    select: (r) => r.settings,
    enabled: !!token,
    staleTime: STALE_TIME_MS,
    // Overrides QueryProvider's blanket `retry: 1`. Only a transient failure is
    // worth repeating — a network error (ApiError carries status 0 for those) or
    // a 5xx. Any 4xx is the server's considered answer: 401 means the session is
    // gone and the API client is already tearing it down, 403 means this account
    // may not read settings. Retrying either burns requests and, for the 401,
    // delays the redirect to /login by the full backoff window.
    retry: (failureCount, error) => {
      const status = error instanceof ApiError ? error.status : null;
      if (status !== null && status >= 400 && status < 500) return false;
      return failureCount < MAX_ATTEMPTS;
    },
    retryDelay: (failureCount) => Math.min(1000 * 2 ** failureCount, 8000),
  });

  const refreshSettings = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return { settings: data ?? null, refreshSettings };
}
