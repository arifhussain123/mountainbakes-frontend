'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { Attachment, CashTransfer, CashTransferMethod } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranchCashTransfers, useCreateCashTransfer } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PhotoCapture } from '@/components/shared/PhotoCapture';
import { AttachmentGallery } from '@/components/shared/AttachmentGallery';
import { ExpandableText } from '@/components/shared/ExpandableText';
import { formatDate } from '@/utils/date';
import { formatCurrency } from '@/utils/currency';
import { ApiError } from '@/utils/api';
import { Banknote, Check, ChevronLeft, Eraser, Send, X } from 'lucide-react';
import {
  CashTransferFormFields,
  CashTransferStatusBadge,
  isCashTransferInputValid,
  methodLabel,
  parseAmount,
  shortBranch,
} from './cashTransferShared';

/**
 * Branch → record money handed to the company, with the photo of the slip.
 *
 * The same popup the Discount button opens, in shape and in reasoning: it
 * lives on New Orders because the branch is already there, and Branch → Cash
 * Deposits is the fuller screen with search and detail. The rules the two
 * share live in `cashTransferShared.tsx`.
 *
 * ONE DIALOG, THREE FACES — never two stacked. The form turns over into a
 * confirmation, and Confirm is the only thing that creates a record: the
 * amount, the method and the photo are read back on one screen before the
 * money is claimed to have moved. Clear turns the form over into its own
 * confirmation when there is something to lose.
 *
 * THE PHOTO IS REQUIRED and is uploaded BEFORE the record exists (PhotoCapture
 * stages it; the create request binds it — migration 67). Removing it here is
 * a local act; the staged upload becomes a harmless orphan.
 *
 * ONE CONFIRM, ONE RECORD. The submit carries a client operation id as the
 * Idempotency-Key, minted when the form is filled in, so a double click or a
 * retry after the connection drops replays the first response instead of
 * booking the same cash twice.
 */
