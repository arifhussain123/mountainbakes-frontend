'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Notification } from '@mb/shared';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { sleep } from '@/utils/helpers';

/**
 * Notifications are live again, read straight from the `notifications` table
 * over Supabase Realtime — the design the schema was built for (migration 07:
 * "the table the client subscribes to via Supabase Realtime"). RLS (migration
 * 09) scopes each user's feed to notifications addressed to them personally or
 * broadcast to their role/branch, so no client-side filtering is needed.
 */

// How many recent notifications to hold in the in-app feed.
const FEED_LIMIT = 50;

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

/** Shape of a `notifications` row as it comes back from PostgREST/Realtime. */
interface NotificationRow {
  id: string;
  type: Notification['type'];
  title: string;
  message: string;
  is_read: boolean;
  target_user_id: string | null;
  target_role: string | null;
  branch_id: string | null;
  related_id: string | null;
  created_at: string;
}

/** Map a snake_case DB row to the camelCase `Notification` the app consumes. */
function mapRow(r: NotificationRow): Notification {
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    message: r.message,
    isRead: r.is_read,
    targetUserId: r.target_user_id,
    targetRole: r.target_role as Notification['targetRole'],
    branchId: r.branch_id,
    relatedId: r.related_id,
    createdAt: r.created_at,
  };
}

/** A `notification_reads` row — one per (notification, recipient) that has been read. */
interface NotificationReadRow { notification_id: string; user_id: string }

/**
 * Flatten a PostgREST error into one readable line.
 *
 * Logging the error object directly renders as `{}` in the Next dev overlay —
 * it serialises with JSON.stringify, and the interesting fields (message, and
 * often details/hint) are either non-enumerable or undefined. That hides the
 * SQLSTATE, which is the only part that says what actually went wrong.
 */
function describeError(e: unknown): string {
  if (!e || typeof e !== 'object') return String(e);
  const { message, code, details, hint } = e as {
    message?: string; code?: string; details?: string; hint?: string;
  };
  const parts = [message, code && `code=${code}`, details && `details=${details}`, hint && `hint=${hint}`];
  return parts.filter(Boolean).join(' | ') || JSON.stringify(e);
}

/**
 * Is this failure worth retrying, or is it the server's considered answer?
 *
 * Keyed on the PostgREST error CODE, not the HTTP status — and that distinction
 * is the whole point. PGRST301/303 come back as 401, so the usual "never retry a
 * 4xx" rule (see the retry predicate in hooks/useSettings.ts, which is right for
 * the Express API) would skip exactly the case this exists for.
 *
 *   PGRST301  JWT expired      ┐ clock skew between Supabase's own GoTrue and
 *   PGRST303  JWT issued at future ┘ PostgREST nodes. PostgREST already allows
 *             30s of skew, so seeing these means the drift is larger than that.
 *             It resolves on its own as wall-clock time advances.
 *   PGRST000-002  could not connect / schema cache — a restart or a blip.
 *   no code at all — fetch itself threw (offline, DNS, TLS).
 *
 * Everything else is deliberate: 42501 is an RLS denial, other PGRST3xx are real
 * auth rejections. Repeating those burns requests and buries the actual problem.
 *
 * NOTE: do NOT "fix" a PGRST303 by calling supabase.auth.refreshSession(). A new
 * token carries a LATER iat, which is further into the lagging node's future —
 * strictly worse. Waiting is the only thing that helps.
 */
const TRANSIENT_CODES = new Set(['PGRST301', 'PGRST303', 'PGRST000', 'PGRST001', 'PGRST002']);

function isTransient(e: unknown): boolean {
  if (!e) return false;
  const code = (e as { code?: string }).code;
  // A thrown fetch (offline, DNS, TLS) never carries a PostgREST code.
  if (!code) return true;
  return TRANSIENT_CODES.has(code);
}

/** Initial attempt plus three retries — 1s + 2s + 4s, roughly 7s before giving up. */
const MAX_ATTEMPTS = 4;

/**
 * Run one PostgREST read, repeating it while the failure looks transient.
 *
 * Each read retries on its own schedule so one failing call cannot hold the other
 * back — in the PGRST303 report only the read-set failed while the feed loaded
 * fine, and re-fetching a feed that already succeeded would be pure waste.
 *
 * Returns null once it gives up; the caller leaves that slice of state alone
 * rather than clobbering it with an empty set.
 */
async function loadWithRetry<T>(
  label: string,
  run: () => PromiseLike<{ data: T[] | null; error: unknown }>,
  isCancelled: () => boolean,
): Promise<T[] | null> {
  for (let attempt = 0; ; attempt++) {
    const { data, error } = await run();
    if (isCancelled()) return null;
    if (!error) return data ?? [];

    const exhausted = attempt >= MAX_ATTEMPTS - 1;
    if (!isTransient(error) || exhausted) {
      const suffix = exhausted && isTransient(error) ? ` (gave up after ${MAX_ATTEMPTS} attempts)` : '';
      console.error(`[notifications] ${label} failed${suffix}:`, describeError(error));
      return null;
    }

    await sleep(Math.min(1000 * 2 ** attempt, 8000));
    if (isCancelled()) return null;
  }
}

