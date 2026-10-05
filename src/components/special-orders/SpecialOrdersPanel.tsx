'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, ChevronDown, Loader2, PackageCheck, Sparkles } from 'lucide-react';
import { SPECIAL_ORDER_STATUS_LABELS, type Attachment, type SpecialOrder, type SpecialOrderStatus } from '@mb/shared';
import {
  useApproveSpecialOrder,
  usePrepareSpecialOrder,
  useSpecialOrders,
  useVerifySpecialOrder,
} from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AttachmentGallery } from '@/components/shared/AttachmentGallery';
import { PhotoCapture } from '@/components/shared/PhotoCapture';
import { formatCurrency as money } from '@/utils/currency';
import { cn } from '@/lib/utils';

/**
 * Special Orders, for whichever side is looking.
 *
 * One panel for both, because it is one document moving between two desks:
 *
 *   production  sees every branch's orders; marks one PREPARED, and later
 *               APPROVES it once the branch has verified it.
 *   branch      sees its own; VERIFIES a prepared one by uploading a photo.
 *
 * It is deliberately separate from the demand table on both pages. A Special
 * Order is not a demand — it never appears in the demand list, the demand
 * summary or a demand total.
 *
 * There is no "add to stock" control anywhere here, and there must not be:
 * approving IS the stock movement. As part of that approval the server adds the
 * ordered quantity to Production Stock and delivers it to the ordering branch's
 * stock, exactly once — and a second, manual way to add the same units is the
 * thing this workflow exists to rule out.
 */

const STATUS_STYLES: Record<SpecialOrderStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  awaiting_verification: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  verified: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
};

/** Which status each side has to act on. */
const NEEDS_ACTION: Record<'branch' | 'production', SpecialOrderStatus[]> = {
  branch: ['awaiting_verification'],
  production: ['pending', 'verified'],
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' }) : '';

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium">{children}</dd>
    </div>
  );
}

