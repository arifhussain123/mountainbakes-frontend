'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { FINANCE_PAYMENT_METHOD_LABELS, LOAN_ENTRY_TYPE_LABELS, type LoanEntry } from '@mb/shared';
import { Ban } from 'lucide-react';
import { useFinanceMutation } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { AttachmentGallery } from '@/components/shared/AttachmentGallery';
import { formatDateTime } from '@/utils/date';
import { Money, StatusBadge } from '../finance-ui';

/**
 * One loan register entry in full — every field, the photo, and who posted it.
 *
 * Cancel (Finance roles with `adjust`) is the only correction: a posted entry
 * is never edited. The row stays in the register, struck through, with the
 * reason, and leaves every total — the server enforces all of that.
 */
export function LoanEntryDetailsDialog({
  entry,
  onClose,
  canCancel,
}: {
  entry: LoanEntry | null;
  onClose: () => void;
  canCancel: boolean;
}) {
  const mut = useFinanceMutation<{ entry: LoanEntry }>();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

  const close = () => {
    setCancelling(false);
    setReason('');
    onClose();
  };

  async function cancel() {
    if (!entry) return;
    try {
      await mut.mutateAsync({ path: `/api/finance/loans/entries/${entry.id}/cancel`, body: { reason } });
      toast.success(`${entry.voucherNo} cancelled`);
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not cancel this entry');
    }
  }

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-4 border-b py-1.5 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );

  return (
    <Dialog open={!!entry} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto md:max-w-lg">
        {entry && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <span className="font-mono">{entry.voucherNo}</span>
                <StatusBadge status={entry.status} />
              </DialogTitle>
              <DialogDescription>{LOAN_ENTRY_TYPE_LABELS[entry.entryType]} — loan register, not the General Ledger.</DialogDescription>
            </DialogHeader>

            <dl className="text-sm">
              {row('Client', `${entry.clientName} (${entry.clientCode})`)}
              {entry.companyName && row('Company', entry.companyName)}
              {row('Business date', entry.businessDate)}
              {row('Ledger head', entry.ledgerHeadName)}
              {entry.branchName && row('Branch', entry.branchName)}
              {entry.paymentMethod && row('Payment method', FINANCE_PAYMENT_METHOD_LABELS[entry.paymentMethod] ?? entry.paymentMethod)}
              {row(
                entry.debit > 0 ? 'Debit' : 'Credit',
                <Money
                  value={entry.debit > 0 ? entry.debit : entry.credit}
                  className={entry.debit > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}
                />,
              )}
              {row('Balance after this entry', <Money value={entry.balance} />)}
              {row('Posted by', `${entry.createdByName ?? '—'} · ${formatDateTime(entry.createdAt)}`)}
            </dl>

            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">Description</p>
              <p className="whitespace-pre-wrap break-words">{entry.description}</p>
            </div>
            {entry.note && (
              <div className="space-y-1 text-sm">
                <p className="text-muted-foreground">Note</p>
                <p className="whitespace-pre-wrap break-words">{entry.note}</p>
              </div>
            )}

            <AttachmentGallery attachments={entry.attachments} title={`${entry.voucherNo} photo`} emptyText="No photo." />

            {entry.status === 'cancelled' && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                <p className="font-semibold">Cancelled — not in any balance</p>
                <p className="whitespace-pre-wrap">{entry.cancelReason}</p>
                <p className="text-xs opacity-80">
                  {entry.cancelledByName ?? '—'}
                  {entry.cancelledAt ? ` · ${formatDateTime(entry.cancelledAt)}` : ''}
                </p>
              </div>
            )}

            {canCancel && entry.status === 'posted' && (
              cancelling ? (
                <div className="space-y-2 rounded-lg border p-3">
                  <Label htmlFor="loan-cancel-reason">Why is this entry being cancelled?</Label>
                  <Textarea id="loan-cancel-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" disabled={mut.isPending} onClick={() => setCancelling(false)}>
                      Keep it
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={mut.isPending || reason.trim().length < 3}
                      onClick={() => void cancel()}
                    >
                      {mut.isPending ? 'Cancelling…' : 'Cancel entry'}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="outline" className="w-full text-destructive" onClick={() => setCancelling(true)}>
                  <Ban className="h-3.5 w-3.5" />
                  Cancel this entry
                </Button>
              )
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
