'use client';

import { useRef, useState } from 'react';
import {
  CreditInputSchema,
  PaymentInputSchema,
  SUPPLIER_PAYMENT_METHODS,
  businessDateStr,
  karachiDateStr,
  type PurchaseDemandDetail,
  type SupplierPaymentMethod,
} from '@mb/shared';
import { Banknote, Clock, HandCoins } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { useRecordSupplierPayment, useRequestSupplierCredit } from '@/lib/purchasing';
import { formatDate, formatDateTime } from '@/utils/date';
import { cn } from '@/lib/utils';
import {
  CREDIT_STATUS_LABEL,
  CREDIT_STATUS_TONE,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
  SUPPLIER_PAYMENT_STATUS_LABEL,
  SUPPLIER_PAYMENT_STATUS_TONE,
  SubmissionKey,
  decimalInput,
  issuesByPath,
  newRequestId,
  parseNumber,
} from './purchasing-model';
import { ConfirmDialog, Field, Pill, Section, errorMessage, money } from './parts';

const METHOD_LABEL: Record<SupplierPaymentMethod, string> = { cash: 'Cash', easypaisa: 'Easypaisa', bank: 'Bank transfer' };

/**
 * Money on a demand: the totals block, payments and credit.
 *
 * PRODUCTION RECORDS, FINANCE POSTS. A payment recorded here is a request —
 * "Production handed over Rs. X" — and touches the ledger only when Finance
 * approves it on their Supplier Payments page. Every label on this screen says
 * so, because "Paid" on a payment Finance has not seen is how a supplier ends
 * up paid twice. Credit is the same: requested here, approved by Finance.
 */
