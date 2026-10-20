'use client';

import { useRef, useState } from 'react';
import {
  NoteSchema,
  PURCHASE_DEMAND_STATUS_LABEL,
  PURCHASE_PAYMENT_PREFERENCE_LABEL,
  type PurchaseDemandDetail,
  type PurchaseDemandStatus,
} from '@mb/shared';
import { Ban, Link2, Pencil, RefreshCw, StickyNote } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PrintButton } from '@/components/shared/PrintButton';
import { PrintPortal } from '@/components/shared/PrintPortal';
import { useDocumentPrint } from '@/hooks/useDocumentPrint';
import { useAddDemandNote, useCancelDemand, usePurchaseDemand, useResendLink } from '@/lib/purchasing';
import { formatDate, formatDateTime } from '@/utils/date';
import { SubmissionKey, eventLabel, formatQty, isInFuture } from './purchasing-model';
import { DemandBadges } from './badges';
import { ConfirmDialog, Facts, Pill, ReasonDialog, Section, errorMessage, money } from './parts';
import { QuotationsSection } from './QuotationsSection';
import { BillsSection } from './BillsSection';
import { DeliveryReceiptSection } from './DeliveryReceiptSection';
import { PaymentsSection } from './PaymentsSection';
import { MessageList } from './MessageList';
import { PurchasePrintSheet } from './PurchasePrintSheet';

/**
 * One demand in full — the place every decision on it is taken.
 *
 * A full-screen dialog on a phone and a wide modal on a desktop, with the
 * demand's life split into tabs in the order it happens: what was asked,
 * quotations, bill, delivery and receipt, money, messages, timeline. Every
 * button reads `detail.actions` — the server's answer to "what may happen to
 * this demand now" — so a demand someone else just moved on shows the
 * buttons for where it IS, after the refetch every write triggers.
 *
 * The supplier link itself is never shown, only when the current one expires:
 * the link is a credential, and the server keeps only its hash.
 */
