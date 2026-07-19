import { X, Reply } from '@/utils/icons';
import { Button } from '@/components/ui/button';
import type { MessageReply } from '@mb/shared';

interface Props {
  replyTo: MessageReply;
  onClose: () => void;
}

export function ReplyBar({ replyTo, onClose }: Props) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-muted/60 border-t border-border text-sm">
      <Reply className="h-3.5 w-3.5 text-primary flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="font-medium text-primary text-xs">{replyTo.senderName}</span>
        <p className="text-muted-foreground truncate text-xs mt-0.5">
          {replyTo.type === 'text' ? replyTo.text : `[${replyTo.type}]`}
        </p>
      </div>
      <Button variant="ghost" size="icon" className="h-6 w-6 flex-shrink-0" onClick={onClose}>
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
