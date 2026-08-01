'use client';

import { useCallback, useMemo, useState } from 'react';
import type { Product } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { PackagePlus, Save, Loader2, Eraser } from 'lucide-react';
import { sortProducts } from '@/utils/productSort';
import { toast } from 'sonner';

function digits(raw: string): string {
  return raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
}

export interface PrepareProductsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
  loadingProducts: boolean;
  submit: (items: { productId: string; qty: number }[]) => Promise<unknown>;
  submitting: boolean;
}

export function PrepareProductsModal({ open, onOpenChange, products, loadingProducts, submit, submitting }: PrepareProductsModalProps) {
  const [qtyById, setQtyById] = useState<Record<string, string>>({});

  // Same order the branch sees in its New Order popup — pound cakes grouped at
  // the end — so the two screens never list the same products differently.
  const ordered = useMemo(() => sortProducts(products), [products]);

  const selected = useMemo(
    () => ordered.map((p) => ({ productId: p.id, qty: parseInt(qtyById[p.id] ?? '', 10) || 0 })).filter((x) => x.qty > 0),
    [ordered, qtyById],
  );

  const setQty = useCallback((id: string, raw: string) => setQtyById((p) => ({ ...p, [id]: digits(raw) })), []);

  async function save() {
    if (selected.length === 0) { toast.error('Enter a quantity for at least one product.'); return; }
    try {
      await submit(selected);
      toast.success('Prepared products saved to production stock');
      setQtyById({});
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    }
  }

  const totalQty = selected.reduce((s, x) => s + x.qty, 0);

  return (
    <Dialog open={open} onOpenChange={(o) => !submitting && onOpenChange(o)}>
      <DialogContent
        showCloseButton
        mobile="fullscreen"
        className="flex flex-col gap-0 overflow-hidden p-0 md:w-[80vw] md:max-w-[80vw] md:rounded-2xl lg:w-[70vw] lg:max-w-[1000px]"
      >
        <div className="shrink-0 border-b bg-card px-5 py-4">
          <h2 className="flex items-center gap-2 font-heading text-base font-semibold sm:text-lg">
            <PackagePlus className="h-5 w-5 text-primary" /> Today&apos;s Prepared Products
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Enter the quantity prepared for each product.</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loadingProducts ? (
            <div className="space-y-2">
              {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : ordered.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">No active products available.</p>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden overflow-hidden rounded-lg border md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted hover:bg-muted">
                      <TableHead className="text-xs uppercase tracking-wide text-muted-foreground">Product</TableHead>
                      <TableHead className="w-32 text-xs uppercase tracking-wide text-muted-foreground">Qty Prepared</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {ordered.map((p) => {
                      const active = (parseInt(qtyById[p.id] ?? '', 10) || 0) > 0;
                      return (
                        <TableRow key={p.id} className={active ? 'bg-primary/5' : undefined}>
                          <TableCell>
                            <div className="font-medium">{p.name}</div>
                            {p.categoryName && <div className="text-xs text-muted-foreground">{p.categoryName}</div>}
                          </TableCell>
                          <TableCell>
                            <Input
                              type="text"
                              inputMode="numeric"
                              placeholder="0"
                              value={qtyById[p.id] ?? ''}
                              onChange={(e) => setQty(p.id, e.target.value)}
                              onFocus={(e) => e.currentTarget.select()}
                              className="h-9 w-24 text-center tabular-nums"
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile cards */}
              <div className="space-y-3 md:hidden">
                {ordered.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg border bg-card p-3">
                    <div className="min-w-0">
                      <p className="font-medium leading-tight">{p.name}</p>
                      {p.categoryName && <p className="text-xs text-muted-foreground">{p.categoryName}</p>}
                    </div>
                    <Input
                      type="text"
                      inputMode="numeric"
                      placeholder="0"
                      value={qtyById[p.id] ?? ''}
                      onChange={(e) => setQty(p.id, e.target.value)}
                      className="h-10 w-20 text-center tabular-nums"
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="shrink-0 flex flex-col gap-2 border-t bg-muted/40 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-baseline gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Total Prepared</span>
            <span className="text-lg font-bold tabular-nums text-primary">{totalQty}</span>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setQtyById({})} disabled={submitting}>
              <Eraser className="mr-1.5 h-4 w-4" /> Clear
            </Button>
            <Button onClick={save} disabled={submitting || selected.length === 0}>
              {submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />} Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
