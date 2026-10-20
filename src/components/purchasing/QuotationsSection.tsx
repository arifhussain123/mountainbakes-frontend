'use client';

import { useMemo, useRef, useState } from 'react';
import {
  PURCHASE_UNITS,
  QuotationInputSchema,
  type PurchaseDemandDetail,
  type PurchaseUnit,
  type Quotation,
  type QuotationAvailability,
} from '@mb/shared';
import { Check as CheckIcon, MessageSquareWarning, PenLine, Plus, Trash2, X } from 'lucide-react';
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
import { useDecideQuotation, useEnterQuotation } from '@/lib/purchasing';
import { formatDate, formatDateTime } from '@/utils/date';
import { cn } from '@/lib/utils';
import {
  AVAILABILITY_LABEL,
  AVAILABILITY_TONE,
  QUOTATION_STATUS_LABEL,
  QUOTATION_STATUS_TONE,
  SubmissionKey,
  decimalInput,
  formatQty,
  issuesByPath,
  newRequestId,
  parseNumber,
  quotationComparison,
  quotationPreviewTotal,
  versionComparison,
} from './purchasing-model';
import { ConfirmDialog, Field, Pill, ReasonDialog, Section, errorMessage, money } from './parts';

/**
 * Quotations on a demand: every version the supplier (or staff on their
 * behalf) submitted, each laid against what was asked for, a side-by-side of
 * the versions when there is more than one, and the decision on the current
 * one.
 *
 * Only the CURRENT quotation can be decided, and only while the server says so
 * (`actions.decideQuotation`). The decision carries the version it was taken
 * on: if the supplier resubmitted while this screen was open, the server
 * refuses the stale decision with a 409 instead of approving a price nobody
 * looked at.
 */