export function PaymentsSection({ token, demand }: { token: string; demand: PurchaseDemandDetail }) {
  const [paying, setPaying] = useState(false);
  const [crediting, setCrediting] = useState(false);
  const t = demand.totals;

  return (
    <div className="space-y-4">
      <Section
        title="Totals"
        actions={demand.approvedBillId ? <Pill tone={PAYMENT_STATUS_TONE[demand.paymentStatus]}>{PAYMENT_STATUS_LABEL[demand.paymentStatus]}</Pill> : undefined}
      >
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Tile label="Bill total" value={money(t.billTotal)} />
          <Tile label="Posted by Finance" value={money(t.paidPosted)} tone="good" />
          <Tile label="Waiting for Finance" value={money(t.paidPending)} tone={t.paidPending > 0 ? 'waiting' : undefined} />
          <Tile label="Outstanding" value={money(t.outstanding)} tone={t.outstanding && t.outstanding > 0 ? 'bad' : undefined} />
          <Tile label="Credit outstanding" value={money(t.creditOutstanding)} />
        </div>
      </Section>

      <Section
        title="Payments"
        actions={
          <>
            {demand.actions.requestCredit && (
              <Button size="sm" variant="outline" onClick={() => setCrediting(true)}>
                <HandCoins className="mr-1.5 h-4 w-4" /> Request credit
              </Button>
            )}
            {demand.actions.recordPayment && (
              <Button size="sm" onClick={() => setPaying(true)}>
                <Banknote className="mr-1.5 h-4 w-4" /> Record payment
              </Button>
            )}
          </>
        }
      >
        {demand.payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">{demand.approvedBillId ? 'No payment recorded yet.' : 'Payments can be recorded once a bill is approved.'}</p>
        ) : (
          <ul className="divide-y">
            {demand.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">
                    {p.paymentNo} · {METHOD_LABEL[p.method]} · {money(p.amount)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Paid {formatDate(p.paidOn)}
                    {p.referenceNo ? ` · ref ${p.referenceNo}` : ''}
                    {p.creditId ? ' · repays credit' : ''} · recorded {formatDateTime(p.recordedAt)}
                    {p.recordedByName ? ` by ${p.recordedByName}` : ''}
                  </p>
                  {p.voucherNo && <p className="text-xs text-muted-foreground">Voucher {p.voucherNo}{p.approvedByName ? ` · approved by ${p.approvedByName}` : ''}</p>}
                  {p.rejectionReason && <p className="text-xs text-red-600">Finance: {p.rejectionReason}</p>}
                  {p.reversalReason && <p className="text-xs text-muted-foreground">Reversed: {p.reversalReason}</p>}
                  {p.notes && <p className="text-xs">{p.notes}</p>}
                </div>
                <Pill tone={SUPPLIER_PAYMENT_STATUS_TONE[p.status]}>{SUPPLIER_PAYMENT_STATUS_LABEL[p.status]}</Pill>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {demand.credits.length > 0 && (
        <Section title="Credit">
          <ul className="divide-y">
            {demand.credits.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">
                    {c.creditNo} · requested {money(c.requestedAmount)}
                    {c.approvedAmount !== null ? ` · approved ${money(c.approvedAmount)}` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Outstanding {money(c.outstanding)}
                    {c.dueDate ? ` · due ${formatDate(c.dueDate)}` : ''}
                    {c.terms ? ` · ${c.terms}` : ''}
                    {c.reference ? ` · ref ${c.reference}` : ''}
                  </p>
                  {c.decisionReason && <p className="text-xs text-muted-foreground">Finance: {c.decisionReason}</p>}
                </div>
                <Pill tone={CREDIT_STATUS_TONE[c.status]}>{CREDIT_STATUS_LABEL[c.status]}</Pill>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <PaymentDialog token={token} demand={demand} open={paying} onOpenChange={setPaying} />
      <CreditDialog token={token} demand={demand} open={crediting} onOpenChange={setCrediting} />
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'waiting' | 'bad' }) {
  return (
    <div className="rounded-lg border p-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          'text-base font-semibold tabular-nums',
          tone === 'good' && 'text-emerald-700 dark:text-emerald-400',
          tone === 'waiting' && 'text-amber-700 dark:text-amber-400',
          tone === 'bad' && 'text-red-600',
        )}
      >
        {value}
      </p>
    </div>
  );
}

/** What is still to pay once posted and pending payments are both counted. */
function stillToRecord(d: PurchaseDemandDetail): number {
  if (d.totals.billTotal === null) return 0;
  return Math.max(0, Math.round((d.totals.billTotal - d.totals.paidPosted - d.totals.paidPending) * 100) / 100);
}

function PaymentDialog({ token, demand, open, onOpenChange }: { token: string; demand: PurchaseDemandDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const record = useRecordSupplierPayment(token);
  const activeCredits = demand.credits.filter((c) => c.status === 'active' && c.outstanding > 0);
  const [f, setF] = useState({ method: 'cash' as SupplierPaymentMethod, amount: '', referenceNo: '', paidOn: '', notes: '', creditId: null as string | null });
  const [attempted, setAttempted] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [clientRequestId, setClientRequestId] = useState('');
  const key = useRef(new SubmissionKey('pay'));

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const left = stillToRecord(demand);
      setF({ method: 'cash', amount: left > 0 ? String(left) : '', referenceNo: '', paidOn: businessDateStr(), notes: '', creditId: null });
      setAttempted(false);
      setConfirming(false);
      setClientRequestId(newRequestId('pay'));
    }
  }
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const body = {
    method: f.method,
    amount: parseNumber(f.amount),
    referenceNo: f.referenceNo.trim() || null,
    paidOn: f.paidOn,
    notes: f.notes.trim() || null,
    creditId: f.creditId,
    clientRequestId: clientRequestId,
  };
  const parsed = PaymentInputSchema.safeParse(body);
  // The server refuses a payment dated in the future or before the demand
  // existed (400); saying so on the field saves the round trip. Over-paying
  // the bill or a credit is the server's call alone (409) — it knows the
  // pending payments and credit this screen may not have refetched yet.
  const earliest = karachiDateStr(new Date(demand.createdAt));
  const latest = businessDateStr();
  const dateErr = f.paidOn && (f.paidOn > latest ? 'A payment cannot be dated in the future' : f.paidOn < earliest ? `The demand was raised on ${formatDate(earliest)}` : null);
  const errors = parsed.success ? {} : issuesByPath(parsed.error.issues);
  if (dateErr && !errors['paidOn']) errors['paidOn'] = dateErr;
  const err = (k: string) => (attempted ? errors[k] : undefined);
  const valid = parsed.success && !dateErr;

  async function submit() {
    if (!parsed.success || !valid || record.isPending) return;
    try {
      const p = await record.mutateAsync({ id: demand.id, body: parsed.data, key: key.current.keyFor(JSON.stringify(parsed.data)) });
      key.current.reset();
      toast.success(p.replayed ? `Payment ${p.paymentNo} was already recorded` : `Payment ${p.paymentNo} recorded — waiting for Finance approval`);
      setConfirming(false);
      onOpenChange(false);
    } catch (e) {
      setConfirming(false);
      toast.error(errorMessage(e, 'Could not record the payment'));
    }
  }

  return (
    <>
      <Dialog open={open && !confirming} onOpenChange={(o) => !record.isPending && onOpenChange(o)}>
        <DialogContent className="md:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record payment · {demand.demandNo}</DialogTitle>
            <DialogDescription className="flex items-start gap-1.5">
              <Clock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              Waits for Finance approval. Nothing is posted to the ledger until Finance approves it on Supplier Payments.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Method" htmlFor="pay-method">
              <Select value={f.method} onValueChange={(v) => v && set('method', v as SupplierPaymentMethod)}>
                <SelectTrigger id="pay-method" className="h-10 w-full">
                  <SelectValue>{(v: string) => METHOD_LABEL[v as SupplierPaymentMethod]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SUPPLIER_PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>{METHOD_LABEL[m]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Amount" htmlFor="pay-amount" error={err('amount')} hint={`Still to record: ${money(stillToRecord(demand))}`}>
              <Input id="pay-amount" inputMode="decimal" value={f.amount} onChange={(e) => set('amount', decimalInput(e.target.value))} className="h-10" placeholder="Rs." />
            </Field>
            <Field label={f.method === 'cash' ? 'Reference no. (optional)' : 'Transaction reference'} htmlFor="pay-ref" error={err('referenceNo')}>
              <Input id="pay-ref" value={f.referenceNo} maxLength={80} onChange={(e) => set('referenceNo', e.target.value)} className="h-10" />
            </Field>
            <Field label="Paid on" htmlFor="pay-date" error={err('paidOn')}>
              <Input id="pay-date" type="date" min={earliest} max={latest} value={f.paidOn} onChange={(e) => set('paidOn', e.target.value)} className="h-10" />
            </Field>
            {activeCredits.length > 0 && (
              <Field label="Repays credit (optional)" htmlFor="pay-credit" className="sm:col-span-2">
                <Select value={f.creditId ?? 'none'} onValueChange={(v) => set('creditId', !v || v === 'none' ? null : (v as string))}>
                  <SelectTrigger id="pay-credit" className="h-10 w-full">
                    <SelectValue>
                      {(v: string) => {
                        const c = activeCredits.find((x) => x.id === v);
                        return c ? `${c.creditNo} · ${money(c.outstanding)} outstanding` : 'Not a credit repayment';
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not a credit repayment</SelectItem>
                    {activeCredits.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.creditNo} · {money(c.outstanding)} outstanding</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field label="Notes (optional)" htmlFor="pay-notes" className="sm:col-span-2">
              <Textarea id="pay-notes" rows={2} maxLength={500} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={record.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setAttempted(true);
                if (valid) setConfirming(true);
              }}
              disabled={record.isPending}
            >
              Review payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Record ${money(body.amount)} ${METHOD_LABEL[f.method].toLowerCase()} payment?`}
        description={`To ${demand.supplierName} against ${demand.demandNo}. It waits for Finance approval and is posted to the ledger only when they approve it.`}
        confirmLabel="Record payment"
        pending={record.isPending}
        onConfirm={() => void submit()}
      />
    </>
  );
}

function CreditDialog({ token, demand, open, onOpenChange }: { token: string; demand: PurchaseDemandDetail; open: boolean; onOpenChange: (o: boolean) => void }) {
  const request = useRequestSupplierCredit(token);
  const [f, setF] = useState({ amount: '', terms: '', dueDate: '', reference: '', notes: '' });
  const [attempted, setAttempted] = useState(false);
  const key = useRef(new SubmissionKey('credit'));

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const left = stillToRecord(demand);
      setF({
        amount: demand.creditAmountRequested ? String(Math.min(demand.creditAmountRequested, left || demand.creditAmountRequested)) : left > 0 ? String(left) : '',
        terms: demand.creditTerms ?? '',
        dueDate: demand.creditDueDate ?? '',
        reference: demand.creditReference ?? '',
        notes: demand.creditNotes ?? '',
      });
      setAttempted(false);
    }
  }
  const set = <K extends keyof typeof f>(k: K, v: string) => setF((p) => ({ ...p, [k]: v }));

  const body = {
    amount: parseNumber(f.amount),
    terms: f.terms.trim() || null,
    dueDate: f.dueDate || null,
    reference: f.reference.trim() || null,
    notes: f.notes.trim() || null,
  };
  const parsed = CreditInputSchema.safeParse(body);
  const errors = parsed.success ? {} : issuesByPath(parsed.error.issues);
  const err = (k: string) => (attempted ? errors[k] : undefined);

  async function submit() {
    setAttempted(true);
    if (!parsed.success || request.isPending) return;
    try {
      const c = await request.mutateAsync({ id: demand.id, body: parsed.data, key: key.current.keyFor(JSON.stringify(parsed.data)) });
      key.current.reset();
      toast.success(`Credit ${c.creditNo} requested — waiting for Finance approval`);
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e, 'Could not request credit'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !request.isPending && onOpenChange(o)}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>Request credit · {demand.demandNo}</DialogTitle>
          <DialogDescription>
            Ask Finance to approve buying from {demand.supplierName} on credit. Waits for Finance approval; one open credit per bill.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Amount" htmlFor="cr-amount" error={err('amount')}>
            <Input id="cr-amount" inputMode="decimal" value={f.amount} onChange={(e) => set('amount', decimalInput(e.target.value))} className="h-10" placeholder="Rs." />
          </Field>
          <Field label="Due date (optional)" htmlFor="cr-due" error={err('dueDate')}>
            <Input id="cr-due" type="date" value={f.dueDate} onChange={(e) => set('dueDate', e.target.value)} className="h-10" />
          </Field>
          <Field label="Terms (optional)" htmlFor="cr-terms">
            <Input id="cr-terms" value={f.terms} maxLength={300} onChange={(e) => set('terms', e.target.value)} className="h-10" placeholder="e.g. 30 days" />
          </Field>
          <Field label="Reference (optional)" htmlFor="cr-ref">
            <Input id="cr-ref" value={f.reference} maxLength={80} onChange={(e) => set('reference', e.target.value)} className="h-10" />
          </Field>
          <Field label="Notes (optional)" htmlFor="cr-notes" className="sm:col-span-2">
            <Textarea id="cr-notes" rows={2} maxLength={500} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={request.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={request.isPending}>
            {request.isPending ? 'Requesting…' : 'Request credit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
