'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Eye, Package, Pencil, Plus, Power, Trash2 } from 'lucide-react';
import type { StoreItem, StoreItemInput, StoreLookup } from '@mb/shared';
import { StoreItemInputSchema } from '@mb/shared';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useDeleteStoreItem, useSaveStoreItem, useSetStoreItemStatus, useStoreItemHistory, useStoreItems, useStoreLookups } from '@/lib/store';
import { ROUTES } from '@/utils/routes';
import {
  ConfirmDialog, ErrorBlock, Fact, Field, FilterSelect, Pill, StorePage, errorMessage, fdt, inputCls, num, qty, useStoreSession,
} from './parts';

/**
 * Store Items Maintenance (design: "Store Items Maintenance"). The master list
 * of dry items. Prices are set in Price Control and quantities move in Store
 * Stock, so neither is edited here.
 */

const col = createColumnHelper<StoreItem>();

interface Form {
  itemCode: string;
  name: string;
  category: string;
  baseUnit: string;
  purchaseUnit: string;
  conversionQty: string;
  minStock: string;
  remarks: string;
}

const lookupValues = (rows: StoreLookup[] | undefined, kind: StoreLookup['kind']) =>
  (rows ?? []).filter((l) => l.kind === kind && l.isActive).map((l) => l.value);