export function QuotationsSection({ token, demand }: { token: string; demand: PurchaseDemandDetail }) {
  const decide = useDecideQuotation(token);
  const [action, setAction] = useState<{ q: Quotation; kind: 'approve' | 'request_changes' | 'reject' } | null>(null);
  const [entering, setEntering] = useState(false);
  const versions = [...demand.quotations].sort((a, b) => b.version - a.version);

  async function submit(reason?: string) {
    if (!action) return;
    const { q, kind } = action;
    try {
      await decide.mutateAsync({ id: demand.id, quotationId: q.id, body: { version: q.version, decision: kind, reason: reason ?? null } });
      toast.success(
        kind === 'approve'
          ? `Quotation v${q.version} approved — ${demand.supplierName} has been asked for the bill`
          : kind === 'request_changes'
            ? `Changes requested from ${demand.supplierName}`
            : `Quotation v${q.version} rejected`,
      );
      setAction(null);
    } catch (e) {
      toast.error(errorMessage(e, 'Could not record the decision'));
      setAction(null);
    }
  }

  return (
    <div className="space-y-4">
      {demand.actions.enterQuotation && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed p-3 text-sm">
          <span className="text-muted-foreground">Supplier replied with prices as a plain WhatsApp message instead of the link?</span>
          <Button size="sm" variant="outline" onClick={() => setEntering(true)}>
            <PenLine className="mr-1.5 h-4 w-4" /> Enter quotation on supplier&apos;s behalf
          </Button>
        </div>
      )}

      {versions.length === 0 && (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No quotation yet. The supplier quotes from the link in their WhatsApp message.
        </p>
      )}

      {versions.length > 1 && <VersionCompare demand={demand} />}

      {versions.map((q) => {
        const current = q.id === demand.currentQuotationId;
        const decidable = current && q.status === 'submitted' && demand.actions.decideQuotation;
        return (
          <Section
            key={q.id}
            title={`Quotation v${q.version}${current ? ' (current)' : ''}`}
            actions={
              <>
                <Pill tone={QUOTATION_STATUS_TONE[q.status]}>{QUOTATION_STATUS_LABEL[q.status]}</Pill>
                <Pill tone="neutral">{q.submittedVia === 'portal' ? 'Supplier link' : `Entered by ${q.enteredByName ?? 'staff'}`}</Pill>
              </>
            }
          >
            <QuotationTable demand={demand} q={q} />
            <div className="flex flex-wrap justify-between gap-x-6 gap-y-1 text-xs text-muted-foreground">
              <span>Submitted {formatDateTime(q.submittedAt)}</span>
              {q.estimatedDeliveryDate && <span>Estimated delivery {formatDate(q.estimatedDeliveryDate)}</span>}
              {q.decidedAt && (
                <span>
                  Decided {formatDateTime(q.decidedAt)}
                  {q.decidedByName ? ` by ${q.decidedByName}` : ''}
                </span>
              )}
            </div>
            {(q.notes || q.deliveryNotes) && (
              <div className="space-y-1 rounded-md bg-muted/40 p-2.5 text-sm">
                {q.notes && <p><span className="text-muted-foreground">Supplier notes: </span>{q.notes}</p>}
                {q.deliveryNotes && <p><span className="text-muted-foreground">Delivery: </span>{q.deliveryNotes}</p>}
              </div>
            )}
            {q.decisionReason && (
              <p className="flex items-start gap-2 rounded-md bg-amber-50 p-2.5 text-sm dark:bg-amber-950/40">
                <MessageSquareWarning className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {q.decisionReason}
              </p>
            )}
            {decidable && (
              <div className="flex flex-wrap gap-2 border-t pt-3">
                <Button size="sm" onClick={() => setAction({ q, kind: 'approve' })}>
                  <CheckIcon className="mr-1.5 h-4 w-4" /> Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => setAction({ q, kind: 'request_changes' })}>
                  <PenLine className="mr-1.5 h-4 w-4" /> Request changes
                </Button>
                <Button size="sm" variant="outline" className="text-red-600 hover:text-red-600" onClick={() => setAction({ q, kind: 'reject' })}>
                  <X className="mr-1.5 h-4 w-4" /> Reject
                </Button>
              </div>
            )}
          </Section>
        );
      })}

      <ConfirmDialog
        open={action?.kind === 'approve'}
        onOpenChange={(o) => !o && setAction(null)}
        title={`Approve quotation v${action?.q.version ?? ''}?`}
        description={`${money(action?.q.total)} with ${demand.supplierName}. They are told on WhatsApp and asked to send their bill. This cannot be undone — a different price needs a new demand.`}
        confirmLabel="Approve quotation"
        pending={decide.isPending}
        onConfirm={() => void submit()}
      />
      <ReasonDialog
        open={action?.kind === 'request_changes'}
        onOpenChange={(o) => !o && setAction(null)}
        title="Request changes"
        description={`${demand.supplierName} receives this reason on WhatsApp with a fresh link to send a new version.`}
        placeholder="e.g. Butter rate is too high — last week it was Rs. 1,800/kg"
        confirmLabel="Send request"
        pending={decide.isPending}
        onConfirm={(r) => void submit(r)}
      />
      <ReasonDialog
        open={action?.kind === 'reject'}
        onOpenChange={(o) => !o && setAction(null)}
        title={`Reject quotation v${action?.q.version ?? ''}?`}
        description={`The demand closes as rejected and ${demand.supplierName}'s link stops working. They receive this reason on WhatsApp. This cannot be undone.`}
        placeholder="e.g. Found another supplier"
        confirmLabel="Reject quotation"
        destructive
        pending={decide.isPending}
        onConfirm={(r) => void submit(r)}
      />

      <QuotationEntryDialog token={token} demand={demand} open={entering} onOpenChange={setEntering} />
    </div>
  );
}

