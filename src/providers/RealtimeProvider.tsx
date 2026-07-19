'use client';

import {
  createContext, useContext, useEffect, useState, useCallback,
} from 'react';
import {
  collection, query, where, orderBy, onSnapshot, doc, updateDoc, limit,
  addDoc, serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/utils/firebase';
import { useAuth } from '@/hooks/useAuth';
import { logger } from '@/utils/logger';
import type {
  Notification, Chat, ChatMember, CreateGroupChatInput, GroupChatType,
} from '@mb/shared';

/**
 * One place for the always-on realtime streams a signed-in user needs
 * (notifications + chats). Previously these lived in `useNotifications` /
 * `useChats`, which were called from the per-page `<Topbar>` (and again from the
 * realtime bridges), so every navigation tore down and re-opened 3+ Firestore
 * `onSnapshot` listeners — and pages that use a bridge opened the notifications
 * stream twice. Mounting this once in the dashboard layout keeps a single set of
 * listeners alive across navigation and shares their state with every consumer.
 */

// ── Notifications ──────────────────────────────────────────────────────────

interface NotificationsValue {
  notifications: Notification[];
  unreadCount: number;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
}

const NotificationsContext = createContext<NotificationsValue | null>(null);

function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    // Two separate queries so Firestore can statically verify each rule branch:
    // 1. targetRole query — works when the `role` custom claim is set on the token
    // 2. targetUserId query — always works (rule trivially satisfied by the uid match)
    let roleItems: Notification[] = [];
    let userItems: Notification[] = [];

    function merge() {
      const seen = new Set<string>();
      const all: Notification[] = [];
      for (const n of [...roleItems, ...userItems]) {
        if (!seen.has(n.id)) {
          seen.add(n.id);
          all.push(n);
        }
      }
      all.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const top50 = all.slice(0, 50);
      setNotifications(top50);
      setUnreadCount(top50.filter((n) => !n.isRead).length);
    }

    const qRole = query(
      collection(db, 'notifications'),
      where('targetRole', '==', user.role),
      orderBy('createdAt', 'desc'),
      limit(50)
    );

    const qUser = query(
      collection(db, 'notifications'),
      where('targetUserId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(25)
    );

    const unsubRole = onSnapshot(
      qRole,
      (snap) => {
        roleItems = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Notification));
        merge();
      },
      (err) => {
        // Silently ignore if role claim isn't set on the token yet
        if (err.code !== 'permission-denied') console.error('Notifications (role):', err);
      }
    );

    const unsubUser = onSnapshot(
      qUser,
      (snap) => {
        userItems = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Notification));
        merge();
      },
      (err) => {
        console.error('Notifications (user):', err);
      }
    );

    return () => {
      unsubRole();
      unsubUser();
    };
  }, [user]);

  const markAsRead = useCallback(async (id: string) => {
    await updateDoc(doc(db, 'notifications', id), { isRead: true });
  }, []);

  const markAllAsRead = useCallback(async () => {
    await Promise.all(
      notifications
        .filter((n) => !n.isRead)
        .map((n) => updateDoc(doc(db, 'notifications', n.id), { isRead: true }))
    );
  }, [notifications]);

  return (
    <NotificationsContext.Provider value={{ notifications, unreadCount, markAsRead, markAllAsRead }}>
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications(): NotificationsValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error('useNotifications must be used within <RealtimeProvider>');
  return ctx;
}

// ── Chats ──────────────────────────────────────────────────────────────────

function docToChat(id: string, data: Record<string, unknown>): Chat {
  const toISO = (v: unknown) => {
    if (!v) return new Date().toISOString();
    if (typeof v === 'object' && 'toDate' in (v as object)) return (v as { toDate: () => Date }).toDate().toISOString();
    return String(v);
  };
  return {
    id,
    type: (data.type as Chat['type']) ?? 'dm',
    name: (data.name as string | null) ?? null,
    description: (data.description as string | null) ?? null,
    avatarUrl: (data.avatarUrl as string | null) ?? null,
    members: (data.members as string[]) ?? [],
    memberDetails: (data.memberDetails as Record<string, ChatMember>) ?? {},
    createdBy: (data.createdBy as string) ?? '',
    createdAt: toISO(data.createdAt),
    updatedAt: toISO(data.updatedAt),
    lastMessage: (data.lastMessage as Chat['lastMessage']) ?? null,
    unreadCounts: (data.unreadCounts as Record<string, number>) ?? {},
    typing: (data.typing as Record<string, string>) ?? {},
    isPinned: (data.isPinned as Record<string, boolean>) ?? {},
    isArchived: (data.isArchived as Record<string, boolean>) ?? {},
    groupType: (data.groupType as GroupChatType | null) ?? null,
  };
}

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

