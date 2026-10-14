'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, ChevronDown, Loader2, PackageCheck, Sparkles } from 'lucide-react';
import {
  SPECIAL_ORDER_STATUS_LABELS,
  type Attachment,
  type SpecialOrder,
  type SpecialOrderItem,
  type SpecialOrderStatus,
} from '@mb/shared';
import {
  useApproveSpecialOrder,
  usePrepareSpecialOrder,
  useSpecialOrders,
  useVerifySpecialOrder,
} from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { AttachmentGallery } from '@/components/shared/AttachmentGallery';
import { PhotoCapture } from '@/components/shared/PhotoCapture';
import { formatCurrency as money } from '@/utils/currency';
import { cn } from '@/lib/utils';

/**
 * Special Orders, for whichever side is looking.
 *
 * One panel for both, because it is one document moving between two desks:
 *
 *   production  sees every branch's orders and marks one PREPARED, entering how
 *               many it actually made. That quantity goes into Production Stock.
 *   branch      sees its own and VERIFIES & APPROVES a prepared one: the
 *               quantity received, with a photo. That quantity goes into the
 *               branch's stock and can be sold.
 *
 * It is deliberately separate from the demand table on both pages. A Special
 * Order is not a demand — it never appears in the demand list, the demand
 * summary or a demand total.
 *
 * There is no "add to stock" control anywhere here, and there must not be. Each
 * stock movement is written by the server as part of the step that causes it,
 * exactly once; a second, manual way to enter the same units is the thing this
 * workflow exists to rule out.
 */

const STATUS_STYLES: Record<SpecialOrderStatus, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  awaiting_verification: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  verified: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
};

/** Which status each side has to act on. `verified` is legacy — see the card. */
const NEEDS_ACTION: Record<'branch' | 'production', SpecialOrderStatus[]> = {
  branch: ['awaiting_verification'],
  production: ['pending', 'verified'],
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' }) : '';

/** Digits only — a whole, non-negative quantity as typed. */
const sanitizeQty = (raw: string) => raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
/** The typed quantity, or null while the box is empty. 0 is a real answer. */
const parseQty = (raw: string | undefined): number | null => {
  if (raw === undefined || raw.trim() === '') return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

/** What Production made, falling back to the request for an order prepared before quantities were recorded. */
const preparedOf = (item: SpecialOrderItem) => item.preparedQty ?? item.qty;

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium">{children}</dd>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-muted-foreground">{label} </span>
      <span className="font-semibold tabular-nums">{value}</span>
    </span>
  );
}

function QtyBox({
  label,
  value,
  onChange,
  invalid,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  invalid?: boolean;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Input
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        aria-label={label}
        aria-invalid={invalid}
        disabled={disabled}
        value={value}
        onChange={(e) => onChange(sanitizeQty(e.target.value))}
        onFocus={(e) => e.currentTarget.select()}
        className={cn('h-10 w-24 text-center text-base tabular-nums', invalid && 'border-destructive')}
      />
    </label>
  );
}

