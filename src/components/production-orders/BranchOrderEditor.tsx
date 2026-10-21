'use client';

import { useMemo, useState } from 'react';
import type { BranchProductionOrder } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useEditProductionOrder, usePackingMaterials, useProducts } from '@/lib/queries';
import { sortProducts } from '@/utils/productSort';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

function digits(raw: string): string {
  return raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
}

interface ProductRow { productId: string; productName: string; qty: string }
interface PackingRow { packingMaterialId: string; materialName: string; qty: string }

/**
 * The branch editing a demand it has sent, while it is still 'pending' — before
 * Production submits it for verification. Change a quantity, remove a line, add
 * a product or packing material, then Save.
 *
 * Saving sends the branch's whole demand as it now stands (the API removes what
 * is left out). Lines Production added itself are shown for context only: they
 * are not the branch's to change, and the API leaves them as they are.
 */
export function BranchOrderEditor({
  order,
  token,
  onCancel,
  onSaved,
}: {
  order: BranchProductionOrder;
  token: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const productsQ = useProducts(token, { isActive: true });
  const packingQ = usePackingMaterials(token);
  const editMut = useEditProductionOrder(token);

  const productionAdded = useMemo(
    () => order.items.filter((it) => it.addedByProduction && !it.isSpecial),
    [order.items],
  );

  // One row per product. A demand with the same product on two branch lines
  // (only possible on old data) shows them as one quantity; the API folds the
  // lines the same way when it saves.
  const [rows, setRows] = useState<ProductRow[]>(() => {
    const byId = new Map<string, ProductRow>();
    for (const it of order.items) {
      if (it.addedByProduction || it.isSpecial) continue;
      const prev = byId.get(it.productId);
      const qty = (prev ? Number(prev.qty) : 0) + (Number(it.qty) || 0);
      byId.set(it.productId, { productId: it.productId, productName: it.productName, qty: String(qty) });
    }
    return [...byId.values()];
  });
  const [packRows, setPackRows] = useState<PackingRow[]>(() =>
    (order.packingItems ?? []).map((it) => ({
      packingMaterialId: it.packingMaterialId,
      materialName: it.materialName,
      qty: String(Number(it.qty) || 0),
    })),
  );

  const [newProductId, setNewProductId] = useState('');
  const [newQty, setNewQty] = useState('');
  const [newMaterialId, setNewMaterialId] = useState('');
  const [newPackQty, setNewPackQty] = useState('');

  const productOptions = useMemo(
    () => sortProducts(productsQ.data ?? []).filter((p) => !rows.some((r) => r.productId === p.id)),
    [productsQ.data, rows],
  );
  const materialOptions = useMemo(
    () => (packingQ.data ?? []).filter((m) => !packRows.some((r) => r.packingMaterialId === m.id)),
    [packingQ.data, packRows],
  );
  const productNameById = useMemo(
    () => new Map((productsQ.data ?? []).map((p) => [p.id, p.name])),
    [productsQ.data],
  );
  const materialNameById = useMemo(
    () => new Map((packingQ.data ?? []).map((m) => [m.id, m.materialName])),
    [packingQ.data],
  );

  function addProduct() {
    const qty = parseInt(newQty, 10);
    const name = productNameById.get(newProductId);
    if (!name || !qty) return;
    setRows((prev) => [...prev, { productId: newProductId, productName: name, qty: String(qty) }]);
    setNewProductId('');
    setNewQty('');
  }

  function addPacking() {
    const qty = parseInt(newPackQty, 10);
    const name = materialNameById.get(newMaterialId);
    if (!name || !qty) return;
    setPackRows((prev) => [...prev, { packingMaterialId: newMaterialId, materialName: name, qty: String(qty) }]);
    setNewMaterialId('');
    setNewPackQty('');
  }

  // A line at 0 or blank is ambiguous — "none of this" is said by removing the
  // line — so Save waits until every box has a quantity.
  const missingQty = [...rows, ...packRows].some((r) => !(parseInt(r.qty, 10) > 0));
  const empty = rows.length === 0 && packRows.length === 0;

  async function save() {
    try {
      await editMut.mutateAsync({
        id: order.id,
        items: rows.map((r) => ({ productId: r.productId, qty: parseInt(r.qty, 10) })),
        packingItems: packRows.map((r) => ({ packingMaterialId: r.packingMaterialId, qty: parseInt(r.qty, 10) })),
      });
      toast.success(`Demand ${order.demandNumber} updated`);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update the demand');
    }
  }

  const busy = editMut.isPending;

  return (
    <>
      <div className="max-h-[70dvh] space-y-4 overflow-y-auto">
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          Production has not sent this demand yet, so you can still change it. Edit a quantity, remove a
          line, or add what you missed, then click Save Changes.
        </p>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Products</h4>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead data-table-head className="text-left text-xs">
                <tr>
                  <th className="px-3 py-2 font-medium">Product</th>
                  <th className="px-3 py-2 text-center font-medium">Qty</th>
                  <th className="w-10 px-3 py-2"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr className="border-t">
                    <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">No products on this demand.</td>
                  </tr>
                )}
                {rows.map((r, idx) => (
                  <tr key={r.productId} className="border-t">
                    <td className="px-3 py-2 font-medium">{r.productName}</td>
                    <td className="px-3 py-1.5 text-center">
                      <Input
                        type="text"
                        inputMode="numeric"
                        aria-label={`${r.productName} quantity`}
                        value={r.qty}
                        disabled={busy}
                        onChange={(e) =>
                          setRows((prev) => prev.map((x, i) => (i === idx ? { ...x, qty: digits(e.target.value) } : x)))
                        }
                        className="mx-auto h-8 w-20 text-center tabular-nums"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Remove ${r.productName}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {productionAdded.map((it, idx) => (
                  <tr key={`prod-${idx}`} className="border-t bg-muted/30 text-muted-foreground">
                    <td className="px-3 py-2">
                      {it.productName} <span className="text-xs">(added by Production)</span>
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums">{it.qty}</td>
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Add product</label>
              <Select value={newProductId} onValueChange={(v) => v && setNewProductId(String(v))}>
                <SelectTrigger className="h-9 w-full" disabled={busy}>
                  {/* base-ui renders the raw value (a uuid) unless given a label. */}
                  <SelectValue placeholder={productsQ.isLoading ? 'Loading…' : 'Select a product'}>
                    {(value) =>
                      productNameById.get(String(value ?? '')) ?? (productsQ.isLoading ? 'Loading…' : 'Select a product')
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {productOptions.map((p) => (
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
                disabled={busy}
                onChange={(e) => setNewQty(digits(e.target.value))}
                className="h-9"
              />
            </div>
            <Button variant="outline" className="h-9" disabled={busy || !newProductId || !parseInt(newQty, 10)} onClick={addProduct}>
              <Plus className="mr-1.5 h-4 w-4" /> Add
            </Button>
          </div>
        </div>

        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Packing Materials</h4>
          {packRows.length > 0 && (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead data-table-head className="text-left text-xs">
                  <tr>
                    <th className="px-3 py-2 font-medium">Material</th>
                    <th className="px-3 py-2 text-center font-medium">Qty</th>
                    <th className="w-10 px-3 py-2"><span className="sr-only">Remove</span></th>
                  </tr>
                </thead>
                <tbody>
                  {packRows.map((r, idx) => (
                    <tr key={r.packingMaterialId} className="border-t">
                      <td className="px-3 py-2 font-medium">{r.materialName}</td>
                      <td className="px-3 py-1.5 text-center">
                        <Input
                          type="text"
                          inputMode="numeric"
                          aria-label={`${r.materialName} quantity`}
                          value={r.qty}
                          disabled={busy}
                          onChange={(e) =>
                            setPackRows((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, qty: digits(e.target.value) } : x)),
                            )
                          }
                          className="mx-auto h-8 w-20 text-center tabular-nums"
                        />
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => setPackRows((prev) => prev.filter((_, i) => i !== idx))}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label={`Remove ${r.materialName}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-2 flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Add packing material</label>
              <Select value={newMaterialId} onValueChange={(v) => v && setNewMaterialId(String(v))}>
                <SelectTrigger className="h-9 w-full" disabled={busy}>
                  <SelectValue placeholder={packingQ.isLoading ? 'Loading…' : 'Select a packing material'}>
                    {(value) =>
                      materialNameById.get(String(value ?? '')) ??
                      (packingQ.isLoading ? 'Loading…' : 'Select a packing material')
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {materialOptions.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.materialName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 sm:w-24">
              <label className="text-xs font-medium text-muted-foreground">Qty</label>
              <Input
                type="text"
                inputMode="numeric"
                value={newPackQty}
                disabled={busy}
                onChange={(e) => setNewPackQty(digits(e.target.value))}
                className="h-9"
              />
            </div>
            <Button
              variant="outline"
              className="h-9"
              disabled={busy || !newMaterialId || !parseInt(newPackQty, 10)}
              onClick={addPacking}
            >
              <Plus className="mr-1.5 h-4 w-4" /> Add
            </Button>
          </div>
        </div>

        {empty && (
          <p className="text-xs text-destructive">
            A demand needs at least one item. To withdraw the whole demand, use Delete instead.
          </p>
        )}
        {!empty && missingQty && (
          <p className="text-xs text-destructive">Enter a quantity on every line, or remove the line.</p>
        )}
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={save} disabled={busy || empty || missingQty}>
          {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null} Save Changes
        </Button>
      </div>
    </>
  );
}
