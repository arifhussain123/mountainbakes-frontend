'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { apiCall, ApiError } from '@/utils/api';
import { type StockRow, businessDateStr, karachiTimeStr } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

export function ReturnItemsModal({
  open,
  onOpenChange,
  rows,
  branchName,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: StockRow[];
  branchName: string;
  onSaved: () => void;
}) {
  const { token } = useAuth();
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState<number>(1);
  const [reason, setReason] = useState('');
  const [stamp, setStamp] = useState({ date: '', time: '' });
  const [submitting, setSubmitting] = useState(false);

  // Only products with stock on hand can be returned.
  const returnable = useMemo(() => rows.filter((r) => r.balance > 0).sort((a, b) => a.productName.localeCompare(b.productName)), [rows]);
  const selected = returnable.find((r) => r.productId === productId) ?? null;
  const available = selected?.balance ?? 0;

  // Reset fields and capture the auto date/time each time the dialog opens.
  useEffect(() => {
    if (open) {
      const now = new Date();
      setStamp({ date: businessDateStr(now), time: karachiTimeStr(now) });
      setProductId('');
      setQty(1);
      setReason('');
    }
  }, [open]);

  const exceeds = !!selected && qty > available;
  const valid = !!productId && qty > 0 && !exceeds;

  async function onSave() {
    if (!valid || !selected) return;
    setSubmitting(true);
    try {
      await apiCall(
        '/api/stock/return',
        { method: 'POST', body: JSON.stringify({ productId, qty, reason: reason.trim() }) },
        token,
      );
      toast.success(`Returned ${qty} × ${selected.productName} to production`);
      onOpenChange(false);
      onSaved();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save return');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Return Items</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Auto fields */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Date</Label>
              <Input value={stamp.date} readOnly disabled />
            </div>
            <div className="space-y-1">
              <Label>Time</Label>
              <Input value={stamp.time} readOnly disabled />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Branch Name</Label>
            <Input value={branchName} readOnly disabled />
          </div>

          <Separator />

          {/* Product + balance */}
          <div className="space-y-1">
            <Label>Product</Label>
            <Select value={productId || null} onValueChange={(v) => setProductId((v as string) ?? '')}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={returnable.length ? 'Select a product…' : 'No products in stock'} />
              </SelectTrigger>
              <SelectContent>
                {returnable.map((r) => (
                  <SelectItem key={r.productId} value={r.productId}>
                    {r.productName} — {r.balance} in stock
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Available Balance</Label>
              <Input value={selected ? String(available) : ''} readOnly disabled placeholder="—" />
            </div>
            <div className="space-y-1">
              <Label>Return Quantity</Label>
              <Input
                type="number"
                min={1}
                max={available || undefined}
                value={Number.isFinite(qty) ? qty : ''}
                onChange={(e) => setQty(e.target.valueAsNumber)}
                disabled={!selected}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Return Reason (optional)</Label>
            <Textarea placeholder="Damaged / unsold / expired…" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>

          {exceeds && (
            <p className="text-sm font-medium text-red-700 dark:text-red-400">
              ❌ Return quantity cannot be greater than available stock.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 pt-1">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button type="button" onClick={onSave} disabled={!valid || submitting}>
              <RotateCcw className="h-4 w-4 mr-1.5" /> {submitting ? 'Saving…' : 'Save Return'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