function SpecialOrderCard({ order, mode, token }: { order: SpecialOrder; mode: 'branch' | 'production'; token: string }) {
  const prepareMut = usePrepareSpecialOrder(token);
  const verifyMut = useVerifySpecialOrder(token);
  const approveMut = useApproveSpecialOrder(token);
  // The verification photo, staged here until the branch presses Verify & Approve.
  const [photos, setPhotos] = useState<Attachment[]>([]);
  // Quantities being entered, by item id. Absent = not touched yet, which reads
  // as the default: the full requested (prepare) or prepared (verify) quantity.
  const [qtyById, setQtyById] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  const canPrepare = mode === 'production' && order.status === 'pending';
  const canVerify = mode === 'branch' && order.status === 'awaiting_verification';

  const typed = (item: SpecialOrderItem, fallback: number) => qtyById[item.id] ?? String(fallback);
  const setQty = (id: string, next: string) => setQtyById((prev) => ({ ...prev, [id]: next }));

  const preparing = order.items.map((item) => ({ item, qty: parseQty(typed(item, item.qty)) }));
  const prepareProblem = preparing.some((p) => p.qty === null)
    ? 'Enter the quantity prepared for every item.'
    : preparing.every((p) => p.qty === 0)
      ? 'Enter the quantity prepared for at least one item.'
      : null;

  const receiving = order.items.map((item) => ({ item, qty: parseQty(typed(item, preparedOf(item))) }));
  const overReceived = receiving.find((r) => r.qty !== null && r.qty > preparedOf(r.item));
  const verifyProblem = receiving.some((r) => r.qty === null)
    ? 'Enter the quantity received for every item.'
    : overReceived
      ? `Received quantity for ${overReceived.item.itemName} cannot be more than the ${preparedOf(overReceived.item)} prepared.`
      : photos.length === 0
        ? 'Add a photo of what you received.'
        : null;

  const run = async (action: () => Promise<unknown>, done: string, failed: string) => {
    try {
      await action();
      toast.success(done);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : failed);
    }
  };

  const submitVerification = () =>
    run(
      async () => {
        await verifyMut.mutateAsync({
          id: order.id,
          attachmentIds: photos.map((p) => p.id),
          items: receiving.map((r) => ({ itemId: r.item.id, receivedQty: r.qty ?? 0 })),
        });
        setPhotos([]);
        setQtyById({});
        setConfirmOpen(false);
      },
      'Verified & approved — added to your stock',
      'Could not verify this Special Order',
    );

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
              {/* Requested, prepared and received are three figures, each shown
                  once it exists — never folded into one. */}
              <div className="flex flex-wrap justify-end gap-x-4 gap-y-0.5 text-sm">
                <Figure label="Requested" value={item.qty} />
                {item.preparedQty !== null && <Figure label="Prepared" value={item.preparedQty} />}
                {item.verifiedQty !== null && <Figure label="Received" value={item.verifiedQty} />}
                <Figure label="Amount" value={money(item.amount)} />
              </div>
            </div>
            {item.description && <p className="text-xs text-muted-foreground">{item.description}</p>}
            {item.requestPhotos.length > 0 && (
              <AttachmentGallery attachments={item.requestPhotos} size="xs" title="Requested photo" />
            )}

            {canPrepare && (
              <QtyBox
                label="Prepared Qty"
                value={typed(item, item.qty)}
                onChange={(next) => setQty(item.id, next)}
                invalid={parseQty(typed(item, item.qty)) === null}
                disabled={prepareMut.isPending}
              />
            )}
            {canVerify && (
              <QtyBox
                label="Received Qty"
                value={typed(item, preparedOf(item))}
                onChange={(next) => setQty(item.id, next)}
                invalid={(() => {
                  const q = parseQty(typed(item, preparedOf(item)));
                  return q === null || q > preparedOf(item);
                })()}
                disabled={verifyMut.isPending}
              />
            )}

            {item.stockTransactionNo && (
              <p className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                +{preparedOf(item)} in Production Stock · {item.stockTransactionNo}
              </p>
            )}
            {order.status === 'approved' && item.verifiedQty !== null && (
              <p className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                +{item.verifiedQty} in {order.branchName || 'branch'} stock · {order.orderNumber}/{item.lineNo}
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
          <p className="text-xs font-medium">Received item photo</p>
          <AttachmentGallery attachments={order.verificationPhotos} title="Received item photo" />
        </div>
      )}

      {/* ── What this side can do now ─────────────────────────────────────── */}
      {canPrepare && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            {prepareProblem ?? 'Marking it prepared adds the Prepared Qty to Production Stock. No separate stock entry is needed.'}
          </p>
          <Button
            size="sm"
            disabled={prepareMut.isPending || prepareProblem !== null}
            onClick={() =>
              run(
                async () => {
                  await prepareMut.mutateAsync({
                    id: order.id,
                    items: preparing.map((p) => ({ itemId: p.item.id, preparedQty: p.qty ?? 0 })),
                  });
                  setQtyById({});
                },
                'Prepared — added to Production Stock and sent to the branch to verify',
                'Could not mark it prepared',
              )
            }
          >
            {prepareMut.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <PackageCheck className="mr-1.5 h-4 w-4" />}
            Mark Prepared
          </Button>
        </div>
      )}

      {canVerify && (
        <div className="space-y-2 rounded-lg border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-900 dark:bg-blue-950/30">
          <PhotoCapture
            entity="special_order_verification"
            value={photos}
            onChange={setPhotos}
            label="Received item photo"
            required
            disabled={verifyMut.isPending}
            hint="Photograph what you received. It is kept alongside the photo you ordered it with — it does not replace it."
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{verifyProblem ?? 'Check the Received Qty above, then verify.'}</p>
            <Button size="sm" disabled={verifyProblem !== null || verifyMut.isPending} onClick={() => setConfirmOpen(true)}>
              Verify &amp; Approve
            </Button>
          </div>
        </div>
      )}

      {/* LEGACY: an order the branch verified before verification itself moved
          the stock. Nothing raised since reaches this state. */}
      {mode === 'production' && order.status === 'verified' && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Verified by the branch under the earlier workflow. Approving books it into Production Stock and on to the
            branch&apos;s stock, once.
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
        <p className="text-xs text-muted-foreground">Verified — it is added to your stock when Production approves it.</p>
      )}
      {mode === 'production' && order.status === 'awaiting_verification' && (
        <p className="text-xs text-muted-foreground">
          Prepared and in Production Stock — it moves to the branch&apos;s stock when the branch verifies it with a photo.
        </p>
      )}

      <Dialog open={confirmOpen} onOpenChange={(o) => !verifyMut.isPending && setConfirmOpen(o)}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle>Verify &amp; Approve {order.orderNumber}?</DialogTitle>
            <DialogDescription>
              After approval, the verified quantity will be added to Branch Stock and become available for sale.
            </DialogDescription>
          </DialogHeader>
          <ul className="divide-y rounded-lg border text-sm">
            {receiving.map(({ item, qty }) => (
              <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate font-medium">{item.itemName}</span>
                <span className="shrink-0 tabular-nums">
                  {qty ?? 0} received <span className="text-muted-foreground">of {preparedOf(item)} prepared</span>
                </span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={verifyMut.isPending}>
              Cancel
            </Button>
            <Button onClick={submitVerification} disabled={verifyMut.isPending || verifyProblem !== null}>
              {verifyMut.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Verify &amp; Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function SpecialOrdersPanel({ mode, token }: { mode: 'branch' | 'production'; token: string }) {
  const ordersQ = useSpecialOrders(token);
  const [showDone, setShowDone] = useState(false);

  // Production is finished with an order the moment the branch verifies it — the
  // units have left Production Stock and there is nothing left to do — so it
  // drops off this screen then. Only the branch keeps the last week's history.
  const orders = (ordersQ.data ?? []).filter((o) => mode === 'branch' || o.status !== 'approved');
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
              Verified &amp; approved in the last 7 days ({done.length})
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
