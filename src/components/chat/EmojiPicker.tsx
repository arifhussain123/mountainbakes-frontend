'use client';

import { useState, useRef, useEffect } from 'react';
import { SmilePlus } from '@/utils/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const EMOJIS = [
  '😀','😂','😍','🥰','😎','🤔','😢','😡','👍','👎',
  '🙏','🤝','👋','🎉','🔥','❤️','💯','✅','❌','⚠️',
  '📦','🧁','🍞','🎂','🍰','☕','🍕','🛒','📋','📊',
  '💰','💵','🏪','🏭','🚚','📞','📧','🔔','✏️','📝',
  '🕐','📅','⏰','🔒','🔑','💡','🌟','⭐','🎯','📌',
  '🤩','😴','🥳','😅','🤣','😊','🫡','👏','🙌','🫶',
];

interface Props {
  onEmojiSelect: (emoji: string) => void;
  disabled?: boolean;
}

export function EmojiPicker({ onEmojiSelect, disabled }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title="Emoji"
      >
        <SmilePlus className="h-4 w-4" />
      </Button>

      {open && (
        <div className={cn(
          'absolute bottom-10 left-0 z-50 bg-popover border border-border rounded-xl shadow-xl p-2',
          'w-64'
        )}>
          <div className="grid grid-cols-10 gap-0.5">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="h-7 w-7 text-lg flex items-center justify-center rounded hover:bg-accent transition-colors"
                onClick={() => { onEmojiSelect(emoji); setOpen(false); }}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
