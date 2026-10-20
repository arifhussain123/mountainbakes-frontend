'use client';

import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, Loader2, Send } from 'lucide-react';
import type { SupplierPortalView } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { newClientRequestId, supplierPortalApi, SupplierPortalError, type BillSubmitResult } from '@/lib/supplierPortal';
import { FieldError, FigureInput, NativeSelect, Notice, Section, TotalRow } from './portalUi';
import { day, qty as fmtQty, rs, todayIso } from './portalFormat';
import {
  billErrorKeyFor,
  buildBill,
  initialBillState,
  lineDifference,
  previewBillLine,
  previewBillTotals,
  SUPPLIER_PAYMENT_METHOD_OPTIONS,
  type BillFormState,
  type BillLine,
} from './billModel';

/**
 * The supplier's final bill against the approved quotation. Same two steps as
 * the quotation (fill in → review → send), the same retry key, and the same
 * rule that the server's totals are the ones shown once it is sent.
 */
export function BillForm({
  view,
  token,
  onSubmitted,
  onLinkError,
  onStale,
}: {
  view: SupplierPortalView;
  token: string;
  onSubmitted: (result: BillSubmitResult) => void;
  onLinkError: (err: SupplierPortalError) => void;
  onStale: (message: string) => void;
}) {
  const [state, setState] = useState<BillFormState>(() => initialBillState(view));
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const requestId = useRef<string | null>(null);
  const inFlight = useRef(false);
  const topRef = useRef<HTMLDivElement>(null);

  const totals = useMemo(() => previewBillTotals(state), [state]);
  const quotation = view.approvedQuotation;
  const deliveryDiffers = quotation ? totals.delivery !== quotation.deliveryCharge : false;

  function update(next: (s: BillFormState) => BillFormState, clearKeys: string[] = []) {
    requestId.current = null;
    setState(next);
    if (clearKeys.length) {
      setErrors((e) => {
        const copy = { ...e };
        for (const k of clearKeys) delete copy[k];
        return copy;
      });
    }
  }
  const setField = <K extends keyof BillFormState>(key: K, value: BillFormState[K]) =>
    update((s) => ({ ...s, [key]: value }), [key as string]);
  const setLine = (id: string, patch: Partial<BillLine>, clear: string[] = []) =>
    update((s) => ({ ...s, lines: s.lines.map((l) => (l.quotationItemId === id ? { ...l, ...patch } : l)) }), [...clear, 'lines']);

  const scrollToTop = () => topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  function review() {
    setFormError(null);
    const built = buildBill(state);
    setErrors(built.errors);
    if (!built.input) {
      setFormError('Some details need fixing — see the highlighted fields.');
      scrollToTop();
      return;
    }
    requestId.current ??= newClientRequestId();
    setStep('review');
    scrollToTop();
  }

  async function submit() {
    if (inFlight.current) return;
    const built = buildBill(state, requestId.current ?? undefined);
    if (!built.input) {
      setErrors(built.errors);
      setStep('edit');
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setFormError(null);
    try {
      onSubmitted(await supplierPortalApi.submitBill(token, built.input));
    } catch (err) {
      const e = err instanceof SupplierPortalError ? err : new SupplierPortalError('Something went wrong. Please try again.', 'server', 0);
      if (e.kind === 'link') {
        onLinkError(e);
        return;
      }
      if (e.kind === 'validation') {
        const mapped: Record<string, string> = {};
        for (const [path, msg] of Object.entries(e.fieldErrors)) mapped[billErrorKeyFor(path, built.included)] ??= msg;
        setErrors(mapped);
        setFormError(e.message);
        setStep('edit');
      } else if (e.kind === 'conflict') {
        setFormError(e.message);
        onStale(e.message);
      } else {
        setFormError(e.message);
      }
      scrollToTop();
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  if (!quotation) {
    return <Notice tone="error">The approved quotation could not be found. Please contact Mountain Bakes.</Notice>;
  }

  const paymentOptions = [
    { value: '', label: 'Not stated' },
    ...SUPPLIER_PAYMENT_METHOD_OPTIONS.map((m) => ({ value: m, label: m })),
    // A method typed on a returned bill that is not one of the usual answers.
    ...(state.supplierPaymentMethod && !SUPPLIER_PAYMENT_METHOD_OPTIONS.includes(state.supplierPaymentMethod)
      ? [{ value: state.supplierPaymentMethod, label: state.supplierPaymentMethod }]
      : []),
  ];

  if (step === 'review') {
    const included = state.lines.filter((l) => l.included);
    return (
      <div ref={topRef} className="scroll-mt-4 space-y-4">
        <Section title="Check your bill" description="Nothing has been sent yet. Check the figures, then send.">
          {formError && <Notice tone="error" className="mb-3">{formError}</Notice>}
          <dl className="mb-3 grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">Bill number</dt>
              <dd className="font-medium">{state.supplierBillNo.trim()}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Invoice date</dt>
              <dd className="font-medium">{day(state.invoiceDate)}</dd>
            </div>
            {state.deliveryDate && (
              <div>
                <dt className="text-xs text-muted-foreground">Delivery date</dt>
                <dd className="font-medium">{day(state.deliveryDate)}</dd>
              </div>
            )}
          </dl>
          <ul className="divide-y rounded-xl border text-sm">
            {included.map((l) => {
              const diff = lineDifference(l);
              return (
                <li key={l.quotationItemId} className="space-y-0.5 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 font-medium">{l.itemName}</p>
                    <p className="shrink-0 font-semibold tabular-nums">{rs(previewBillLine(l) ?? 0)}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {fmtQty(Number(l.qty.replace(/,/g, '')))} {l.unit} × {rs(Number(l.rate.replace(/,/g, '')))}
                  </p>
                  {diff && <p className="text-xs text-amber-700 dark:text-amber-300">{diff}</p>}
                </li>
              );
            })}
          </ul>
          <div className="mt-3 text-sm">
            <TotalRow label="Items" value={rs(totals.subtotal)} />
            <TotalRow label="Delivery charge" value={rs(totals.delivery)} />
            {totals.other > 0 && (
              <TotalRow label={`Other charges${state.otherChargesNote.trim() ? ` (${state.otherChargesNote.trim()})` : ''}`} value={rs(totals.other)} />
            )}
            {totals.discount > 0 && <TotalRow label="Discount" value={`− ${rs(totals.discount)}`} />}
            <TotalRow label="Bill total (estimate)" value={rs(totals.grandTotal)} strong />
            <p className="mt-1 text-xs text-muted-foreground">Mountain Bakes&apos; system confirms the final total when you send.</p>
          </div>
          {(state.supplierPaymentMethod || state.supplierStatedPaid) && (
            <p className="mt-3 text-sm text-muted-foreground">
              You note: {state.supplierPaymentMethod || 'payment'}
              {state.supplierStatedPaid && ` · ${rs(Number(state.supplierStatedPaid.replace(/,/g, '')))} paid`}. This does not record a payment.
            </p>
          )}
          {state.notes.trim() && <p className="mt-1 text-sm text-muted-foreground">Notes: {state.notes.trim()}</p>}
        </Section>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" className="h-12 text-base" onClick={() => setStep('edit')} disabled={submitting}>
            <ArrowLeft className="size-4" /> Change something
          </Button>
          <Button className="h-12 text-base" onClick={() => void submit()} disabled={submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {submitting ? 'Sending…' : 'Send bill'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div ref={topRef} className="scroll-mt-4 space-y-4">
      {formError && <Notice tone="error">{formError}</Notice>}

      <Section
        title="Your bill"
        description={`Against your approved quotation (version ${quotation.version}). Change a quantity or rate only if it really differs — Mountain Bakes checks every difference.`}
      >
        {errors['lines'] && <Notice tone="error" className="mb-3">{errors['lines']}</Notice>}
        <div className="space-y-3">
          {state.lines.map((l) => {
            const diff = l.included ? lineDifference(l) : null;
            const total = previewBillLine(l);
            return (
              <div key={l.quotationItemId} className={cn('rounded-xl border p-3', !l.included && 'bg-muted/40')}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={cn('font-medium', !l.included && 'text-muted-foreground line-through')}>{l.itemName}</p>
                    <p className="text-xs text-muted-foreground">
                      Approved: {fmtQty(l.quotedQty)} {l.unit} × {rs(l.quotedRate)}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums">{!l.included ? '—' : total === null ? '—' : rs(total)}</p>
                </div>
                {l.included ? (
                  <>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <FigureInput
                        id={`${l.quotationItemId}-qty`}
                        label="Quantity billed"
                        suffix={l.unit}
                        value={l.qty}
                        onChange={(v) => setLine(l.quotationItemId, { qty: v }, [`${l.quotationItemId}.qty`])}
                        error={errors[`${l.quotationItemId}.qty`]}
                      />
                      <FigureInput
                        id={`${l.quotationItemId}-rate`}
                        label="Rate per unit"
                        suffix="Rs."
                        value={l.rate}
                        onChange={(v) => setLine(l.quotationItemId, { rate: v }, [`${l.quotationItemId}.rate`])}
                        error={errors[`${l.quotationItemId}.rate`]}
                      />
                    </div>
                    {diff && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">{diff}</p>}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="mt-2 text-muted-foreground"
                      onClick={() => setLine(l.quotationItemId, { included: false }, [`${l.quotationItemId}.qty`, `${l.quotationItemId}.rate`])}
                    >
                      Not delivering this item
                    </Button>
                  </>
                ) : (
                  <Button variant="outline" size="sm" className="mt-2" onClick={() => setLine(l.quotationItemId, { included: true })}>
                    Put back on the bill
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      <Section title="Bill details">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="b-no" className="text-xs text-muted-foreground">
              Your bill / invoice number
            </Label>
            <Input
              id="b-no"
              value={state.supplierBillNo}
              maxLength={60}
              onChange={(e) => setField('supplierBillNo', e.target.value)}
              aria-invalid={errors['supplierBillNo'] ? true : undefined}
              className="h-11 text-base"
            />
            <FieldError message={errors['supplierBillNo']} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="b-invoice-date" className="text-xs text-muted-foreground">
              Invoice date
            </Label>
            <Input
              id="b-invoice-date"
              type="date"
              max={todayIso()}
              value={state.invoiceDate}
              onChange={(e) => setField('invoiceDate', e.target.value)}
              aria-invalid={errors['invoiceDate'] ? true : undefined}
              className="h-11 text-base"
            />
            <FieldError message={errors['invoiceDate']} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="b-delivery-date" className="text-xs text-muted-foreground">
              Delivery date (optional)
            </Label>
            <Input
              id="b-delivery-date"
              type="date"
              value={state.deliveryDate}
              onChange={(e) => setField('deliveryDate', e.target.value)}
              aria-invalid={errors['deliveryDate'] ? true : undefined}
              className="h-11 text-base"
            />
            <FieldError message={errors['deliveryDate']} />
          </div>
          <div>
            <FigureInput
              id="b-delivery-charge"
              label="Delivery charge"
              suffix="Rs."
              value={state.deliveryCharge}
              onChange={(v) => setField('deliveryCharge', v)}
              error={errors['deliveryCharge']}
              placeholder="0"
            />
            {deliveryDiffers && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">Quoted delivery charge was {rs(quotation.deliveryCharge)}.</p>
            )}
          </div>
          <FigureInput
            id="b-discount"
            label="Discount"
            suffix="Rs."
            value={state.discount}
            onChange={(v) => setField('discount', v)}
            error={errors['discount']}
            placeholder="0"
          />
          <FigureInput
            id="b-other"
            label="Other charges"
            suffix="Rs."
            value={state.otherCharges}
            onChange={(v) => setField('otherCharges', v)}
            error={errors['otherCharges']}
            placeholder="0"
          />
        </div>
        {totals.other > 0 && (
          <div className="mt-3 space-y-1">
            <Label htmlFor="b-other-note" className="text-xs text-muted-foreground">
              What are the other charges for?
            </Label>
            <Input
              id="b-other-note"
              value={state.otherChargesNote}
              maxLength={300}
              onChange={(e) => setField('otherChargesNote', e.target.value)}
              className="h-11 text-base"
            />
            <FieldError message={errors['otherChargesNote']} />
          </div>
        )}
      </Section>

      <Section
        title="Payment you have received (optional)"
        description="Only if Mountain Bakes has already paid you something for this order."
      >
        <Notice tone="info" className="mb-3">
          This does not record a payment. It is only your note — Mountain Bakes records its own payments.
        </Notice>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="b-pay-method" className="text-xs text-muted-foreground">
              Paid by
            </Label>
            <NativeSelect
              id="b-pay-method"
              value={state.supplierPaymentMethod}
              onChange={(v) => setField('supplierPaymentMethod', v)}
              options={paymentOptions}
              invalid={!!errors['supplierPaymentMethod']}
            />
            <FieldError message={errors['supplierPaymentMethod']} />
          </div>
          <FigureInput
            id="b-paid"
            label="Amount you say is paid"
            suffix="Rs."
            value={state.supplierStatedPaid}
            onChange={(v) => setField('supplierStatedPaid', v)}
            error={errors['supplierStatedPaid']}
            placeholder="0"
          />
        </div>
      </Section>

      <Section title="Notes (optional)">
        <Textarea
          id="b-notes"
          aria-label="Notes for Mountain Bakes"
          rows={2}
          maxLength={1000}
          value={state.notes}
          onChange={(e) => setField('notes', e.target.value)}
          className="text-base"
        />
        <FieldError message={errors['notes']} />
      </Section>

      <Section title="Estimated bill total">
        <div className="text-sm">
          <TotalRow label="Items" value={rs(totals.subtotal)} />
          <TotalRow label="Delivery charge" value={rs(totals.delivery)} />
          {totals.other > 0 && <TotalRow label="Other charges" value={rs(totals.other)} />}
          {totals.discount > 0 && <TotalRow label="Discount" value={`− ${rs(totals.discount)}`} />}
          <TotalRow label="Bill total" value={rs(totals.grandTotal)} strong />
        </div>
      </Section>

      <div className="flex justify-end">
        <Button className="h-12 w-full text-base sm:w-auto" onClick={review}>
          Review bill
        </Button>
      </div>
    </div>
  );
}
