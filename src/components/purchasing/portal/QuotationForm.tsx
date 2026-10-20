'use client';

import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, Loader2, Plus, Send, Trash2 } from 'lucide-react';
import { PURCHASE_UNITS, type SupplierPortalView } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  newClientRequestId,
  supplierPortalApi,
  SupplierPortalError,
  type QuotationSubmitResult,
} from '@/lib/supplierPortal';
import { FieldError, FigureInput, NativeSelect, Notice, Section, TotalRow } from './portalUi';
import { AVAILABILITY_LABEL } from './PortalViews';
import { day, qty as fmtQty, rs, todayIso } from './portalFormat';
import {
  buildQuotation,
  errorKeyFor,
  initialQuotationState,
  isRequested,
  isUnit,
  lineKey,
  orderedLines,
  previewLineTotal,
  previewTotals,
  type AddedLine,
  type QuotationFormState,
  type RequestedLine,
} from './quotationModel';

/**
 * The supplier's quotation: one card per requested item, then anything they
 * add, then delivery, then a review of the figures before anything is sent.
 *
 * Nothing is sent until the review step's Submit. The request carries a
 * clientRequestId minted for that review, so a Submit that times out and is
 * pressed again returns the version the server already saved instead of
 * creating another; changing anything mints a new one.
 */

type Choice = 'available' | 'partial' | 'unavailable' | 'substitute';
const CHOICES: Array<{ value: Choice; label: string }> = [
  { value: 'available', label: 'Available' },
  { value: 'partial', label: 'Partly' },
  { value: 'unavailable', label: 'Not available' },
  { value: 'substitute', label: 'Substitute' },
];

const UNIT_OPTIONS = [{ value: '', label: 'Unit…' }, ...PURCHASE_UNITS.map((u) => ({ value: u, label: u }))];

