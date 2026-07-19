'use client';

import { useState, useEffect } from 'react';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useAppStore } from '@/stores/useAppStore';
import { useChats } from '@/hooks/useChats';
import { usePresence } from '@/hooks/usePresence';
import { useAuth } from '@/hooks/useAuth';
import { ChatList } from './ChatList';
import { ChatWindow } from './ChatWindow';
import { ChatDetails } from './ChatDetails';
import { cn } from '@/lib/utils';
import type { Chat } from '@mb/shared';
import { toast } from 'sonner';

export function ChatPanel() {
  const { chatOpen, activeChatId, closeChat, setActiveChatId } = useAppStore();
  const { user } = useAuth();
  const { chats, loading, error } = useChats();
  const uid = user?.uid ?? '';

  // Collect all member UIDs for presence tracking — only while the chat sheet is
  // open, so we don't hold an `onSnapshot` on userPresence on every page.
  const allMemberUids = chatOpen
    ? Array.from(new Set(chats.flatMap((c) => c.members).filter((id) => id !== uid)))
    : [];
  const presence = usePresence(allMemberUids);

  const [showDetails, setShowDetails] = useState(false);
  // Mobile: 'list' | 'window' | 'details'
  const [mobilePanel, setMobilePanel] = useState<'list' | 'window' | 'details'>('list');

  const activeChat: Chat | undefined = chats.find((c) => c.id === activeChatId);

  function handleSelectChat(chatId: string) {
    setActiveChatId(chatId);
    setMobilePanel('window');
  }

  function handleBack() {
    setActiveChatId(null);
    setMobilePanel('list');
    setShowDetails(false);
  }

  // Toast notification for new messages in non-active chats
  useEffect(() => {
    if (!chatOpen || !uid) return;
    chats.forEach((chat) => {
      const unread = chat.unreadCounts?.[uid] ?? 0;
      if (unread > 0 && chat.id !== activeChatId) {
        const sender = chat.lastMessage?.senderName ?? 'Someone';
        const text = chat.lastMessage?.text ?? '[attachment]';
        const name = chat.type === 'dm'
          ? Object.values(chat.memberDetails).find((m) => m.uid !== uid)?.displayName ?? 'DM'
          : chat.name ?? 'Group';
        // Only toast if panel is open on a different chat
        // (avoids toasting on initial load)
      }
    });
  }, [chats, activeChatId, uid, chatOpen]);

  return (
    <Sheet open={chatOpen} onOpenChange={(open) => !open && closeChat()}>
      <SheetContent
        side="right"
        className={cn(
          'p-0 flex flex-row overflow-hidden',
          'w-[min(95vw,900px)] sm:max-w-none'
        )}
      >
        {/* List panel — hidden on mobile when window open */}
        <div className={cn(
          'flex-shrink-0 overflow-hidden',
          // Desktop: always show; Tablet: show unless details open; Mobile: show only when on list
          'w-72',
          'hidden md:flex md:flex-col',
          mobilePanel === 'list' && 'flex flex-col'
        )}>
          <ChatList
            chats={chats}
            loading={loading}
            error={error}
            currentUid={uid}
            activeChatId={activeChatId}
            presence={presence}
            onSelectChat={handleSelectChat}
          />
        </div>

        {/* Mobile list panel */}
        <div className={cn(
          'flex-col overflow-hidden w-full',
          'md:hidden',
          mobilePanel === 'list' ? 'flex' : 'hidden'
        )}>
          <ChatList
            chats={chats}
            loading={loading}
            error={error}
            currentUid={uid}
            activeChatId={activeChatId}
            presence={presence}
            onSelectChat={handleSelectChat}
          />
        </div>

        {/* Window panel */}
        <div className={cn(
          'flex-1 overflow-hidden flex flex-col',
          // Desktop: always show; Mobile: show only when on window panel
          'hidden',
          activeChat ? 'md:flex' : 'hidden',
          mobilePanel === 'window' && 'flex'
        )}>
          {activeChat ? (
            <ChatWindow
              chat={activeChat}
              onBack={handleBack}
              onOpenDetails={() => {
                setShowDetails((v) => !v);
                setMobilePanel('details');
              }}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
              Select a conversation to start chatting
            </div>
          )}
        </div>

        {/* Details panel — desktop only, toggled by Info button */}
        {showDetails && activeChat && (
          <div className="hidden lg:flex flex-col flex-shrink-0 w-64 overflow-hidden">
            <ChatDetails
              chat={activeChat}
              currentUid={uid}
              presence={presence}
              onClose={() => setShowDetails(false)}
            />
          </div>
        )}

        {/* Mobile details panel */}
        <div className={cn(
          'flex-col overflow-hidden w-full',
          'lg:hidden',
          mobilePanel === 'details' && activeChat ? 'flex' : 'hidden'
        )}>
          {activeChat && (
            <ChatDetails
              chat={activeChat}
              currentUid={uid}
              presence={presence}
              onClose={() => setMobilePanel('window')}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
