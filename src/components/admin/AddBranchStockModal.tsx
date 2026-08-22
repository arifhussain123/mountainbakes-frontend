'use client';

import { useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSaveAdminStock } from '@/lib/queries';
import type { StockRow } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ApiError } from '@/utils/api';
import { toast } from 'sonner';

/**
 * Admin → Branch Stock → Add Stock.
 *
 * The table behind this dialog edits ABSOLUTE figures, which is the right tool
 * for reconciling a day and the wrong one for the commonest admin job: "give this
 * branch twenty more units". Doing that on the table means finding the product,
 * reading its current New Stock, and typing the sum — arithmetic the admin should
 * not be doing, and the number they read may already be stale.
 *
 * So this dialog takes a quantity to ADD and turns it into the absolute target
 * itself. The request is still absolute (current + qty), which is what keeps the
 * server's live-figure sizing meaningful; the addition just happens where the
 * current figure is known rather than in someone's head.
 *
 * Every active product is offered, including ones sitting at zero — a product
 * that has never moved in this branch has no `stock` row at all, and the
 * correction upserts one. That is what makes this the "add" in add/edit/delete.
 */

/** Which ledger column the added units land in. */
const BOOK_AS = [
  {
    value: 'newQty' as const,
    label: 'New Stock',
    hint: 'Books the units as production delivered today — the same column an approved demand fills.',
  },
  {
    value: 'adjustment' as const,
    label: 'Adjustment',
    hint: 'Books them as an admin correction. Use for a stock-take fix rather than a real delivery.',
  },
];

function sanitize(raw: string): string {
  return raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
}

/** Search the same two fields the stock table does: code and name. */
function matches(r: StockRow | null, query: string): boolean {
  if (r == null) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return r.stockCode.toLowerCase().includes(q) || r.productName.toLowerCase().includes(q);
}

export function AddBranchStockModal({
  open,
  onOpenChange,
  rows,
  branchId,
  branchName,
  date,
  reason,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: StockRow[];
  branchId: string;
  branchName: string;
  date: string;
  reason: string;
}) {
  const { token } = useAuth();
  const save = useSaveAdminStock(token ?? '');

  // Adding stock is a forward-looking act, so the picker offers active products
  // only. `rows` now also carries discontinued products that still hold stock —
  // they belong in the table being counted, not in a list of things to stock up.
  const sellable = useMemo(() => rows.filter((r) => r.isActive), [rows]);

  const [product, setProduct] = useState<StockRow | null>(null);
  const [qty, setQty] = useState('');
  const [bookAs, setBookAs] = useState<'newQty' | 'adjustment'>('newQty');

  // Reset on open, as a render-time adjustment rather than in an effect — an
  // effect renders the previous entry for a frame before clearing it.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setProduct(null);
      setQty('');
      setBookAs('newQty');
    }
  }

  const amount = parseInt(qty, 10);
  const valid = !!product && Number.isFinite(amount) && amount > 0;

  async function onSubmit() {
    if (!valid || !product) return;
    try {
      const result = await save.mutateAsync({
        branchId,
        date,
        reason: reason.trim(),
        // Absolute target = what is there now + what is being added.
        rows: [{ productId: product.productId, [bookAs]: product[bookAs] + amount }],
      });
      if (result.failed.length > 0) {
        toast.error(`${result.failed[0]!.productName}: ${result.failed[0]!.error}`);
        return;
      }
      toast.success(`Added ${amount} × ${product.productName} to ${branchName}`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to add stock');
    }
  }

  const preview = product
    ? `${product.productName}: ${bookAs === 'newQty' ? 'New' : 'Adjustment'} ${product[bookAs]} → ${product[bookAs] + (Number.isFinite(amount) ? amount : 0)}, balance ${product.balance} → ${product.balance + (Number.isFinite(amount) ? amount : 0)}`
    : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !save.isPending && onOpenChange(o)}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Stock — {branchName || 'branch'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Product</Label>
            {/* A Combobox rather than a Select, for the same reason the branch's
                Return Items dialog uses one: the product list is long and this
                has to work on a phone. */}
            <Combobox
              items={sellable}
              filter={matches}
              value={product}
              onValueChange={(r: StockRow | null) => setProduct(r)}
              itemToStringLabel={(r: StockRow) => r.productName}
              itemToStringValue={(r: StockRow) => r.productId}
              isItemEqualToValue={(a: StockRow, b: StockRow) => a?.productId === b?.productId}
            >
              <ComboboxInput
                aria-label="Product"
                placeholder="Search product…"
                className="text-base sm:text-sm"
              />
              <ComboboxContent>
                <ComboboxEmpty>No products found.</ComboboxEmpty>
                <ComboboxList>
                  {(r: StockRow) => (
                    <ComboboxItem key={r.productId} value={r}>
                      <div className="flex flex-1 flex-col">
                        <span className="font-medium">{r.productName}</span>
                        <span className="text-xs text-muted-foreground">
                          {r.stockCode} · {r.balance} in stock
                        </span>
                      </div>
                    </ComboboxItem>
                  )}
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="add-qty">Quantity to add</Label>
              <Input
                id="add-qty"
                type="text"
                inputMode="numeric"
                value={qty}
                onChange={(e) => setQty(sanitize(e.target.value))}
                placeholder="0"
                className="text-base tabular-nums sm:text-sm"
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="add-book-as">Book as</Label>
              <Select value={bookAs} onValueChange={(v) => v && setBookAs(v as 'newQty' | 'adjustment')}>
                <SelectTrigger id="add-book-as" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {BOOK_AS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            {BOOK_AS.find((o) => o.value === bookAs)!.hint} Dated {date}.
          </p>

          {preview && (
            <div className="rounded-lg border bg-muted/30 p-2.5 text-sm tabular-nums">{preview}</div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={save.isPending}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={!valid || save.isPending}>
            {save.isPending ? 'Adding…' : 'Add Stock'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
