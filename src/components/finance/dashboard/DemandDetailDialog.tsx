'use client';

import { useAuth } from '@/hooks/useAuth';
import { useProductionOrder, usePreviousOrderBalance } from '@/lib/queries';
import { ApiError } from '@/utils/api';
import { formatDate, formatDateTime } from '@/utils/date';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AttachmentGallery } from '@/components/shared/AttachmentGallery';
import { Money } from '../finance-ui';

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  awaiting_verification: 'Awaiting Verification',
  verified: 'Verified — Awaiting Approval',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  awaiting_verification: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  verified: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
  cancelled: 'bg-muted text-muted-foreground',
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b py-1.5 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{children}</span>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card px-3.5 py-2.5">
      <p className="mb-1 text-[11px] font-extrabold tracking-[0.1em] text-muted-foreground uppercase">{title}</p>
      {children}
    </div>
  );
}

/**
 * The complete demand — what a demand number opens from the Finance Income
 * drill-down (RecordsDrawer).
 *
 * `amount`/`amountLabel` come from the drill-down row that opened this, not from
 * a recalculation here: that figure was already summed server-side with the
 * exact rule `finance_order_values` defines (live product price × approved
 * qty), and re-deriving it from this order's own `unitPrice` SNAPSHOTS — the
 * figure Production bills the branch on — would show a second, legitimately
 * different number next to the one the user clicked. Everything else here (the
 * record itself: dates, status, approvals) comes straight off the production
 * order Finance is looking at.
 */
export function DemandDetailDialog({
  orderId,
  amountLabel,
  amount,
  onClose,
}: {
  orderId: string;
  amountLabel: string;
  amount: number;
  onClose: () => void;
}) {
  const { token } = useAuth();
  const q = useProductionOrder(token ?? '', orderId);
  const order = q.data;
  // What the branch owed coming INTO this demand — the same figures the
  // production slip prints (previous-balance.service.ts), not a second
  // computation: previous demand's company share, less what came back as
  // returns/discounts, less what Finance has already received for it.
  const prevQ = usePreviousOrderBalance(token ?? '', orderId, { enabled: !!order });
  const prev = prevQ.data;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto gap-0 p-0 md:max-w-lg">
        <DialogHeader className="bg-fin-income px-5 py-4 text-fin-ink-foreground">
          <DialogTitle className="text-base font-extrabold text-fin-ink-foreground">
            {order ? order.demandNumber : q.isError ? 'Demand' : 'Loading demand…'}
          </DialogTitle>
          <DialogDescription className="text-fin-ink-muted">
            {order ? `${order.branchName} · ${formatDate(order.date)}` : 'Complete demand record'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 p-5">
          {q.isError ? (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <p className="text-sm font-semibold">
                {q.error instanceof ApiError && q.error.status === 404
                  ? 'This demand could not be found. It may have been cancelled or deleted.'
                  : q.error instanceof ApiError && q.error.status === 403
                    ? 'You do not have permission to view this demand.'
                    : 'This demand could not be loaded.'}
              </p>
              {!(q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403)) && (
                <Button variant="outline" size="sm" onClick={() => void q.refetch()}>
                  Retry
                </Button>
              )}
            </div>
          ) : !order ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }, (_, i) => (
                <Skeleton key={i} className="h-9 w-full" />
              ))}
            </div>
          ) : (
            <>
              <Section title="Demand">
                <Row label="Demand no.">
                  <span className="font-mono">{order.demandNumber}</span>
                </Row>
                <Row label="Business date">{formatDate(order.date)}</Row>
                {order.requiredDate && <Row label="Required by">{formatDate(order.requiredDate)}</Row>}
                <Row label="Branch">{order.branchName}</Row>
                <Row label="Status">
                  <span
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[order.status] ?? 'bg-muted text-muted-foreground'}`}
                  >
                    {STATUS_LABELS[order.status] ?? order.status}
                  </span>
                </Row>
              </Section>

              <Section title={amountLabel}>
                <Row label={amountLabel}>
                  <Money value={amount} />
                </Row>
              </Section>

              {prev && (
                <Section title="Previous delivery">
                  {prev.previous ? (
                    <>
                      <Row label="Previous demand">
                        <span className="font-mono">{prev.previous.demandNumber}</span>
                      </Row>
                      <Row label="Previous amount">
                        <Money value={prev.companyShareValue} />
                      </Row>
                      <Row label="Return amount">
                        <Money value={prev.returnsValue} blankZero />
                      </Row>
                      {!!prev.discountsValue && (
                        <Row label="Discount amount">
                          <Money value={prev.discountsValue} />
                        </Row>
                      )}
                      <Row label="Received amount">
                        <Money value={prev.paymentsReceivedValue ?? 0} blankZero />
                      </Row>
                      <Row label="Remaining balance">
                        <Money value={prev.remainingBalance ?? prev.amountToCollect} />
                      </Row>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">No earlier delivery to this branch — nothing owed coming in.</p>
                  )}
                </Section>
              )}

              {order.changeReason && (
                <Section title="Change reason">
                  <p className="text-sm">{order.changeReason}</p>
                </Section>
              )}

              {order.status === 'cancelled' && order.cancelReason && (
                <Section title="Cancellation">
                  <p className="text-sm">{order.cancelReason}</p>
                  <Row label="Cancelled by">{order.cancelledByName ?? '—'}</Row>
                  {order.cancelledAt && <Row label="Cancelled at">{formatDateTime(order.cancelledAt)}</Row>}
                </Section>
              )}

              {((order.demandPhotos && order.demandPhotos.length > 0) ||
                (order.verificationPhotos && order.verificationPhotos.length > 0)) && (
                <Section title="Attachments">
                  {order.demandPhotos && order.demandPhotos.length > 0 && (
                    <AttachmentGallery attachments={order.demandPhotos} size="sm" title="Demand photo" />
                  )}
                  {order.verificationPhotos && order.verificationPhotos.length > 0 && (
                    <AttachmentGallery attachments={order.verificationPhotos} size="sm" title="Verification photo" />
                  )}
                </Section>
              )}

              <p className="font-mono text-[10px] text-muted-foreground select-all">ID {order.id}</p>
            </>
          )}
        </div>

        <DialogFooter className="border-t px-5 py-3">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
