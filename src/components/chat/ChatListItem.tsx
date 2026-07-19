'use client';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { PresenceDot } from './PresenceDot';
import { Pin } from '@/utils/icons';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/utils/date';
import { initials } from '@/utils/helpers';
import type { Chat, UserPresence } from '@mb/shared';

interface Props {
  chat: Chat;
  currentUid: string;
  presence?: UserPresence;
  isActive: boolean;
  onClick: () => void;
}

export function ChatListItem({ chat, currentUid, presence, isActive, onClick }: Props) {
  const isDM = chat.type === 'dm';
  const unread = chat.unreadCounts?.[currentUid] ?? 0;
  const isPinned = chat.isPinned?.[currentUid] ?? false;

  const displayName = isDM
    ? Object.values(chat.memberDetails).find((m) => m.uid !== currentUid)?.displayName ?? 'DM'
    : chat.name ?? 'Group';

  const lastText = chat.lastMessage
    ? (chat.lastMessage.type === 'text'
      ? (chat.lastMessage.text.length > 42 ? chat.lastMessage.text.slice(0, 42) + '…' : chat.lastMessage.text)
      : `[${chat.lastMessage.type}]`)
    : 'No messages yet';

  const timeStr = chat.lastMessage?.sentAt ? timeAgo(chat.lastMessage.sentAt) : '';

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left transition-colors',
        isActive ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/60',
      )}
    >
      {/* Avatar with presence dot */}
      <div className="relative flex-shrink-0">
        <Avatar className="h-9 w-9">
          <AvatarFallback className={cn(
            'text-xs',
            isActive ? 'bg-primary/20 text-primary' : 'bg-muted-foreground/10 text-muted-foreground'
          )}>
            {initials(displayName)}
          </AvatarFallback>
        </Avatar>
        {isDM && presence && (
          <PresenceDot
            status={presence.status}
            className="absolute -bottom-0.5 -right-0.5 h-3 w-3 border-2 border-background"
          />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1 min-w-0">
            <span className={cn('text-sm font-medium truncate', unread > 0 && 'font-semibold')}>
              {displayName}
            </span>
            {isPinned && <Pin className="h-2.5 w-2.5 text-amber-500 flex-shrink-0" />}
          </div>
          <span className="text-[10px] text-muted-foreground flex-shrink-0">{timeStr}</span>
        </div>
        <div className="flex items-center justify-between gap-1 mt-0.5">
          <p className={cn(
            'text-xs truncate',
            unread > 0 ? 'text-foreground font-medium' : 'text-muted-foreground'
          )}>
            {chat.lastMessage && chat.lastMessage.senderId === currentUid ? 'You: ' : ''}
            {lastText}
          </p>
          {unread > 0 && (
            <Badge className="h-4 min-w-4 px-1 text-[10px] flex-shrink-0 rounded-full">
              {unread > 99 ? '99+' : unread}
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
}
