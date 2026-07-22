'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Paperclip, Send, FileText, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { useAddTicketMessage } from '@/lib/queries';
import { qk } from '@/lib/queryKeys';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { SupportTicket, SupportTicketAttachment } from '@mb/shared';

const ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf,.xls,.xlsx,.doc,.docx';
const roleLabel = (r?: string | null) =>
  r === 'super_admin' ? 'Admin' : r === 'branch_manager' ? 'Branch' : r === 'production_user' ? 'Production' : '';

/** A clickable attachment chip — fetches a short-lived signed URL on click, then opens it. */
function AttachmentChip({ attachment, token }: { attachment: SupportTicketAttachment; token: string }) {
  const [loading, setLoading] = useState(false);
  async function open() {
    setLoading(true);
    try {
      const r = await apiCall<{ url: string }>(`/api/support-tickets/attachments/${attachment.id}/url`, {}, token);
      window.open(r.url, '_blank', 'noopener,noreferrer');
    } catch {
      toast.error('Could not open attachment');
    } finally {
      setLoading(false);
    }
  }
  return (
    <button
      type="button"
      onClick={open}
      disabled={loading}
      className="inline-flex max-w-full items-center gap-1.5 rounded-md border bg-card px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
    >
      <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{attachment.fileName}</span>
    </button>
  );
}

export function TicketConversation({ ticket }: { ticket: SupportTicket }) {
  const { token, user } = useAuth();
  const qc = useQueryClient();
  const addMsg = useAddTicketMessage(token);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);

  const canReply = ticket.status !== 'closed';

  async function send() {
    if (!text.trim() && !file) return;
    setSending(true);
    try {
      // A file with no text still needs a carrier message (attachments hang off a reply).
      const body = text.trim() || (file ? `📎 ${file.name}` : '');
      const res = await addMsg.mutateAsync({ ticketId: ticket.id, message: body });
      const messageId = (res as { message?: { id?: string } })?.message?.id;

      if (file && messageId) {
        const fd = new FormData();
        fd.append('file', file);
        await apiCall(`/api/support-tickets/${ticket.id}/attachments?messageId=${messageId}`, { method: 'POST', body: fd }, token);
      }
      setText('');
      setFile(null);
      qc.invalidateQueries({ queryKey: qk.ticket(ticket.id) });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  }

  const openingAttachments = ticket.attachments ?? [];
  const messages = ticket.messages ?? [];

  return (
    <div className="flex flex-col">
      {/* Scrollable thread — newest at the bottom. */}
      <div className="max-h-[46vh] space-y-3 overflow-y-auto pr-1">
        {/* Opening post */}
        <ThreadItem
          isOwn={ticket.createdBy === user?.uid}
          name={ticket.createdByName ?? 'User'}
          role={ticket.createdByRole}
          at={ticket.createdAt}
          body={ticket.description}
        >
          {openingAttachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {openingAttachments.map((a) => (
                <AttachmentChip key={a.id} attachment={a} token={token} />
              ))}
            </div>
          )}
        </ThreadItem>

        {messages.map((m) => (
          <ThreadItem
            key={m.id}
            isOwn={m.senderId === user?.uid}
            name={m.senderName ?? 'User'}
            role={m.senderRole}
            at={m.createdAt}
            body={m.message}
          >
            {(m.attachments?.length ?? 0) > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.attachments!.map((a) => (
                  <AttachmentChip key={a.id} attachment={a} token={token} />
                ))}
              </div>
            )}
          </ThreadItem>
        ))}
      </div>

      {/* Reply box */}
      {canReply ? (
        <div className="mt-3 space-y-2 border-t pt-3">
          {file && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              <span className="truncate">{file.name}</span>
              <button type="button" onClick={() => setFile(null)} className="text-destructive">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Write a reply…"
            className="min-h-[70px]"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); }
            }}
          />
          <div className="flex items-center justify-between">
            <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
              <Paperclip className="h-4 w-4" />
              <span>Attach</span>
              <input
                type="file"
                accept={ACCEPT}
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <Button size="sm" onClick={send} disabled={sending || (!text.trim() && !file)}>
              <Send className="mr-1.5 h-3.5 w-3.5" />
              {sending ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </div>
      ) : (
        <p className="mt-3 border-t pt-3 text-center text-xs text-muted-foreground">This ticket is closed.</p>
      )}
    </div>
  );
}

function ThreadItem({
  isOwn, name, role, at, body, children,
}: {
  isOwn: boolean; name: string; role?: string | null; at: string; body: string; children?: React.ReactNode;
}) {
  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-lg border px-3 py-2 ${isOwn ? 'bg-primary/5' : 'bg-card'}`}>
        <div className="mb-1 flex items-center gap-2 text-xs">
          <span className="font-medium">{name}</span>
          {role && <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{roleLabel(role)}</span>}
          <span className="text-muted-foreground">{format(new Date(at), 'dd MMM, HH:mm')}</span>
        </div>
        <p className="whitespace-pre-wrap text-sm">{body}</p>
        {children}
      </div>
    </div>
  );
}