export function QuotationForm({
  view,
  token,
  withdrawsApproval,
  onSubmitted,
  onCancel,
  onLinkError,
  onStale,
}: {
  view: SupplierPortalView;
  token: string;
  /** The demand is approved and awaiting a bill: a new version withdraws that approval. */
  withdrawsApproval?: boolean;
  onSubmitted: (result: QuotationSubmitResult) => void;
  onCancel?: () => void;
  onLinkError: (err: SupplierPortalError) => void;
  /** The demand moved on under the form (Production decided meanwhile): reload, and say why. */
  onStale: (message: string) => void;
}) {
  const [state, setState] = useState<QuotationFormState>(() => initialQuotationState(view));
  const [step, setStep] = useState<'edit' | 'review'>('edit');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const requestId = useRef<string | null>(null);
  const inFlight = useRef(false);
  const topRef = useRef<HTMLDivElement>(null);

  const order = useMemo(() => orderedLines(state), [state]);
  const totals = useMemo(() => previewTotals(state), [state]);
  const requestedName = useMemo(() => new Map(state.requested.map((r) => [r.demandItemId, r.itemName])), [state.requested]);

  /** Every edit invalidates the retry key and clears that field's error. */
  function update(next: (s: QuotationFormState) => QuotationFormState, clearKeys: string[] = []) {
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

  const setRequested = (key: string, patch: Partial<RequestedLine>, clear: string[] = []) =>
    update((s) => ({ ...s, requested: s.requested.map((r) => (r.key === key ? { ...r, ...patch } : r)) }), clear);
  const setAdded = (key: string, patch: Partial<AddedLine>, clear: string[] = []) =>
    update((s) => ({ ...s, added: s.added.map((a) => (a.key === key ? { ...a, ...patch } : a)) }), clear);

  function choose(line: RequestedLine, choice: Choice) {
    const clear = [`${line.key}.qty`, `${line.key}.rate`];
    if (choice === 'available') {
      const q = Number(line.qty);
      setRequested(line.key, { availability: 'available', qty: !q || line.availability === 'unavailable' ? String(line.requestedQty) : line.qty }, clear);
    } else if (choice === 'partial') {
      const q = Number(line.qty);
      setRequested(line.key, { availability: 'partial', qty: !q || q >= line.requestedQty ? '' : line.qty }, clear);
    } else if (choice === 'unavailable') {
      setRequested(line.key, { availability: 'unavailable', qty: '0' }, clear);
    } else {
      update(
        (s) => ({
          ...s,
          requested: s.requested.map((r) => (r.key === line.key ? { ...r, availability: 'unavailable', qty: '0' } : r)),
          added: s.added.some((a) => a.substituteFor === line.demandItemId)
            ? s.added
            : [
                ...s.added,
                {
                  key: lineKey('add'),
                  substituteFor: line.demandItemId,
                  itemName: '',
                  unit: isUnit(line.unit) ? line.unit : '',
                  qty: String(line.requestedQty),
                  rate: '',
                  note: '',
                },
              ],
        }),
        clear,
      );
    }
  }

  function changeQty(line: RequestedLine, value: string) {
    // Typing less than was asked for makes it a partial supply, and the full
    // amount (or more) makes it available — the choice follows the figure.
    const n = Number(value.replace(/,/g, ''));
    let availability = line.availability;
    if (value.trim() !== '' && Number.isFinite(n) && n > 0) {
      availability = n < line.requestedQty ? 'partial' : 'available';
    }
    setRequested(line.key, { qty: value, availability }, [`${line.key}.qty`]);
  }

  function addLine(substituteFor: string | null) {
    update((s) => ({
      ...s,
      added: [...s.added, { key: lineKey('add'), substituteFor, itemName: '', unit: '', qty: '', rate: '', note: '' }],
    }));
  }

  const removeAdded = (key: string) => update((s) => ({ ...s, added: s.added.filter((a) => a.key !== key) }));

  function scrollToTop() {
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function review() {
    setFormError(null);
    const built = buildQuotation(state);
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
    const built = buildQuotation(state, requestId.current ?? undefined);
    if (!built.input) {
      setErrors(built.errors);
      setStep('edit');
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setFormError(null);
    try {
      const result = await supplierPortalApi.submitQuotation(token, built.input);
      onSubmitted(result);
    } catch (err) {
      const e = err instanceof SupplierPortalError ? err : new SupplierPortalError('Something went wrong. Please try again.', 'server', 0);
      if (e.kind === 'link') {
        onLinkError(e);
        return;
      }
      if (e.kind === 'validation') {
        const mapped: Record<string, string> = {};
        for (const [path, msg] of Object.entries(e.fieldErrors)) mapped[errorKeyFor(path, built.order)] ??= msg;
        setErrors(mapped);
        setFormError(e.message);
        setStep('edit');
      } else if (e.kind === 'conflict') {
        setFormError(e.message);
        onStale(e.message);
      } else {
        // Network / server / rate limit: stay on the review, same retry key.
        setFormError(e.message);
      }
      scrollToTop();
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  const nothingAvailable = order.every((l) => isRequested(l) && l.availability === 'unavailable');

  if (step === 'review') {
    return (
      <div ref={topRef} className="scroll-mt-4 space-y-4">
        <Section title="Check your quotation" description="Nothing has been sent yet. Check the figures, then send.">
          {formError && <Notice tone="error" className="mb-3">{formError}</Notice>}
          {withdrawsApproval && (
            <Notice tone="warning" className="mb-3" title="This replaces your approved quotation">
              Mountain Bakes already approved your earlier quotation. Sending this one withdraws that approval and they review again.
            </Notice>
          )}
          <ul className="divide-y rounded-xl border text-sm">
            {order.map((l) => {
              const total = previewLineTotal(l) ?? 0;
              const unavailable = isRequested(l) && l.availability === 'unavailable';
              return (
                <li key={l.key} className="space-y-0.5 px-3 py-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 font-medium">{l.itemName}</p>
                    <p className="shrink-0 font-semibold tabular-nums">{rs(total)}</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {isRequested(l)
                      ? AVAILABILITY_LABEL[l.availability]
                      : l.substituteFor
                        ? `Substitute for ${requestedName.get(l.substituteFor) ?? 'a requested item'}`
                        : 'Extra item'}
                    {!unavailable && ` · ${fmtQty(Number(l.qty.replace(/,/g, '')))} ${l.unit} × ${rs(Number(l.rate.replace(/,/g, '')))}`}
                  </p>
                  {l.note.trim() && <p className="text-xs text-muted-foreground">Note: {l.note.trim()}</p>}
                </li>
              );
            })}
          </ul>
          <div className="mt-3 text-sm">
            <TotalRow label="Items" value={rs(totals.subtotal)} />
            <TotalRow label="Delivery charge" value={rs(totals.delivery)} />
            <TotalRow label="Total (estimate)" value={rs(totals.total)} strong />
            <p className="mt-1 text-xs text-muted-foreground">Mountain Bakes&apos; system confirms the final total when you send.</p>
          </div>
          {(state.estimatedDeliveryDate || state.deliveryNotes.trim() || state.notes.trim()) && (
            <div className="mt-3 space-y-1 text-sm text-muted-foreground">
              {state.estimatedDeliveryDate && <p>Delivery expected: {day(state.estimatedDeliveryDate)}</p>}
              {state.deliveryNotes.trim() && <p>Delivery: {state.deliveryNotes.trim()}</p>}
              {state.notes.trim() && <p>Notes: {state.notes.trim()}</p>}
            </div>
          )}
          {nothingAvailable && (
            <Notice tone="info" className="mt-3">
              You are telling Mountain Bakes that nothing on this request is available.
            </Notice>
          )}
        </Section>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="outline" className="h-12 text-base" onClick={() => setStep('edit')} disabled={submitting}>
            <ArrowLeft className="size-4" /> Change something
          </Button>
          <Button className="h-12 text-base" onClick={() => void submit()} disabled={submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            {submitting ? 'Sending…' : 'Send quotation'}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div ref={topRef} className="scroll-mt-4 space-y-4">
      {formError && <Notice tone="error">{formError}</Notice>}
      {errors['form'] && <Notice tone="error">{errors['form']}</Notice>}
      {withdrawsApproval && (
        <Notice tone="warning" title="Revising an approved quotation">
          Mountain Bakes already approved your quotation. A new version withdraws that approval until they review it again.
        </Notice>
      )}

      <Section
        title={view.latestQuotation ? `Update your quotation (version ${view.latestQuotation.version + 1})` : 'Your quotation'}
        description="For each item, say whether you have it, how much, and your rate per unit."
      >
        <div className="space-y-3">
          {state.requested.map((line) => {
            const subs = state.added.filter((a) => a.substituteFor === line.demandItemId);
            const choice: Choice = line.availability === 'unavailable' && subs.length > 0 ? 'substitute' : line.availability;
            const unavailable = line.availability === 'unavailable';
            const total = previewLineTotal(line);
            return (
              <div key={line.key} className="rounded-xl border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium">{line.itemName}</p>
                    <p className="text-xs text-muted-foreground">
                      Requested {fmtQty(line.requestedQty)} {line.unit}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold tabular-nums">{total === null ? '—' : rs(total)}</p>
                </div>

                <div role="radiogroup" aria-label={`${line.itemName} availability`} className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {CHOICES.map((c) => (
                    <button
                      key={c.value}
                      type="button"
                      role="radio"
                      aria-checked={choice === c.value}
                      onClick={() => choose(line, c.value)}
                      className={cn(
                        'h-10 rounded-lg border px-2 text-sm font-medium transition-colors',
                        choice === c.value
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input bg-background hover:bg-muted',
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>

                {unavailable ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {choice === 'substitute'
                      ? 'Removed from your quotation (quantity 0). Fill in the substitute below.'
                      : 'Removed from your quotation (quantity 0).'}
                  </p>
                ) : (
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <FigureInput
                      id={`${line.key}-qty`}
                      label="Quantity available"
                      suffix={line.unit}
                      value={line.qty}
                      onChange={(v) => changeQty(line, v)}
                      error={errors[`${line.key}.qty`]}
                    />
                    <FigureInput
                      id={`${line.key}-rate`}
                      label="Rate per unit"
                      suffix="Rs."
                      value={line.rate}
                      onChange={(v) => setRequested(line.key, { rate: v }, [`${line.key}.rate`])}
                      error={errors[`${line.key}.rate`]}
                    />
                  </div>
                )}

                <div className="mt-3 space-y-1">
                  <Label htmlFor={`${line.key}-note`} className="text-xs text-muted-foreground">
                    Note (optional)
                  </Label>
                  <Input
                    id={`${line.key}-note`}
                    value={line.note}
                    maxLength={300}
                    onChange={(e) => setRequested(line.key, { note: e.target.value })}
                    placeholder="Brand, pack size, quality…"
                    className="h-11 text-base"
                  />
                  <FieldError message={errors[`${line.key}.note`]} />
                </div>

                {subs.map((a) => (
                  <AddedLineCard
                    key={a.key}
                    line={a}
                    errors={errors}
                    title={`Substitute for ${line.itemName}`}
                    onChange={(patch, clear) => setAdded(a.key, patch, clear)}
                    onRemove={() => removeAdded(a.key)}
                  />
                ))}
              </div>
            );
          })}

          {state.added
            .filter((a) => !a.substituteFor)
            .map((a) => (
              <AddedLineCard
                key={a.key}
                line={a}
                errors={errors}
                title="Extra item"
                onChange={(patch, clear) => setAdded(a.key, patch, clear)}
                onRemove={() => removeAdded(a.key)}
              />
            ))}

          <Button variant="outline" className="h-11 w-full" onClick={() => addLine(null)}>
            <Plus className="size-4" /> Add an extra item
          </Button>
        </div>
      </Section>

      <Section title="Delivery">
        <div className="grid gap-3 sm:grid-cols-2">
          <FigureInput
            id="q-delivery-charge"
            label="Delivery charge"
            suffix="Rs., 0 if free"
            value={state.deliveryCharge}
            onChange={(v) => update((s) => ({ ...s, deliveryCharge: v }), ['deliveryCharge'])}
            error={errors['deliveryCharge']}
            placeholder="0"
          />
          <div className="space-y-1">
            <Label htmlFor="q-delivery-date" className="text-xs text-muted-foreground">
              Expected delivery date
            </Label>
            <Input
              id="q-delivery-date"
              type="date"
              min={todayIso()}
              value={state.estimatedDeliveryDate}
              onChange={(e) => update((s) => ({ ...s, estimatedDeliveryDate: e.target.value }), ['estimatedDeliveryDate'])}
              aria-invalid={errors['estimatedDeliveryDate'] ? true : undefined}
              className="h-11 text-base"
            />
            <FieldError message={errors['estimatedDeliveryDate']} />
          </div>
        </div>
        <div className="mt-3 space-y-1">
          <Label htmlFor="q-delivery-notes" className="text-xs text-muted-foreground">
            Delivery notes (optional)
          </Label>
          <Textarea
            id="q-delivery-notes"
            rows={2}
            maxLength={500}
            value={state.deliveryNotes}
            onChange={(e) => update((s) => ({ ...s, deliveryNotes: e.target.value }), ['deliveryNotes'])}
            placeholder="Delivery time, who delivers…"
            className="text-base"
          />
          <FieldError message={errors['deliveryNotes']} />
        </div>
        <div className="mt-3 space-y-1">
          <Label htmlFor="q-notes" className="text-xs text-muted-foreground">
            Other notes for Mountain Bakes (optional)
          </Label>
          <Textarea
            id="q-notes"
            rows={2}
            maxLength={1000}
            value={state.notes}
            onChange={(e) => update((s) => ({ ...s, notes: e.target.value }), ['notes'])}
            className="text-base"
          />
          <FieldError message={errors['notes']} />
        </div>
      </Section>

      <Section title="Estimated total">
        <div className="text-sm">
          <TotalRow label="Items" value={rs(totals.subtotal)} />
          <TotalRow label="Delivery charge" value={rs(totals.delivery)} />
          <TotalRow label="Total" value={rs(totals.total)} strong />
        </div>
      </Section>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button variant="outline" className="h-12 text-base" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button className="h-12 text-base" onClick={review}>
          Review quotation
        </Button>
      </div>
    </div>
  );
}

function AddedLineCard({
  line,
  title,
  errors,
  onChange,
  onRemove,
}: {
  line: AddedLine;
  title: string;
  errors: Record<string, string>;
  onChange: (patch: Partial<AddedLine>, clear?: string[]) => void;
  onRemove: () => void;
}) {
  const total = previewLineTotal(line);
  return (
    <div className="mt-3 rounded-xl border border-dashed border-primary/40 bg-primary/5 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{title}</p>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold tabular-nums">{total === null ? '—' : rs(total)}</span>
          <Button variant="ghost" size="icon" aria-label={`Remove ${title.toLowerCase()}`} onClick={onRemove}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>
      <div className="mt-2 grid grid-cols-[1fr_7rem] gap-3">
        <div className="space-y-1">
          <Label htmlFor={`${line.key}-name`} className="text-xs text-muted-foreground">
            Item name
          </Label>
          <Input
            id={`${line.key}-name`}
            value={line.itemName}
            maxLength={120}
            onChange={(e) => onChange({ itemName: e.target.value }, [`${line.key}.itemName`])}
            aria-invalid={errors[`${line.key}.itemName`] ? true : undefined}
            className="h-11 text-base"
          />
          <FieldError message={errors[`${line.key}.itemName`]} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${line.key}-unit`} className="text-xs text-muted-foreground">
            Unit
          </Label>
          <NativeSelect
            id={`${line.key}-unit`}
            value={line.unit}
            onChange={(v) => onChange({ unit: isUnit(v) ? v : '' }, [`${line.key}.unit`])}
            options={UNIT_OPTIONS}
            invalid={!!errors[`${line.key}.unit`]}
          />
          <FieldError message={errors[`${line.key}.unit`]} />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <FigureInput
          id={`${line.key}-qty`}
          label="Quantity"
          suffix={line.unit || undefined}
          value={line.qty}
          onChange={(v) => onChange({ qty: v }, [`${line.key}.qty`])}
          error={errors[`${line.key}.qty`]}
        />
        <FigureInput
          id={`${line.key}-rate`}
          label="Rate per unit"
          suffix="Rs."
          value={line.rate}
          onChange={(v) => onChange({ rate: v }, [`${line.key}.rate`])}
          error={errors[`${line.key}.rate`]}
        />
      </div>
      <div className="mt-3 space-y-1">
        <Label htmlFor={`${line.key}-note`} className="text-xs text-muted-foreground">
          Note (optional)
        </Label>
        <Input
          id={`${line.key}-note`}
          value={line.note}
          maxLength={300}
          onChange={(e) => onChange({ note: e.target.value })}
          className="h-11 text-base"
        />
        <FieldError message={errors[`${line.key}.note`]} />
      </div>
    </div>
  );
}