export function StoreItemsPage() {
  const session = useStoreSession();
  const { token, can } = session;
  const itemsQ = useStoreItems(token, true);
  const lookupsQ = useStoreLookups(token);
  const categories = lookupValues(lookupsQ.data, 'category');
  const baseUnits = lookupValues(lookupsQ.data, 'base_unit');
  const purchaseUnits = lookupValues(lookupsQ.data, 'purchase_unit');

  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [unit, setUnit] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<{ id?: string } | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [toggling, setToggling] = useState<StoreItem | null>(null);
  const [deleting, setDeleting] = useState<StoreItem | null>(null);

  const setStatusM = useSetStoreItemStatus(token);
  const deleteM = useDeleteStoreItem(token);
  const canEdit = can('items.edit');

  const all = useMemo(() => itemsQ.data ?? [], [itemsQ.data]);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all.filter((i) =>
      (!term || `${i.name} ${i.itemCode} ${i.itemNo}`.toLowerCase().includes(term)) &&
      (!cat || i.category === cat) && (!unit || i.baseUnit === unit) && (!status || i.status === status));
  }, [all, q, cat, unit, status]);

  const columns = useMemo(() => [
    col.accessor('itemNo', { header: 'Item ID', meta: { mobile: 'subtitle' }, cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span> }),
    col.accessor('itemCode', { header: 'Item Code', cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span> }),
    col.accessor('name', {
      header: 'Item Name',
      meta: { mobile: 'title' },
      cell: (c) => (
        <div className="min-w-[140px]">
          <div className="font-semibold">{c.getValue()}</div>
          {c.row.original.remarks ? <div className="text-xs text-muted-foreground">{c.row.original.remarks}</div> : null}
        </div>
      ),
    }),
    col.accessor('category', { header: 'Category' }),
    col.accessor('baseUnit', { header: 'Base Unit' }),
    col.accessor('purchaseUnit', { header: 'Purchase Unit' }),
    col.accessor('conversionQty', {
      header: 'Conversion',
      cell: (c) => <span className="whitespace-nowrap">1 {c.row.original.purchaseUnit} = {num(c.getValue())} {c.row.original.baseUnit}</span>,
    }),
    col.accessor('minStock', { header: 'Low-stock Level', meta: { align: 'center', mobile: 'figure' }, cell: (c) => <span className="tabular-nums">{qty(c.getValue(), c.row.original.baseUnit)}</span> }),
    col.accessor('availableQty', { header: 'In Store', meta: { align: 'center', mobile: 'figure' }, cell: (c) => <span className="tabular-nums">{qty(c.getValue(), c.row.original.baseUnit)}</span> }),
    col.accessor('status', {
      header: 'Status',
      meta: { mobile: 'badge' },
      cell: (c) => <Pill tone={c.getValue() === 'active' ? 'green' : 'muted'}>{c.getValue() === 'active' ? 'Active' : 'Inactive'}</Pill>,
    }),
    col.display({
      id: 'actions',
      header: 'Actions',
      cell: (c) => {
        const i = c.row.original;
        return (
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setViewing(i.id)}><Eye className="mr-1 h-3.5 w-3.5" />View</Button>
            {canEdit && (
              <>
                <Button size="sm" variant="outline" onClick={() => setEditing({ id: i.id })}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>
                <Button size="sm" variant="outline" className={i.status === 'active' ? 'text-red-700' : 'text-emerald-700'} onClick={() => setToggling(i)}>
                  <Power className="mr-1 h-3.5 w-3.5" />{i.status === 'active' ? 'Deactivate' : 'Activate'}
                </Button>
              </>
            )}
            {can('items.delete') && (
              <Button size="sm" variant="ghost" className="text-red-700" aria-label={`Delete ${i.name}`} onClick={() => setDeleting(i)}><Trash2 className="h-3.5 w-3.5" /></Button>
            )}
          </div>
        );
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canEdit, session.me.data]);

  return (
    <StorePage
      session={session}
      subtitle="Master list of dry items. Prices are set in Price Control and quantities in Store Stock."
      needs="view"
      actions={canEdit ? <Button onClick={() => setEditing({})}><Plus className="mr-1.5 h-4 w-4" />New Item</Button> : null}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search item, code or ID…" aria-label="Search" className={inputCls() + ' max-w-xs'} />
        <FilterSelect label="Category" value={cat} onChange={setCat}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </FilterSelect>
        <FilterSelect label="Unit" value={unit} onChange={setUnit}>
          <option value="">All units</option>
          {baseUnits.map((c) => <option key={c} value={c}>{c}</option>)}
        </FilterSelect>
        <FilterSelect label="Status" value={status} onChange={setStatus}>
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </FilterSelect>
        <span className="ml-auto text-[13px] text-muted-foreground">{rows.length} of {all.length} items</span>
      </div>

      {itemsQ.isError ? (
        <ErrorBlock error={itemsQ.error} onRetry={() => void itemsQ.refetch()} />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          loading={itemsQ.isLoading}
          sortable
          toolbar={false}
          pageSize={25}
          empty={
            <EmptyState
              icon={Package}
              title={all.length ? 'No items match these filters' : 'No dry items yet'}
              description={all.length ? 'Clear a filter to see more.' : 'Add the first dry item the store keeps.'}
              action={!all.length && canEdit ? <Button size="sm" onClick={() => setEditing({})}><Plus className="mr-1.5 h-4 w-4" />New Item</Button> : undefined}
            />
          }
        />
      )}

      {editing && (
        <ItemFormDialog
          token={token}
          item={editing.id ? all.find((i) => i.id === editing.id) ?? null : null}
          categories={categories}
          baseUnits={baseUnits}
          purchaseUnits={purchaseUnits}
          onClose={() => setEditing(null)}
        />
      )}
      {viewing && <ItemViewDialog token={token} id={viewing} onClose={() => setViewing(null)} />}

      <ConfirmDialog
        open={!!toggling}
        onOpenChange={(o) => !o && setToggling(null)}
        title={toggling?.status === 'active' ? `Deactivate ${toggling?.name}?` : `Activate ${toggling?.name}?`}
        description={toggling?.status === 'active'
          ? 'It can no longer be received or requested. Its stock and history stay.'
          : 'It can be received and requested again.'}
        confirmLabel={toggling?.status === 'active' ? 'Deactivate' : 'Activate'}
        destructive={toggling?.status === 'active'}
        pending={setStatusM.isPending}
        onConfirm={() => {
          if (!toggling) return;
          setStatusM.mutate({ id: toggling.id, active: toggling.status !== 'active' }, {
            onSuccess: (i) => { toast.success(i.status === 'active' ? `${i.name} is active again.` : `${i.name} deactivated.`); setToggling(null); },
            onError: (e) => { toast.error(errorMessage(e)); setToggling(null); },
          });
        }}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description="Only an item that was never received, priced or requested can be deleted. Anything else is deactivated instead, so its history stays."
        confirmLabel="Delete item"
        destructive
        pending={deleteM.isPending}
        onConfirm={() => {
          if (!deleting) return;
          deleteM.mutate(deleting.id, {
            onSuccess: () => { toast.success(`${deleting.name} deleted.`); setDeleting(null); },
            onError: (e) => { toast.error(errorMessage(e)); setDeleting(null); },
          });
        }}
      />
    </StorePage>
  );
}

function ItemFormDialog({ token, item, categories, baseUnits, purchaseUnits, onClose }: {
  token: string;
  item: StoreItem | null;
  categories: string[];
  baseUnits: string[];
  purchaseUnits: string[];
  onClose: () => void;
}) {
  const saveM = useSaveStoreItem(token);
  const [tried, setTried] = useState(false);
  const [f, setF] = useState<Form>(() => item
    ? { itemCode: item.itemCode, name: item.name, category: item.category, baseUnit: item.baseUnit, purchaseUnit: item.purchaseUnit, conversionQty: String(item.conversionQty), minStock: String(item.minStock), remarks: item.remarks ?? '' }
    : { itemCode: '', name: '', category: categories[0] ?? '', baseUnit: baseUnits[0] ?? 'KG', purchaseUnit: purchaseUnits[0] ?? 'Bag', conversionQty: '', minStock: '', remarks: '' });
  const set = (k: keyof Form) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const input: StoreItemInput = {
    itemCode: f.itemCode.trim().toUpperCase(),
    name: f.name.trim(),
    category: f.category,
    baseUnit: f.baseUnit,
    purchaseUnit: f.purchaseUnit,
    conversionQty: Number(f.conversionQty),
    minStock: f.minStock === '' ? NaN : Number(f.minStock),
    remarks: f.remarks.trim() || null,
  };
  const parsed = StoreItemInputSchema.safeParse(input);
  const errs: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
  const e = (k: string) => (tried ? errs[k] ?? null : null);
  const convOk = Number(f.conversionQty) > 0;

  const save = () => {
    if (!parsed.success) { setTried(true); return; }
    saveM.mutate({ id: item?.id, input: parsed.data }, {
      onSuccess: (i) => {
        toast.success(item ? `${i.name} updated.` : `${i.name} added as ${i.itemNo}. Set its price in Price Control before receiving it.`);
        onClose();
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !saveM.isPending && onClose()}>
      <DialogContent className="md:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{item ? `Edit ${item.itemNo}` : 'New Store Item'}</DialogTitle>
          <DialogDescription>{item ? 'Changes are recorded in the item history.' : 'Store Item ID is assigned when you save.'}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Item Name" required error={e('name')}>
            <input className={inputCls(!!e('name'))} value={f.name} onChange={(x) => set('name')(x.target.value)} placeholder="e.g. Brown Sugar" />
          </Field>
          <Field label="Item Code" required error={e('itemCode')}>
            <input className={inputCls(!!e('itemCode'))} value={f.itemCode} onChange={(x) => set('itemCode')(x.target.value)} placeholder="e.g. SUG-002" />
          </Field>
          <Field label="Category">
            <select className={inputCls()} value={f.category} onChange={(x) => set('category')(x.target.value)}>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Base Unit" hint={item ? 'Can\'t change once stock has moved.' : undefined}>
            <select className={inputCls()} value={f.baseUnit} onChange={(x) => set('baseUnit')(x.target.value)}>
              {baseUnits.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Purchase Unit">
            <select className={inputCls()} value={f.purchaseUnit} onChange={(x) => set('purchaseUnit')(x.target.value)}>
              {purchaseUnits.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Conversion Quantity" required error={e('conversionQty')}
            hint={convOk ? `1 ${f.purchaseUnit} = ${f.conversionQty} ${f.baseUnit}` : `${f.baseUnit} in one ${f.purchaseUnit}`}>
            <input inputMode="decimal" className={inputCls(!!e('conversionQty'))} value={f.conversionQty} onChange={(x) => set('conversionQty')(x.target.value.replace(/[^\d.]/g, ''))} placeholder="e.g. 50" />
          </Field>
          <Field label="Low-stock Level" required error={e('minStock')} hint={`Flag as low stock at or below this many ${f.baseUnit}`}>
            <input inputMode="decimal" className={inputCls(!!e('minStock'))} value={f.minStock} onChange={(x) => set('minStock')(x.target.value.replace(/[^\d.]/g, ''))} placeholder="0" />
          </Field>
        </div>
        <Field label="Remarks" optional>
          <Textarea rows={2} value={f.remarks} onChange={(x) => set('remarks')(x.target.value)} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saveM.isPending}>Cancel</Button>
          <Button onClick={save} disabled={saveM.isPending}>{saveM.isPending ? 'Saving…' : 'Save Item'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ItemViewDialog({ token, id, onClose }: { token: string; id: string; onClose: () => void }) {
  const h = useStoreItemHistory(token, id);
  const i = h.data?.item;
  const events = h.data?.events ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="md:max-w-[680px]">
        <DialogHeader>
          <DialogTitle>{i?.name ?? 'Item'}</DialogTitle>
          <DialogDescription>{i ? `${i.itemNo} · ${i.itemCode}` : ''}</DialogDescription>
        </DialogHeader>
        {h.isLoading ? (
          <Skeleton className="h-48 w-full" />
        ) : h.isError || !i ? (
          <ErrorBlock error={h.error} onRetry={() => void h.refetch()} />
        ) : (
          <div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Fact k="Store Item ID" v={i.itemNo} />
              <Fact k="Item Code" v={i.itemCode} />
              <Fact k="Category" v={i.category} />
              <Fact k="Base Unit" v={i.baseUnit} />
              <Fact k="Purchase Unit" v={i.purchaseUnit} />
              <Fact k="Conversion" v={`1 ${i.purchaseUnit} = ${num(i.conversionQty)} ${i.baseUnit}`} />
              <Fact k="Low-stock level" v={qty(i.minStock, i.baseUnit)} />
              <Fact k="In store now" v={qty(i.availableQty, i.baseUnit)} />
              <Fact k="Status" v={i.status === 'active' ? 'Active' : 'Inactive'} />
              <Fact k="Created" v={`${fdt(i.createdAt)}${i.createdByName ? ` · ${i.createdByName}` : ''}`} className="col-span-2" />
              <Fact k="Remarks" v={i.remarks || '—'} className="col-span-2 sm:col-span-3" />
            </div>
            <div className="flex flex-wrap gap-2">
              <Link className="text-sm font-semibold text-primary hover:underline" href={`${ROUTES.STORE_LEDGER}?item=${i.id}`}>Open stock ledger</Link>
              <Link className="text-sm font-semibold text-primary hover:underline" href={ROUTES.STORE_PRICES}>Prices</Link>
            </div>
            <div>
              <div className="mb-1.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Item history</div>
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground">No changes recorded.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {events.map((ev) => (
                    <li key={ev.id} className="rounded-lg border border-border px-3 py-2 text-sm">
                      <b className="capitalize">{ev.action}</b> · {ev.actorName ?? '—'} · {fdt(ev.createdAt)}
                      {ev.detail ? <div className="text-xs text-muted-foreground">{ev.detail}</div> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
