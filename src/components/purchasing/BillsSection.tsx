'use client';

import { useRef, useState } from 'react';
import { BillInputSchema, businessDateStr, type PurchaseDemandDetail, type SupplierBill } from '@mb/shared';
import { AlertTriangle, Check as CheckIcon, FileText, MessageSquareWarning, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useDecideBill, useEnterBill } from '@/lib/purchasing';
import { formatDate, formatDateTime } from '@/utils/date';
import {
  BILL_DIFFERENCE_FIELD_LABEL,
  BILL_STATUS_LABEL,
  BILL_STATUS_TONE,
  SubmissionKey,
  decimalInput,
  formatQty,
  issuesByPath,
  newRequestId,
  parseNumber,
  quotationPreviewTotal,
} from './purchasing-model';
import { Check, ConfirmDialog, Field, Pill, ReasonDialog, Section, errorMessage, money } from './parts';

/**
 * Supplier bills on a demand, newest first, each with its decision.
 *
 * A bill that differs from the approved quotation (quantity, rate, delivery or
 * other charges) cannot be approved plainly: the server answers 409 unless
 * `acceptDifferences` is set, and then insists on a reason — the record of WHY
 * Production paid something other than what it agreed. The dialog asks for
 * both in one step, listing the differences above the box.
 */
