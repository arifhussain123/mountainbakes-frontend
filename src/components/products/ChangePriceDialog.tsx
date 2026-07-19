'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import type { Product } from '@mb/shared';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';

/** Today's date 'YYYY-MM-DD' in Asia/Karachi (en-CA formats as ISO). */
function karachiToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi' }).format(new Date());
}

export function ChangePriceDialog({
  product,
  open,
  onOpenChange,
  onSuccess,
}: {
  product: Product | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSuccess?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Change Price</DialogTitle>
        </DialogHeader>
        {product && (
          <ChangePriceForm key={product.id} product={product} onDone={() => { onOpenChange(false); onSuccess?.(); }} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function ChangePriceForm({ product, onDone }: { product: Product; onDone: () => void }) {
  const { token } = useAuth();
  const [newPrice, setNewPrice] = useState<string>(String(product.price ?? ''));
  const [effectiveDate, setEffectiveDate] = useState<string>(karachiToday());
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const price = Number(newPrice);
    if (!Number.isFinite(price) || price <= 0) { toast.error('Enter a valid positive price'); return; }
    if (!reason.trim()) { toast.error('Please enter a reason'); return; }
    setSubmitting(true);
    try {
      const res = await apiCall<{ status: string; effectiveDate?: string }>(
        `/api/products/${product.id}/price`,
        { method: 'POST', body: JSON.stringify({ newPrice: price, effectiveDate, reason: reason.trim() }) },
        token,
      );
      if (res.status === 'skipped') toast.info('Price unchanged — nothing to do');
      else if (res.status === 'scheduled') toast.success(`Price scheduled for ${res.effectiveDate ?? effectiveDate}`);
      else toast.success('Price updated');
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change price');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/40 p-3 text-sm">
        <p className="font-medium">{product.name}</p>
        <p className="text-muted-foreground">
          Current price: <span className="font-semibold text-foreground">Rs.{Number(product.price ?? 0).toLocaleString()}</span>
        </p>
      </div>

      <div className="space-y-1">
        <Label>New Price (Rs.)</Label>
        <Input type="number" inputMode="decimal" value={newPrice} onChange={(e) => setNewPrice(e.target.value)} placeholder="1200" />
      </div>

      <div className="space-y-1">
        <Label>Effective Date</Label>
        <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
        <p className="text-xs text-muted-foreground">Today or earlier applies now; a future date activates at 2 AM on that day. Past sales are never affected.</p>
      </div>

      <div className="space-y-1">
        <Label>Reason</Label>
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Supplier price increase" />
      </div>

      <Button className="w-full" onClick={submit} disabled={submitting}>
        {submitting ? 'Saving…' : 'Save Price Change'}
      </Button>
    </div>
  );
}
