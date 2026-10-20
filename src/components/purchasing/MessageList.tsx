'use client';

import type { ReactNode } from 'react';
import type { WhatsAppMessage } from '@mb/shared';
import { ArrowDownLeft, ArrowUpRight, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/utils/api';
import { useRetryMessage } from '@/lib/purchasing';
import { formatDateTime } from '@/utils/date';
import { cn } from '@/lib/utils';
import { MessageStatusPill } from './badges';
import { errorMessage } from './parts';

/**
 * WhatsApp messages as a thread: inbound on the left, outbound on the right,
 * each with its delivery status, the error WhatsApp gave when it failed, and
 * Retry on a failed send.
 *
 * Bodies are shown as stored. The server masks the supplier link in the stored
 * copy of every outbound message, so the token is never on this screen.
 */
export function MessageList({
  token,
  messages,
  showContext = false,
  empty = 'No messages yet.',
  extraActions,
  onResendLink,
  resendLabel = 'Resend link',
}: {
  token: string;
  /** In display order — callers pass oldest first for a thread. */
  messages: WhatsAppMessage[];
  /** Show which demand / supplier each message belongs to — for the queues, where rows are unrelated. */
  showContext?: boolean;
  empty?: string;
  /** Extra buttons per message (the Unmatched queue's Assign / Dismiss). */
  extraActions?: (m: WhatsAppMessage) => ReactNode;
  /**
   * Offered when Retry is refused because the failed message carried a
   * supplier link that has since been masked: it cannot be resent as it was,
   * and a fresh link is the way round. The detail passes its own Resend link;
   * the queues pass "open the demand".
   */
  onResendLink?: (m: WhatsAppMessage) => void;
  resendLabel?: string;
}) {
  const retry = useRetryMessage(token);

  async function doRetry(m: WhatsAppMessage) {
    try {
      await retry.mutateAsync(m.id);
      toast.success('Message queued again');
    } catch (e) {
      // The server's sentence as-is. A 409 naming "Resend link" means the
      // message held a supplier link that has been masked since; a retry can
      // never succeed, so offer the action that can.
      const linkGone = e instanceof ApiError && e.status === 409 && /resend link/i.test(e.message);
      toast.error(errorMessage(e, 'Could not retry the message'), {
        ...(linkGone && onResendLink && m.demandId ? { action: { label: resendLabel, onClick: () => onResendLink(m) } } : {}),
        duration: linkGone ? 10_000 : undefined,
      });
    }
  }

  if (messages.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>;

  return (
    <ul className="space-y-2">
      {messages.map((m) => {
        const out = m.direction === 'outbound';
        return (
          <li key={m.id} className={cn('flex', out ? 'justify-end' : 'justify-start')}>
            <div
              className={cn(
                'w-full max-w-[42rem] space-y-1.5 rounded-xl border p-2.5 text-sm sm:w-[85%]',
                out ? 'bg-emerald-50/60 dark:bg-emerald-950/20' : 'bg-card',
                m.status === 'failed' && 'border-destructive/50',
              )}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  {out ? <ArrowUpRight className="h-3.5 w-3.5" aria-hidden /> : <ArrowDownLeft className="h-3.5 w-3.5" aria-hidden />}
                  {out ? `To ${m.waId}` : `From ${m.waId}`}
                  {m.createdByName ? ` · ${m.createdByName}` : ''}
                  {m.templateName ? ` · template ${m.templateName}` : m.type !== 'text' ? ` · ${m.type}` : ''}
                </span>
                <MessageStatusPill status={m.status} />
              </div>
              {showContext && (m.demandNo || m.supplierName) && (
                <p className="text-xs font-medium">
                  {[m.demandNo, m.supplierName].filter(Boolean).join(' · ')}
                </p>
              )}
              <p className="whitespace-pre-wrap break-words">{m.body || <span className="italic text-muted-foreground">(no text)</span>}</p>
              {m.status === 'failed' && (m.errorCode || m.errorTitle || m.errorDetail) && (
                <p className="rounded-md bg-destructive/10 p-2 text-xs text-destructive">
                  {m.errorCode ? `Error ${m.errorCode}` : 'Error'}
                  {m.errorTitle ? `: ${m.errorTitle}` : ''}
                  {m.errorDetail ? ` — ${m.errorDetail}` : ''}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>
                  {formatDateTime(m.createdAt)}
                  {m.deliveredAt ? ` · delivered ${formatDateTime(m.deliveredAt)}` : ''}
                  {m.readAt ? ` · read ${formatDateTime(m.readAt)}` : ''}
                  {m.failedAt ? ` · failed ${formatDateTime(m.failedAt)}` : ''}
                  {m.status === 'queued' && m.attempts ? ` · attempt ${m.attempts}` : ''}
                  {m.status === 'queued' && m.nextAttemptAt ? `, next try ${formatDateTime(m.nextAttemptAt)}` : ''}
                </span>
                <span className="flex flex-wrap gap-1.5">
                  {extraActions?.(m)}
                  {out && m.status === 'failed' && (
                    <Button size="xs" variant="outline" disabled={retry.isPending} onClick={() => void doRetry(m)}>
                      <RotateCcw className="mr-1 h-3 w-3" /> Retry
                    </Button>
                  )}
                </span>
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
