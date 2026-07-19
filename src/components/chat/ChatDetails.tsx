'use client';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { X, Pin, Archive, LogOut, UserPlus } from '@/utils/icons';
import { PresenceDot } from './PresenceDot';
import { cn } from '@/lib/utils';
import { initials } from '@/utils/helpers';
import { formatRole } from '@/utils/format';
import { useChats } from '@/hooks/useChats';
import type { Chat, UserPresence } from '@mb/shared';
import { toast } from 'sonner';

interface Props {
  chat: Chat;
  currentUid: string;
  presence: Record<string, UserPresence>;
  onClose: () => void;
}

export function ChatDetails({ chat, currentUid, presence, onClose }: Props) {
  const { archiveChat, pinChat } = useChats();

  const isPinned = chat.isPinned?.[currentUid] ?? false;
  const isArchived = chat.isArchived?.[currentUid] ?? false;
  const isGroup = chat.type === 'group';

  const chatName = isGroup
    ? chat.name ?? 'Group'
    : Object.values(chat.memberDetails).find((m) => m.uid !== currentUid)?.displayName ?? 'DM';

  async function handlePin() {
    try {
      await pinChat(chat.id, !isPinned);
      toast.success(isPinned ? 'Unpinned' : 'Pinned conversation');
    } catch {
      toast.error('Failed to update pin');
    }
  }

  async function handleArchive() {
    try {
      await archiveChat(chat.id);
      toast.success('Archived conversation');
      onClose();
    } catch {
      toast.error('Failed to update archive');
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden border-l border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-border flex-shrink-0">
        <h3 className="text-sm font-semibold">Details</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Chat info */}
        <div className="flex flex-col items-center px-4 py-5 gap-2">
          <Avatar className="h-16 w-16">
            <AvatarFallback className="text-lg bg-primary/10 text-primary">
              {initials(chatName)}
            </AvatarFallback>
          </Avatar>
          <p className="text-sm font-semibold text-center">{chatName}</p>
          {isGroup && chat.description && (
            <p className="text-xs text-muted-foreground text-center">{chat.description}</p>
          )}
          {isGroup && (
            <Badge variant="outline" className="text-[10px]">
              {chat.groupType ?? 'custom'} · {chat.members.length} members
            </Badge>
          )}
        </div>

        <Separator />

        {/* Quick actions */}
        <div className="grid grid-cols-2 gap-2 px-3 py-3">
          <Button
            variant={isPinned ? 'secondary' : 'outline'}
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={handlePin}
          >
            <Pin className="h-3.5 w-3.5" />
            {isPinned ? 'Unpin' : 'Pin'}
          </Button>
          <Button
            variant={isArchived ? 'secondary' : 'outline'}
            size="sm"
            className="h-8 text-xs gap-1.5"
            onClick={handleArchive}
          >
            <Archive className="h-3.5 w-3.5" />
            {isArchived ? 'Unarchive' : 'Archive'}
          </Button>
        </div>

        <Separator />

        {/* Members */}
        <div className="px-3 py-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Members ({chat.members.length})
            </p>
          </div>

          <div className="space-y-0.5">
            {chat.members.map((uid) => {
              const member = chat.memberDetails[uid];
              if (!member) return null;
              const memberPresence = presence[uid];
              const isCurrentUser = uid === currentUid;

              return (
                <div key={uid} className="flex items-center gap-2.5 px-1 py-2 rounded-lg hover:bg-muted/40 transition-colors">
                  <div className="relative flex-shrink-0">
                    <Avatar className="h-7 w-7">
                      <AvatarFallback className="text-[10px] bg-muted text-muted-foreground">
                        {initials(member.displayName)}
                      </AvatarFallback>
                    </Avatar>
                    {memberPresence && (
                      <PresenceDot
                        status={memberPresence.status}
                        className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 border-[1.5px] border-background"
                      />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">
                      {member.displayName} {isCurrentUser && <span className="text-muted-foreground font-normal">(you)</span>}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {formatRole(member.role)}{member.branchName ? ` · ${member.branchName}` : ''}
                    </p>
                  </div>
                  <span className={cn(
                    'text-[9px] font-medium',
                    memberPresence?.status === 'online' ? 'text-emerald-500' : 'text-muted-foreground'
                  )}>
                    {memberPresence?.status ?? 'offline'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