export function CashDepositModal({
  open,
  onOpenChange,
  openedOnce,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Gates the list fetch — see DiscountModal for why the parent owns it. */
  openedOnce: boolean;
}) {
  const { token, user } = useAuth();
  const transfersQ = useBranchCashTransfers(token, { enabled: openedOnce, limit: 50 });
  const createMut = useCreateCashTransfer(token);

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<CashTransferMethod | null>(null);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<Attachment[]>([]);
  const [photoTouched, setPhotoTouched] = useState(false);
  /** Which face the popup is showing. */
  const [face, setFace] = useState<'form' | 'confirm' | 'clear'>('form');
  /** One id per attempt; renewed after a success or a Clear, never on a retry. */
  const [opId, setOpId] = useState(() => newOperationId());

  const transfers = transfersQ.data?.transfers ?? [];
  const busy = createMut.isPending;
  const dirty = amount !== '' || method !== null || note !== '' || photos.length > 0;
  const valid = isCashTransferInputValid(amount, method, photos.length);
  const photoError = photoTouched && photos.length === 0 ? 'Payment proof photo is required.' : undefined;

  function resetForm() {
    setAmount('');
    setMethod(null);
    setNote('');
    setPhotos([]);
    setPhotoTouched(false);
    setFace('form');
    setOpId(newOperationId());
  }

  function save() {
    setPhotoTouched(true);
    if (!valid) {
      if (photos.length === 0) toast.error('Payment proof photo is required.');
      return;
    }
    setFace('confirm');
  }

  async function confirm() {
    if (!valid || !method) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      toast.error('You are offline. Your entries are kept — reconnect and press Confirm again.');
      return;
    }
    try {
      const created = await createMut.mutateAsync({
        clientOperationId: opId,
        amount: parseAmount(amount),
        paymentMethod: method,
        ...(note.trim() ? { note: note.trim() } : {}),
        attachmentIds: photos.map((p) => p.id),
      });
      toast.success(`Cash Deposit submitted successfully (${created.transferNo}). Waiting for Finance approval.`);
      resetForm();
    } catch (err) {
      // The server's sentence names the cause — a closed day, a photo that
      // vanished between upload and submit — and is more use than a generic
      // failure. Nothing is reset: the same attempt can be retried under the
      // same operation id.
      toast.error(
        err instanceof ApiError || err instanceof Error
          ? err.message
          : 'Unable to submit cash deposit. Please try again.',
      );
      setFace('form');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (busy) return;
        if (!o) setFace('form');
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
        {face === 'clear' ? (
          <>
            <DialogHeader>
              <DialogTitle>Clear this form?</DialogTitle>
              <DialogDescription>All entered information will be removed.</DialogDescription>
            </DialogHeader>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setFace('form')}>
                Keep
              </Button>
              <Button variant="destructive" className="flex-1" onClick={resetForm}>
                <Eraser className="mr-1.5 h-4 w-4" /> Clear
              </Button>
            </div>
          </>
        ) : face === 'confirm' ? (
          <>
            <DialogHeader>
              <DialogTitle>Confirm Cash Deposit</DialogTitle>
              <DialogDescription>
                Read it back before it is sent. Once confirmed, the transfer cannot be changed — Finance approves or
                rejects it.
              </DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 rounded-md bg-muted/40 p-3 text-sm">
              <dt className="text-muted-foreground">Total Amount</dt>
              <dd className="text-right text-base font-semibold tabular-nums">{formatCurrency(parseAmount(amount))}</dd>
              <dt className="text-muted-foreground">Payment Method</dt>
              <dd className="text-right font-medium">{method ? methodLabel(method) : '—'}</dd>
              <dt className="text-muted-foreground">Branch</dt>
              <dd className="text-right font-medium">{shortBranch(user?.branchName)}</dd>
              <dt className="col-span-2 pt-1 text-muted-foreground">Note</dt>
              <dd className="col-span-2 whitespace-pre-wrap break-words">{note.trim() || '—'}</dd>
              <dt className="col-span-2 pt-1 text-muted-foreground">Photo</dt>
              <dd className="col-span-2">
                <AttachmentGallery attachments={photos} size="sm" title="Payment picture" />
              </dd>
            </dl>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setFace('form')} disabled={busy}>
                <ChevronLeft className="mr-1.5 h-4 w-4" /> Back
              </Button>
              <Button className="flex-1" onClick={confirm} disabled={busy || !valid}>
                <Check className="mr-1.5 h-4 w-4" />
                {busy ? 'Submitting…' : 'Confirm'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Cash Deposit</DialogTitle>
              <DialogDescription>
                Record cash, Easypaisa or bank money handed to the company. Finance approves it and posts the receipt.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <CashTransferFormFields
                idPrefix="cash-deposit-popup"
                amount={amount}
                onAmountChange={setAmount}
                method={method}
                onMethodChange={setMethod}
                note={note}
                onNoteChange={setNote}
                disabled={busy}
              />

              <PhotoCapture
                entity="cash_transfer"
                value={photos}
                onChange={(next) => {
                  setPhotos(next);
                  setPhotoTouched(true);
                }}
                label="Payment Picture"
                required
                max={1}
                crop
                captureLabel="Capture Picture"
                disabled={busy}
                error={photoError}
                hint="Photograph the deposit slip, the cash handover or the transfer confirmation."
              />

              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => (dirty ? setFace('clear') : undefined)}
                  disabled={busy || !dirty}
                >
                  <Eraser className="mr-1.5 h-4 w-4" /> Clear
                </Button>
                <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={busy}>
                  <X className="mr-1.5 h-4 w-4" /> Cancel
                </Button>
                <Button className="flex-1" onClick={save} disabled={busy || !valid}>
                  <Send className="mr-1.5 h-4 w-4" /> Save
                </Button>
              </div>
            </div>

            <Separator />

            {/* ── The branch's own transfers ────────────────────────────── */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-medium">Your cash deposits</p>
                <p className="text-xs text-muted-foreground">Last 90 days</p>
              </div>

              {transfersQ.isLoading ? (
                <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
              ) : transfers.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">No cash transfers found.</p>
              ) : (
                <ul className="space-y-2">
                  {transfers.map((t) => (
                    <RecentTransfer key={t.id} transfer={t} />
                  ))}
                </ul>
              )}

              <p className="pt-1 text-center text-xs text-muted-foreground">
                The Cash Deposits page has the full record, with search and detail.
              </p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function RecentTransfer({ transfer: t }: { transfer: CashTransfer }) {
  return (
    <li className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-sm font-medium">{t.transferNo}</p>
          <p className="text-xs text-muted-foreground">
            {formatDate(t.date)} · {methodLabel(t.paymentMethod)}
            {t.voucherNo ? ` · ${t.voucherNo}` : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="font-semibold tabular-nums">{formatCurrency(t.amount)}</p>
          <CashTransferStatusBadge status={t.status} className="mt-0.5" />
        </div>
      </div>
      {t.note && <ExpandableText text={t.note} className="mt-1.5 text-xs text-muted-foreground" />}
      {t.rejectionReason && (
        <p className="mt-1.5 rounded-md bg-muted/60 p-2 text-xs">
          <span className="font-medium">Finance: </span>
          {t.rejectionReason}
        </p>
      )}
      <AttachmentGallery attachments={t.attachments} size="xs" title={`${t.transferNo} payment picture`} className="mt-2" />
    </li>
  );
}

/** A UUID where the platform offers one, a time-salted fallback where it does not (plain http). */
function newOperationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `ct-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export { Banknote as CashDepositIcon };