function SpecialOrderCard({ order, mode, token }: { order: SpecialOrder; mode: 'branch' | 'production'; token: string }) {
  const prepareMut = usePrepareSpecialOrder(token);
  const verifyMut = useVerifySpecialOrder(token);
  const approveMut = useApproveSpecialOrder(token);
  // The verification photo, staged here until the branch presses Verify.
  const [photos, setPhotos] = useState<Attachment[]>([]);

  const run = async (action: () => Promise<unknown>, done: string, failed: string) => {
    try {
      await action();
      toast.success(done);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : failed);
    }
  };

  const stockAdded = order.status === 'approved';

  return (
    <div className="space-y-3 rounded-lg border bg-background p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary-foreground">
            <Sparkles className="h-3 w-3" /> Special Order
          </span>
          <span className="font-semibold tabular-nums">{order.orderNumber}</span>
        </div>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', STATUS_STYLES[order.status])}>
          {SPECIAL_ORDER_STATUS_LABELS[order.status]}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {/* The SO number is the reference Production works from — there is no
            second, separate production id to keep in step with it. */}
        <Detail label={mode === 'production' ? 'Production ID' : 'Special Order ID'}>{order.orderNumber}</Detail>
        <Detail label="Branch">{order.branchName || '—'}</Detail>
        <Detail label="Raised">{order.date}</Detail>
        <Detail label="Required by">{order.requiredDate || '—'}</Detail>
      </dl>

      <ul className="divide-y rounded-lg border">
        {order.items.map((item) => (
          <li key={item.id} className="space-y-1.5 px-3 py-2">
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <p className="min-w-0 font-medium leading-tight">{item.itemName}</p>
              <div className="flex shrink-0 gap-4 text-sm">
                <span>
                  <span className="text-muted-foreground">Demand Qty </span>
                  <span className="font-semibold tabular-nums">{item.qty}</span>
                </span>
                <span>
                  <span className="text-muted-foreground">Amount </span>
                  <span className="font-semibold tabular-nums">{money(item.amount)}</span>
                </span>
              </div>
            </div>
            {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
            {item.requestPhotos.length > 0 && (
              <AttachmentGallery attachments={item.requestPhotos} size="xs" title="Requested photo" />
            )}
            {item.stockTransactionNo && (
              <p className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                +{item.qty} prepared in Production Stock and delivered to {order.branchName || 'the branch'}&apos;s stock ·{' '}
                {item.stockTransactionNo}
              </p>
            )}
          </li>
        ))}
      </ul>

      {order.items.length > 1 && (
        <p className="text-right text-sm">
          <span className="text-muted-foreground">Special Order total </span>
          <span className="font-semibold tabular-nums">{money(order.totalAmount)}</span>
        </p>
      )}

      {/* The trail, one line per step that has happened. */}
      <ul className="space-y-0.5 text-xs text-muted-foreground">
        <li>Raised by {order.createdByName || '—'} · {when(order.submittedAt)}</li>
        {order.preparedAt && <li>Prepared by {order.preparedByName || '—'} · {when(order.preparedAt)}</li>}
        {order.verifiedAt && <li>Verified by {order.verifiedByName || '—'} · {when(order.verifiedAt)}</li>}
        {order.approvedAt && <li>Approved by {order.approvedByName || '—'} · {when(order.approvedAt)}</li>}
      </ul>

      {order.verificationPhotos.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium">Verification photo</p>
          <AttachmentGallery attachments={order.verificationPhotos} title="Verification photo" />
        </div>
      )}

      {/* ── What this side can do now ─────────────────────────────────────── */}
      {mode === 'production' && order.status === 'pending' && (
        <div className="flex justify-end">
          <Button
            size="sm"
            disabled={prepareMut.isPending}
            onClick={() =>
              run(() => prepareMut.mutateAsync(order.id), 'Marked prepared — sent to the branch to verify', 'Could not mark it prepared')
            }
          >
            {prepareMut.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-1.5 h-4 w-4" />}
            Mark Prepared
          </Button>
        </div>
      )}

      {mode === 'branch' && order.status === 'awaiting_verification' && (
        <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900 dark:bg-blue-950/30">
          <PhotoCapture
            entity="special_order_verification"
            value={photos}
            onChange={setPhotos}
            label="Verification photo"
            required
            disabled={verifyMut.isPending}
            hint="Photograph the finished item. It is kept alongside the photo you ordered it with — it does not replace it."
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={photos.length === 0 || verifyMut.isPending}
              onClick={() =>
                run(
                  async () => {
                    await verifyMut.mutateAsync({ id: order.id, attachmentIds: photos.map((p) => p.id) });
                    setPhotos([]);
                  },
                  'Verified — sent for approval',
                  'Could not verify this Special Order',
                )
              }
            >
              {verifyMut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Submit Verification
            </Button>
          </div>
        </div>
      )}

      {mode === 'production' && order.status === 'verified' && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Approving adds the Demand Qty to Production Stock and delivers it to the branch&apos;s stock, once. No
            separate stock entry is needed.
          </p>
          <Button
            size="sm"
            disabled={approveMut.isPending}
            onClick={() =>
              run(() => approveMut.mutateAsync(order.id), 'Approved — delivered to branch stock', 'Could not approve this Special Order')
            }
          >
            {approveMut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Approve
          </Button>
        </div>
      )}

      {mode === 'branch' && order.status === 'pending' && (
        <p className="text-xs text-muted-foreground">With Production — you will be asked to verify it once it is prepared.</p>
      )}
      {mode === 'branch' && order.status === 'verified' && (
        <p className="text-xs text-muted-foreground">
          Verified — it is added to your stock when Production approves it.
        </p>
      )}
      {mode === 'production' && order.status === 'awaiting_verification' && (
        <p className="text-xs text-muted-foreground">Prepared — waiting for the branch to verify it with a photo.</p>
      )}
      {stockAdded && !order.items.some((i) => i.stockTransactionNo) && (
        <p className="text-xs text-muted-foreground">Approved — delivered to branch stock.</p>
      )}
    </div>
  );
}

export function SpecialOrdersPanel({ mode, token }: { mode: 'branch' | 'production'; token: string }) {
  const ordersQ = useSpecialOrders(token);
  const [showDone, setShowDone] = useState(false);

  const orders = ordersQ.data ?? [];
  // Nothing raised, nothing shown: most days most branches have no Special
  // Order, and an empty card above the demand table would only be in the way.
  if (orders.length === 0) return null;

  const open = orders.filter((o) => o.status !== 'approved');
  const done = orders.filter((o) => o.status === 'approved');
  const needsAction = open.filter((o) => NEEDS_ACTION[mode].includes(o.status)).length;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <Sparkles className="h-4 w-4 text-primary" />
          Special Orders
          {needsAction > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-400">
              {needsAction} {mode === 'branch' ? 'to verify' : 'need action'}
            </span>
          )}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Sent straight to Production — separate from demand, and not counted in it.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {open.length === 0 && <p className="text-sm text-muted-foreground">No open Special Orders.</p>}
        {open.map((o) => (
          <SpecialOrderCard key={o.id} order={o} mode={mode} token={token} />
        ))}

        {done.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setShowDone((s) => !s)}
              aria-expanded={showDone}
              className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={cn('h-4 w-4 transition-transform', showDone && 'rotate-180')} />
              Approved in the last 7 days ({done.length})
            </button>
            {showDone && (
              <div className="mt-3 space-y-3">
                {done.map((o) => (
                  <SpecialOrderCard key={o.id} order={o} mode={mode} token={token} />
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