export function BillsSection({ token, demand }: { token: string; demand: PurchaseDemandDetail }) {
  const decide = useDecideBill(token);
  const [approving, setApproving] = useState<SupplierBill | null>(null);
  const [rejecting, setRejecting] = useState<SupplierBill | null>(null);
  const [entering, setEntering] = useState(false);
  const [acceptDiffs, setAcceptDiffs] = useState(false);
  const [diffReason, setDiffReason] = useState('');
  const [attempted, setAttempted] = useState(false);
  const bills = [...demand.bills].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));

  function openApprove(b: SupplierBill) {
    setApproving(b);
    setAcceptDiffs(false);
    setDiffReason('');
    setAttempted(false);
  }

  async function approve() {
    if (!approving) return;
    const b = approving;
    setAttempted(true);
    if (b.differsFromQuotation && (!acceptDiffs || diffReason.trim().length < 3)) return;
    try {
      await decide.mutateAsync({
        id: demand.id,
        billId: b.id,
        body: b.differsFromQuotation
          ? { decision: 'approve', acceptDifferences: true, reason: diffReason.trim() }
          : { decision: 'approve' },
      });
      toast.success(`Bill ${b.supplierBillNo} approved — ${money(b.grandTotal)} is now payable`);
      setApproving(null);
    } catch (e) {
      toast.error(errorMessage(e, 'Could not approve the bill'));
    }
  }

  async function reject(reason: string) {
    if (!rejecting) return;
    const b = rejecting;
    try {
      await decide.mutateAsync({ id: demand.id, billId: b.id, body: { decision: 'reject', reason } });
      toast.success(`Bill ${b.supplierBillNo} rejected — ${demand.supplierName} has been asked for a corrected one`);
      setRejecting(null);
    } catch (e) {
      toast.error(errorMessage(e, 'Could not reject the bill'));
    }
  }

  return (
    <div className="space-y-4">
      {demand.actions.enterBill && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3 text-sm">
          <span className="text-muted-foreground">Got a paper or photo bill instead of one through the link?</span>
          <Button size="sm" variant="outline" onClick={() => setEntering(true)}>
            <FileText className="mr-1.5 h-4 w-4" /> Enter bill
          </Button>
        </div>
      )}

      {bills.length === 0 && (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {demand.approvedQuotationId ? 'Waiting for the supplier to send their bill.' : 'A bill can be sent once a quotation is approved.'}
        </p>
      )}

      {bills.map((b) => (
        <Section
          key={b.id}
          title={`Bill ${b.supplierBillNo}`}
          actions={
            <>
              <Pill tone={BILL_STATUS_TONE[b.status]}>{BILL_STATUS_LABEL[b.status]}</Pill>
              <Pill tone="neutral">{b.submittedVia === 'portal' ? 'Supplier link' : `Entered by ${b.enteredByName ?? 'staff'}`}</Pill>
              {b.differsFromQuotation && (
                <Pill tone="waiting">
                  <AlertTriangle className="h-3 w-3" aria-hidden /> Differs from quotation v{b.quotationVersion}
                </Pill>
              )}
            </>
          }
        >
          <BillTable bill={b} />
          {b.differsFromQuotation && <Differences bill={b} />}
          <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 text-xs text-muted-foreground">
            <span>Invoice {formatDate(b.invoiceDate)}</span>
            {b.deliveryDate && <span>Delivery {formatDate(b.deliveryDate)}</span>}
            <span>Submitted {formatDateTime(b.submittedAt)}</span>
            {b.decidedAt && (
              <span>
                Decided {formatDateTime(b.decidedAt)}
                {b.decidedByName ? ` by ${b.decidedByName}` : ''}
              </span>
            )}
          </div>
          {(b.supplierPaymentMethod || b.supplierStatedPaid > 0) && (
            <p className="rounded-md bg-muted/40 p-2.5 text-xs">
              Supplier&apos;s own statement: {b.supplierPaymentMethod ? `prefers ${b.supplierPaymentMethod}` : ''}
              {b.supplierStatedPaid > 0 ? `${b.supplierPaymentMethod ? ', ' : ''}says ${money(b.supplierStatedPaid)} already paid` : ''}.
              {' '}This is not a payment — only payments recorded below and posted by Finance count.
            </p>
          )}
          {b.notes && <p className="text-sm"><span className="text-muted-foreground">Notes: </span>{b.notes}</p>}
          {b.decisionReason && (
            <p className="flex items-start gap-2 rounded-md bg-amber-50 p-2.5 text-sm dark:bg-amber-950/40">
              <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {b.decisionReason}
            </p>
          )}
          {b.status === 'submitted' && demand.actions.decideBill && (
            <div className="flex flex-wrap gap-2 border-t pt-3">
              <Button size="sm" onClick={() => openApprove(b)}>
                <CheckIcon className="mr-1.5 h-4 w-4" /> {b.differsFromQuotation ? 'Accept differences & approve' : 'Approve bill'}
              </Button>
              <Button size="sm" variant="outline" className="text-red-600 hover:text-red-600" onClick={() => setRejecting(b)}>
                <X className="mr-1.5 h-4 w-4" /> Reject
              </Button>
            </div>
          )}
        </Section>
      ))}

      <ConfirmDialog
        open={!!approving}
        onOpenChange={(o) => !o && setApproving(null)}
        title={`Approve bill ${approving?.supplierBillNo ?? ''}?`}
        description={`${money(approving?.grandTotal)} becomes payable to ${demand.supplierName} and the demand moves to Awaiting delivery. This cannot be undone.`}
        confirmLabel="Approve bill"
        pending={decide.isPending}
        onConfirm={() => void approve()}
      >
        {approving?.differsFromQuotation && (
          <div className="space-y-2">
            <Differences bill={approving} />
            <Check id="bill-accept-diffs" checked={acceptDiffs} onChange={setAcceptDiffs}>
              I have checked these differences and accept them.
            </Check>
            <Field label="Why they are accepted" htmlFor="bill-diff-reason" error={attempted && diffReason.trim().length < 3 ? 'Give a reason' : null}>
              <Textarea
                id="bill-diff-reason"
                rows={2}
                maxLength={1000}
                value={diffReason}
                onChange={(e) => setDiffReason(e.target.value)}
                placeholder="e.g. Flour price went up today, confirmed on the phone"
              />
            </Field>
            {attempted && !acceptDiffs && <p className="text-xs text-destructive">Tick the box to accept the differences.</p>}
          </div>
        )}
      </ConfirmDialog>
      <ReasonDialog
        open={!!rejecting}
        onOpenChange={(o) => !o && setRejecting(null)}
        title={`Reject bill ${rejecting?.supplierBillNo ?? ''}?`}
        description={`Nothing becomes payable. ${demand.supplierName} receives this reason on WhatsApp with a fresh link to send a corrected bill.`}
        placeholder="e.g. Wrong bill number"
        confirmLabel="Reject bill"
        destructive
        pending={decide.isPending}
        onConfirm={(r) => void reject(r)}
      />
      <BillEntryDialog token={token} demand={demand} open={entering} onOpenChange={setEntering} />
    </div>
  );
}

