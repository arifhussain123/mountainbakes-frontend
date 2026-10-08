'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Notification } from '@mb/shared';
import { apiCall } from '@/utils/api';
import { useAuth } from '@/hooks/useAuth';

/**
 * The in-app notification feed, read from the API and kept fresh by polling.
 *
 * It used to be read straight from the `notifications` table over Supabase
 * Realtime, with RLS scoping each user's feed. The API now applies that same
 * scoping (`GET /api/notifications`: addressed to the user personally, or
 * broadcast to their role/branch), so the browser no longer needs a database
 * it can reach — only the API it already talks to for everything else.
 *
 * The price is latency: a notification shows up within one poll interval
 * instead of at once. Everything that hangs off this feed (the bell, and the
 * cache-invalidating bridges in hooks/use*Realtime.ts) inherits that.
 */

// How often a visible, online tab asks for the feed. Hidden tabs do not poll at
// all; they catch up the moment they are looked at again.
const POLL_INTERVAL_MS = 30_000;

// ── Notifications ──────────────────────────────────────────────────────────

interface NotificationsValue {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsValue | null>(null);

export function useNotifications(): NotificationsValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used within <RealtimeProvider>');
  return ctx;
}

interface FeedResponse {
  /** Newest first. `isRead` here is the legacy per-row flag only. */
  notifications: Notification[];
  /** Ids in `notifications` this user has read (per-recipient read-state). */
  readIds: string[];
}

/** Same ids in the same order — the feed has not moved since the last poll. */
function sameFeed(a: Notification[], b: Notification[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((n, i) => n.id === b[i].id && n.isRead === b[i].isRead);
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

function useNotificationsState(): NotificationsValue {
  const { user, token } = useAuth();
  const uid = user?.uid;
  // The feed as the API returned it; the effective feed overlays this user's
  // read-set (see `notifications` below).
  const [rawNotifications, setRawNotifications] = useState<Notification[]>([]);
  // IDs this user has read, from the per-recipient `notification_reads` table.
  // Unlike notifications.is_read (one shared flag per row), this is per
  // (notification, user) — so read-state works for role/branch broadcasts and
  // follows the user across devices at the next poll.
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  // Marked read here but not yet confirmed by the API. A poll that was already
  // in flight when the user clicked answers without them; overlaying this set
  // stops that stale answer from flashing the badge back on.
  const pendingReads = useRef<Set<string>>(new Set());

  // The token changes on every refresh. Held in a ref so a refresh does not
  // tear down and restart the poll timer.
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);
  const signedIn = Boolean(uid && token);

  useEffect(() => {
    // Signed out, or holding an offline identity with no token: nothing to ask
    // the API for. Any prior session's feed is cleared by the previous cleanup.
    if (!signedIn) return;

    let cancelled = false;
    let inFlight = false;

    const poll = async () => {
      if (inFlight || cancelled) return;
      // A hidden tab has nobody reading it, and an offline one cannot be
      // answered — apiCall would only log a network error every interval.
      if (document.visibilityState !== 'visible' || navigator.onLine === false) return;
      const currentToken = tokenRef.current;
      if (!currentToken) return;

      inFlight = true;
      try {
        const feed = await apiCall<FeedResponse>('/api/notifications', {}, currentToken);
        if (cancelled) return;
        // Unchanged state is handed back as the SAME object, so a quiet poll
        // re-renders nothing and the bridges' effects do not re-run.
        setRawNotifications((prev) => (sameFeed(prev, feed.notifications) ? prev : feed.notifications));
        setReadIds((prev) => {
          const next = new Set(feed.readIds);
          pendingReads.current.forEach((id) => next.add(id));
          return sameSet(prev, next) ? prev : next;
        });
      } catch (err) {
        // Keep what is on screen: one failed poll must not empty the bell. The
        // next interval, or the tab regaining focus or connection, tries again.
        console.warn('[notifications] feed poll failed:', err instanceof Error ? err.message : err);
      } finally {
        inFlight = false;
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), POLL_INTERVAL_MS);
    // Coming back to the tab or back online is when a stale feed matters most,
    // so do not wait out the rest of the interval.
    const onWake = () => void poll();
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('online', onWake);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('online', onWake);
      // Drop this session's feed and read-set so a different user never inherits it.
      pendingReads.current = new Set();
      setRawNotifications([]);
      setReadIds(new Set());
    };
  }, [uid, signedIn]);

  // The feed the app consumes: a row is read if the legacy is_read flag says so
  // OR this user has a notification_reads row for it.
  const notifications = useMemo(
    () => rawNotifications.map((n) => (n.isRead || readIds.has(n.id) ? { ...n, isRead: true } : n)),
    [rawNotifications, readIds],
  );

  const markRead = useCallback(async (ids: string[], label: string) => {
    const currentToken = tokenRef.current;
    if (!uid || !currentToken || ids.length === 0) return;
    // Optimistic: the badge clears at once, the API catches up behind it.
    ids.forEach((id) => pendingReads.current.add(id));
    setReadIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });
    try {
      await apiCall('/api/notifications/read', { method: 'POST', body: JSON.stringify({ ids }) }, currentToken);
    } catch (err) {
      console.error(`[notifications] ${label} failed:`, err instanceof Error ? err.message : err);
    } finally {
      // Confirmed or failed, the next poll is the authority from here on.
      ids.forEach((id) => pendingReads.current.delete(id));
    }
  }, [uid]);

  const markAsRead = useCallback((id: string) => markRead([id], 'markAsRead'), [markRead]);

  const markAllAsRead = useCallback(
    () => markRead(notifications.filter((n) => !n.isRead).map((n) => n.id), 'markAllAsRead'),
    [markRead, notifications],
  );

  const unreadCount = useMemo(
    () => notifications.reduce((acc, n) => (n.isRead ? acc : acc + 1), 0),
    [notifications],
  );

  return { notifications, unreadCount, markAsRead, markAllAsRead };
}

// ── Composed provider ────────────────────────────────────────────────────────

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const notifications = useNotificationsState();
  return (
    <NotificationsContext.Provider value={notifications}>
      {children}
    </NotificationsContext.Provider>
  );
}
