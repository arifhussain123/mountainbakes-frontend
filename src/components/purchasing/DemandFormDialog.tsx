'use client';

import { useMemo, useRef, useState } from 'react';
import {
  DemandInputSchema,
  PURCHASE_PAYMENT_PREFERENCES,
  PURCHASE_PAYMENT_PREFERENCE_LABEL,
  PURCHASE_UNITS,
  businessDateStr,
  type PurchaseDemand,
  type PurchaseDemandDetail,
  type PurchaseItem,
  type PurchasePaymentPreference,
  type PurchasePriority,
  type PurchaseUnit,
  type Supplier,
  type VerificationResult,
  type WhatsAppConnectionStatus,
} from '@mb/shared';
import { AlertTriangle, CheckCircle2, Plus, Send, ShieldCheck, Trash2, UserPlus, XCircle } from 'lucide-react';
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
import {
  useCreateDemand,
  usePurchaseItems,
  useSendDemand,
  useSupplierBalance,
  useUpdateDemand,
  useVerifyDemand,
} from '@/lib/purchasing';
import { formatDateTime } from '@/utils/date';
import { cn } from '@/lib/utils';
import {
  SubmissionKey,
  canSendVerified,
  decimalInput,
  failedErrors,
  failedWarnings,
  formatQty,
  issuesByPath,
  newRequestId,
  parseNumber,
} from './purchasing-model';
import { ConfirmDialog, Field, errorMessage, money } from './parts';
import { RegisterSupplierForm, SupplierPicker } from './SupplierPicker';

/**
 * New Demand / Edit Demand — draft, verify and send in one dialog.
 *
 * THE THREE BUTTONS ARE THREE SERVER STEPS, in order:
 *
 *   Save Draft  POST /demands (first time) or PUT /demands/:id (after). The
 *               server bumps `revision` on every save, and a save after Verify
 *               un-verifies — so the dialog keeps the revision it last saved.
 *   Verify      saves first if anything changed, then POST /verify with that
 *               revision. Errors block; warnings are shown and do not.
 *   Send        only once Verify passed for the revision now saved and nothing
 *               has been typed since. POST /send with an Idempotency-Key, so a
 *               press whose answer is lost cannot message the supplier twice.
 *
 * The client-side zod parse (the server's own DemandInputSchema) gives a field
 * its message before the round trip; the server re-checks everything.
 *
 * `clientRequestId` is minted once per opening. A create that is retried —
 * double click, lost response — comes back as the FIRST demand (`replayed`)
 * rather than a second one; if the form changed in between, the replayed
 * draft is brought up to date with a PUT straight after.
 */

interface ItemRow {
  rowId: string;
  itemId: string | null;
  itemName: string;
  qty: string;
  unit: PurchaseUnit | '';
  note: string;
}

interface FormState {
  supplier: Supplier | null;
  priority: PurchasePriority;
  requiredDate: string;
  notes: string;
  deliveryInstructions: string;
  paymentPreference: PurchasePaymentPreference;
  creditReference: string;
  creditAmount: string;
  creditTerms: string;
  creditDueDate: string;
  creditNotes: string;
  items: ItemRow[];
}

const emptyRow = (): ItemRow => ({ rowId: newRequestId('row'), itemId: null, itemName: '', qty: '', unit: '', note: '' });

function blankForm(): FormState {
  return {
    supplier: null,
    priority: 'normal',
    requiredDate: businessDateStr(),
    notes: '',
    deliveryInstructions: '',
    paymentPreference: 'cash',
    creditReference: '',
    creditAmount: '',
    creditTerms: '',
    creditDueDate: '',
    creditNotes: '',
    items: [emptyRow()],
  };
}

function formFromDemand(d: PurchaseDemandDetail): FormState {
  return {
    supplier: d.supplier,
    priority: d.priority,
    requiredDate: d.requiredDate,
    notes: d.notes ?? '',
    deliveryInstructions: d.deliveryInstructions ?? '',
    paymentPreference: d.paymentPreference,
    creditReference: d.creditReference ?? '',
    creditAmount: d.creditAmountRequested == null ? '' : String(d.creditAmountRequested),
    creditTerms: d.creditTerms ?? '',
    creditDueDate: d.creditDueDate ?? '',
    creditNotes: d.creditNotes ?? '',
    items: [...d.items]
      .sort((a, b) => a.lineNo - b.lineNo)
      .map((i) => ({
        rowId: i.id,
        itemId: i.itemId,
        itemName: i.itemName,
        qty: String(i.requestedQty),
        unit: (PURCHASE_UNITS as readonly string[]).includes(i.unit) ? (i.unit as PurchaseUnit) : '',
        note: i.note ?? '',
      })),
  };
}

