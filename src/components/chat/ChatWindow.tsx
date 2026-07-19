'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { ArrowLeft, Info, Loader2 } from '@/utils/icons';
import { MessageBubble } from './MessageBubble';
import { MessageInput } from './MessageInput';
import { TypingIndicator } from './TypingIndicator';
import { ChatMessagesSkeleton } from './ChatSkeleton';
import { cn } from '@/lib/utils';
import { initials } from '@/utils/helpers';
import { timeAgo } from '@/utils/date';
import { useChatMessages } from '@/hooks/useChatMessages';
import { useAuth } from '@/hooks/useAuth';
import type { Chat, MessageReply } from '@mb/shared';
import { toast } from 'sonner';

interface Props {
  chat: Chat;
  onBack?: () => void;
  onOpenDetails?: () => void;
}

export function ChatWindow({ chat, onBack, onOpenDetails }: Props) {
  const { user } = useAuth();
  const {
    messages, loading, hasMore, loadMore,
    sendMessage, editMessage, deleteMessage, pinMessage,
    markRead, setTyping, uploadAttachment,
  } = useChatMessages(chat.id);

  const [replyTo, setReplyTo] = useState<MessageReply | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const bottomRef = useRef<HTMLDivElement>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevScrollHeight = useRef(0);

  const uid = user?.uid ?? '';
  const isGroup = chat.type === 'group';

  // Mark read when chat opens
  useEffect(() => {
    markRead();
  }, [chat.id]);

  // Scroll to bottom on first load
  useEffect(() => {
    if (!loading && messages.length > 0) {
      bottomRef.current?.scrollIntoView({ behavior: 'instant' });
    }
  }, [loading]);

  // Preserve scroll position when loading older messages
  const handleLoadMore = useCallback(async () => {
    if (!scrollRef.current) return;
    prevScrollHeight.current = scrollRef.current.scrollHeight;
    await loadMore();
    requestAnimationFrame(() => {
      if (!scrollRef.current) return;
      const diff = scrollRef.current.scrollHeight - prevScrollHeight.current;
      scrollRef.current.scrollTop += diff;
    });
  }, [loadMore]);

  // IntersectionObserver for infinite-scroll load-more
  useEffect(() => {
    const el = topRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) handleLoadMore(); },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, handleLoadMore]);

  async function handleSend(input: Parameters<typeof sendMessage>[0]) {
    await sendMessage(input);
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  async function handleEdit() {
    if (!editingId || !editText.trim()) return;
    try {
      await editMessage(editingId, editText.trim());
    } catch {
      toast.error('Failed to edit message');
    } finally {
      setEditingId(null);
      setEditText('');
    }
  }

  async function handleDelete(messageId: string) {
    try {
      await deleteMessage(messageId);
    } catch {
      toast.error('Failed to delete message');
    }
  }

  async function handlePin(messageId: string, pin: boolean) {
    try {
      await pinMessage(messageId, pin);
    } catch {
      toast.error('Failed to update pin');
    }
  }

  // Typing names
  const typingNames = Object.entries(chat.typing ?? {})
    .filter(([id, ts]) => {
      if (id === uid) return false;
      const age = Date.now() - new Date(ts as string).getTime();
      return age < 4000;
    })
    .map(([id]) => chat.memberDetails[id]?.displayName ?? 'Someone');

  // Chat name
  const chatName = chat.type === 'dm'
    ? Object.values(chat.memberDetails).find((m) => m.uid !== uid)?.displayName ?? 'DM'
    : chat.name ?? 'Group';

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border bg-card flex-shrink-0">
        {onBack && (
          <Button variant="ghost" size="icon" className="h-7 w-7 mr-1" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <Avatar className="h-8 w-8">
          <AvatarFallback className="text-xs bg-primary/10 text-primary">
            {initials(chatName)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{chatName}</p>
          {isGroup && (
            <p className="text-[10px] text-muted-foreground">
              {chat.members.length} members
            </p>
          )}
        </div>
        {onOpenDetails && (
          <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={onOpenDetails}>
            <Info className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Edit mode banner */}
      {editingId && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800 flex-shrink-0">
          <span className="text-xs font-medium text-amber-700 dark:text-amber-400 flex-1">Editing message</span>
          <Input
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleEdit();
              if (e.key === 'Escape') { setEditingId(null); setEditText(''); }
            }}
            className="h-7 text-sm flex-1 max-w-xs"
            autoFocus
          />
          <Button size="sm" className="h-7" onClick={handleEdit}>Save</Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => { setEditingId(null); setEditText(''); }}>Cancel</Button>
        </div>
      )}

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto flex flex-col">
        {/* Load-more sentinel */}
        <div ref={topRef} className="flex justify-center py-2">
          {hasMore && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {loading ? (
          <ChatMessagesSkeleton />
        ) : messages.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            No messages yet. Say hello!
          </div>
        ) : (
          <div className="flex flex-col gap-0 py-2">
            {[...messages].reverse().map((msg, i, arr) => {
              const prevMsg = arr[i - 1];
              const showAvatar = !prevMsg || prevMsg.senderId !== msg.senderId;
              return (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  currentUid={uid}
                  isGroup={isGroup}
                  showAvatar={showAvatar}
                  onReply={setReplyTo}
                  onEdit={(id, text) => { setEditingId(id); setEditText(text); }}
                  onDelete={handleDelete}
                  onPin={handlePin}
                />
              );
            })}
          </div>
        )}

        {/* Typing indicator */}
        <TypingIndicator typingNames={typingNames} />

        {/* Scroll anchor */}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0">
        <MessageInput
          replyTo={replyTo}
          onClearReply={() => setReplyTo(null)}
          onSend={handleSend}
          onTyping={(isTyping) => setTyping(isTyping)}
          onUpload={(file) => uploadAttachment(file)}
          disabled={!uid}
        />
      </div>
    </div>
  );
}
