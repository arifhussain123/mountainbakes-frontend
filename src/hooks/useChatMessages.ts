'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import {
  collection, query, orderBy, limit, onSnapshot,
  addDoc, updateDoc, doc, serverTimestamp,
  startAfter, getDocs, FieldValue, increment,
  type DocumentSnapshot, type QueryDocumentSnapshot,
  deleteField,
} from 'firebase/firestore';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '@/utils/firebase';
import { useAuth } from './useAuth';
import type { ChatMessage, ChatAttachment, SendMessageInput, MessageReply } from '@mb/shared';
import { CHAT_MESSAGE_LIMIT, CHAT_TYPING_TIMEOUT_MS, STORAGE_CHAT_PATH } from '@/utils/constants';
import { logger } from '@/utils/logger';

function docToMessage(id: string, data: Record<string, unknown>): ChatMessage {
  const toISO = (v: unknown) => {
    if (!v) return new Date().toISOString();
    if (typeof v === 'object' && 'toDate' in (v as object)) return (v as { toDate: () => Date }).toDate().toISOString();
    return String(v);
  };
  const toISOOrNull = (v: unknown) => v ? toISO(v) : null;

  return {
    id,
    senderId: (data.senderId as string) ?? '',
    senderName: (data.senderName as string) ?? '',
    senderRole: (data.senderRole as ChatMessage['senderRole']) ?? 'branch_manager',
    text: (data.text as string | null) ?? null,
    type: (data.type as ChatMessage['type']) ?? 'text',
    attachments: (data.attachments as ChatAttachment[]) ?? [],
    replyTo: (data.replyTo as MessageReply | null) ?? null,
    readBy: (data.readBy as Record<string, string>) ?? {},
    editedAt: toISOOrNull(data.editedAt),
    deletedAt: toISOOrNull(data.deletedAt),
    isPinned: Boolean(data.isPinned),
    pinnedBy: (data.pinnedBy as string | null) ?? null,
    pinnedAt: toISOOrNull(data.pinnedAt),
    sentAt: toISO(data.sentAt),
  };
}

