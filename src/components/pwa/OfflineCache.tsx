'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { clearSnapshot, restoreSnapshot, saveSnapshot } from '@/lib/offline/queryPersist';

/**
 * Keeps the on-device copy of the last synced data in step with the live cache,
 * so the app can be opened and read with no connection.
 *
 * Mounted inside AuthProvider rather than in QueryProvider, which sits above it:
 * a snapshot belongs to one signed-in user and must never be restored into
 * somebody else's session on a shared branch phone, so there is nothing to
 * restore until we know who this is.
 */

/**
 * Saves are throttled and trailing. The cache fires an event for every query
 * that settles — a dashboard opening produces dozens in a second — and
 * serialising on each would jank the screen being read.
 */
const SAVE_THROTTLE_MS = 10_000;

export function OfflineCache() {
  const queryClient = useQueryClient();
  const { user, loading } = useAuth();
  const userId = user?.uid ?? null;

  useEffect(() => {
    // Say nothing until the session has resolved. `user` is null while the
    // Supabase session is still being read from storage, and treating that as a
    // sign-out would wipe the snapshot every cold start — exactly when it is
    // about to be needed.
    if (loading) return;

    if (!userId) {
      // Genuinely signed out. The next person to pick up this phone must not
      // find the last user's figures waiting for them.
      void clearSnapshot();
      return;
    }

    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let lastSavedAt = 0;

    const save = () => {
      timer = null;
      lastSavedAt = Date.now();
      void saveSnapshot(queryClient, userId);
    };

    const schedule = () => {
      if (timer) return;
      timer = setTimeout(save, Math.max(0, SAVE_THROTTLE_MS - (Date.now() - lastSavedAt)));
    };

    // A phone is far more often just closed than deliberately backgrounded, and
    // `pagehide`/`hidden` are the last events a browser reliably delivers.
    // Without these the final minutes of a shift would never reach disk.
    const flush = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      void saveSnapshot(queryClient, userId);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flush();
    };

    void (async () => {
      await restoreSnapshot(queryClient, userId);
      if (cancelled) return;
      // Subscribed only AFTER restoring, so hydration's own cache events do not
      // immediately schedule a save of what was just read back.
      unsubscribe = queryClient.getQueryCache().subscribe(schedule);
    })();

    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      cancelled = true;
      unsubscribe?.();
      if (timer) clearTimeout(timer);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [queryClient, userId, loading]);

  return null;
}
