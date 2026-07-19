'use client';

import { useCallback } from 'react';
import type { ChatMessage, ChatAttachment, SendMessageInput } from '@mb/shared';

const DISABLED = 'Chat is unavailable — the realtime backend has been removed.';

const NO_MESSAGES: ChatMessage[] = [];

/**
 * Chat messaging is disabled — the message stream and attachment storage it
 * relied on have both been removed. The returned
 * shape is unchanged so `<ChatWindow>` still compiles: reads are empty and
 * writes are inert. Reimplement on Supabase to bring the feature back.
 */
export function useChatMessages(_chatId: string | null) {
  const noop = useCallback(async (): Promise<void> => {}, []);

  const uploadAttachment = useCallback(async (_file: File): Promise<ChatAttachment> => {
    throw new Error(DISABLED);
  }, []);

  const sendMessage = useCallback(async (_input: SendMessageInput): Promise<void> => {
    throw new Error(DISABLED);
  }, []);

  const editMessage = useCallback(async (_messageId: string, _newText: string): Promise<void> => {
    throw new Error(DISABLED);
  }, []);

  const deleteMessage = useCallback(async (_messageId: string): Promise<void> => {
    throw new Error(DISABLED);
  }, []);

  const pinMessage = useCallback(async (_messageId: string, _pin: boolean): Promise<void> => {
    throw new Error(DISABLED);
  }, []);

  const setTyping = useCallback((_isTyping: boolean): void => {}, []);

  return {
    messages: NO_MESSAGES,
    loading: false,
    hasMore: false,
    loadMore: noop,
    sendMessage,
    editMessage,
    deleteMessage,
    markRead: noop,
    setTyping,
    uploadAttachment,
    pinMessage,
  };
}