/** One quotation against the demand: requested vs available, rate, line total, and what was left off. */
function QuotationTable({ demand, q }: { demand: PurchaseDemandDetail; q: Quotation }) {
  const rows = quotationComparison(demand.items, q);
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full min-w-[34rem] text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-1.5 pr-2 font-medium">Item</th>
            <th className="py-1.5 pr-2 text-right font-medium">Requested</th>
            <th className="py-1.5 pr-2 text-right font-medium">Available</th>
            <th className="py-1.5 pr-2 text-right font-medium">Rate</th>
            <th className="py-1.5 pr-2 text-right font-medium">Line total</th>
            <th className="py-1.5 font-medium">Availability</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const short = r.line && r.requestedQty !== null && r.line.availableQty < r.requestedQty;
            return (
              <tr key={r.key} className={cn('border-b last:border-0', (!r.line || r.line.availability === 'unavailable') && 'text-muted-foreground')}>
                <td className="py-1.5 pr-2">
                  <span className={cn(!r.line && 'line-through')}>{r.itemName}</span>
                  {r.substituteFor && <span className="block text-xs text-muted-foreground">instead of {r.substituteFor}</span>}
                  {r.line?.note && <span className="block text-xs text-muted-foreground">{r.line.note}</span>}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{r.requestedQty === null ? '—' : `${formatQty(r.requestedQty)} ${r.unit}`}</td>
                <td className={cn('py-1.5 pr-2 text-right tabular-nums', short && 'font-medium text-amber-700 dark:text-amber-400')}>
                  {r.line ? `${formatQty(r.line.availableQty)} ${r.line.unit}` : '—'}
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{r.line ? money(r.line.unitRate) : '—'}</td>
                <td className="py-1.5 pr-2 text-right font-medium tabular-nums">{r.line ? money(r.line.lineTotal) : '—'}</td>
                <td className="py-1.5">
                  {r.line ? (
                    <Pill tone={AVAILABILITY_TONE[r.line.availability]}>{AVAILABILITY_LABEL[r.line.availability]}</Pill>
                  ) : (
                    <Pill tone="bad">Removed</Pill>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="text-sm">
          <tr>
            <td colSpan={4} className="pt-2 pr-2 text-right text-muted-foreground">Subtotal</td>
            <td className="pt-2 pr-2 text-right tabular-nums">{money(q.subtotal)}</td>
            <td />
          </tr>
          <tr>
            <td colSpan={4} className="pr-2 text-right text-muted-foreground">Delivery charge</td>
            <td className="pr-2 text-right tabular-nums">{money(q.deliveryCharge)}</td>
            <td />
          </tr>
          <tr className="font-semibold">
            <td colSpan={4} className="pr-2 text-right">Total</td>
            <td className="pr-2 text-right tabular-nums">{money(q.total)}</td>
            <td />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Every version side by side, so a resubmission's changes can be read at a glance. */
function VersionCompare({ demand }: { demand: PurchaseDemandDetail }) {
  const versions = useMemo(() => [...demand.quotations].sort((a, b) => a.version - b.version), [demand.quotations]);
  const rows = useMemo(() => versionComparison(demand.items, versions), [demand.items, versions]);
  return (
    <Section title="Compare versions">
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full text-sm" style={{ minWidth: `${12 + versions.length * 10}rem` }}>
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-1.5 pr-2 font-medium">Item</th>
              <th className="py-1.5 pr-2 text-right font-medium">Requested</th>
              {versions.map((q) => (
                <th key={q.id} className="py-1.5 pr-2 text-right font-medium">v{q.version}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b last:border-0 align-top">
                <td className="py-1.5 pr-2">{r.itemName}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{r.requestedQty === null ? 'substitute' : `${formatQty(r.requestedQty)} ${r.unit}`}</td>
                {r.cells.map((l, i) => {
                  const prev = i > 0 ? r.cells[i - 1] : null;
                  const changed = !!prev && !!l && (prev.unitRate !== l.unitRate || prev.availableQty !== l.availableQty);
                  return (
                    <td key={versions[i]!.id} className={cn('py-1.5 pr-2 text-right tabular-nums', changed && 'bg-amber-50 dark:bg-amber-950/40')}>
                      {l && l.availability !== 'unavailable' ? (
                        <>
                          <span className="block">{formatQty(l.availableQty)} × {money(l.unitRate)}</span>
                          <span className="block text-xs font-medium">{money(l.lineTotal)}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">{l ? 'unavailable' : '—'}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td colSpan={2} className="pt-2 pr-2 text-right">Total (incl. delivery)</td>
              {versions.map((q) => (
                <td key={q.id} className="pt-2 pr-2 text-right tabular-nums">{money(q.total)}</td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </Section>
  );
}

// ── Staff entry ─────────────────────────────────────────────────────────────

interface QLine {
  rowId: string;
  demandItemId: string | null;
  substituteForDemandItemId: string | null;
  itemName: string;
  unit: PurchaseUnit | '';
  requestedQty: number | null;
  availability: QuotationAvailability;
  qty: string;
  rate: string;
  note: string;
}

function linesFor(demand: PurchaseDemandDetail): QLine[] {
  return [...demand.items]
    .sort((a, b) => a.lineNo - b.lineNo)
    .map((i) => ({
      rowId: i.id,
      demandItemId: i.id,
      substituteForDemandItemId: null,
      itemName: i.itemName,
      unit: (PURCHASE_UNITS as readonly string[]).includes(i.unit) ? (i.unit as PurchaseUnit) : '',
      requestedQty: i.requestedQty,
      availability: 'available',
      qty: String(i.requestedQty),
      rate: '',
      note: '',
    }));
}

/**
 * Enter a quotation the supplier sent as an ordinary WhatsApp message
 * (POST /demands/:id/quotations). It becomes the next version exactly as if
 * the supplier had used the link, marked "entered by" whoever keyed it in.
 */
function QuotationEntryDialog({
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
  const enter = useEnterQuotation(token);
  const [lines, setLines] = useState<QLine[]>([]);
  const [deliveryCharge, setDeliveryCharge] = useState('0');
  const [eta, setEta] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [notes, setNotes] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [clientRequestId, setClientRequestId] = useState('');
  const key = useRef(new SubmissionKey('quote'));

  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setLines(linesFor(demand));
      setDeliveryCharge('0');
      setEta('');
      setDeliveryNotes('');
      setNotes('');
      setAttempted(false);
      setClientRequestId(newRequestId('q'));
    }
  }

  const setLine = (rowId: string, patch: Partial<QLine>) => setLines((p) => p.map((l) => (l.rowId === rowId ? { ...l, ...patch } : l)));

  const body = {
    items: lines.map((l) => ({
      demandItemId: l.demandItemId,
      substituteForDemandItemId: l.substituteForDemandItemId,
      itemName: l.itemName,
      ...(l.unit ? { unit: l.unit } : {}),
      availableQty: l.availability === 'unavailable' ? 0 : parseNumber(l.qty),
      unitRate: l.availability === 'unavailable' ? 0 : parseNumber(l.rate),
      availability: l.availability,
      note: l.note.trim() || null,
    })),
    deliveryCharge: parseNumber(deliveryCharge),
    estimatedDeliveryDate: eta || null,
    deliveryNotes: deliveryNotes.trim() || null,
    notes: notes.trim() || null,
    clientRequestId: clientRequestId,
  };
  const parsed = QuotationInputSchema.safeParse(body);
  const errors = parsed.success ? {} : issuesByPath(parsed.error.issues);
  const err = (k: string) => (attempted ? errors[k] : undefined);
  const preview = quotationPreviewTotal(
    body.items.map((l) => ({ qty: l.availableQty, rate: l.unitRate })),
    body.deliveryCharge,
  );

  async function submit() {
    setAttempted(true);
    if (!parsed.success || enter.isPending) return;
    const bodyJson = JSON.stringify(parsed.data);
    try {
      const q = await enter.mutateAsync({ id: demand.id, body: parsed.data, key: key.current.keyFor(bodyJson) });
      key.current.reset();
      toast.success(`Quotation v${q.version} entered — ${money(q.total)}`);
      onOpenChange(false);
    } catch (e) {
      toast.error(errorMessage(e, 'Could not enter the quotation'));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !enter.isPending && onOpenChange(o)}>
      <DialogContent mobile="fullscreen" className="md:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Enter quotation · {demand.demandNo}</DialogTitle>
          <DialogDescription>
            Key in the prices {demand.supplierName} sent as a WhatsApp message. It is recorded as the next version, entered by you, and waits for approval like any other.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {lines.map((l, idx) => (
            <div key={l.rowId} className="space-y-2 rounded-lg border p-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                {l.demandItemId ? (
                  <p className="text-sm font-medium">
                    {l.itemName} <span className="font-normal text-muted-foreground">· requested {formatQty(l.requestedQty)} {l.unit}</span>
                  </p>
                ) : (
                  <p className="text-sm font-medium">Substitute</p>
                )}
                <div className="flex items-center gap-2">
                  {l.demandItemId ? (
                    <Select
                      value={l.availability}
                      onValueChange={(v) => {
                        const a = (v as QuotationAvailability) ?? 'available';
                        setLine(l.rowId, { availability: a, qty: a === 'unavailable' ? '0' : l.qty === '0' ? String(l.requestedQty ?? '') : l.qty });
                      }}
                    >
                      <SelectTrigger className="h-9 w-36" aria-label={`Availability of ${l.itemName}`}>
                        <SelectValue>{(v: string) => AVAILABILITY_LABEL[v as QuotationAvailability]}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {(['available', 'partial', 'unavailable'] as const).map((a) => (
                          <SelectItem key={a} value={a}>{AVAILABILITY_LABEL[a]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Button variant="ghost" size="icon" aria-label="Remove substitute" onClick={() => setLines((p) => p.filter((x) => x.rowId !== l.rowId))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
              {!l.demandItemId && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Input
                    aria-label="Substitute item name"
                    placeholder="Item name"
                    value={l.itemName}
                    maxLength={120}
                    onChange={(e) => setLine(l.rowId, { itemName: e.target.value })}
                    className="col-span-2 h-10 sm:col-span-1"
                    aria-invalid={!!err(`items.${idx}.itemName`)}
                  />
                  <Select value={l.unit || null} onValueChange={(v) => setLine(l.rowId, { unit: ((v as string) ?? '') as PurchaseUnit | '' })}>
                    <SelectTrigger className="h-10 w-full" aria-label="Substitute unit">
                      <SelectValue placeholder="Unit" />
                    </SelectTrigger>
                    <SelectContent>
                      {PURCHASE_UNITS.map((u) => (
                        <SelectItem key={u} value={u}>{u}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={l.substituteForDemandItemId}
                    onValueChange={(v) => setLine(l.rowId, { substituteForDemandItemId: (v as string) ?? null })}
                  >
                    <SelectTrigger className="h-10 w-full" aria-label="Instead of">
                      <SelectValue placeholder="Instead of…">
                        {(v: string | null) => demand.items.find((i) => i.id === v)?.itemName ?? 'Instead of…'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {demand.items.map((i) => (
                        <SelectItem key={i.id} value={i.id}>{i.itemName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {l.availability !== 'unavailable' && (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <Field label="Available qty" error={err(`items.${idx}.availableQty`)}>
                    <Input inputMode="decimal" value={l.qty} onChange={(e) => setLine(l.rowId, { qty: decimalInput(e.target.value) })} className="h-10" aria-label="Available quantity" />
                  </Field>
                  <Field label="Rate per unit" error={err(`items.${idx}.unitRate`)}>
                    <Input inputMode="decimal" value={l.rate} placeholder="Rs." onChange={(e) => setLine(l.rowId, { rate: decimalInput(e.target.value) })} className="h-10" aria-label="Rate per unit" />
                  </Field>
                  <div className="col-span-2 flex items-end justify-end pb-2 text-sm sm:col-span-1">
                    <span className="text-muted-foreground">Line:&nbsp;</span>
                    <span className="font-medium tabular-nums">{money(quotationPreviewTotal([{ qty: parseNumber(l.qty), rate: parseNumber(l.rate) }], 0))}</span>
                  </div>
                </div>
              )}
              <Input
                aria-label="Line note"
                placeholder="Note (optional) — brand, packing"
                value={l.note}
                maxLength={300}
                onChange={(e) => setLine(l.rowId, { note: e.target.value })}
                className="h-9"
              />
              {err(`items.${idx}.availability`) && <p className="text-xs text-destructive">{err(`items.${idx}.availability`)}</p>}
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setLines((p) => [
                ...p,
                {
                  rowId: newRequestId('sub'),
                  demandItemId: null,
                  substituteForDemandItemId: null,
                  itemName: '',
                  unit: '',
                  requestedQty: null,
                  availability: 'substitute',
                  qty: '',
                  rate: '',
                  note: '',
                },
              ])
            }
          >
            <Plus className="mr-1.5 h-4 w-4" /> Add substitute
          </Button>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Delivery charge" htmlFor="q-delivery" error={err('deliveryCharge')}>
              <Input id="q-delivery" inputMode="decimal" value={deliveryCharge} onChange={(e) => setDeliveryCharge(decimalInput(e.target.value))} className="h-10" />
            </Field>
            <Field label="Estimated delivery (optional)" htmlFor="q-eta" error={err('estimatedDeliveryDate')}>
              <Input id="q-eta" type="date" value={eta} onChange={(e) => setEta(e.target.value)} className="h-10" />
            </Field>
            <Field label="Delivery notes (optional)" htmlFor="q-dnotes">
              <Textarea id="q-dnotes" rows={2} maxLength={500} value={deliveryNotes} onChange={(e) => setDeliveryNotes(e.target.value)} />
            </Field>
            <Field label="Supplier's notes (optional)" htmlFor="q-notes">
              <Textarea id="q-notes" rows={2} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </Field>
          </div>
          {err('items') && <p className="text-xs text-destructive">{err('items')}</p>}
          <p className="text-right text-sm">
            Total <span className="font-semibold tabular-nums">{money(preview)}</span>
            <span className="block text-xs text-muted-foreground">Preview — the server calculates the final total.</span>
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={enter.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={enter.isPending}>
            {enter.isPending ? 'Saving…' : 'Save quotation'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
