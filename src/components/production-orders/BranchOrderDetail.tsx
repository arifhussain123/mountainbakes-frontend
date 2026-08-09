'use client';

import type { BranchProductionOrder } from '@mb/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground'}`}>
      {status}
    </span>
  );
}

/**
 * Read-only demand detail for the branch side. Production owns quantity edits and
 * approval (see OrderPrintPreview); once a branch submits a demand it has one
 * demandNumber and a fixed items/packingItems list here, view-only.
 */
export function BranchOrderDetail({
  open,
  onOpenChange,
  order,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: BranchProductionOrder | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent mobile="fullscreen" className="md:max-w-2xl">
        {order && (
          <>
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{order.demandNumber}</span>
                <StatusPill status={order.status} />
              </DialogTitle>
              <p className="text-sm text-muted-foreground">{order.date} · {order.time}</p>
            </DialogHeader>

            <div className="max-h-[70vh] space-y-4 overflow-y-auto">
              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Products</h4>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Product</th>
                        <th className="px-3 py-2 text-right font-medium">Requested</th>
                        <th className="px-3 py-2 text-right font-medium">Approved</th>
                        <th className="px-3 py-2 text-right font-medium">Pending</th>
                      </tr>
                    </thead>
                    <tbody>
                      {order.items.map((it) => (
                        <tr key={it.productId} className="border-t">
                          <td className="px-3 py-2 font-medium">{it.productName}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{it.qty}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{it.approvedQty ?? '—'}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {it.remainingBalanceQty ? (
                              <span className="font-semibold text-amber-600">{it.remainingBalanceQty}</span>
                            ) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {order.packingItems && order.packingItems.length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Packing Materials</h4>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-medium">Material</th>
                          <th className="px-3 py-2 text-right font-medium">Requested</th>
                          <th className="px-3 py-2 text-right font-medium">Approved</th>
                        </tr>
                      </thead>
                      <tbody>
                        {order.packingItems.map((it) => (
                          <tr key={it.packingMaterialId} className="border-t">
                            <td className="px-3 py-2 font-medium">{it.materialName}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{it.qty}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{it.approvedQty ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {order.status !== 'pending' && (
                <p className="text-xs text-muted-foreground">
                  {order.status === 'approved'
                    ? `Approved by ${order.approvedByName ?? '—'} — items are locked and can no longer be changed.`
                    : 'Rejected — items are locked and can no longer be changed.'}
                </p>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
