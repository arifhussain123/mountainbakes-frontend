'use client';

import { useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import type { ProductionReturn } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import {
  useProductionReturns, useCreateReturn, useReviewReturn, useBranches, useProducts,
} from '@/lib/queries';import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable } from '@/components/shared/DataTable';
import { Plus, Check, X } from 'lucide-react';
import { toast } from 'sonner';

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  accepted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  rejected: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
};
const short = (name: string) => name.replace('Mountain Bakes ', '');

export function ProductionReturnsPage() {
  const { token } = useAuth();
  const returnsQ = useProductionReturns(token);
  const branchesQ = useBranches(token);
  const productsQ = useProducts(token, { isActive: true });
  const createMut = useCreateReturn(token);
  const reviewMut = useReviewReturn(token);

  const [open, setOpen] = useState(false);
  const [branchId, setBranchId] = useState('');
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');

  function reset() {
    setBranchId(''); setProductId(''); setQty(''); setReason('');
  }

  async function save() {
    const q = parseInt(qty, 10) || 0;
    if (!branchId || !productId || q <= 0 || !reason.trim()) {
      toast.error('Fill in branch, product, quantity and reason.');
      return;
    }
    try {
      await createMut.mutateAsync({ branchId, productId, qty: q, reason: reason.trim() });
      toast.success('Return recorded');
      reset();
      setOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to record return');
    }
  }

  async function review(id: string, status: 'accepted' | 'rejected') {
    try {
      await reviewMut.mutateAsync({ id, status });
      toast.success(status === 'accepted' ? 'Return accepted — added back to production stock' : 'Return rejected');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to review return');
    }
  }

  const col = createColumnHelper<ProductionReturn>();
  const columns = [
    col.accessor('date', { header: 'Return Date', cell: (i) => <span className="text-sm">{i.getValue()}</span> }),
    col.accessor('branchName', { header: 'Branch', cell: (i) => <span className="font-medium">{short(i.getValue())}</span> }),
    col.accessor('productName', { header: 'Product', cell: (i) => <span>{i.getValue()}</span> }),
    col.accessor('qty', { header: 'Qty', cell: (i) => <span className="font-semibold tabular-nums">{i.getValue()}</span> }),
    col.accessor('reason', { header: 'Reason', cell: (i) => <span className="text-muted-foreground">{i.getValue()}</span> }),
    col.accessor('status', {
      header: 'Status',
      cell: (i) => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_STYLES[i.getValue()] ?? 'bg-muted'}`}>{i.getValue()}</span>
      ),
    }),
    col.display({
      id: 'actions',
      header: '',
      cell: ({ row }) => row.original.status === 'pending' ? (
        <div className="flex gap-1.5">
          <Button size="sm" className="h-8" onClick={() => review(row.original.id, 'accepted')} disabled={reviewMut.isPending}>
            <Check className="mr-1 h-3.5 w-3.5" /> Accept
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-red-600" onClick={() => review(row.original.id, 'rejected')} disabled={reviewMut.isPending}>
            <X className="mr-1 h-3.5 w-3.5" /> Reject
          </Button>
        </div>
      ) : <span className="text-xs text-muted-foreground">—</span>,
    }),
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Product Returns</h2>
          <p className="text-sm text-muted-foreground">Last 30 days</p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="mr-1 h-4 w-4" /> New Return
        </Button>
      </div>

      <DataTable columns={columns} data={returnsQ.data ?? []} loading={returnsQ.isLoading} searchPlaceholder="Search returns…" />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Record a Product Return</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label>Branch</Label>
              <Select value={branchId} onValueChange={(v) => setBranchId((v as string) ?? '')}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select branch" /></SelectTrigger>
                <SelectContent>
                  {(branchesQ.data ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Product</Label>
              <Select value={productId} onValueChange={(v) => setProductId((v as string) ?? '')}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select product" /></SelectTrigger>
                <SelectContent>
                  {(productsQ.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Quantity</Label>
              <Input type="text" inputMode="numeric" placeholder="0" value={qty} onChange={(e) => setQty(e.target.value.replace(/\D/g, ''))} />
            </div>
            <div className="space-y-1">
              <Label>Reason</Label>
              <Textarea placeholder="e.g. Damaged / unsold / expired" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            <Button className="w-full" size="lg" onClick={save} disabled={createMut.isPending}>
              {createMut.isPending ? 'Saving…' : 'Save Return'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
