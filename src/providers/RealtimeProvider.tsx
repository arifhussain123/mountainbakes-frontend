'use client';

import { createContext, useContext } from 'react';
import type {
  Notification, Chat, ChatMember, CreateGroupChatInput,
} from '@mb/shared';

/**
 * Realtime notifications and chats are disabled — the stream they read from has
 * been removed. The contexts and hook signatures are preserved so
 * every consumer still compiles: reads return empty, mutations are inert.
 * Reimplement on Supabase Realtime to bring the features back.
 */

const DISABLED = 'Chat is unavailable — the realtime backend has been removed.';

// ── Notifications ──────────────────────────────────────────────────────────

interface NotificationsValue {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
}

const NOTIFICATIONS_VALUE: NotificationsValue = {
  notifications: [],
  unreadCount: 0,
  markAsRead: async () => {},
  markAllAsRead: async () => {},
};

const NotificationsContext = createContext<NotificationsValue | null>(null);

export function useNotifications(): NotificationsValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used within <RealtimeProvider>');
  return ctx;
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
  return (
    <NotificationsContext.Provider value={NOTIFICATIONS_VALUE}>
      <ChatsContext.Provider value={CHATS_VALUE}>{children}</ChatsContext.Provider>
    </NotificationsContext.Provider>
  );
}
