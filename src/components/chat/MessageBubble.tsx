'use client';

import { useState } from 'react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreHorizontal, Reply, Pencil, Trash2, Pin, Copy, CheckCheck, Check } from '@/utils/icons';
import { AttachmentPreview } from './AttachmentPreview';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/utils/date';
import { initials } from '@/utils/helpers';
import type { ChatMessage, MessageReply } from '@mb/shared';
import { toast } from 'sonner';

interface Props {
  message: ChatMessage;
  currentUid: string;
  isGroup: boolean;
  showAvatar: boolean;
  onReply: (replyTo: MessageReply) => void;
  onEdit: (messageId: string, currentText: string) => void;
  onDelete: (messageId: string) => void;
  onPin: (messageId: string, pin: boolean) => void;
}

export function MessageBubble({ message, currentUid, isGroup, showAvatar, onReply, onEdit, onDelete, onPin }: Props) {
  const isOwn = message.senderId === currentUid;
  const [hovering, setHovering] = useState(false);

  if (message.deletedAt) {
    return (
      <div className={cn('flex gap-2 px-4 py-0.5', isOwn ? 'justify-end' : 'justify-start')}>
        <p className="text-xs italic text-muted-foreground/50 bg-muted/30 px-3 py-1.5 rounded-full">
          This message was deleted
        </p>
      </div>
    );
  }

  const readByOthers = Object.keys(message.readBy).some((uid) => uid !== currentUid);
  const allMembersRead = readByOthers; // simplified — enough for the indicator

  function handleCopy() {
    if (message.text) {
      navigator.clipboard.writeText(message.text);
      toast.success('Copied to clipboard');
    }
  }

  return (
    <div
      className={cn('flex gap-2 px-4 py-0.5 group', isOwn ? 'flex-row-reverse' : 'flex-row')}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      {/* Avatar (only for others in group) */}
      {!isOwn && showAvatar ? (
        <Avatar className="h-7 w-7 flex-shrink-0 self-end mb-1">
          <AvatarFallback className="text-[10px] bg-primary/10 text-primary">
            {initials(message.senderName)}
          </AvatarFallback>
        </Avatar>
      ) : !isOwn ? (
        <div className="w-7 flex-shrink-0" />
      ) : null}

      <div className={cn('flex flex-col max-w-[72%]', isOwn ? 'items-end' : 'items-start')}>
        {/* Sender name + time (group chats, non-own) */}
        {!isOwn && isGroup && showAvatar && (
          <p className="text-[11px] font-medium text-muted-foreground mb-0.5 px-1">{message.senderName}</p>
        )}

        {/* Reply quote */}
        {message.replyTo && (
          <div className={cn(
            'text-xs px-2.5 py-1.5 rounded-t-lg border-l-2 border-primary/60 bg-muted/50 mb-0.5 max-w-full',
            isOwn ? 'rounded-tl-lg' : 'rounded-tr-lg'
          )}>
            <p className="font-medium text-primary/80">{message.replyTo.senderName}</p>
            <p className="text-muted-foreground truncate">
              {message.replyTo.type === 'text' ? message.replyTo.text : `[${message.replyTo.type}]`}
            </p>
          </div>
        )}

        {/* Bubble */}
        <div className={cn(
          'relative px-3.5 py-2 rounded-2xl text-sm leading-relaxed',
          isOwn
            ? 'bg-primary text-white rounded-br-sm'
            : 'bg-card border border-border text-foreground rounded-bl-sm',
          message.replyTo && (isOwn ? 'rounded-tr-sm' : 'rounded-tl-sm')
        )}>
          {/* Attachments */}
          {message.attachments.map((att, i) => (
            <div key={i} className="mb-1">
              <AttachmentPreview mode="bubble" attachment={att} />
            </div>
          ))}

          {/* Text */}
          {message.text && (
            <p className="whitespace-pre-wrap break-words">{message.text}</p>
          )}

          {/* Edited indicator */}
          {message.editedAt && (
            <span className={cn('text-[10px] ml-1', isOwn ? 'text-white/60' : 'text-muted-foreground')}>
              (edited)
            </span>
          )}
        </div>

        {/* Time + read receipt */}
        <div className={cn('flex items-center gap-1 mt-0.5 px-1', isOwn ? 'flex-row-reverse' : '')}>
          <span className="text-[10px] text-muted-foreground">{timeAgo(message.sentAt)}</span>
          {isOwn && (
            allMembersRead
              ? <CheckCheck className="h-3 w-3 text-primary" />
              : <Check className="h-3 w-3 text-muted-foreground" />
          )}
          {message.isPinned && <Pin className="h-2.5 w-2.5 text-amber-500" />}
        </div>
      </div>

      {/* Context menu */}
      {hovering && (
        <div className={cn('self-center', isOwn ? 'mr-1' : 'ml-1')}>
          <DropdownMenu>
            <DropdownMenuTrigger className="h-6 w-6 rounded-full hover:bg-accent flex items-center justify-center text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align={isOwn ? 'end' : 'start'} className="w-44">
              <DropdownMenuItem onClick={() => onReply({
                messageId: message.id,
                senderId: message.senderId,
                senderName: message.senderName,
                text: message.text ?? `[${message.type}]`,
                type: message.type,
              })}>
                <Reply className="h-3.5 w-3.5 mr-2" /> Reply
              </DropdownMenuItem>
              {message.text && (
                <DropdownMenuItem onClick={handleCopy}>
                  <Copy className="h-3.5 w-3.5 mr-2" /> Copy
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => onPin(message.id, !message.isPinned)}>
                <Pin className="h-3.5 w-3.5 mr-2" /> {message.isPinned ? 'Unpin' : 'Pin'}
              </DropdownMenuItem>
              {isOwn && message.text && (
                <DropdownMenuItem onClick={() => onEdit(message.id, message.text!)}>
                  <Pencil className="h-3.5 w-3.5 mr-2" /> Edit
                </DropdownMenuItem>
              )}
              {isOwn && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => onDelete(message.id)}
                    className="text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
