'use client';

import { useState } from 'react';
import { MessageReviewSchema, type Supplier, type WhatsAppMessage } from '@mb/shared';
import { CheckCircle2, Inbox, Link2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { Pagination } from '@/components/data-engine/Pagination';
import { usePurchaseDemands, usePurchaseMessages, useReviewMessage } from '@/lib/purchasing';
import { demandStatusLabel } from './purchasing-model';
import { ConfirmDialog, Field, errorMessage } from './parts';
import { MessageList } from './MessageList';
import { SupplierPicker } from './SupplierPicker';

const PAGE = 20;

/**
 * The two message queues that need a person.
 *
 * UNMATCHED: an inbound message the webhook could not tie to a supplier or a
 * demand with certainty — an unknown number, or a known supplier with several
 * open demands and nothing in the text to say which. Nothing is guessed; it
 * waits here to be assigned or dismissed (POST /messages/:id/review).
 *
 * FAILED: a send WhatsApp refused for good (after the outbox's own retries).
 * Retry re-queues the SAME message — no second demand, no second message row.
 */
export function MessageQueue({
  token,
  filter,
  onOpenDemand,
}: {
  token: string;
  filter: 'unmatched' | 'failed';
  /** Where a refused Retry sends the person: the demand, whose Resend link sends a fresh one. */
  onOpenDemand: (id: string) => void;
}) {
  const [page, setPage] = useState(1);
  const q = usePurchaseMessages(token, { filter, page, limit: PAGE });
  const review = useReviewMessage(token);
  const [assigning, setAssigning] = useState<WhatsAppMessage | null>(null);
  const [dismissing, setDismissing] = useState<WhatsAppMessage | null>(null);
  const messages = q.data?.messages ?? [];

  async function dismiss() {
    if (!dismissing) return;
    try {
      await review.mutateAsync({ messageId: dismissing.id, body: { action: 'dismiss' } });
      toast.success('Message dismissed');
      setDismissing(null);
    } catch (e) {
      toast.error(errorMessage(e, 'Could not dismiss the message'));
    }
  }

  if (q.isLoading) return <Skeleton className="h-48 w-full" />;
  if (q.isError) {
    return (
      <div className="space-y-2 text-sm">
        <p className="text-destructive">{errorMessage(q.error, 'Could not load the messages.')}</p>
        <Button size="sm" variant="outline" onClick={() => void q.refetch()}>Try again</Button>
      </div>
    );
  }
  if (messages.length === 0) {
    return filter === 'unmatched' ? (
      <EmptyState icon={Inbox} title="Nothing to match" description="Every inbound message has been tied to a supplier or a demand." />
    ) : (
      <EmptyState icon={CheckCircle2} title="No failed messages" description="Every message WhatsApp refused has been retried or resolved." />
    );
  }

  return (
    <div className="space-y-3">
      <MessageList
        token={token}
        messages={messages}
        showContext
        onResendLink={(m) => m.demandId && onOpenDemand(m.demandId)}
        resendLabel="Open demand"
        extraActions={
          filter === 'unmatched'
            ? (m) => (
                <>
                  <Button size="xs" onClick={() => setAssigning(m)}>
                    <Link2 className="mr-1 h-3 w-3" /> Assign
                  </Button>
                  <Button size="xs" variant="outline" onClick={() => setDismissing(m)}>
                    <XCircle className="mr-1 h-3 w-3" /> Dismiss
                  </Button>
                </>
              )
            : undefined
        }
      />
      <Pagination page={page} pageSize={PAGE} total={q.data?.total ?? 0} onPageChange={setPage} loading={q.isFetching} />
      <AssignDialog token={token} message={assigning} onClose={() => setAssigning(null)} />
      <ConfirmDialog
        open={!!dismissing}
        onOpenChange={(o) => !o && setDismissing(null)}
        title="Dismiss this message?"
        description="It leaves the Unmatched queue without being tied to any supplier or demand. It stays in the conversation's history."
        confirmLabel="Dismiss"
        pending={review.isPending}
        onConfirm={() => void dismiss()}
      />
    </div>
  );
}

/** Tie an unmatched message to a supplier, and optionally one of their demands. */
function AssignDialog({ token, message, onClose }: { token: string; message: WhatsAppMessage | null; onClose: () => void }) {
  const review = useReviewMessage(token);
  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [demandId, setDemandId] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const demandsQ = usePurchaseDemands(token, { supplierId: supplier?.id ?? null, limit: 50 }, { enabled: !!supplier });

  const [shown, setShown] = useState<string | null>(null);
  if ((message?.id ?? null) !== shown) {
    setShown(message?.id ?? null);
    setSupplier(null);
    setDemandId(null);
    setAttempted(false);
  }

  const body = { action: 'assign' as const, supplierId: supplier?.id ?? null, demandId };
  const parsed = MessageReviewSchema.safeParse(body);
  const demands = demandsQ.data?.demands ?? [];

  async function submit() {
    setAttempted(true);
    if (!message || !parsed.success || review.isPending) return;
    try {
      await review.mutateAsync({ messageId: message.id, body: parsed.data });
      toast.success('Message assigned');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e, 'Could not assign the message'));
    }
  }

  return (
    <Dialog open={!!message} onOpenChange={(o) => !o && !review.isPending && onClose()}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign message</DialogTitle>
          <DialogDescription>From {message?.waId}: &ldquo;{(message?.body ?? '').slice(0, 140)}&rdquo;</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Field label="Supplier" htmlFor="assign-supplier">
            <SupplierPicker token={token} id="assign-supplier" value={supplier} onChange={(s) => { setSupplier(s); setDemandId(null); }} />
          </Field>
          <Field label="Demand (optional)" htmlFor="assign-demand" error={attempted && !parsed.success ? 'Choose a supplier or a demand' : null}>
            <Select value={demandId ?? 'none'} onValueChange={(v) => setDemandId(!v || v === 'none' ? null : (v as string))} disabled={!supplier}>
              <SelectTrigger id="assign-demand" className="h-10 w-full">
                <SelectValue>
                  {(v: string) => {
                    const d = demands.find((x) => x.id === v);
                    return d ? `${d.demandNo} · ${demandStatusLabel(d.status)}` : supplier ? 'No specific demand' : 'Choose a supplier first';
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No specific demand</SelectItem>
                {demands.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.demandNo} · {demandStatusLabel(d.status)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={review.isPending}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={review.isPending}>{review.isPending ? 'Saving…' : 'Assign'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
