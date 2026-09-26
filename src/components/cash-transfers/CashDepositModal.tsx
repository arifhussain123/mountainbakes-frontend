'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  businessDateStr,
  businessDaysAgoStr,
  type Attachment,
  type CashTransfer,
  type DailySaleRecordList,
} from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranchCashTransfers, useCreateCashTransfer } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import { ApiError, apiCall } from '@/utils/api';
import { AlertTriangle, Banknote, Check, ChevronLeft, Eraser, Info, Send, Wand2, X } from 'lucide-react';
import {
  CashDepositBreakdown,
  CashDepositFormFields,
  CashTransferStatusBadge,
  EMPTY_DEPOSIT_DRAFT,
  channelsLabel,
  depositDraftError,
  depositFigures,
  shortBranch,
  type CashDepositDraft,
} from './cashTransferShared';

/**
 * Branch → record money handed to the company, with the photo of the slip.
 *
 * The same popup the Discount button opens, in shape and in reasoning: it
 * lives on New Orders because the branch is already there, and Branch → Cash
 * Deposits is the fuller screen with search and detail. The rules the two
 * share live in `cashTransferShared.tsx`.
 *
 * THREE CHANNELS, NO METHOD (migration 121). The branch types what it handed
 * over by Cash, Easypaisa and Bank; the Total is their sum and is never typed.
 * Fuel Charges sits beside the Total, never inside it, and is booked as its own
 * Fuel income. Foodpanda has no field — it is keyed into Easypaisa by hand.
 *
 * AUTO reads the DAILY SALE RECORD for the chosen business date — Cash on
 * Table → Cash, Easypaisa → Easypaisa, Bank → Bank — through the same
 * endpoint the Daily Sale Record page uses, so the two screens cannot show
 * different figures for one day. It only fills the form; nothing is saved
 * until the person reads it back and confirms.
 *
 * ONE DEPOSIT PER BRANCH PER DAY. A day that already has a pending or approved
 * deposit is flagged as soon as the date is picked, Auto refuses to fill it,
 * and the server refuses a second one (409). Corrections to the existing one go
 * through the Help Desk, which re-posts the ledger.
 *
 * ONE DIALOG, THREE FACES — never two stacked. The form turns over into a
 * confirmation, and Confirm is the only thing that creates a record. Clear
 * turns the form over into its own confirmation when there is something to lose.
 *
 * THE PHOTO is required whenever the Total is above 0, and is uploaded BEFORE
 * the record exists (PhotoCapture stages it; the create request binds it —
 * migration 67). A Fuel-Charges-only deposit may go without one.
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

  const today = businessDateStr();
  const earliest = businessDaysAgoStr(DEPOSIT_BACKDATE_DAYS);
  const [date, setDate] = useState(today);
  const [draft, setDraft] = useState<CashDepositDraft>(EMPTY_DEPOSIT_DRAFT);
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<Attachment[]>([]);
  const [photoTouched, setPhotoTouched] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  /** What Auto last filled in from, shown under the button. */
  const [autoSource, setAutoSource] = useState<{ date: string; foodpanda: number; cashOnTable: number } | null>(null);
  /** Which face the popup is showing. */
  const [face, setFace] = useState<'form' | 'confirm' | 'clear'>('form');
  /** One id per attempt; renewed after a success or a Clear, never on a retry. */
  const [opId, setOpId] = useState(() => newOperationId());

  // The chosen day's own deposits — to warn before anything is typed.
  const dayQ = useBranchCashTransfers(token, { enabled: open && !!date, from: date, to: date, limit: 10 });
  const existing = (dayQ.data?.transfers ?? []).find((t) => t.status !== 'rejected') ?? null;

  const transfers = transfersQ.data?.transfers ?? [];
  const busy = createMut.isPending;
  const figures = depositFigures(draft);
  const dirty =
    Object.values(draft).some((v) => v !== '') || note !== '' || photos.length > 0 || date !== today;
  const draftError = depositDraftError(draft, photos.length);
  const dateError = date > today ? 'The date cannot be in the future.' : date < earliest ? `Pick a date from ${formatDate(earliest)} onwards.` : null;
  const valid = !draftError && !dateError && !existing;
  const photoNeeded = figures.total > 0;
  const photoError = photoTouched && photoNeeded && photos.length === 0 ? 'Payment proof photo is required.' : undefined;

  function resetForm() {
    setDate(today);
    setDraft(EMPTY_DEPOSIT_DRAFT);
    setNote('');
    setPhotos([]);
    setPhotoTouched(false);
    setAutoSource(null);
    setFace('form');
    setOpId(newOperationId());
  }

  /**
   * Fill Cash / Easypaisa / Bank from the Daily Sale Record of `date`. Two
   * small reads, both scoped by the API to this branch: the day's deposits
   * (refuse if one exists) and the day's Daily Sale Record — never the sales.
   */
  async function auto() {
    if (dateError) { toast.error(dateError); return; }
    setAutoBusy(true);
    try {
      const [deposits, dsr] = await Promise.all([
        apiCall<{ transfers: CashTransfer[] }>(
          `/api/cash-transfers?${new URLSearchParams({ from: date, to: date, limit: '10' })}`, {}, token,
        ),
        apiCall<DailySaleRecordList>(
          `/api/daily-sale-records?${new URLSearchParams({ from: date, to: date })}`, {}, token,
        ),
      ]);
      const dup = deposits.transfers.find((t) => t.status !== 'rejected');
      if (dup) {
        toast.error(`Cash deposit already exists for this date and branch (${dup.transferNo}).`);
        return;
      }
      const record = dsr.records.find((r) => r.businessDate === date);
      if (!record) {
        // Leave the fields as they are: zeros here would read as a real record.
        toast.error('No Daily Sale Record found for this date.');
        return;
      }
      const cashOnTable = record.expectedCashInHand;
      setDraft((d) => ({
        ...d,
        // Cash on Table can go negative when till expenses exceeded cash taken;
        // there is no cash to hand over then, so Cash is 0 (shown below).
        cash: amountText(Math.max(0, cashOnTable)),
        easypaisa: amountText(record.autoEasypaisa),
        bank: amountText(record.autoBank),
      }));
      setAutoSource({ date, foodpanda: record.autoFoodpanda, cashOnTable });
      toast.success('Filled from the Daily Sale Record. Check the figures before saving.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read the Daily Sale Record.');
    } finally {
      setAutoBusy(false);
    }
  }

  function save() {
    setPhotoTouched(true);
    if (existing) { toast.error(`Cash deposit already exists for this date and branch (${existing.transferNo}).`); return; }
    if (dateError || draftError) { toast.error((dateError ?? draftError)!); return; }
    setFace('confirm');
  }

  async function confirm() {
    if (!valid) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      toast.error('You are offline. Your entries are kept — reconnect and press Confirm again.');
      return;
    }
    try {
      const created = await createMut.mutateAsync({
        clientOperationId: opId,
        cashAmount: figures.cashAmount,
        easypaisaAmount: figures.easypaisaAmount,
        bankAmount: figures.bankAmount,
        fuelCharges: figures.fuelCharges,
        // What the person saw; the server recomputes and refuses a mismatch.
        totalAmount: figures.total,
        ...(note.trim() ? { note: note.trim() } : {}),
        attachmentIds: photos.map((p) => p.id),
        businessDate: date,
      });
      toast.success(`Cash Deposit submitted successfully (${created.transferNo}). Waiting for Finance approval.`);
      resetForm();
    } catch (err) {
      // The server's sentence names the cause — a closed day, a deposit that
      // already exists, a photo that vanished between upload and submit — and
      // is more use than a generic failure. Nothing is reset: the same attempt
      // can be retried under the same operation id.
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
                Read it back before it is sent. Once confirmed, the deposit cannot be changed — Finance approves or
                rejects it.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 rounded-md bg-muted/40 p-3 text-sm">
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
                <dt className="text-muted-foreground">Date</dt>
                <dd className="text-right font-medium">{formatDate(date)}</dd>
                <dt className="text-muted-foreground">Branch</dt>
                <dd className="text-right font-medium">{shortBranch(user?.branchName)}</dd>
              </dl>
              <CashDepositBreakdown
                transfer={{ ...figures, amount: figures.total }}
                className="border-t pt-2"
              />
              <dl className="grid grid-cols-1 gap-y-1.5 border-t pt-2">
                <dt className="text-muted-foreground">Note</dt>
                <dd className="whitespace-pre-wrap break-words">{note.trim() || '—'}</dd>
                {photos.length > 0 && (
                  <>
                    <dt className="pt-1 text-muted-foreground">Photo</dt>
                    <dd>
                      <AttachmentGallery attachments={photos} size="sm" title="Payment picture" />
                    </dd>
                  </>
                )}
              </dl>
            </div>
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
                Record the cash, Easypaisa and bank money handed to the company. Finance approves it and posts the
                receipt.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cash-deposit-popup-date">Date</Label>
                  <Input
                    id="cash-deposit-popup-date"
                    type="date"
                    value={date}
                    min={earliest}
                    max={today}
                    onChange={(e) => { setDate(e.target.value); setAutoSource(null); }}
                    disabled={busy}
                    className="text-base sm:text-sm"
                  />
                  {dateError && <p className="text-xs text-destructive">{dateError}</p>}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cash-deposit-popup-branch">Branch</Label>
                  <Input
                    id="cash-deposit-popup-branch"
                    readOnly
                    tabIndex={-1}
                    value={user?.branchName ?? '—'}
                    className="cursor-default bg-muted/50 text-base sm:text-sm"
                  />
                </div>
              </div>

              {existing && (
                <div role="alert" className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                  <p>
                    Cash deposit already exists for this date and branch —{' '}
                    <span className="font-mono font-medium">{existing.transferNo}</span> ({existing.status === 'approved' ? 'approved' : 'awaiting Finance'}).
                    It is listed below; ask Finance through the Help Desk to correct it.
                  </p>
                </div>
              )}

              <CashDepositFormFields
                idPrefix="cash-deposit-popup"
                draft={draft}
                onDraftChange={setDraft}
                note={note}
                onNoteChange={setNote}
                disabled={busy}
                autoSlot={
                  <div className="space-y-1">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={auto}
                      disabled={busy || autoBusy || !!existing || !!dateError}
                    >
                      <Wand2 className="mr-1.5 h-4 w-4" />
                      {autoBusy ? 'Reading…' : 'Auto'}
                    </Button>
                    <p className="text-xs text-muted-foreground">
                      {autoSource
                        ? `From the Daily Sale Record of ${formatDate(autoSource.date)}: Cash on Table → Cash, Easypaisa, Bank.`
                        : 'Fills Cash (Cash on Table), Easypaisa and Bank from the Daily Sale Record of this date.'}
                      {autoSource && autoSource.cashOnTable < 0 &&
                        ` Cash on Table was ${formatCurrency(autoSource.cashOnTable)}, so Cash is 0.`}
                      {autoSource && autoSource.foodpanda > 0 &&
                        ` Foodpanda (${formatCurrency(autoSource.foodpanda)}) is not added — key it into Easypaisa by hand if it was received.`}
                    </p>
                  </div>
                }
              />

              <PhotoCapture
                entity="cash_transfer"
                value={photos}
                onChange={(next) => {
                  setPhotos(next);
                  setPhotoTouched(true);
                }}
                label="Payment Picture"
                required={photoNeeded}
                max={1}
                crop
                captureLabel="Capture Picture"
                disabled={busy}
                error={photoError}
                hint={
                  photoNeeded
                    ? 'Photograph the deposit slip, the cash handover or the transfer confirmation.'
                    : 'Not needed when only Fuel Charges are entered.'
                }
              />

              <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  <span className="font-semibold">Note:</span> If cash is not maintained and daily cash deposit details
                  are not provided to the company, share the payment details with the date and reason.
                </p>
              </div>

              {draftError && (dirty || photoTouched) && (
                <p className="text-xs text-destructive">{draftError}</p>
              )}

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
                  <Send className="mr-1.5 h-4 w-4" /> Save Deposit
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

/**
 * How far back a deposit may be dated: the server's sync window
 * (resolveClientBusinessDate — 7 business days including today). The server
 * is the authority; this only keeps the picker from offering a refused day.
 */
const DEPOSIT_BACKDATE_DAYS = 6;

/** A number as the amount inputs hold it: no grouping, at most 2 decimals, '' for 0. */
function amountText(n: number): string {
  const v = Math.round(n * 100) / 100;
  return v > 0 ? String(v) : '';
}

function RecentTransfer({ transfer: t }: { transfer: CashTransfer }) {
  return (
    <li className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-sm font-medium">{t.transferNo}</p>
          <p className="text-xs text-muted-foreground">
            {formatDate(t.date)} · {channelsLabel(t)}
            {t.voucherNo ? ` · ${t.voucherNo}` : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="font-semibold tabular-nums">{formatCurrency(t.amount)}</p>
          {t.fuelCharges > 0 && (
            <p className="text-xs tabular-nums text-muted-foreground">+ Fuel {formatCurrency(t.fuelCharges)}</p>
          )}
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
