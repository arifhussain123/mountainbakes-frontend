'use client';

import type { PurchaseDemand, WhatsAppMessageStatus } from '@mb/shared';
import { AlertTriangle, Flame } from 'lucide-react';
import {
  DELIVERY_STATUS_LABEL,
  DELIVERY_STATUS_TONE,
  DEMAND_STATUS_TONE,
  MESSAGE_STATUS_LABEL,
  MESSAGE_STATUS_TONE,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_TONE,
  demandStatusLabel,
} from './purchasing-model';
import { Pill } from './parts';

/**
 * A demand's state as badges. Status, payment and delivery are three separate
 * pills because they move independently: a demand can be Received and still
 * Unpaid, or Awaiting delivery and already paid in part.
 *
 * Payment is shown only once a bill is approved — before that there is nothing
 * to owe, and "Unpaid" on a draft reads as a debt. Delivery is shown once it has
 * been booked, for the same reason.
 */
export function DemandBadges({
  demand,
  lastMessageStatus,
  showStatus = true,
}: {
  demand: Pick<PurchaseDemand, 'status' | 'priority' | 'paymentStatus' | 'deliveryStatus' | 'approvedBillId'>;
  lastMessageStatus?: WhatsAppMessageStatus | null;
  showStatus?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {showStatus && <Pill tone={DEMAND_STATUS_TONE[demand.status]}>{demandStatusLabel(demand.status)}</Pill>}
      {demand.priority === 'urgent' && (
        <Pill tone="bad">
          <Flame className="h-3 w-3" aria-hidden /> Urgent
        </Pill>
      )}
      {demand.approvedBillId && (
        <Pill tone={PAYMENT_STATUS_TONE[demand.paymentStatus]}>{PAYMENT_STATUS_LABEL[demand.paymentStatus]}</Pill>
      )}
      {demand.deliveryStatus !== 'not_booked' && (
        <Pill tone={DELIVERY_STATUS_TONE[demand.deliveryStatus]}>{DELIVERY_STATUS_LABEL[demand.deliveryStatus]}</Pill>
      )}
      {lastMessageStatus === 'failed' && (
        <Pill tone="bad">
          <AlertTriangle className="h-3 w-3" aria-hidden /> Message failed
        </Pill>
      )}
    </div>
  );
}

export function MessageStatusPill({ status }: { status: WhatsAppMessageStatus }) {
  return <Pill tone={MESSAGE_STATUS_TONE[status]}>{MESSAGE_STATUS_LABEL[status]}</Pill>;
}
