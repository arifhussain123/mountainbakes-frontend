'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Notification } from '@mb/shared';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';

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

  useEffect(() => {
    // Signed out: nothing to subscribe to. Any prior session's feed is cleared
    // by the cleanup of the previous run, so we don't touch state here.
    if (!uid) return;

    let cancelled = false;

    // The shared Supabase client keeps the realtime socket's JWT in sync via
    // onAuthStateChange, so RLS can evaluate role/branch broadcasts
    // (app.jwt_role() / app.jwt_branch_id()) without a manual setAuth here.

    // Initial load: the feed and this user's read-set together. RLS scopes both.
    (async () => {
      const [feedRes, readsRes] = await Promise.all([
        supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(FEED_LIMIT),
        supabase.from('notification_reads').select('notification_id'),
      ]);
      if (cancelled) return;
      if (readsRes.error) {
        console.error('[notifications] read-set load failed:', describeError(readsRes.error));
      } else {
        setReadIds(new Set((readsRes.data ?? []).map((r) => (r as NotificationReadRow).notification_id)));
      }
      if (feedRes.error) {
        console.error('[notifications] initial load failed:', describeError(feedRes.error));
        return;
      }
      setRawNotifications((feedRes.data ?? []).map((r) => mapRow(r as NotificationRow)));
    })();

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
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      // Drop this session's feed and read-set so a different user never inherits it.
      setRawNotifications([]);
      setReadIds(new Set());
    };
  }, [uid, upsert, addReadId]);

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