function useNotificationsState(): NotificationsValue {
  const { user } = useAuth();
  const uid = user?.uid;
  // Raw rows straight from PostgREST/Realtime; the effective feed overlays this
  // user's read-set (see `notifications` below).
  const [rawNotifications, setRawNotifications] = useState<Notification[]>([]);
  // IDs this user has read, sourced from the per-recipient `notification_reads`
  // table. Unlike notifications.is_read (one shared flag per row, unwritable by
  // broadcast recipients), this is per (notification, user) — so read-state works
  // for role/branch broadcasts and syncs across devices via Realtime.
  const [readIds, setReadIds] = useState<Set<string>>(new Set());

  // Upsert by id, newest first — used for both the initial load and every
  // realtime INSERT/UPDATE so a row is never duplicated.
  const upsert = useCallback((incoming: Notification) => {
    setRawNotifications((prev) => {
      const next = prev.filter((n) => n.id !== incoming.id);
      next.unshift(incoming);
      next.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return next.slice(0, FEED_LIMIT);
    });
  }, []);

  const addReadId = useCallback((id: string) => {
    setReadIds((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));
  }, []);

  // Load the feed and this user's read-set. RLS scopes both. Each half retries
  // independently on a transient failure, so a blip costs a few seconds of
  // backoff instead of wedging the bell for the whole session.
  const load = useCallback(async (isCancelled: () => boolean) => {
    const [feed, reads] = await Promise.all([
      loadWithRetry<NotificationRow>(
        'initial load',
        () => supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(FEED_LIMIT),
        isCancelled,
      ),
      loadWithRetry<NotificationReadRow>(
        'read-set load',
        () => supabase.from('notification_reads').select('notification_id'),
        isCancelled,
      ),
    ]);
    if (isCancelled()) return;
    // A null means that half gave up — leave its state as it was rather than
    // overwriting a good feed with an empty one on a later reconnect.
    if (reads) setReadIds(new Set(reads.map((r) => r.notification_id)));
    if (feed) setRawNotifications(feed.map(mapRow));
  }, []);

  useEffect(() => {
    // Signed out: nothing to subscribe to. Any prior session's feed is cleared
    // by the cleanup of the previous run, so we don't touch state here.
    if (!uid) return;

    let cancelled = false;
    const isCancelled = () => cancelled;

    // The shared Supabase client keeps the realtime socket's JWT in sync via
    // onAuthStateChange, so RLS can evaluate role/branch broadcasts
    // (app.jwt_role() / app.jwt_branch_id()) without a manual setAuth here.
    //
    // Wrapped in an IIFE rather than called directly so react-hooks can see that
    // nothing in `load` writes state synchronously — every setState in it sits
    // behind the awaited round-trip.
    void (async () => {
      await load(isCancelled);
    })();

    // `subscribe` reports SUBSCRIBED on the first connect too, and the load above
    // already covers that one. Only a RE-subscribe is interesting.
    let subscribedBefore = false;

    // Live updates: new notifications, and this user's read rows (so a read on
    // one device clears the badge on another).
    const channel = supabase
      .channel('notifications-feed')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications' },
        (payload) => upsert(mapRow(payload.new as NotificationRow)),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'notifications' },
        (payload) => upsert(mapRow(payload.new as NotificationRow)),
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notification_reads', filter: `user_id=eq.${uid}` },
        (payload) => addReadId((payload.new as NotificationReadRow).notification_id),
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'notification_reads', filter: `user_id=eq.${uid}` },
        (payload) => {
          const removed = (payload.old as NotificationReadRow).notification_id;
          setReadIds((prev) => {
            if (!prev.has(removed)) return prev;
            const next = new Set(prev);
            next.delete(removed);
            return next;
          });
        },
      )
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        if (!subscribedBefore) {
          subscribedBefore = true;
          return;
        }
        // The socket dropped and came back, so every INSERT during the outage was
        // missed and the in-memory feed is stale. Re-reading is also the second
        // chance for a clock-skew window that outlasted the backoff above —
        // QueryProvider disables refetch-on-focus globally, so nothing else would.
        void load(isCancelled);
      });

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      // Drop this session's feed and read-set so a different user never inherits it.
      setRawNotifications([]);
      setReadIds(new Set());
    };
  }, [uid, upsert, addReadId, load]);

  // The feed the app consumes: a row is read if the legacy is_read flag says so
  // OR this user has a notification_reads row for it.
  const notifications = useMemo(
    () => rawNotifications.map((n) => (n.isRead || readIds.has(n.id) ? { ...n, isRead: true } : n)),
    [rawNotifications, readIds],
  );

  const markAsRead = useCallback(async (id: string) => {
    if (!uid) return;
    addReadId(id); // optimistic
    // Per-recipient read row; ON CONFLICT DO NOTHING makes a repeat click a no-op.
    const { error } = await supabase
      .from('notification_reads')
      .upsert({ notification_id: id, user_id: uid }, { onConflict: 'notification_id,user_id', ignoreDuplicates: true });
    if (error) console.error('[notifications] markAsRead failed:', describeError(error));
  }, [uid, addReadId]);

  const markAllAsRead = useCallback(async () => {
    if (!uid) return;
    const unreadIds = notifications.filter((n) => !n.isRead).map((n) => n.id);
    if (!unreadIds.length) return;
    setReadIds((prev) => {
      const next = new Set(prev);
      unreadIds.forEach((i) => next.add(i));
      return next;
    });
    const rows = unreadIds.map((notification_id) => ({ notification_id, user_id: uid }));
    const { error } = await supabase
      .from('notification_reads')
      .upsert(rows, { onConflict: 'notification_id,user_id', ignoreDuplicates: true });
    if (error) console.error('[notifications] markAllAsRead failed:', describeError(error));
  }, [uid, notifications]);

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
