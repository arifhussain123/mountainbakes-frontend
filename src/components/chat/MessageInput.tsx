'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Send, Paperclip, Loader2 } from '@/utils/icons';
import { EmojiPicker } from './EmojiPicker';
import { ReplyBar } from './ReplyBar';
import { AttachmentPreview } from './AttachmentPreview';
import type { MessageReply, ChatAttachment, SendMessageInput } from '@mb/shared';
import { CHAT_ATTACHMENT_MAX_BYTES } from '@/utils/constants';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface StagedFile {
  file: File;
  preview: string;
  uploading: boolean;
  result?: ChatAttachment;
}

interface Props {
  replyTo: MessageReply | null;
  onClearReply: () => void;
  onSend: (input: SendMessageInput) => Promise<void>;
  onTyping: (isTyping: boolean) => void;
  onUpload: (file: File) => Promise<ChatAttachment>;
  disabled?: boolean;
}

export function MessageInput({ replyTo, onClearReply, onSend, onTyping, onUpload, disabled }: Props) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [staged, setStaged] = useState<StagedFile[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  function handleEmojiSelect(emoji: string) {
    setText((prev) => prev + emoji);
    textareaRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleTextChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setText(e.target.value);
    onTyping(e.target.value.length > 0);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';

    for (const file of files) {
      if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
        toast.error(`${file.name} exceeds the 10 MB limit`);
        continue;
      }

      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : '';
      const staged: StagedFile = { file, preview, uploading: true };
      setStaged((prev) => [...prev, staged]);

      try {
        const result = await onUpload(file);
        setStaged((prev) =>
          prev.map((s) => s.file === file ? { ...s, uploading: false, result } : s)
        );
      } catch {
        toast.error(`Failed to upload ${file.name}`);
        setStaged((prev) => prev.filter((s) => s.file !== file));
        if (preview) URL.revokeObjectURL(preview);
      }
    }
  }

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed && staged.length === 0) return;
    if (staged.some((s) => s.uploading)) return;

    setSending(true);
    try {
      const attachments = staged.filter((s) => s.result).map((s) => s.result!);
      const type = attachments.length > 0
        ? (attachments[0].mimeType.startsWith('image/') ? 'image' : 'file')
        : 'text';

      await onSend({ text: trimmed || null, type, attachments, replyTo });

      setText('');
      setStaged([]);
      onClearReply();
      onTyping(false);
      textareaRef.current?.focus();
    } catch (err) {
      toast.error('Failed to send message');
    } finally {
      setSending(false);
    }
  }

  const canSend = (text.trim().length > 0 || staged.length > 0) && !staged.some((s) => s.uploading) && !sending;

  return (
    <div className="border-t border-border bg-card">
      {/* Reply bar */}
      {replyTo && <ReplyBar replyTo={replyTo} onClose={onClearReply} />}

      {/* Staged attachments */}
      {staged.length > 0 && (
        <div className="flex gap-2 flex-wrap px-3 pt-2">
          {staged.map((s, i) => (
            <AttachmentPreview
              key={i}
              mode="send"
              staged={s}
              onRemove={() => {
                if (s.preview) URL.revokeObjectURL(s.preview);
                setStaged((prev) => prev.filter((_, j) => j !== i));
              }}
            />
          ))}
        </div>
      )}

      <div className="flex items-end gap-1.5 px-3 py-2.5">
        {/* File input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,application/pdf,.xlsx,.xls,.csv"
          className="hidden"
          onChange={handleFileChange}
          disabled={disabled || sending}
        />

        {/* Emoji */}
        <EmojiPicker onEmojiSelect={handleEmojiSelect} disabled={disabled || sending} />

        {/* Attach */}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground flex-shrink-0"
          onClick={() => fileInputRef.current?.click()}
          disabled={disabled || sending}
          title="Attach file"
        >
          <Paperclip className="h-4 w-4" />
        </Button>

        {/* Textarea */}
        <Textarea
          ref={textareaRef}
          value={text}
          onChange={handleTextChange}
          onKeyDown={handleKeyDown}
          placeholder="Type a message… (Enter to send, Shift+Enter for new line)"
          className={cn(
            'flex-1 min-h-[36px] max-h-[140px] resize-none py-2 text-sm',
            'border-0 bg-muted/40 focus-visible:ring-1 rounded-xl'
          )}
          disabled={disabled || sending}
          rows={1}
        />

        {/* Send */}
        <Button
          type="button"
          size="icon"
          className="h-8 w-8 flex-shrink-0 rounded-full"
          onClick={handleSend}
          disabled={!canSend || disabled}
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
