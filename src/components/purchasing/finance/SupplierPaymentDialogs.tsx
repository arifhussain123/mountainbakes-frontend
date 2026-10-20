'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import type { SupplierCredit, SupplierPayment } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { StatusBadge, useMoney } from '@/components/finance/finance-ui';
import { formatDate, formatDateTime } from '@/utils/date';
import { cn } from '@/lib/utils';
import {
  DEFAULT_SUPPLIER_PAYMENT_HEAD_CODE,
  useSupplierCreditDecision,
  useSupplierPaymentDecision,
  useSupplierPaymentHeads,
} from '@/lib/supplierPayments';
import { CreditStatusBadge, DetailRow, paymentMethodLabel } from './supplierPaymentShared';

/**
 * Finance's decisions on WhatsApp Purchasing money, each behind its own
 * confirmation: approve (posts a PV- voucher), reject (nothing posted),
 * reverse (an opposite entry; the PV stays, marked reversed) and the credit
 * decision. A lost race or a refused rule — "already posted", "recorded by
 * you; another person must approve it" — comes back as the server's own
 * sentence and is shown as-is, the same as the Cash Transfers dialogs.
 */

function PaymentSummary({ payment }: { payment: SupplierPayment }) {
  const { format } = useMoney();
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md bg-muted/40 p-3 text-sm">
      <DetailRow label="Payment">{payment.paymentNo}</DetailRow>
      <DetailRow label="Supplier">{payment.supplierName ?? '—'}</DetailRow>
      <DetailRow label="Demand">{payment.demandNo ?? '—'}</DetailRow>
      <DetailRow label="Supplier bill">{payment.supplierBillNo ?? '—'}</DetailRow>
      <DetailRow label="Method">{paymentMethodLabel(payment.method, payment.account)}</DetailRow>
      {payment.referenceNo && <DetailRow label="Reference">{payment.referenceNo}</DetailRow>}
      <DetailRow label="Paid on">{formatDate(payment.paidOn)}</DetailRow>
      <DetailRow label="Amount">
        <span className="tabular-nums">{format(payment.amount)}</span>
      </DetailRow>
    </dl>
  );
}

