'use client';

import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Search, Plus } from '@/utils/icons';
import { ChatListItem } from './ChatListItem';
import { ChatListSkeleton } from './ChatSkeleton';
import { NewChatDialog } from './NewChatDialog';
import { cn } from '@/lib/utils';
import type { Chat, UserPresence } from '@mb/shared';

interface Props {
  chats: Chat[];
  loading: boolean;
  error?: string | null;
  currentUid: string;
  activeChatId: string | null;
  presence: Record<string, UserPresence>;
  onSelectChat: (chatId: string) => void;
}

export function ChatList({ chats, loading, error, currentUid, activeChatId, presence, onSelectChat }: Props) {
  const [search, setSearch] = useState('');
  const [newChatOpen, setNewChatOpen] = useState(false);

  const filtered = useMemo(() => {
    if (!search.trim()) return chats;
    const q = search.toLowerCase();
    return chats.filter((c) => {
      const name = c.type === 'dm'
        ? Object.values(c.memberDetails).find((m) => m.uid !== currentUid)?.displayName ?? ''
        : c.name ?? '';
      return name.toLowerCase().includes(q) || c.lastMessage?.text?.toLowerCase().includes(q);
    });
  }, [chats, search, currentUid]);

  const pinned = filtered.filter((c) => c.isPinned?.[currentUid]);
  const unpinned = filtered.filter((c) => !c.isPinned?.[currentUid]);

  function getDMPresence(chat: Chat): UserPresence | undefined {
    if (chat.type !== 'dm') return undefined;
    const otherId = chat.members.find((id) => id !== currentUid);
    return otherId ? presence[otherId] : undefined;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden border-r border-border">
      {/* Header */}
      <div className="px-3 pt-3 pb-2 flex-shrink-0">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-foreground">Messages</h2>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => setNewChatOpen(true)}
            title="New chat"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations…"
            className="h-8 pl-8 text-xs bg-muted/50 border-0 focus-visible:ring-1"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-1.5 pb-2">
        {error ? (
          <div className="flex flex-col items-center justify-center h-32 text-center gap-1.5 px-4">
            <p className="text-xs font-medium text-destructive">{error}</p>
            <p className="text-[10px] text-muted-foreground">
              Chat will return once the realtime backend is reconnected.
            </p>
          </div>
        ) : loading ? (
          <ChatListSkeleton />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
            <p className="text-xs">{search ? 'No results' : 'No conversations yet'}</p>
            {!search && (
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setNewChatOpen(true)}>
                Start a chat
              </Button>
            )}
          </div>
        ) : (
          <>
            {pinned.length > 0 && (
              <>
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide px-2 py-1.5">Pinned</p>
                {pinned.map((chat) => (
                  <ChatListItem
                    key={chat.id}
                    chat={chat}
                    currentUid={currentUid}
                    presence={getDMPresence(chat)}
                    isActive={chat.id === activeChatId}
                    onClick={() => onSelectChat(chat.id)}
                  />
                ))}
                <Separator className="my-1.5" />
              </>
            )}
            {unpinned.map((chat) => (
              <ChatListItem
                key={chat.id}
                chat={chat}
                currentUid={currentUid}
                presence={getDMPresence(chat)}
                isActive={chat.id === activeChatId}
                onClick={() => onSelectChat(chat.id)}
              />
            ))}
          </>
        )}
      </div>

      <NewChatDialog
        open={newChatOpen}
        onClose={() => setNewChatOpen(false)}
        currentUid={currentUid}
        onChatCreated={(chatId) => { setNewChatOpen(false); onSelectChat(chatId); }}
      />
    </div>
  );
}
