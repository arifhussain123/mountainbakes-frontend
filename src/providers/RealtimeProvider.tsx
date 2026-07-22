'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type {
  Notification, Chat, ChatMember, CreateGroupChatInput,
} from '@mb/shared';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * Notifications are live again, read straight from the `notifications` table
 * over Supabase Realtime — the design the schema was built for (migration 07:
 * "the table the client subscribes to via Supabase Realtime"). RLS (migration
 * 09) scopes each user's feed to notifications addressed to them personally or
 * broadcast to their role/branch, so no client-side filtering is needed.
 *
 * Chats remain disabled — that feature's realtime backend has not been ported.
 * Its context/hook signatures are preserved so every consumer still compiles:
 * reads return empty, mutations throw.
 */

const DISABLED = 'Chat is unavailable — the realtime backend has been removed.';

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

function useNotificationsState(): NotificationsValue {
  const { user } = useAuth();
  const uid = user?.uid;
  const [notifications, setNotifications] = useState<Notification[]>([]);

  // Upsert by id, newest first — used for both the initial load and every
  // realtime INSERT/UPDATE so a row is never duplicated.
  const upsert = useCallback((incoming: Notification) => {
    setNotifications((prev) => {
      const next = prev.filter((n) => n.id !== incoming.id);
      next.unshift(incoming);
      next.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
      return next.slice(0, FEED_LIMIT);
    });
  }, []);

  useEffect(() => {
    // Signed out: nothing to subscribe to. Any prior session's feed is cleared
    // by the cleanup of the previous run, so we don't touch state here.
    if (!uid) return;

    let cancelled = false;

    // The shared Supabase client keeps the realtime socket's JWT in sync via
    // onAuthStateChange, so RLS can evaluate role/branch broadcasts
    // (app.jwt_role() / app.jwt_branch_id()) without a manual setAuth here.

    // Initial load. RLS already scopes the rows to this user's feed.
    (async () => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(FEED_LIMIT);
      if (cancelled) return;
      if (error) {
        console.error('[notifications] initial load failed', error);
        return;
      }
      setNotifications((data ?? []).map((r) => mapRow(r as NotificationRow)));
    })();

    // Live updates: new notifications and read-state changes.
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
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
      // Drop this session's feed so a different user never inherits it.
      setNotifications([]);
    };
  }, [uid, upsert]);

  const markAsRead = useCallback(async (id: string) => {
    // Optimistic — the dropdown reacts instantly. RLS only lets a user persist
    // read-state on notifications addressed to them personally; role broadcasts
    // clear locally for the session but re-appear unread on reload (the schema
    // tracks a single shared is_read per broadcast row, not per recipient).
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('id', id);
    if (error) console.error('[notifications] markAsRead failed', error);
  }, []);

  const markAllAsRead = useCallback(async () => {
    const unreadIds = notifications.filter((n) => !n.isRead).map((n) => n.id);
    if (!unreadIds.length) return;
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    const { error } = await supabase
      .from('notifications')
      .update({ is_read: true })
      .in('id', unreadIds);
    if (error) console.error('[notifications] markAllAsRead failed', error);
  }, [notifications]);

  const unreadCount = useMemo(
    () => notifications.reduce((acc, n) => (n.isRead ? acc : acc + 1), 0),
    [notifications],
  );

  return { notifications, unreadCount, markAsRead, markAllAsRead };
}

// ── Chats ──────────────────────────────────────────────────────────────────

interface ChatsValue {
  chats: Chat[];
  unreadTotal: number;
  loading: boolean;
  error: string | null;
  createDM: (targetMember: ChatMember) => Promise<string>;
  createGroup: (input: CreateGroupChatInput) => Promise<string>;
  archiveChat: (chatId: string) => Promise<void>;
  pinChat: (chatId: string, pinned: boolean) => Promise<void>;
}

const CHATS_VALUE: ChatsValue = {
  chats: [],
  unreadTotal: 0,
  loading: false,
  error: DISABLED,
  createDM: async () => { throw new Error(DISABLED); },
  createGroup: async () => { throw new Error(DISABLED); },
  archiveChat: async () => {},
  pinChat: async () => {},
};

const ChatsContext = createContext<ChatsValue | null>(null);

export function useChats(): ChatsValue {
  const ctx = useContext(ChatsContext);
  if (!ctx) throw new Error('useChats must be used within <RealtimeProvider>');
  return ctx;
}

// ── Composed provider ────────────────────────────────────────────────────────

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const notifications = useNotificationsState();
  return (
    <NotificationsContext.Provider value={notifications}>
      <ChatsContext.Provider value={CHATS_VALUE}>{children}</ChatsContext.Provider>
    </NotificationsContext.Provider>
  );
}