const orNull = (s: string) => (s.trim() ? s.trim() : null);

/** The request body, before validation. Credit fields only travel with the credit preference. */
function bodyOf(f: FormState) {
  const credit = f.paymentPreference === 'credit';
  return {
    supplierId: f.supplier?.id ?? '',
    priority: f.priority,
    requiredDate: f.requiredDate,
    notes: orNull(f.notes),
    deliveryInstructions: orNull(f.deliveryInstructions),
    paymentPreference: f.paymentPreference,
    creditReference: credit ? orNull(f.creditReference) : null,
    creditAmountRequested: credit ? (f.creditAmount.trim() ? parseNumber(f.creditAmount) : null) : null,
    creditTerms: credit ? orNull(f.creditTerms) : null,
    creditDueDate: credit ? orNull(f.creditDueDate) : null,
    creditNotes: credit ? orNull(f.creditNotes) : null,
    items: f.items.map((r) => ({
      itemId: r.itemId,
      itemName: r.itemName,
      requestedQty: parseNumber(r.qty),
      unit: r.unit,
      note: orNull(r.note),
    })),
  };
}

export function DemandFormDialog({
  open,
  onOpenChange,
  token,
  existing,
  connection,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  /** Edit an existing draft. Omit for a new demand. */
  existing?: PurchaseDemandDetail | null;
  connection?: WhatsAppConnectionStatus;
  /** After a successful send — the page opens the demand. */
  onSent?: (demand: PurchaseDemand) => void;
}) {
  const itemsQ = usePurchaseItems(token);
  const createMut = useCreateDemand(token);
  const updateMut = useUpdateDemand(token);
  const verifyMut = useVerifyDemand(token);
  const sendMut = useSendDemand(token);

  const [form, setForm] = useState<FormState>(blankForm);
  const [attempted, setAttempted] = useState(false);
  const [registering, setRegistering] = useState(false);
  /** The demand as the server last returned it — its id and current revision. */
  const [saved, setSaved] = useState<PurchaseDemand | null>(null);
  /** The body that save sent, to tell whether anything has been typed since. */
  const [savedBody, setSavedBody] = useState<string | null>(null);
  const [verify, setVerify] = useState<{ result: VerificationResult | null; revision: number; ok: boolean; at: string | null; by: string | null } | null>(null);
  const [confirmSend, setConfirmSend] = useState(false);

  const [clientRequestId, setClientRequestId] = useState('');
  const createKey = useRef(new SubmissionKey('demand'));
  const sendKey = useRef(new SubmissionKey('send'));

  // Reset on every opening — render-time adjustment, as ReturnItemsModal does,
  // so a previous demand never flashes for a frame.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const initial = existing ? formFromDemand(existing) : blankForm();
      setForm(initial);
      setAttempted(false);
      setRegistering(false);
      setSaved(existing ?? null);
      setSavedBody(existing ? JSON.stringify(bodyOf(initial)) : null);
      setVerify(
        existing && existing.status === 'verified' && existing.verifiedRevision === existing.revision
          ? { result: null, revision: existing.revision, ok: true, at: existing.verifiedAt, by: existing.verifiedByName }
          : null,
      );
      setConfirmSend(false);
      // A new request id makes a new body, and with it a new Idempotency-Key.
      setClientRequestId(newRequestId('dem'));
    }
  }

  const balanceQ = useSupplierBalance(token, form.paymentPreference === 'credit' ? form.supplier?.id ?? null : null);

  const body = useMemo(() => bodyOf(form), [form]);
  const bodyJson = JSON.stringify(body);
  const dirty = savedBody !== bodyJson;
  const parsed = DemandInputSchema.safeParse(body);
  const errors = parsed.success ? {} : issuesByPath(parsed.error.issues);
  const err = (k: string) => (attempted ? errors[k] : undefined);

  const busy = createMut.isPending || updateMut.isPending || verifyMut.isPending || sendMut.isPending;
  const sendable = canSendVerified({
    verifiedOk: verify?.ok ?? false,
    verifiedRevision: verify?.revision ?? null,
    savedRevision: saved?.revision ?? null,
    dirty,
  });

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setForm((p) => ({ ...p, [k]: v }));
  const setRow = (rowId: string, patch: Partial<ItemRow>) =>
    setForm((p) => ({ ...p, items: p.items.map((r) => (r.rowId === rowId ? { ...r, ...patch } : r)) }));

  /** Save the form as it stands. Returns the saved demand, or null when it could not be. */
  async function save(): Promise<PurchaseDemand | null> {
    setAttempted(true);
    if (!parsed.success) {
      toast.error('Check the highlighted fields.');
      return null;
    }
    const input = parsed.data;
    try {
      let d: PurchaseDemand;
      if (!saved) {
        const full = { ...input, clientRequestId };
        const created = await createMut.mutateAsync({ body: full, key: createKey.current.keyFor(JSON.stringify(full)) });
        d = created;
        // A replay hands back the draft as it was first saved; bring it up to date.
        if (created.replayed && (created.status === 'draft' || created.status === 'verified')) {
          d = await updateMut.mutateAsync({ id: created.id, body: { ...input, revision: created.revision } });
        }
      } else {
        d = await updateMut.mutateAsync({ id: saved.id, body: { ...input, revision: saved.revision } });
      }
      setSaved(d);
      setSavedBody(bodyJson);
      // Any save un-verifies on the server; mirror it.
      setVerify(null);
      return d;
    } catch (e) {
      toast.error(errorMessage(e, 'Could not save the demand'));
      return null;
    }
  }

  async function saveDraft() {
    const d = await save();
    if (d) toast.success(`Saved draft ${d.demandNo}`);
  }

  async function runVerify() {
    const d = !saved || dirty ? await save() : saved;
    if (!d) return;
    try {
      const r = await verifyMut.mutateAsync({ id: d.id, revision: d.revision });
      setSaved(r.demand);
      setVerify({ result: r, revision: r.demand.revision, ok: r.ok, at: r.demand.verifiedAt, by: r.demand.verifiedByName });
      if (r.ok) toast.success(failedWarnings(r.checks).length ? 'Verified, with warnings — read them before sending' : 'Verified — ready to send');
      else toast.error('Verification failed — fix the checks marked in red');
    } catch (e) {
      toast.error(errorMessage(e, 'Could not verify the demand'));
    }
  }

  async function send() {
    if (!saved || !sendable) return;
    try {
      const d = await sendMut.mutateAsync({ id: saved.id, revision: saved.revision, key: sendKey.current.keyFor(`${saved.id}:${saved.revision}`) });
      sendKey.current.reset();
      setConfirmSend(false);
      toast.success(`${d.demandNo} queued for ${d.supplierName} on WhatsApp`);
      onOpenChange(false);
      onSent?.(d);
    } catch (e) {
      setConfirmSend(false);
      toast.error(errorMessage(e, 'Could not send the demand'));
    }
  }

  const catalog = itemsQ.data ?? [];
  const balance = balanceQ.data;

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
        <DialogContent mobile="fullscreen" className="md:max-w-3xl">
          <DialogHeader>
            <DialogTitle>{saved ? `${existing ? 'Edit' : 'New'} demand · ${saved.demandNo}` : 'New purchase demand'}</DialogTitle>
            <DialogDescription>
              Save it as a draft, verify it, then send it to the supplier on WhatsApp. They quote from a private link; nothing is ordered until you approve a quotation.
            </DialogDescription>
          </DialogHeader>

          <form
            className="space-y-5"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void saveDraft();
            }}
          >
            {/* ── Supplier ── */}
            <div className="space-y-2">
              <Field label="Supplier" htmlFor="demand-supplier" error={err('supplierId')}>
                <SupplierPicker
                  token={token}
                  id="demand-supplier"
                  value={form.supplier}
                  onChange={(s) => set('supplier', s)}
                  invalid={!!err('supplierId')}
                />
              </Field>
              {form.supplier && !form.supplier.whatsappOptInAt && (
                <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  No WhatsApp consent is recorded for this supplier, so Verify will refuse to send to them.
                </p>
              )}
              {registering ? (
                <RegisterSupplierForm
                  token={token}
                  onCancel={() => setRegistering(false)}
                  onCreated={(s) => {
                    set('supplier', s);
                    setRegistering(false);
                  }}
                />
              ) : (
                <Button type="button" variant="ghost" size="sm" onClick={() => setRegistering(true)}>
                  <UserPlus className="mr-1.5 h-4 w-4" /> Register a new supplier
                </Button>
              )}
            </div>

            {/* ── When and how urgent ── */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Required date" htmlFor="demand-date" error={err('requiredDate')}>
                <Input
                  id="demand-date"
                  type="date"
                  value={form.requiredDate}
                  min={businessDateStr()}
                  onChange={(e) => set('requiredDate', e.target.value)}
                  className="h-10"
                  aria-invalid={!!err('requiredDate')}
                />
              </Field>
              <div className="space-y-1.5">
                <p className="text-sm font-medium" id="demand-priority">Priority</p>
                <div className="flex gap-2" role="radiogroup" aria-labelledby="demand-priority">
                  {(['urgent', 'normal'] as const).map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={form.priority === p}
                      onClick={() => set('priority', p)}
                      className={cn(
                        'h-10 flex-1 rounded-lg border text-sm font-semibold transition-colors',
                        form.priority === p
                          ? p === 'urgent'
                            ? 'border-red-600 bg-red-600 text-white'
                            : 'border-foreground bg-foreground text-background'
                          : 'bg-card hover:bg-muted',
                      )}
                    >
                      {p === 'urgent' ? 'Urgent' : 'Normal'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Items ── */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Items</p>
                {err('items') && <p className="text-xs text-destructive">{err('items')}</p>}
              </div>
              <div className="space-y-3">
                {form.items.map((r, idx) => (
                  <div key={r.rowId} className="grid grid-cols-2 gap-2 rounded-lg border p-2.5 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_auto]">
                    <div className="col-span-2 sm:col-span-1">
                      <ItemNameField
                        id={`item-name-${r.rowId}`}
                        value={r.itemName}
                        itemId={r.itemId}
                        catalog={catalog}
                        invalid={!!err(`items.${idx}.itemName`)}
                        onText={(text) => setRow(r.rowId, { itemName: text, itemId: null })}
                        onPick={(item) => setRow(r.rowId, { itemName: item.name, itemId: item.id, unit: item.unit })}
                      />
                      {err(`items.${idx}.itemName`) && <p className="mt-1 text-xs text-destructive">{err(`items.${idx}.itemName`)}</p>}
                    </div>
                    <div>
                      <Input
                        aria-label={`Quantity for item ${idx + 1}`}
                        inputMode="decimal"
                        placeholder="Qty"
                        value={r.qty}
                        onChange={(e) => setRow(r.rowId, { qty: decimalInput(e.target.value) })}
                        className="h-10"
                        aria-invalid={!!err(`items.${idx}.requestedQty`)}
                      />
                      {err(`items.${idx}.requestedQty`) && <p className="mt-1 text-xs text-destructive">{err(`items.${idx}.requestedQty`)}</p>}
                    </div>
                    <div>
                      <Select value={r.unit || null} onValueChange={(v) => setRow(r.rowId, { unit: ((v as string) ?? '') as PurchaseUnit | '' })}>
                        <SelectTrigger className="h-10 w-full" aria-label={`Unit for item ${idx + 1}`} aria-invalid={!!err(`items.${idx}.unit`)}>
                          <SelectValue placeholder="Unit" />
                        </SelectTrigger>
                        <SelectContent>
                          {PURCHASE_UNITS.map((u) => (
                            <SelectItem key={u} value={u}>{u}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {err(`items.${idx}.unit`) && <p className="mt-1 text-xs text-destructive">{err(`items.${idx}.unit`)}</p>}
                    </div>
                    <div className="col-span-2 flex items-start justify-end sm:col-span-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove item ${idx + 1}`}
                        disabled={form.items.length === 1}
                        onClick={() => setForm((p) => ({ ...p, items: p.items.filter((x) => x.rowId !== r.rowId) }))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <Input
                      aria-label={`Note for item ${idx + 1}`}
                      placeholder="Note for the supplier (optional) — brand, grade, packing"
                      value={r.note}
                      maxLength={300}
                      onChange={(e) => setRow(r.rowId, { note: e.target.value })}
                      className="col-span-2 h-9 sm:col-span-4"
                    />
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={form.items.length >= 100}
                onClick={() => setForm((p) => ({ ...p, items: [...p.items, emptyRow()] }))}
              >
                <Plus className="mr-1.5 h-4 w-4" /> Add item
              </Button>
            </div>

            {/* ── Notes ── */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Notes for the supplier (optional)" htmlFor="demand-notes" error={err('notes')}>
                <Textarea id="demand-notes" rows={2} maxLength={1000} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
              </Field>
              <Field label="Delivery instructions (optional)" htmlFor="demand-delivery" error={err('deliveryInstructions')}>
                <Textarea
                  id="demand-delivery"
                  rows={2}
                  maxLength={1000}
                  value={form.deliveryInstructions}
                  onChange={(e) => set('deliveryInstructions', e.target.value)}
                  placeholder="Gate, timing, who receives"
                />
              </Field>
            </div>

            {/* ── Payment preference ── */}
            <div className="space-y-2">
              <p className="text-sm font-medium" id="demand-payment">Payment preference</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-labelledby="demand-payment">
                {PURCHASE_PAYMENT_PREFERENCES.map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="radio"
                    aria-checked={form.paymentPreference === p}
                    onClick={() => set('paymentPreference', p)}
                    className={cn(
                      'h-10 rounded-lg border text-sm font-medium transition-colors',
                      form.paymentPreference === p ? 'border-foreground bg-foreground text-background' : 'bg-card hover:bg-muted',
                    )}
                  >
                    {PURCHASE_PAYMENT_PREFERENCE_LABEL[p]}
                  </button>
                ))}
              </div>
              {form.paymentPreference === 'credit' && (
                <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                  <div className="text-sm">
                    {!form.supplier ? (
                      <span className="text-muted-foreground">Choose the supplier to see what is already owed to them.</span>
                    ) : balanceQ.isLoading ? (
                      <span className="text-muted-foreground">Loading {form.supplier.name}&apos;s balance…</span>
                    ) : balance ? (
                      <span>
                        Already with {form.supplier.name}: <strong>{money(balance.outstanding)}</strong> outstanding on bills,{' '}
                        <strong>{money(balance.creditOutstanding)}</strong> on credit
                        {balance.pendingPayments > 0 ? `, ${money(balance.pendingPayments)} in payments waiting for Finance` : ''}.
                      </span>
                    ) : (
                      <span className="text-muted-foreground">Nothing outstanding with {form.supplier.name}.</span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Credit amount requested" htmlFor="credit-amount" error={err('creditAmountRequested')}>
                      <Input
                        id="credit-amount"
                        inputMode="decimal"
                        value={form.creditAmount}
                        onChange={(e) => set('creditAmount', decimalInput(e.target.value))}
                        placeholder="Rs."
                        className="h-10"
                        aria-invalid={!!err('creditAmountRequested')}
                      />
                    </Field>
                    <Field label="Due date (optional)" htmlFor="credit-due" error={err('creditDueDate')}>
                      <Input id="credit-due" type="date" value={form.creditDueDate} onChange={(e) => set('creditDueDate', e.target.value)} className="h-10" />
                    </Field>
                    <Field label="Reference (optional)" htmlFor="credit-ref" error={err('creditReference')}>
                      <Input id="credit-ref" value={form.creditReference} maxLength={100} onChange={(e) => set('creditReference', e.target.value)} className="h-10" />
                    </Field>
                    <Field label="Terms (optional)" htmlFor="credit-terms" error={err('creditTerms')}>
                      <Input id="credit-terms" value={form.creditTerms} maxLength={300} onChange={(e) => set('creditTerms', e.target.value)} placeholder="e.g. 30 days" className="h-10" />
                    </Field>
                    <Field label="Credit notes (optional)" htmlFor="credit-notes" className="sm:col-span-2" error={err('creditNotes')}>
                      <Textarea id="credit-notes" rows={2} maxLength={500} value={form.creditNotes} onChange={(e) => set('creditNotes', e.target.value)} />
                    </Field>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    This records what you are asking the supplier for. The credit itself is requested on the demand once the bill is approved, and Finance approves it.
                  </p>
                </div>
              )}
            </div>

            {/* ── Verification ── */}
            {verify && <VerificationPanel verify={verify} stale={dirty || verify.revision !== saved?.revision} />}
          </form>

          <DialogFooter className="gap-2 sm:flex-wrap">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Close
            </Button>
            <Button variant="outline" onClick={() => void saveDraft()} disabled={busy || (!!saved && !dirty)}>
              {createMut.isPending || updateMut.isPending ? 'Saving…' : saved && !dirty ? 'Saved' : 'Save Draft'}
            </Button>
            <Button variant="secondary" onClick={() => void runVerify()} disabled={busy}>
              <ShieldCheck className="mr-1.5 h-4 w-4" />
              {verifyMut.isPending ? 'Verifying…' : 'Verify'}
            </Button>
            <Button onClick={() => setConfirmSend(true)} disabled={busy || !sendable} title={sendable ? undefined : 'Verify the saved demand first'}>
              <Send className="mr-1.5 h-4 w-4" />
              Send Demand
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmSend}
        onOpenChange={setConfirmSend}
        title={`Send ${saved?.demandNo ?? 'this demand'}?`}
        description={
          connection?.state === 'mock'
            ? `Test mode: the message to ${saved?.supplierName ?? 'the supplier'} is recorded but NOT delivered. The demand will still move to Awaiting supplier.`
            : `${saved?.supplierName ?? 'The supplier'} gets a WhatsApp message with a private link to quote. The demand can no longer be edited once it is sent.`
        }
        confirmLabel="Send on WhatsApp"
        pending={sendMut.isPending}
        onConfirm={() => void send()}
      />
    </>
  );
}

/** The checks Verify ran, errors first. A stale result says so instead of pretending to still apply. */
function VerificationPanel({
  verify,
  stale,
}: {
  verify: { result: VerificationResult | null; ok: boolean; at: string | null; by: string | null };
  stale: boolean;
}) {
  const checks = verify.result?.checks ?? [];
  const errors = failedErrors(checks);
  const warnings = failedWarnings(checks);
  return (
    <div
      className={cn(
        'space-y-2 rounded-lg border p-3',
        stale ? 'opacity-70' : verify.ok ? 'border-emerald-300 dark:border-emerald-800' : 'border-destructive/50',
      )}
    >
      <p className="flex items-center gap-2 text-sm font-semibold">
        {verify.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden /> : <XCircle className="h-4 w-4 text-destructive" aria-hidden />}
        {verify.ok ? 'Verified' : 'Not verified'}
        {verify.ok && verify.at && (
          <span className="text-xs font-normal text-muted-foreground">
            {formatDateTime(verify.at)}
            {verify.by ? ` · ${verify.by}` : ''}
          </span>
        )}
      </p>
      {stale && <p className="text-xs text-amber-700 dark:text-amber-400">The form changed after this check. Save and verify again before sending.</p>}
      {checks.length > 0 && (
        <ul className="space-y-1 text-sm">
          {[...errors, ...warnings, ...checks.filter((c) => c.ok)].map((c) => (
            <li key={c.key} className="flex items-start gap-2">
              {c.ok ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
              ) : c.severity === 'error' ? (
                <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
              ) : (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden />
              )}
              <span>
                <span className={cn(!c.ok && c.severity === 'error' && 'font-medium text-destructive')}>{c.label}</span>
                {c.message && <span className="block text-xs text-muted-foreground">{c.message}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * The item name, from the ingredient catalog or typed freely.
 *
 * A text box with suggestions rather than a Combobox, because free text is a
 * first-class answer here — a supplier is often asked for something the
 * catalog has never held. Picking a suggestion links the line to the catalog
 * item (and its unit), which is what lets the goods receipt later book the
 * stock without asking; typing over it unlinks it again.
 */
function ItemNameField({
  id,
  value,
  itemId,
  catalog,
  invalid,
  onText,
  onPick,
}: {
  id: string;
  value: string;
  itemId: string | null;
  catalog: PurchaseItem[];
  invalid?: boolean;
  onText: (text: string) => void;
  onPick: (item: PurchaseItem) => void;
}) {
  const [focused, setFocused] = useState(false);
  const q = value.trim().toLowerCase();
  const suggestions = focused && q && !itemId
    ? catalog.filter((c) => c.name.toLowerCase().includes(q) || c.itemCode.toLowerCase().includes(q)).slice(0, 6)
    : [];
  return (
    <div className="relative">
      <Input
        id={id}
        aria-label="Item"
        placeholder="Item — search the catalog or type a name"
        value={value}
        maxLength={120}
        autoComplete="off"
        onChange={(e) => onText(e.target.value)}
        onFocus={() => setFocused(true)}
        // Delayed so a tap on a suggestion lands before the list disappears.
        onBlur={() => window.setTimeout(() => setFocused(false), 150)}
        className="h-10 pr-20"
        aria-invalid={invalid}
      />
      <span className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-[10px] font-medium uppercase text-muted-foreground">
        {itemId ? 'Catalog' : value.trim() ? 'Free text' : ''}
      </span>
      {suggestions.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border bg-popover shadow-md" role="listbox">
          {suggestions.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={false}
                className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left text-sm hover:bg-accent"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(c);
                  setFocused(false);
                }}
              >
                <span className="truncate">{c.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {c.itemCode} · {formatQty(c.balance)} {c.unit} in stock
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