function BillTable({ bill }: { bill: SupplierBill }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[26rem] text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-1.5 pr-2 font-medium">Item</th>
            <th className="py-1.5 pr-2 text-right font-medium">Qty</th>
            <th className="py-1.5 pr-2 text-right font-medium">Rate</th>
            <th className="py-1.5 text-right font-medium">Line total</th>
          </tr>
        </thead>
        <tbody>
          {[...bill.items].sort((a, b) => a.lineNo - b.lineNo).map((l) => (
            <tr key={l.id} className="border-b last:border-0">
              <td className="py-1.5 pr-2">{l.itemName}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{formatQty(l.qty)} {l.unit}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{money(l.unitRate)}</td>
              <td className="py-1.5 text-right font-medium tabular-nums">{money(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <TotalRow label="Subtotal" value={bill.subtotal} />
          <TotalRow label="Delivery charge" value={bill.deliveryCharge} />
          {bill.discount > 0 && <TotalRow label="Discount" value={-bill.discount} />}
          {bill.otherCharges > 0 && <TotalRow label={`Other charges${bill.otherChargesNote ? ` (${bill.otherChargesNote})` : ''}`} value={bill.otherCharges} />}
          <TotalRow label="Grand total" value={bill.grandTotal} strong />
        </tfoot>
      </table>
    </div>
  );
}

function TotalRow({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <tr className={strong ? 'font-semibold' : undefined}>
      <td colSpan={3} className="pt-1 pr-2 text-right text-muted-foreground">{label}</td>
      <td className="pt-1 text-right tabular-nums">{money(value)}</td>
    </tr>
  );
}

function Differences({ bill }: { bill: SupplierBill }) {
  return (
    <div className="rounded-md border border-amber-300 bg-amber-50 p-2.5 text-sm dark:border-amber-800 dark:bg-amber-950/40">
      <p className="mb-1 font-medium">Differences from the approved quotation</p>
      <ul className="space-y-0.5">
        {bill.differences.map((d, i) => (
          <li key={i} className="flex flex-wrap justify-between gap-2">
            <span>
              {d.item ? `${d.item} · ` : ''}
              {BILL_DIFFERENCE_FIELD_LABEL[d.field] ?? d.field}
            </span>
            <span className="tabular-nums">
              {d.field === 'quantity' ? formatQty(d.quoted) : money(d.quoted)} → <strong>{d.field === 'quantity' ? formatQty(d.billed) : money(d.billed)}</strong>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Staff entry ─────────────────────────────────────────────────────────────

/**
 * Enter the supplier's bill by hand (POST /demands/:id/bills), prefilled from
 * the approved quotation so only what changed has to be typed. The server
 * compares it with the quotation and flags any difference for approval.
 */
function BillEntryDialog({
  token,
  demand,
  open,
  onOpenChange,
}: {
  token: string;
  demand: PurchaseDemandDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const enter = useEnterBill(token);
  const approved = demand.quotations.find((q) => q.id === demand.approvedQuotationId) ?? null;
  const quoted = (approved?.items ?? []).filter((l) => l.availability !== 'unavailable' && l.availableQty > 0);

  const [lines, setLines] = useState<Array<{ quotationItemId: string; itemName: string; unit: string; qty: string; rate: string }>>([]);
  const [f, setF] = useState({ billNo: '', invoiceDate: '', deliveryDate: '', deliveryCharge: '0', discount: '0', otherCharges: '0', otherChargesNote: '', method: '', statedPaid: '0', notes: '' });
  const [attempted, setAttempted] = useState(false);
  const [clientRequestId, setClientRequestId] = useState('');
  const key = useRef(new SubmissionKey('bill'));

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setLines(quoted.map((l) => ({ quotationItemId: l.id, itemName: l.itemName, unit: l.unit, qty: String(l.availableQty), rate: String(l.unitRate) })));
      setF({
        billNo: '',
        invoiceDate: businessDateStr(),
        deliveryDate: '',
        deliveryCharge: String(approved?.deliveryCharge ?? 0),
        discount: '0',
        otherCharges: '0',
        otherChargesNote: '',
        method: '',
        statedPaid: '0',
        notes: '',
      });
      setAttempted(false);
      setClientRequestId(newRequestId('bill'));
    }
  }
  const set = <K extends keyof typeof f>(k: K, v: string) => setF((p) => ({ ...p, [k]: v }));

  const body = {
    supplierBillNo: f.billNo,
    invoiceDate: f.invoiceDate,
    deliveryDate: f.deliveryDate || null,
    items: lines.map((l) => ({ quotationItemId: l.quotationItemId, qty: parseNumber(l.qty), unitRate: parseNumber(l.rate) })),
    deliveryCharge: parseNumber(f.deliveryCharge),
    discount: parseNumber(f.discount),
    otherCharges: parseNumber(f.otherCharges),
    otherChargesNote: f.otherChargesNote.trim() || null,
    supplierPaymentMethod: f.method.trim() || null,
    supplierStatedPaid: parseNumber(f.statedPaid),
    notes: f.notes.trim() || null,
    clientRequestId: clientRequestId,
  };
  const parsed = BillInputSchema.safeParse(body);
  const errors = parsed.success ? {} : issuesByPath(parsed.error.issues);
  const err = (k: string) => (attempted ? errors[k] : undefined);
  const preview =
    quotationPreviewTotal(body.items.map((l) => ({ qty: l.qty, rate: l.unitRate })), body.deliveryCharge) +
    (Number.isFinite(body.otherCharges) ? body.otherCharges : 0) -
    (Number.isFinite(body.discount) ? body.discount : 0);

  async function submit() {
    setAttempted(true);
    if (!parsed.success || enter.isPending) return;
    try {
      const b = await enter.mutateAsync({ id: demand.id, body: parsed.data, key: key.current.keyFor(JSON.stringify(parsed.data)) });
      key.current.reset();
      toast.success(`Bill ${b.supplierBillNo} entered — ${money(b.grandTotal)}${b.differsFromQuotation ? ', differs from the quotation' : ''}`);
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e, 'Could not enter the bill'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !enter.isPending && onOpenChange(o)}>
      <DialogContent mobile="fullscreen" className="md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Enter bill · {demand.demandNo}</DialogTitle>
          <DialogDescription>
            Prefilled from the approved quotation (v{approved?.version ?? '—'}). Change only what the bill says differently; any difference is flagged for approval.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Bill number" htmlFor="bill-no" error={err('supplierBillNo')}>
              <Input id="bill-no" value={f.billNo} maxLength={60} onChange={(e) => set('billNo', e.target.value)} className="h-10" />
            </Field>
            <Field label="Invoice date" htmlFor="bill-date" error={err('invoiceDate')}>
              <Input id="bill-date" type="date" value={f.invoiceDate} onChange={(e) => set('invoiceDate', e.target.value)} className="h-10" />
            </Field>
            <Field label="Delivery date (optional)" htmlFor="bill-ddate" error={err('deliveryDate')}>
              <Input id="bill-ddate" type="date" value={f.deliveryDate} onChange={(e) => set('deliveryDate', e.target.value)} className="h-10" />
            </Field>
          </div>
          <div className="space-y-2">
            {lines.map((l, idx) => (
              <div key={l.quotationItemId} className="grid grid-cols-2 items-end gap-2 rounded-lg border p-2.5 sm:grid-cols-[minmax(0,1fr)_7rem_8rem]">
                <p className="col-span-2 text-sm font-medium sm:col-span-1 sm:pb-2">{l.itemName}</p>
                <Field label={`Qty (${l.unit})`} error={err(`items.${idx}.qty`)}>
                  <Input inputMode="decimal" value={l.qty} aria-label={`Billed quantity of ${l.itemName}`} onChange={(e) => setLines((p) => p.map((x, i) => (i === idx ? { ...x, qty: decimalInput(e.target.value) } : x)))} className="h-10" />
                </Field>
                <Field label="Rate" error={err(`items.${idx}.unitRate`)}>
                  <Input inputMode="decimal" value={l.rate} aria-label={`Billed rate of ${l.itemName}`} onChange={(e) => setLines((p) => p.map((x, i) => (i === idx ? { ...x, rate: decimalInput(e.target.value) } : x)))} className="h-10" />
                </Field>
              </div>
            ))}
            {err('items') && <p className="text-xs text-destructive">{err('items')}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Delivery charge" error={err('deliveryCharge')}>
              <Input inputMode="decimal" value={f.deliveryCharge} onChange={(e) => set('deliveryCharge', decimalInput(e.target.value))} className="h-10" aria-label="Delivery charge" />
            </Field>
            <Field label="Discount" error={err('discount')}>
              <Input inputMode="decimal" value={f.discount} onChange={(e) => set('discount', decimalInput(e.target.value))} className="h-10" aria-label="Discount" />
            </Field>
            <Field label="Other charges" error={err('otherCharges')}>
              <Input inputMode="decimal" value={f.otherCharges} onChange={(e) => set('otherCharges', decimalInput(e.target.value))} className="h-10" aria-label="Other charges" />
            </Field>
            <Field label="For (optional)">
              <Input value={f.otherChargesNote} maxLength={300} onChange={(e) => set('otherChargesNote', e.target.value)} className="h-10" aria-label="What the other charges are for" />
            </Field>
            <Field label="Supplier's payment method (optional)" className="col-span-2">
              <Input value={f.method} maxLength={60} onChange={(e) => set('method', e.target.value)} className="h-10" aria-label="Payment method the supplier asks for" placeholder="As written on the bill" />
            </Field>
            <Field label="Supplier says already paid" className="col-span-2" error={err('supplierStatedPaid')} hint="Their statement only — not recorded as a payment.">
              <Input inputMode="decimal" value={f.statedPaid} onChange={(e) => set('statedPaid', decimalInput(e.target.value))} className="h-10" aria-label="Amount the supplier says is already paid" />
            </Field>
          </div>
          <Field label="Notes (optional)" htmlFor="bill-notes">
            <Textarea id="bill-notes" rows={2} maxLength={1000} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
          </Field>
          <p className="text-right text-sm">
            Grand total <span className="font-semibold tabular-nums">{money(Math.round(preview * 100) / 100)}</span>
            <span className="block text-xs text-muted-foreground">Preview — the server calculates the final total.</span>
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enter.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={enter.isPending || lines.length === 0}>
            {enter.isPending ? 'Saving…' : 'Save bill'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