export function useChatMessages(chatId: string | null) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const lastDocRef = useRef<QueryDocumentSnapshot | null>(null);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!chatId || !user) {
      setMessages([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    setMessages([]);
    lastDocRef.current = null;

    const q = query(
      collection(db, 'chats', chatId, 'messages'),
      orderBy('sentAt', 'desc'),
      limit(CHAT_MESSAGE_LIMIT)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        if (!snap.empty) {
          lastDocRef.current = snap.docs[snap.docs.length - 1];
        }
        setHasMore(snap.docs.length === CHAT_MESSAGE_LIMIT);
        // Reverse so oldest is at top
        const list = snap.docs.map((d) => docToMessage(d.id, d.data() as Record<string, unknown>)).reverse();
        setMessages(list);
        setLoading(false);
      },
      (err) => {
        logger.error('useChatMessages snapshot error', err);
        setLoading(false);
      }
    );

    return unsub;
  }, [chatId, user?.uid]);

  const loadMore = useCallback(async () => {
    if (!chatId || !lastDocRef.current || !hasMore) return;

    const q = query(
      collection(db, 'chats', chatId, 'messages'),
      orderBy('sentAt', 'desc'),
      startAfter(lastDocRef.current),
      limit(CHAT_MESSAGE_LIMIT)
    );

    const snap = await getDocs(q);
    if (!snap.empty) lastDocRef.current = snap.docs[snap.docs.length - 1];
    setHasMore(snap.docs.length === CHAT_MESSAGE_LIMIT);

    const older = snap.docs.map((d) => docToMessage(d.id, d.data() as Record<string, unknown>)).reverse();
    setMessages((prev) => [...older, ...prev]);
  }, [chatId, hasMore]);

  const uploadAttachment = useCallback(async (file: File): Promise<ChatAttachment> => {
    if (!chatId || !user) throw new Error('Not authenticated');
    const filename = `${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    const path = `${STORAGE_CHAT_PATH}/${chatId}/${filename}`;
    const fileRef = storageRef(storage, path);
    await uploadBytes(fileRef, file);
    const url = await getDownloadURL(fileRef);

    return {
      url,
      storagePath: path,
      name: file.name,
      size: file.size,
      mimeType: file.type,
      thumbnailUrl: file.type.startsWith('image/') ? url : null,
    };
  }, [chatId, user]);

  const sendMessage = useCallback(async (input: SendMessageInput): Promise<void> => {
    if (!chatId || !user) return;

    const messageData = {
      senderId: user.uid,
      senderName: user.displayName,
      senderRole: user.role,
      text: input.text,
      type: input.type,
      attachments: input.attachments ?? [],
      replyTo: input.replyTo ?? null,
      readBy: { [user.uid]: serverTimestamp() },
      editedAt: null,
      deletedAt: null,
      isPinned: false,
      pinnedBy: null,
      pinnedAt: null,
      sentAt: serverTimestamp(),
    };

    await addDoc(collection(db, 'chats', chatId, 'messages'), messageData);

    // Update chat's lastMessage and bump unread counts for all other members.
    // Read the chat doc to get the member list, then write lastMessage + increments.
    const preview = input.text
      ? (input.text.length > 60 ? input.text.slice(0, 60) + '…' : input.text)
      : input.type === 'image' ? '[Image]' : '[File]';

    // We need the member list — get it from our messages state context or re-fetch
    // For simplicity: update the chat doc. The increment for other members is handled
    // by clearing our own count and bumping others. We'll fetch the chat doc first.
    const { getDoc } = await import('firebase/firestore');
    const chatRef = doc(db, 'chats', chatId);
    const chatDoc = await getDoc(chatRef);
    if (!chatDoc.exists()) return;

    const members: string[] = chatDoc.data().members ?? [];
    const unreadUpdate: Record<string, FieldValue | number> = {};
    members.forEach((uid) => {
      if (uid !== user.uid) {
        unreadUpdate[`unreadCounts.${uid}`] = increment(1);
      }
    });

    await updateDoc(chatRef, {
      lastMessage: {
        text: preview,
        senderId: user.uid,
        senderName: user.displayName,
        sentAt: new Date().toISOString(),
        type: input.type,
      },
      updatedAt: serverTimestamp(),
      ...unreadUpdate,
    });

    // Clear own typing
    setTyping(false);
  }, [chatId, user]);

  const editMessage = useCallback(async (messageId: string, newText: string): Promise<void> => {
    if (!chatId) return;
    await updateDoc(doc(db, 'chats', chatId, 'messages', messageId), {
      text: newText,
      editedAt: serverTimestamp(),
    });
  }, [chatId]);

  const deleteMessage = useCallback(async (messageId: string): Promise<void> => {
    if (!chatId) return;
    await updateDoc(doc(db, 'chats', chatId, 'messages', messageId), {
      deletedAt: serverTimestamp(),
      text: null,
    });
  }, [chatId]);

  const markRead = useCallback(async (): Promise<void> => {
    if (!chatId || !user) return;

    const chatRef = doc(db, 'chats', chatId);
    await updateDoc(chatRef, {
      [`unreadCounts.${user.uid}`]: 0,
      updatedAt: serverTimestamp(),
    });

    // Mark messages as read (batch the unread ones)
    const unread = messages.filter((m) => !m.readBy[user.uid] && !m.deletedAt);
    const { writeBatch } = await import('firebase/firestore');
    const batch = writeBatch(db);
    unread.slice(0, 20).forEach((m) => {
      batch.update(doc(db, 'chats', chatId, 'messages', m.id), {
        [`readBy.${user.uid}`]: serverTimestamp(),
      });
    });
    if (unread.length > 0) await batch.commit();
  }, [chatId, user, messages]);

  const setTyping = useCallback((isTyping: boolean): void => {
    if (!chatId || !user) return;

    if (typingTimerRef.current) clearTimeout(typingTimerRef.current);

    if (isTyping) {
      updateDoc(doc(db, 'chats', chatId), {
        [`typing.${user.uid}`]: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch(() => {});

      typingTimerRef.current = setTimeout(() => {
        updateDoc(doc(db, 'chats', chatId), {
          [`typing.${user.uid}`]: deleteField(),
        }).catch(() => {});
      }, CHAT_TYPING_TIMEOUT_MS);
    } else {
      updateDoc(doc(db, 'chats', chatId), {
        [`typing.${user.uid}`]: deleteField(),
      }).catch(() => {});
    }
  }, [chatId, user]);

  const pinMessage = useCallback(async (messageId: string, pin: boolean): Promise<void> => {
    if (!chatId || !user) return;
    await updateDoc(doc(db, 'chats', chatId, 'messages', messageId), {
      isPinned: pin,
      pinnedBy: pin ? user.uid : null,
      pinnedAt: pin ? serverTimestamp() : null,
    });
  }, [chatId, user]);

  return {
    messages,
    loading,
    hasMore,
    loadMore,
    sendMessage,
    editMessage,
    deleteMessage,
    markRead,
    setTyping,
    uploadAttachment,
    pinMessage,
  };
}
