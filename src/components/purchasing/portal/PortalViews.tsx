'use client';

import { CalendarClock, Clock } from 'lucide-react';
import type { QuotationAvailability, SupplierPortalView } from '@mb/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Notice, Section, TotalRow } from './portalUi';
import { day, qty, rs, untilText, when } from './portalFormat';

/**
 * The read-only parts of the portal: the demand as Mountain Bakes sent it, and
 * the supplier's own quotation and bill as the SERVER recorded them — every
 * figure here is the API's, never one computed on this phone.
 */

type PortalQuotation = NonNullable<SupplierPortalView['latestQuotation']>;
type PortalBill = NonNullable<SupplierPortalView['latestBill']>;

export const AVAILABILITY_LABEL: Record<QuotationAvailability, string> = {
  available: 'Available',
  partial: 'Partly available',
  unavailable: 'Not available',
  substitute: 'Substitute / extra',
};

const QUOTATION_STATUS: Record<PortalQuotation['status'], { label: string; cls: string }> = {
  submitted: { label: 'With Mountain Bakes', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' },
  changes_requested: { label: 'Changes requested', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' },
  approved: { label: 'Approved', cls: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200' },
  rejected: { label: 'Rejected', cls: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200' },
  superseded: { label: 'Replaced by a newer version', cls: 'bg-muted text-muted-foreground' },
};

const BILL_STATUS: Record<PortalBill['status'], { label: string; cls: string }> = {
  submitted: { label: 'Being checked', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' },
  approved: { label: 'Accepted', cls: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200' },
  rejected: { label: 'Returned', cls: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200' },
};

function StatusPill({ label, cls }: { label: string; cls: string }) {
  return (
    <Badge variant="secondary" className={cn('shrink-0 whitespace-nowrap', cls)}>
      {label}
    </Badge>
  );
}

export function DemandSummary({ view }: { view: SupplierPortalView }) {
  const urgent = view.priority === 'urgent';
  return (
    <Section
      title={`Purchase request ${view.demandNo}`}
      description={`From ${view.business} to ${view.supplierName}`}
      actions={<StatusPill label={view.statusLabel} cls="bg-primary/10 text-primary" />}
    >
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Needed by</dt>
          <dd className="font-medium">{day(view.requiredDate)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Priority</dt>
          <dd>
            <StatusPill
              label={urgent ? 'Urgent' : 'Normal'}
              cls={urgent ? 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200' : 'bg-muted text-foreground'}
            />
          </dd>
        </div>
      </dl>

      {(view.notes || view.deliveryInstructions) && (
        <div className="mt-3 space-y-2 text-sm">
          {view.notes && (
            <div>
              <p className="text-xs text-muted-foreground">Notes from Mountain Bakes</p>
              <p className="whitespace-pre-line">{view.notes}</p>
            </div>
          )}
          {view.deliveryInstructions && (
            <div>
              <p className="text-xs text-muted-foreground">Delivery instructions</p>
              <p className="whitespace-pre-line">{view.deliveryInstructions}</p>
            </div>
          )}
        </div>
      )}

      <div className="mt-4">
        <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Items requested</p>
        <ul className="divide-y rounded-xl border">
          {view.items.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-3 px-3 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="font-medium">{i.itemName}</p>
                {i.note && <p className="text-xs text-muted-foreground">{i.note}</p>}
              </div>
              <p className="shrink-0 font-semibold tabular-nums">
                {qty(i.requestedQty)} {i.unit}
              </p>
            </li>
          ))}
        </ul>
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Clock className="size-3.5" />
        This link works until {when(view.linkExpiresAt)} ({untilText(view.linkExpiresAt)}).
      </p>
    </Section>
  );
}

/** Production's reason, when it is one the supplier must act on. */
export function ProductionNote({ view }: { view: SupplierPortalView }) {
  if (!view.productionNote) return null;
  const changes = view.status === 'changes_requested';
  return (
    <Notice tone="warning" title={changes ? 'Mountain Bakes asked for changes' : 'Your bill was returned'}>
      <p className="whitespace-pre-line">{view.productionNote}</p>
      <p className="mt-1 text-xs opacity-80">
        {changes ? 'Update your quotation below and send it again.' : 'Correct the bill below and send it again.'}
      </p>
    </Notice>
  );
}

export function QuotationCard({
  quotation,
  title,
  actions,
}: {
  quotation: PortalQuotation;
  title?: string;
  actions?: React.ReactNode;
}) {
  const status = QUOTATION_STATUS[quotation.status];
  return (
    <Section
      title={title ?? `Your quotation · version ${quotation.version}`}
      description={`Sent ${when(quotation.submittedAt)}`}
      actions={<StatusPill {...status} />}
    >
      <ul className="divide-y rounded-xl border text-sm">
        {quotation.items.map((l) => (
          <li key={l.id} className="space-y-0.5 px-3 py-2.5">
            <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 font-medium">{l.itemName}</p>
              <p className="shrink-0 font-semibold tabular-nums">{rs(l.lineTotal)}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              {AVAILABILITY_LABEL[l.availability]}
              {l.availability !== 'unavailable' && (
                <>
                  {' · '}
                  {qty(l.availableQty)} {l.unit} × {rs(l.unitRate)}
                </>
              )}
              {l.requestedQty !== null && ` · asked ${qty(l.requestedQty)} ${l.unit}`}
            </p>
            {l.note && <p className="text-xs text-muted-foreground">Note: {l.note}</p>}
          </li>
        ))}
      </ul>
      <div className="mt-3 text-sm">
        <TotalRow label="Items" value={rs(quotation.subtotal)} />
        <TotalRow label="Delivery charge" value={rs(quotation.deliveryCharge)} />
        <TotalRow label="Total" value={rs(quotation.total)} strong />
      </div>
      {(quotation.estimatedDeliveryDate || quotation.deliveryNotes || quotation.notes) && (
        <div className="mt-3 space-y-1 text-sm">
          {quotation.estimatedDeliveryDate && (
            <p className="flex items-center gap-1.5">
              <CalendarClock className="size-4 text-muted-foreground" /> Delivery expected {day(quotation.estimatedDeliveryDate)}
            </p>
          )}
          {quotation.deliveryNotes && <p className="text-muted-foreground">Delivery: {quotation.deliveryNotes}</p>}
          {quotation.notes && <p className="text-muted-foreground">Notes: {quotation.notes}</p>}
        </div>
      )}
      {actions && <div className="mt-4">{actions}</div>}
    </Section>
  );
}

export function BillCard({ bill }: { bill: PortalBill }) {
  const status = BILL_STATUS[bill.status];
  return (
    <Section
      title={`Your bill ${bill.supplierBillNo}`}
      description={`Invoice date ${day(bill.invoiceDate)} · sent ${when(bill.submittedAt)}`}
      actions={<StatusPill {...status} />}
    >
      <ul className="divide-y rounded-xl border text-sm">
        {bill.items.map((l) => (
          <li key={l.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
            <div className="min-w-0">
              <p className="font-medium">{l.itemName}</p>
              <p className="text-xs text-muted-foreground">
                {qty(l.qty)} {l.unit} × {rs(l.unitRate)}
              </p>
            </div>
            <p className="shrink-0 font-semibold tabular-nums">{rs(l.lineTotal)}</p>
          </li>
        ))}
      </ul>
      <div className="mt-3 text-sm">
        <TotalRow label="Items" value={rs(bill.subtotal)} />
        <TotalRow label="Delivery charge" value={rs(bill.deliveryCharge)} />
        {bill.otherCharges > 0 && (
          <TotalRow label={`Other charges${bill.otherChargesNote ? ` (${bill.otherChargesNote})` : ''}`} value={rs(bill.otherCharges)} />
        )}
        {bill.discount > 0 && <TotalRow label="Discount" value={`− ${rs(bill.discount)}`} />}
        <TotalRow label="Bill total" value={rs(bill.grandTotal)} strong />
      </div>
      <div className="mt-3 space-y-1 text-sm text-muted-foreground">
        {bill.deliveryDate && <p>Delivery date: {day(bill.deliveryDate)}</p>}
        {(bill.supplierPaymentMethod || bill.supplierStatedPaid > 0) && (
          <p>
            You noted: {bill.supplierPaymentMethod ?? 'payment'}
            {bill.supplierStatedPaid > 0 && ` · ${rs(bill.supplierStatedPaid)} paid`}. Mountain Bakes records its own payments.
          </p>
        )}
        {bill.notes && <p>Notes: {bill.notes}</p>}
        {bill.differsFromQuotation && (
          <p className="text-amber-700 dark:text-amber-300">This bill differs from the approved quotation; Mountain Bakes checks the difference.</p>
        )}
        {bill.status === 'rejected' && bill.decisionReason && (
          <p className="text-destructive">Returned: {bill.decisionReason}</p>
        )}
      </div>
    </Section>
  );
}

/** One plain sentence for a demand the supplier cannot act on right now. */
export function readOnlyMessage(view: SupplierPortalView): { title: string; body: string } {
  switch (view.status) {
    case 'bill_submitted':
      return { title: 'Your bill is with Mountain Bakes', body: 'They are checking it. You will hear back on WhatsApp.' };
    case 'awaiting_delivery':
      return { title: 'Bill accepted', body: 'Mountain Bakes accepted your bill and is waiting for the delivery.' };
    case 'partially_received':
      return { title: 'Part of the delivery received', body: 'Mountain Bakes has received part of this order.' };
    case 'received':
      return { title: 'Order received', body: 'Mountain Bakes has received this order. Thank you.' };
    default:
      return { title: 'Nothing to do right now', body: 'There is nothing to send for this request at the moment.' };
  }
}
