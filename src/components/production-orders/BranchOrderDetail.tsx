'use client';

import { useState } from 'react';
import type { Attachment, BranchProductionOrder } from '@mb/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AttachmentGallery } from '@/components/shared/AttachmentGallery';
import { PhotoCapture } from '@/components/shared/PhotoCapture';
import { useProducts, useVerifyProductionOrder } from '@/lib/queries';
import { Loader2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  awaiting_verification: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400',
  verified: 'bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
};

const STATUS_LABELS: Record<string, string> = {
  awaiting_verification: 'Awaiting Verification',
  verified: 'Verified — Awaiting Approval',
};

function StatusPill({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground'}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function digits(raw: string): string {
  return raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
}

/**
 * Branch demand detail. Read-only for 'pending'/'approved'/'rejected' — Production
 * owns quantity edits before submission (see OrderPrintPreview). For
 * 'awaiting_verification' this becomes interactive: the branch checks what
 * physically arrived against what Production recorded, corrects any
 * shortage/overage, and can add items that showed up unrequested, then clicks
 * Verify. That is the point at which stock actually moves into branch
 * inventory, for the counted quantity; Production then signs the order off.
 */
export function BranchOrderDetail({
  open,
  onOpenChange,
  order,
  token,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: BranchProductionOrder | null;
  token: string;
}) {
  const awaitingVerification = order?.status === 'awaiting_verification';
  const productsQ = useProducts(token, { enabled: awaitingVerification });
  const verifyMut = useVerifyProductionOrder(token);

  const [verifiedQtys, setVerifiedQtys] = useState<Record<string, string>>({});
  const [newItems, setNewItems] = useState<{ productId: string; productName: string; qty: number }[]>([]);
  const [addingItem, setAddingItem] = useState(false);
  const [newProductId, setNewProductId] = useState('');
  const [newQty, setNewQty] = useState('');
  /** Photos of the delivery as counted. Cleared with the rest of the form. */
  const [photos, setPhotos] = useState<Attachment[]>([]);

  function resetLocalState() {
    setVerifiedQtys({});
    setNewItems([]);
    setAddingItem(false);
    setNewProductId('');
    setNewQty('');
    setPhotos([]);
  }

  function addStagedItem() {
    const qty = parseInt(newQty, 10);
    const product = (productsQ.data ?? []).find((p) => p.id === newProductId);
    if (!product || !qty || qty <= 0) return;
    setNewItems((prev) => [...prev, { productId: product.id, productName: product.name, qty }]);
    setAddingItem(false);
    setNewProductId('');
    setNewQty('');
  }

  async function verify() {
    if (!order) return;
    const verifiedItems = order.items.map((it) => ({
      productId: it.productId,
      verifiedQty: parseInt(verifiedQtys[it.productId] ?? String(it.approvedQty ?? it.qty), 10) || 0,
    }));
    try {
      await verifyMut.mutateAsync({
        id: order.id,
        verifiedItems,
        newItems: newItems.map(({ productId, qty }) => ({ productId, qty })),
        attachmentIds: photos.map((p) => p.id),
      });
      toast.success('Verified — sent to Production for final approval');
      resetLocalState();
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to verify order');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) resetLocalState();
        onOpenChange(o);
      }}
    >
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
              {awaitingVerification && (
                <p className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">
                  Check the physical items received against the quantities below. Correct any shortage or
                  overage in &quot;Verified Qty&quot;, add anything that arrived but isn&apos;t listed, then click Verify.
                  Verifying is what adds these goods to your branch stock, so count before you confirm.
                </p>
              )}

              <div>
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Products</h4>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                      <tr>
                        {/* Every figure is centred under its heading, in both
                            states of this table — the editable "Verified Qty"
                            one and the read-only "Pending" one — so the columns
                            do not shift when the order changes status. Only the
                            product name stays left. */}
                        <th className="px-3 py-2 font-medium">Product</th>
                        <th className="px-3 py-2 text-center font-medium">Requested</th>
                        <th className="px-3 py-2 text-center font-medium">Approved</th>
                        {awaitingVerification ? (
                          <th className="px-3 py-2 text-center font-medium">Verified Qty</th>
                        ) : (
                          <th className="px-3 py-2 text-center font-medium">Pending</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {order.items.map((it) => (
                        <tr key={it.productId} className="border-t">
                          <td className="px-3 py-2 font-medium">
                            {it.productName}
                            {/* A special line moves stock like any other, so it
                                is counted and verified in this same table — the
                                badge is what tells the counter that this one was
                                made to order rather than picked off the shelf. */}
                            {it.isSpecial && (
                              <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-primary">
                                Special
                              </span>
                            )}
                            {it.isSpecial && it.description && (
                              <p className="mt-0.5 text-xs font-normal text-muted-foreground">{it.description}</p>
                            )}
                          </td>
                          <td className="px-3 py-2 text-center tabular-nums">{it.qty}</td>
                          <td className="px-3 py-2 text-center tabular-nums">{it.approvedQty ?? '—'}</td>
                          {awaitingVerification ? (
                            <td className="px-3 py-1.5 text-center">
                              {/* mx-auto, not ml-auto: the box itself is centred
                                  in the column like the plain figures around it,
                                  and the digits are centred inside the box. */}
                              <Input
                                type="text"
                                inputMode="numeric"
                                value={verifiedQtys[it.productId] ?? String(it.approvedQty ?? it.qty)}
                                onChange={(e) =>
                                  setVerifiedQtys((p) => ({ ...p, [it.productId]: digits(e.target.value) }))
                                }
                                className="mx-auto h-8 w-20 text-center tabular-nums"
                              />
                            </td>
                          ) : (
                            <td className="px-3 py-2 text-center tabular-nums">
                              {it.remainingBalanceQty ? (
                                <span className="font-semibold text-amber-600">{it.remainingBalanceQty}</span>
                              ) : '—'}
                            </td>
                          )}
                        </tr>
                      ))}
                      {newItems.map((it, idx) => (
                        <tr key={`new-${it.productId}`} className="border-t bg-emerald-50/50 dark:bg-emerald-950/20">
                          <td className="px-3 py-2 font-medium">
                            {it.productName} <span className="text-xs font-normal text-emerald-600">(new)</span>
                          </td>
                          <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">—</td>
                          <td className="px-3 py-2 text-center tabular-nums text-muted-foreground">—</td>
                          <td className="px-3 py-1.5 text-center">
                            {/* Centred as a unit — the quantity with its remove
                                control — so it lines up with the inputs above. */}
                            <div className="flex items-center justify-center gap-2">
                              <span className="tabular-nums">{it.qty}</span>
                              <button
                                type="button"
                                onClick={() => setNewItems((prev) => prev.filter((_, i) => i !== idx))}
                                className="text-muted-foreground hover:text-foreground"
                                aria-label="Remove"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {awaitingVerification && (
                  <div className="mt-2">
                    {addingItem ? (
                      <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-end">
                        <div className="min-w-0 flex-1 space-y-1">
                          <label className="text-xs font-medium text-muted-foreground">Product</label>
                          <Select value={newProductId} onValueChange={(v) => v && setNewProductId(v)}>
                            <SelectTrigger className="h-9 w-full">
                              <SelectValue placeholder={productsQ.isLoading ? 'Loading…' : 'Select a product'} />
                            </SelectTrigger>
                            <SelectContent>
                              {(productsQ.data ?? [])
                                .filter((p) => !order.items.some((it) => it.productId === p.id) && !newItems.some((it) => it.productId === p.id))
                                .map((p) => (
                                  <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1 sm:w-24">
                          <label className="text-xs font-medium text-muted-foreground">Qty</label>
                          <Input
                            type="text"
                            inputMode="numeric"
                            value={newQty}
                            onChange={(e) => setNewQty(digits(e.target.value))}
                            className="h-9"
                          />
                        </div>
                        <Button className="h-9" disabled={!newProductId || !newQty} onClick={addStagedItem}>
                          Add
                        </Button>
                        <Button variant="ghost" className="h-9" onClick={() => setAddingItem(false)}>Cancel</Button>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => setAddingItem(true)}>
                        <Plus className="mr-1.5 h-4 w-4" /> Add Item Not On This Demand
                      </Button>
                    )}
                  </div>
                )}
              </div>

              {order.packingItems && order.packingItems.length > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Packing Materials</h4>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                        <tr>
                          {/* Same centring as the products table above. */}
                          <th className="px-3 py-2 font-medium">Material</th>
                          <th className="px-3 py-2 text-center font-medium">Requested</th>
                          <th className="px-3 py-2 text-center font-medium">Approved</th>
                        </tr>
                      </thead>
                      <tbody>
                        {order.packingItems.map((it) => (
                          <tr key={it.packingMaterialId} className="border-t">
                            <td className="px-3 py-2 font-medium">{it.materialName}</td>
                            <td className="px-3 py-2 text-center tabular-nums">{it.qty}</td>
                            <td className="px-3 py-2 text-center tabular-nums">{it.approvedQty ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* What the branch photographed when it raised this demand. Shown
                  at every status — it is the context for the quantities above. */}
              {(order.demandPhotos?.length ?? 0) > 0 && (
                <div>
                  <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Demand Photo
                  </h4>
                  <AttachmentGallery attachments={order.demandPhotos} title="Demand photo" />
                </div>
              )}

              {awaitingVerification ? (
                <PhotoCapture
                  entity="production_order_verification"
                  value={photos}
                  onChange={setPhotos}
                  label="Delivery photo"
                  required
                  disabled={verifyMut.isPending}
                  hint="Photograph what arrived before you verify. This is Production's only record of the delivery."
                />
              ) : (
                (order.verificationPhotos?.length ?? 0) > 0 && (
                  <div>
                    <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Delivery Photo
                    </h4>
                    <AttachmentGallery attachments={order.verificationPhotos} title="Delivery photo" />
                  </div>
                )
              )}

              {order.status === 'approved' && (
                <p className="text-xs text-muted-foreground">
                  Approved by {order.approvedByName ?? '—'}
                  {order.verifiedByName ? ` · Verified by ${order.verifiedByName}` : ''} — items are locked and can no longer be changed.
                </p>
              )}
              {order.status === 'rejected' && (
                <p className="text-xs text-muted-foreground">Rejected — items are locked and can no longer be changed.</p>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={verifyMut.isPending}>
                Close
              </Button>
              {awaitingVerification && (
                // Disabled without a photo rather than letting the API 400 after
                // the user has already committed to the count.
                <Button onClick={verify} disabled={verifyMut.isPending || photos.length === 0}>
                  {verifyMut.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null} Verify
                </Button>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