const ChatsContext = createContext<ChatsValue | null>(null);

function ChatsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [chats, setChats] = useState<Chat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unreadTotal, setUnreadTotal] = useState(0);

  useEffect(() => {
    if (!user) { setChats([]); setUnreadTotal(0); setLoading(false); return; }

    const q = query(
      collection(db, 'chats'),
      where('members', 'array-contains', user.uid),
      orderBy('updatedAt', 'desc')
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => docToChat(d.id, d.data() as Record<string, unknown>));
        const filtered = list.filter((c) => !c.isArchived[user.uid]);
        setChats(filtered);
        setUnreadTotal(filtered.reduce((sum, c) => sum + (c.unreadCounts[user.uid] ?? 0), 0));
        setLoading(false);
      },
      (err) => {
        logger.error('useChats snapshot error', err);
        setError('Failed to load chats');
        setLoading(false);
      }
    );

    return unsub;
  }, [user]);

  const createDM = useCallback(async (targetMember: ChatMember): Promise<string> => {
    if (!user) throw new Error('Not authenticated');

    // Check if DM already exists
    const existing = chats.find(
      (c) => c.type === 'dm' && c.members.includes(targetMember.uid) && c.members.length === 2
    );
    if (existing) return existing.id;

    const myMember: ChatMember = {
      uid: user.uid,
      displayName: user.displayName,
      role: user.role,
      branchName: user.branchName,
    };

    const ref = await addDoc(collection(db, 'chats'), {
      type: 'dm',
      name: null,
      description: null,
      avatarUrl: null,
      members: [user.uid, targetMember.uid],
      memberDetails: { [user.uid]: myMember, [targetMember.uid]: targetMember },
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessage: null,
      unreadCounts: { [user.uid]: 0, [targetMember.uid]: 0 },
      typing: {},
      isPinned: {},
      isArchived: {},
      groupType: null,
    });

    return ref.id;
  }, [user, chats]);

  const createGroup = useCallback(async (input: CreateGroupChatInput): Promise<string> => {
    if (!user) throw new Error('Not authenticated');

    const myMember: ChatMember = {
      uid: user.uid,
      displayName: user.displayName,
      role: user.role,
      branchName: user.branchName,
    };

    const allMemberDetails = { ...input.memberDetails, [user.uid]: myMember };
    const allMemberUids = Array.from(new Set([...input.memberUids, user.uid]));
    const initialUnread = Object.fromEntries(allMemberUids.map((uid) => [uid, 0]));

    const ref = await addDoc(collection(db, 'chats'), {
      type: 'group',
      name: input.name,
      description: input.description ?? null,
      avatarUrl: null,
      members: allMemberUids,
      memberDetails: allMemberDetails,
      createdBy: user.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      lastMessage: null,
      unreadCounts: initialUnread,
      typing: {},
      isPinned: {},
      isArchived: {},
      groupType: input.groupType,
    });

    return ref.id;
  }, [user]);

  const archiveChat = useCallback(async (chatId: string): Promise<void> => {
    if (!user) return;
    await updateDoc(doc(db, 'chats', chatId), {
      [`isArchived.${user.uid}`]: true,
      updatedAt: serverTimestamp(),
    });
  }, [user]);

  const pinChat = useCallback(async (chatId: string, pinned: boolean): Promise<void> => {
    if (!user) return;
    await updateDoc(doc(db, 'chats', chatId), {
      [`isPinned.${user.uid}`]: pinned,
      updatedAt: serverTimestamp(),
    });
  }, [user]);

  return (
    <ChatsContext.Provider
      value={{ chats, unreadTotal, loading, error, createDM, createGroup, archiveChat, pinChat }}
    >
      {children}
    </ChatsContext.Provider>
  );
}

export function useChats(): ChatsValue {
  const ctx = useContext(ChatsContext);
  if (!ctx) throw new Error('useChats must be used within <RealtimeProvider>');
  return ctx;
}

// ── Composed provider ────────────────────────────────────────────────────────

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NotificationsProvider>
      <ChatsProvider>{children}</ChatsProvider>
    </NotificationsProvider>
  );
}