export function DemandDetailDialog({
  token,
  demandId,
  onClose,
  onEdit,
}: {
  token: string;
  demandId: string | null;
  onClose: () => void;
  /** Open the demand form on this draft. */
  onEdit: (d: PurchaseDemandDetail) => void;
}) {
  const q = usePurchaseDemand(token, demandId);
  const d = q.data;
  const [tab, setTab] = useState('overview');
  const [confirmResend, setConfirmResend] = useState(false);
  const { printing, print } = useDocumentPrint();

  // Back to the first tab whenever a different demand opens.
  const [shownId, setShownId] = useState(demandId);
  if (demandId !== shownId) {
    setShownId(demandId);
    setTab('overview');
  }

  const failed = d?.messages.filter((m) => m.status === 'failed').length ?? 0;

  return (
    <>
      <Dialog open={!!demandId} onOpenChange={(o) => !o && onClose()}>
        <DialogContent mobile="fullscreen" className="md:max-w-5xl">
          {!d ? (
            <div className="space-y-3">
              <DialogHeader>
                <DialogTitle>Demand</DialogTitle>
                <DialogDescription>{q.isError ? errorMessage(q.error, 'Could not load the demand.') : 'Loading…'}</DialogDescription>
              </DialogHeader>
              {q.isError ? (
                <Button variant="outline" onClick={() => void q.refetch()}>Try again</Button>
              ) : (
                <>
                  <Skeleton className="h-16 w-full" />
                  <Skeleton className="h-64 w-full" />
                </>
              )}
            </div>
          ) : (
            <div className="min-w-0 space-y-4">
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2 pr-8">
                  {d.demandNo}
                  <DemandBadges demand={d} lastMessageStatus={failed > 0 ? 'failed' : null} />
                </DialogTitle>
                <DialogDescription>
                  {d.supplierName} · {d.supplierWhatsapp} · required {formatDate(d.requiredDate)}
                  {d.createdByName ? ` · raised by ${d.createdByName}` : ''}
                </DialogDescription>
              </DialogHeader>

              <HeaderActions token={token} d={d} confirmResend={confirmResend} setConfirmResend={setConfirmResend} onEdit={() => onEdit(d)} onPrint={() => print()} refreshing={q.isFetching} onRefresh={() => void q.refetch()} />

              <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
                <TabsList className="w-full justify-start">
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="quotations">Quotations{d.quotations.length ? ` (${d.quotations.length})` : ''}</TabsTrigger>
                  <TabsTrigger value="bill">Bill{d.bills.length ? ` (${d.bills.length})` : ''}</TabsTrigger>
                  <TabsTrigger value="delivery">Delivery &amp; receipt</TabsTrigger>
                  <TabsTrigger value="payments">Payments</TabsTrigger>
                  <TabsTrigger value="messages">Messages{failed ? ` (${failed} failed)` : d.messages.length ? ` (${d.messages.length})` : ''}</TabsTrigger>
                  <TabsTrigger value="timeline">Timeline</TabsTrigger>
                </TabsList>
                <TabsContent value="overview" className="pt-2">
                  <Overview token={token} d={d} />
                </TabsContent>
                <TabsContent value="quotations" className="pt-2">
                  <QuotationsSection token={token} demand={d} />
                </TabsContent>
                <TabsContent value="bill" className="pt-2">
                  <BillsSection token={token} demand={d} />
                </TabsContent>
                <TabsContent value="delivery" className="pt-2">
                  <DeliveryReceiptSection token={token} demand={d} />
                </TabsContent>
                <TabsContent value="payments" className="pt-2">
                  <PaymentsSection token={token} demand={d} />
                </TabsContent>
                <TabsContent value="messages" className="pt-2">
                  <MessageList
                    token={token}
                    messages={[...d.messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt))}
                    empty="No WhatsApp messages for this demand yet."
                    onResendLink={d.actions.resendLink ? () => setConfirmResend(true) : undefined}
                  />
                </TabsContent>
                <TabsContent value="timeline" className="pt-2">
                  <Timeline d={d} />
                </TabsContent>
              </Tabs>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {d && (
        <PrintPortal active={printing}>
          <PurchasePrintSheet demand={d} />
        </PrintPortal>
      )}
    </>
  );
}

function HeaderActions({
  token,
  d,
  confirmResend,
  setConfirmResend,
  onEdit,
  onPrint,
  refreshing,
  onRefresh,
}: {
  token: string;
  d: PurchaseDemandDetail;
  /** Lifted to the dialog so a refused message Retry can open it too. */
  confirmResend: boolean;
  setConfirmResend: (open: boolean) => void;
  onEdit: () => void;
  onPrint: () => void;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const resend = useResendLink(token);
  const cancel = useCancelDemand(token);
  const [cancelling, setCancelling] = useState(false);
  const resendKey = useRef(new SubmissionKey('resend'));

  async function doResend() {
    try {
      await resend.mutateAsync({ id: d.id, key: resendKey.current.keyFor(d.id) });
      resendKey.current.reset();
      toast.success(`A fresh link is on its way to ${d.supplierName}`);
      setConfirmResend(false);
    } catch (e) {
      toast.error(errorMessage(e, 'Could not resend the link'));
      setConfirmResend(false);
    }
  }

  async function doCancel(reason: string) {
    try {
      await cancel.mutateAsync({ id: d.id, reason });
      toast.success(`${d.demandNo} cancelled`);
      setCancelling(false);
    } catch (e) {
      toast.error(errorMessage(e, 'Could not cancel the demand'));
    }
  }

  const linkOpen = isInFuture(d.linkExpiresAt);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Link2 className="h-3.5 w-3.5" aria-hidden />
        {d.linkExpiresAt
          ? linkOpen
            ? `Supplier link valid until ${formatDateTime(d.linkExpiresAt)}`
            : `Supplier link expired ${formatDateTime(d.linkExpiresAt)}`
          : 'No active supplier link'}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={onRefresh} disabled={refreshing} aria-label="Refresh">
          <RefreshCw className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
        </Button>
        {d.actions.edit && (
          <Button size="sm" onClick={onEdit}>
            <Pencil className="mr-1.5 h-4 w-4" /> {d.actions.send ? 'Edit / send' : 'Edit, verify & send'}
          </Button>
        )}
        {d.actions.resendLink && (
          <Button size="sm" variant="outline" onClick={() => setConfirmResend(true)}>
            <Link2 className="mr-1.5 h-4 w-4" /> Resend link
          </Button>
        )}
        <PrintButton onPrint={onPrint} size="sm" variant="outline" showMenu={false} printLabel="Print summary" saveLabel="Save summary as PDF" />
        {d.actions.cancel && (
          <Button size="sm" variant="outline" className="text-red-600 hover:text-red-600" onClick={() => setCancelling(true)}>
            <Ban className="mr-1.5 h-4 w-4" /> Cancel demand
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirmResend}
        onOpenChange={setConfirmResend}
        title="Send a fresh link?"
        description={`${d.supplierName} gets a new WhatsApp message with a new link. The link they have now stops working.`}
        confirmLabel="Resend link"
        pending={resend.isPending}
        onConfirm={() => void doResend()}
      />
      <ReasonDialog
        open={cancelling}
        onOpenChange={setCancelling}
        title={`Cancel ${d.demandNo}?`}
        description={`The demand closes and ${d.supplierName}'s link stops working.${d.status === 'draft' || d.status === 'verified' ? '' : ' They are told on WhatsApp, with this reason.'} This cannot be undone.`}
        placeholder="e.g. No longer needed — bought locally"
        confirmLabel="Cancel demand"
        destructive
        pending={cancel.isPending}
        onConfirm={(r) => void doCancel(r)}
      />
    </div>
  );
}

function Overview({ token, d }: { token: string; d: PurchaseDemandDetail }) {
  const addNote = useAddDemandNote(token);
  const [note, setNote] = useState('');
  const notes = d.events.filter((e) => e.event === 'note');
  const parsedNote = NoteSchema.safeParse({ note });

  async function submitNote() {
    if (!parsedNote.success || addNote.isPending) return;
    try {
      await addNote.mutateAsync({ id: d.id, note: parsedNote.data.note });
      setNote('');
      toast.success('Note added');
    } catch (e) {
      toast.error(errorMessage(e, 'Could not add the note'));
    }
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="space-y-4">
        <Section title={`Requested items (${d.items.length})`}>
          <ul className="divide-y text-sm">
            {[...d.items].sort((a, b) => a.lineNo - b.lineNo).map((i) => (
              <li key={i.id} className="flex items-start justify-between gap-3 py-1.5">
                <span className="min-w-0">
                  {i.itemName}
                  {i.itemCode && <span className="ml-1 text-xs text-muted-foreground">{i.itemCode}</span>}
                  {!i.itemId && <span className="ml-1 text-xs text-muted-foreground">(free text)</span>}
                  {i.note && <span className="block text-xs text-muted-foreground">{i.note}</span>}
                </span>
                <span className="shrink-0 font-medium tabular-nums">
                  {formatQty(i.requestedQty)} {i.unit}
                </span>
              </li>
            ))}
          </ul>
        </Section>
        {(d.notes || d.deliveryInstructions) && (
          <Section title="For the supplier">
            {d.notes && <p className="text-sm"><span className="text-muted-foreground">Notes: </span>{d.notes}</p>}
            {d.deliveryInstructions && <p className="text-sm"><span className="text-muted-foreground">Delivery: </span>{d.deliveryInstructions}</p>}
          </Section>
        )}
        <Section title="Internal notes">
          {notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No internal notes. These are never sent to the supplier.</p>
          ) : (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li key={n.id} className="rounded-md bg-muted/40 p-2.5 text-sm">
                  <p className="whitespace-pre-wrap">{n.reason}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {n.actorName ?? 'Staff'} · {formatDateTime(n.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <div className="space-y-2">
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000} placeholder="Add an internal note — not sent to the supplier" aria-label="Internal note" />
            <div className="flex justify-end">
              <Button size="sm" variant="outline" disabled={!parsedNote.success || addNote.isPending} onClick={() => void submitNote()}>
                <StickyNote className="mr-1.5 h-4 w-4" /> {addNote.isPending ? 'Adding…' : 'Add note'}
              </Button>
            </div>
          </div>
        </Section>
      </div>
      <div className="space-y-4">
        <Section title="Summary">
          <Facts
            rows={[
              ['Status', PURCHASE_DEMAND_STATUS_LABEL[d.status]],
              ['Priority', d.priority === 'urgent' ? 'Urgent' : 'Normal'],
              ['Required', formatDate(d.requiredDate)],
              ['Payment preference', PURCHASE_PAYMENT_PREFERENCE_LABEL[d.paymentPreference]],
              ...(d.paymentPreference === 'credit'
                ? ([
                    ['Credit asked', money(d.creditAmountRequested)],
                    ['Credit terms', d.creditTerms ?? '—'],
                    ['Credit due', d.creditDueDate ? formatDate(d.creditDueDate) : '—'],
                    ['Credit reference', d.creditReference ?? '—'],
                  ] as Array<[string, string]>)
                : []),
              ['Verified', d.verifiedAt ? `${formatDateTime(d.verifiedAt)}${d.verifiedByName ? ` · ${d.verifiedByName}` : ''}` : '—'],
              ['Sent', d.sentAt ? `${formatDateTime(d.sentAt)}${d.sentByName ? ` · ${d.sentByName}` : ''}` : '—'],
              ['Created', formatDateTime(d.createdAt)],
              ...(d.closedAt
                ? ([['Closed', `${formatDateTime(d.closedAt)}${d.closedByName ? ` · ${d.closedByName}` : ''}`]] as Array<[string, string]>)
                : []),
            ]}
          />
          {d.closedReason && <p className="rounded-md bg-muted/40 p-2.5 text-sm">{d.closedReason}</p>}
        </Section>
        <Section title="Money">
          <Facts
            rows={[
              ['Bill total', money(d.totals.billTotal)],
              ['Posted by Finance', money(d.totals.paidPosted)],
              ['Waiting for Finance', money(d.totals.paidPending)],
              ['Outstanding', money(d.totals.outstanding)],
              ['Credit outstanding', money(d.totals.creditOutstanding)],
            ]}
          />
        </Section>
        {d.supplier && (
          <Section title="Supplier">
            <Facts
              rows={[
                ['Name', d.supplier.name],
                ['Code', d.supplier.supplierCode],
                ['WhatsApp', d.supplier.whatsappNumber],
                ['Contact', d.supplier.contactPerson ?? '—'],
                ['Terms', d.supplier.paymentTerms ?? '—'],
                ['WhatsApp consent', d.supplier.whatsappOptInAt ? formatDate(d.supplier.whatsappOptInAt) : <Pill tone="bad">Not recorded</Pill>],
              ]}
            />
          </Section>
        )}
      </div>
    </div>
  );
}

const statusLabel = (s: string | null) =>
  s ? PURCHASE_DEMAND_STATUS_LABEL[s as PurchaseDemandStatus] ?? s.replace(/_/g, ' ') : null;

function Timeline({ d }: { d: PurchaseDemandDetail }) {
  if (d.events.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">No events yet.</p>;
  return (
    <ol className="relative space-y-3 border-l pl-4">
      {[...d.events].reverse().map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute top-1.5 -left-[21px] h-2.5 w-2.5 rounded-full border-2 border-background bg-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">
            {eventLabel(e.event)}
            {e.fromStatus !== e.toStatus && e.toStatus && (
              <span className="font-normal text-muted-foreground">
                {' '}· {statusLabel(e.fromStatus) ?? '—'} → {statusLabel(e.toStatus)}
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatDateTime(e.createdAt)} · {e.actorType === 'supplier' ? `Supplier${e.actorName ? ` (${e.actorName})` : ''}` : e.actorType === 'system' ? 'System' : e.actorName ?? 'Staff'}
          </p>
          {e.reason && <p className="mt-0.5 whitespace-pre-wrap text-sm">{e.reason}</p>}
        </li>
      ))}
    </ol>
  );
}
