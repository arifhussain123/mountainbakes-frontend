'use client';

import { useRef, useState } from 'react';
import { MessageReplySchema, type WhatsAppConversation } from '@mb/shared';
import { ArrowLeft, Clock, MessageCircle, Search, Send } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState } from '@/components/shared/EmptyState';
import { useDebounce } from '@/hooks/useDebounce';
import {
  useMarkConversationRead,
  usePurchaseConversations,
  usePurchaseDemands,
  usePurchaseMessages,
  useReplyConversation,
} from '@/lib/purchasing';
import { formatDateTime } from '@/utils/date';
import { cn } from '@/lib/utils';
import { SubmissionKey, demandStatusLabel, isReplyWindowOpen, newRequestId } from './purchasing-model';
import { errorMessage } from './parts';
import { MessageList } from './MessageList';

/**
 * Conversations — every WhatsApp thread on the Production number.
 *
 * THE 24-HOUR WINDOW. WhatsApp lets a business send free text only within a
 * day of the contact's last message; after that only an approved template
 * goes through, and a template cannot carry an arbitrary reply. The server
 * computes `windowOpenUntil` and refuses a reply outside it, so the box is
 * disabled here with the reason and the way round it — "Resend link" on the
 * demand sends the update template, which works at any time.
 */
export function ConversationsPanel({ token, onOpenDemand }: { token: string; onOpenDemand: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search.trim(), 300);
  const convQ = usePurchaseConversations(token, debounced || null);
  const markRead = useMarkConversationRead(token);
  const [openId, setOpenId] = useState<string | null>(null);
  const conversations = convQ.data?.conversations ?? [];
  const open = conversations.find((c) => c.id === openId) ?? null;

  function select(c: WhatsAppConversation) {
    setOpenId(c.id);
    if (c.unreadCount > 0) markRead.mutate(c.id);
  }

  return (
    <div className="grid min-h-[28rem] grid-cols-1 gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
      {/* On a phone the list and the thread take turns; side by side from md. */}
      <div className={cn('space-y-2', open && 'max-md:hidden')}>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search number or name…" className="h-10 pl-8" aria-label="Search conversations" />
        </div>
        {convQ.isLoading ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : convQ.isError ? (
          <div className="space-y-2 text-sm">
            <p className="text-destructive">{errorMessage(convQ.error, 'Could not load conversations.')}</p>
            <Button size="sm" variant="outline" onClick={() => void convQ.refetch()}>Try again</Button>
          </div>
        ) : conversations.length === 0 ? (
          <EmptyState icon={MessageCircle} title="No conversations" description={debounced ? 'Try a different search.' : 'Threads appear here once a demand is sent or a supplier writes in.'} />
        ) : (
          <ul className="divide-y rounded-lg border">
            {conversations.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => select(c)}
                  className={cn('flex w-full items-start gap-2 p-2.5 text-left hover:bg-muted/60', c.id === openId && 'bg-muted')}
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{c.supplierName ?? c.profileName ?? c.waId}</span>
                      {c.unreadCount > 0 && (
                        <span className="shrink-0 rounded-full bg-emerald-600 px-1.5 text-[11px] font-semibold text-white">{c.unreadCount}</span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {c.lastMessage ? `${c.lastMessage.direction === 'outbound' ? 'You: ' : ''}${c.lastMessage.body ?? ''}` : c.waId}
                    </p>
                    <p className="text-[11px] text-muted-foreground">{c.lastMessageAt ? formatDateTime(c.lastMessageAt) : ''}</p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={cn(!open && 'max-md:hidden')}>
        {open ? (
          <Thread token={token} conversation={open} onBack={() => setOpenId(null)} onOpenDemand={onOpenDemand} />
        ) : (
          <EmptyState icon={MessageCircle} title="Choose a conversation" description="The thread, its delivery statuses and the reply box open here." className="h-full" />
        )}
      </div>
    </div>
  );
}

function Thread({
  token,
  conversation: c,
  onBack,
  onOpenDemand,
}: {
  token: string;
  conversation: WhatsAppConversation;
  onBack: () => void;
  onOpenDemand: (id: string) => void;
}) {
  const msgsQ = usePurchaseMessages(token, { conversationId: c.id, limit: 200 });
  // Demands with this supplier, to link a reply to one (optional).
  const demandsQ = usePurchaseDemands(token, { supplierId: c.supplierId, bucket: 'pending', limit: 50 }, { enabled: !!c.supplierId });
  const reply = useReplyConversation(token);
  const [text, setText] = useState('');
  const [demandId, setDemandId] = useState<string | null>(null);
  const key = useRef(new SubmissionKey('reply'));
  const [clientRequestId, setClientRequestId] = useState(() => newRequestId('reply'));

  const windowOpen = isReplyWindowOpen(c.windowOpenUntil);
  const messages = [...(msgsQ.data?.messages ?? [])].reverse();
  const parsed = MessageReplySchema.safeParse({ body: text, demandId, clientRequestId });

  async function send() {
    if (!parsed.success || reply.isPending || !windowOpen) return;
    try {
      await reply.mutateAsync({ id: c.id, body: parsed.data, key: key.current.keyFor(JSON.stringify(parsed.data)) });
      key.current.reset();
      setClientRequestId(newRequestId('reply'));
      setText('');
      toast.success('Reply queued');
    } catch (e) {
      toast.error(errorMessage(e, 'Could not send the reply'));
    }
  }

  const demands = demandsQ.data?.demands ?? [];
  return (
    <div className="flex h-full flex-col gap-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button variant="ghost" size="icon-sm" className="md:hidden" onClick={onBack} aria-label="Back to conversations">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <p className="truncate font-medium">{c.supplierName ?? c.profileName ?? c.waId}</p>
            <p className="text-xs text-muted-foreground">
              {c.waId}
              {c.profileName && c.supplierName ? ` · WhatsApp name ${c.profileName}` : ''}
              {!c.supplierId ? ' · not linked to a supplier' : ''}
            </p>
          </div>
        </div>
        {demands.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {demands.slice(0, 3).map((d) => (
              <Button key={d.id} size="xs" variant="outline" onClick={() => onOpenDemand(d.id)}>
                {d.demandNo}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="max-h-[55dvh] min-h-[12rem] flex-1 overflow-y-auto">
        {msgsQ.isLoading ? <Skeleton className="h-40 w-full" /> : <MessageList token={token} messages={messages} onResendLink={(m) => m.demandId && onOpenDemand(m.demandId)} resendLabel="Open demand" />}
      </div>

      {windowOpen ? (
        <div className="space-y-2 border-t pt-3">
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" aria-hidden /> Free-text replies allowed until {formatDateTime(c.windowOpenUntil)}
          </p>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={1000} placeholder="Write a reply…" aria-label="Reply" />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {demands.length > 0 ? (
              <Select value={demandId ?? 'none'} onValueChange={(v) => setDemandId(!v || v === 'none' ? null : (v as string))}>
                <SelectTrigger className="h-9 w-full sm:w-64" aria-label="Link reply to demand">
                  <SelectValue>
                    {(v: string) => {
                      const d = demands.find((x) => x.id === v);
                      return d ? `About ${d.demandNo}` : 'Not about a specific demand';
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Not about a specific demand</SelectItem>
                  {demands.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.demandNo} · {demandStatusLabel(d.status)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <span />
            )}
            <Button size="sm" onClick={() => void send()} disabled={!parsed.success || reply.isPending}>
              <Send className="mr-1.5 h-4 w-4" /> {reply.isPending ? 'Sending…' : 'Send reply'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-1 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
          <p className="font-medium">The 24-hour reply window is closed.</p>
          <p className="text-xs">
            WhatsApp only allows free text within 24 hours of {c.supplierName ?? 'the contact'}&apos;s last message
            {c.lastInboundAt ? ` (${formatDateTime(c.lastInboundAt)})` : ''}. To reach them now, open the demand and use <strong>Resend link</strong> — it sends an approved template that works at any time. The box opens again as soon as they write.
          </p>
          <Textarea disabled rows={2} placeholder="Replies are disabled outside the 24-hour window" aria-label="Reply (disabled)" />
        </div>
      )}
    </div>
  );
}