export function PaymentDetailsDialog({
  payment,
  onClose,
  footer,
}: {
  payment: SupplierPayment | null;
  onClose: () => void;
  footer?: React.ReactNode;
}) {
  return (
    <Dialog open={payment !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {payment?.paymentNo}
            {payment && <StatusBadge status={payment.status} />}
          </DialogTitle>
          <DialogDescription>Recorded by Production against a supplier bill from WhatsApp Purchasing.</DialogDescription>
        </DialogHeader>
        {payment && (
          <div className="space-y-3">
            <PaymentSummary payment={payment} />
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
              <DetailRow label="Recorded">
                {payment.recordedByName ?? '—'} · {formatDateTime(payment.recordedAt)}
              </DetailRow>
              {payment.notes && <DetailRow label="Notes">{payment.notes}</DetailRow>}
              {payment.voucherNo && <DetailRow label="Voucher">{payment.voucherNo}</DetailRow>}
              {payment.approvedAt && (
                <DetailRow label="Approved">
                  {payment.approvedByName ?? '—'} · {formatDateTime(payment.approvedAt)}
                </DetailRow>
              )}
              {payment.rejectionReason && <DetailRow label="Rejected because">{payment.rejectionReason}</DetailRow>}
              {payment.reversalVoucherNo && <DetailRow label="Reversal voucher">{payment.reversalVoucherNo}</DetailRow>}
              {payment.reversedAt && (
                <DetailRow label="Reversed">
                  {payment.reversedByName ?? '—'} · {formatDateTime(payment.reversedAt)}
                </DetailRow>
              )}
              {payment.reversalReason && <DetailRow label="Reversal reason">{payment.reversalReason}</DetailRow>}
            </dl>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          {footer}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ApprovePaymentDialog({ payment, onClose }: { payment: SupplierPayment | null; onClose: () => void }) {
  const heads = useSupplierPaymentHeads(payment !== null);
  const mut = useSupplierPaymentDecision();
  const [chosen, setChosen] = useState<string | null>(null);

  const items = useMemo(
    () => (heads.data ?? []).map((h) => ({ value: h.id, label: `${h.name} (${h.code})` })),
    [heads.data],
  );
  const defaultHeadId = useMemo(() => {
    const list = heads.data ?? [];
    return (list.find((h) => h.code === DEFAULT_SUPPLIER_PAYMENT_HEAD_CODE) ?? list[0])?.id ?? null;
  }, [heads.data]);
  const headId = chosen ?? defaultHeadId;
  const headsUnavailable = heads.isError || (heads.isSuccess && items.length === 0);

  function close() {
    if (mut.isPending) return;
    setChosen(null);
    onClose();
  }

  async function submit() {
    if (!payment) return;
    try {
      // No head (the list could not load) → the server's own default head.
      const result = await mut.mutateAsync({ kind: 'approve', id: payment.id, ledgerHeadId: headsUnavailable ? null : headId });
      toast.success(
        result.voucherNo
          ? `Approved — ${result.voucherNo} posted to the Daily Ledger`
          : `Approved ${payment.paymentNo}`,
      );
      setChosen(null);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not approve this payment');
    }
  }

  return (
    <Dialog open={payment !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>Approve this supplier payment?</DialogTitle>
          <DialogDescription>
            A PV- payment voucher is posted to the Daily Ledger for the amount below, under the head you choose, dated
            the day it was paid (today, if that day is already closed). The payment becomes final; correcting it later
            means reversing it.
          </DialogDescription>
        </DialogHeader>

        {payment && <PaymentSummary payment={payment} />}

        <div className="space-y-1">
          <Label>Ledger head</Label>
          {headsUnavailable ? (
            <p className="rounded-md border border-dashed p-2 text-sm text-muted-foreground">
              The expense heads could not be loaded. Approving posts under the default head (Raw Materials).
            </p>
          ) : (
            <Select items={items} value={headId} onValueChange={(v) => setChosen((v as string | null) ?? null)} disabled={heads.isLoading || mut.isPending}>
              <SelectTrigger className="h-11 w-full md:h-9">
                <SelectValue placeholder={heads.isLoading ? 'Loading heads…' : 'Choose a head'} />
              </SelectTrigger>
              <SelectContent>
                {items.map((h) => (
                  <SelectItem key={h.value} value={h.value}>
                    {h.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={mut.isPending || !payment || heads.isLoading || (!headsUnavailable && !headId)}>
            {mut.isPending ? 'Approving…' : 'Confirm Approval'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Reject (nothing posted) or reverse (an opposite entry) — both need a reason. */
export function PaymentReasonDialog({
  payment,
  kind,
  onClose,
}: {
  payment: SupplierPayment | null;
  kind: 'reject' | 'reverse';
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const mut = useSupplierPaymentDecision();
  const { format } = useMoney();
  const reasonMissing = reason.trim().length < 3;
  const reverse = kind === 'reverse';

  function close() {
    if (mut.isPending) return;
    setReason('');
    onClose();
  }

  async function submit() {
    if (!payment || reasonMissing) return;
    try {
      const result = await mut.mutateAsync({ kind, id: payment.id, reason: reason.trim() });
      toast.success(
        reverse
          ? `Reversed ${payment.paymentNo}${result.reversalVoucherNo ? ` — ${result.reversalVoucherNo} posted` : ''}`
          : `Rejected ${payment.paymentNo} — Production has been told why`,
      );
      setReason('');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : `Could not ${kind} this payment`);
    }
  }

  return (
    <Dialog open={payment !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>{reverse ? 'Reverse this posted payment?' : 'Reject Supplier Payment'}</DialogTitle>
          <DialogDescription>
            {payment
              ? reverse
                ? `An opposite entry is posted against ${payment.voucherNo ?? 'the voucher'} for ${format(payment.amount)}. The original voucher stays in the ledger, marked reversed, and the demand shows the amount as unpaid again.`
                : `${payment.paymentNo} (${format(payment.amount)} to ${payment.supplierName ?? 'the supplier'}) is refused. Nothing is posted; Production sees your reason.`
              : ''}
          </DialogDescription>
        </DialogHeader>

        {payment && reverse && <PaymentSummary payment={payment} />}

        <div className="space-y-1">
          <Label htmlFor={`supplier-payment-${kind}-reason`}>
            {reverse ? 'Reversal reason' : 'Rejection reason'} <span className="text-destructive">*</span>
          </Label>
          <Textarea
            id={`supplier-payment-${kind}-reason`}
            rows={3}
            maxLength={1000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={reverse ? 'Why is this payment being undone — bounced transfer, wrong supplier?' : 'What does not match — the amount, the reference, the bill?'}
            disabled={mut.isPending}
          />
          {reason !== '' && reasonMissing && <p className="text-xs text-destructive">Say why (at least 3 characters).</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} disabled={mut.isPending || reasonMissing || !payment}>
            {mut.isPending ? (reverse ? 'Reversing…' : 'Rejecting…') : reverse ? 'Confirm Reversal' : 'Reject'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Approve (all or part of the requested amount) or reject a credit request.
 * Terms, due date and reference are Production's, set on the request; Finance
 * decides the amount. CreditDecisionSchema carries nothing else.
 */
export function CreditDecisionDialog({ credit, onClose }: { credit: SupplierCredit | null; onClose: () => void }) {
  const mut = useSupplierCreditDecision();
  const { format } = useMoney();
  const [decision, setDecision] = useState<'approve' | 'reject'>('approve');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const requested = credit?.requestedAmount ?? 0;
  const cleaned = amount.replace(/,/g, '').trim();
  const typed = cleaned === '' ? null : Number(cleaned);
  const amountError =
    decision !== 'approve' || typed === null
      ? null
      : !/^\d*\.?\d+$/.test(cleaned) || typed <= 0
        ? 'Enter an amount above zero'
        : !/^\d*(\.\d{1,2})?$/.test(cleaned)
          ? 'At most 2 decimal places'
          : typed > requested
            ? `At most the ${format(requested)} requested`
            : null;
  const reasonMissing = decision === 'reject' && reason.trim().length < 3;

  function reset() {
    setDecision('approve');
    setAmount('');
    setReason('');
  }

  function close() {
    if (mut.isPending) return;
    reset();
    onClose();
  }

  async function submit() {
    if (!credit || amountError || reasonMissing) return;
    try {
      const result = await mut.mutateAsync(
        decision === 'approve'
          ? { id: credit.id, decision: 'approve', approvedAmount: typed, reason: reason.trim() || null }
          : { id: credit.id, decision: 'reject', reason: reason.trim() },
      );
      toast.success(
        decision === 'approve'
          ? `Approved ${result.creditNo} — ${format(result.approvedAmount)} on credit`
          : `Rejected ${credit.creditNo} — Production has been told why`,
      );
      reset();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not record this decision');
    }
  }

  return (
    <Dialog open={credit !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Credit request {credit?.creditNo}
            {credit && <CreditStatusBadge status={credit.status} />}
          </DialogTitle>
          <DialogDescription>
            Approving makes the amount a supplier liability (active credit) that later supplier payments repay. Nothing
            is posted to the ledger now.
          </DialogDescription>
        </DialogHeader>

        {credit && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md bg-muted/40 p-3 text-sm">
            <DetailRow label="Supplier">{credit.supplierName ?? '—'}</DetailRow>
            <DetailRow label="Demand">{credit.demandNo ?? '—'}</DetailRow>
            <DetailRow label="Requested">
              <span className="tabular-nums">{format(credit.requestedAmount)}</span>
            </DetailRow>
            <DetailRow label="Terms">{credit.terms ?? '—'}</DetailRow>
            <DetailRow label="Due date">{credit.dueDate ? formatDate(credit.dueDate) : '—'}</DetailRow>
            {credit.reference && <DetailRow label="Reference">{credit.reference}</DetailRow>}
            {credit.notes && <DetailRow label="Notes">{credit.notes}</DetailRow>}
            <DetailRow label="Requested by">
              {credit.requestedByName ?? '—'} · {formatDateTime(credit.requestedAt)}
            </DetailRow>
          </dl>
        )}

        <div role="radiogroup" aria-label="Decision" className="grid grid-cols-2 gap-2">
          {(['approve', 'reject'] as const).map((d) => (
            <button
              key={d}
              type="button"
              role="radio"
              aria-checked={decision === d}
              disabled={mut.isPending}
              onClick={() => setDecision(d)}
              className={cn(
                'h-10 rounded-lg border text-sm font-medium transition-colors',
                decision === d
                  ? d === 'approve'
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-destructive bg-destructive text-white'
                  : 'border-input hover:bg-muted',
              )}
            >
              {d === 'approve' ? 'Approve' : 'Reject'}
            </button>
          ))}
        </div>

        {decision === 'approve' && (
          <div className="space-y-1">
            <Label htmlFor="credit-approved-amount">Approved amount</Label>
            <Input
              id="credit-approved-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={`${requested} (the full request)`}
              disabled={mut.isPending}
              aria-invalid={amountError ? true : undefined}
              className="h-11 md:h-9"
            />
            {amountError ? (
              <p className="text-xs text-destructive">{amountError}</p>
            ) : (
              <p className="text-xs text-muted-foreground">Leave blank to approve the full amount requested.</p>
            )}
          </div>
        )}

        <div className="space-y-1">
          <Label htmlFor="credit-decision-reason">
            {decision === 'reject' ? (
              <>
                Rejection reason <span className="text-destructive">*</span>
              </>
            ) : (
              'Note (optional)'
            )}
          </Label>
          <Textarea
            id="credit-decision-reason"
            rows={2}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={mut.isPending}
          />
          {decision === 'reject' && reason !== '' && reasonMissing && (
            <p className="text-xs text-destructive">Say why (at least 3 characters).</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button
            variant={decision === 'reject' ? 'destructive' : 'default'}
            onClick={submit}
            disabled={mut.isPending || !credit || !!amountError || reasonMissing}
          >
            {mut.isPending ? 'Saving…' : decision === 'approve' ? 'Confirm Approval' : 'Reject'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
