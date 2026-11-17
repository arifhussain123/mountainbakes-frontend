'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { createColumnHelper } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Download, Eye, LayoutGrid, List, Package, Pencil, Plus, Power, Tag, Trash2, Upload } from 'lucide-react';
import type { StoreBarcodeType, StoreItem, StoreItemInput, StoreLookup } from '@mb/shared';
import { STORE_BARCODE_TYPES, StoreItemInputSchema } from '@mb/shared';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { downloadStoreItems, useAddStoreItemBarcode, useAddStoreItemPackage, useBulkUpdateStoreItems, useDeleteStoreItem, useDeleteStoreItemBarcode, useDeleteStoreItemPackage, useRequestStorePrice, useSaveStoreItem, useSetStoreItemStatus, useStoreItemBarcodes, useStoreItemHistory, useStoreItemPackages, useStoreItems, useStoreLookups, useStoreSuppliers } from '@/lib/store';
import { StoreItemImportDialog } from './StoreItemImportDialog';
import { ROUTES } from '@/utils/routes';
import {
  ConfirmDialog, ErrorBlock, Fact, Field, FilterSelect, Pill, StorePage, errorMessage, fdt, inputCls, num, qty, titleCase, useStoreSession,
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
  reorderQty: string;
  maxLevel: string;
  safetyStock: string;
  leadTimeDays: string;
  preferredSupplierId: string;
  storageType: 'dry' | 'chilled' | 'frozen';
  trackExpiry: boolean;
  description: string;
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
  const [importing, setImporting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const setStatusM = useSetStoreItemStatus(token);
  const deleteM = useDeleteStoreItem(token);
  const requestPriceM = useRequestStorePrice(token);
  const canEdit = can('items.edit');
  const canReceive = can('receive');

  const [view, setView] = useState<'list' | 'grid'>('list');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBulkCat, setShowBulkCat] = useState(false);
  const [bulkCatTo, setBulkCatTo] = useState('');
  const bulkM = useBulkUpdateStoreItems(token);

  const toggleOne = (id: string, on: boolean) =>
    setSelected((prev) => { const n = new Set(prev); if (on) n.add(id); else n.delete(id); return n; });
  const clearSel = () => setSelected(new Set());
  const runBulk = (action: 'activate' | 'deactivate' | 'set_category', categoryTo?: string) => {
    if (selected.size === 0) return;
    bulkM.mutate({ ids: Array.from(selected), action, categoryTo }, {
      onSuccess: (r) => { toast.success(`${r.updated} item${r.updated === 1 ? '' : 's'} updated.`); clearSel(); setShowBulkCat(false); },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  const all = useMemo(() => itemsQ.data ?? [], [itemsQ.data]);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all.filter((i) =>
      (!term || `${i.name} ${i.itemCode} ${i.itemNo}`.toLowerCase().includes(term)) &&
      (!cat || i.category === cat) && (!unit || i.baseUnit === unit) && (!status || i.status === status));
  }, [all, q, cat, unit, status]);

  const columns = useMemo(() => [
    ...(canEdit ? [col.display({
      id: 'select',
      header: () => {
        const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));
        return <input type="checkbox" aria-label="Select all" className="h-4 w-4 accent-primary" checked={allOn}
          onChange={(e) => setSelected((prev) => { const n = new Set(prev); rows.forEach((r) => (e.target.checked ? n.add(r.id) : n.delete(r.id))); return n; })} />;
      },
      cell: (c) => <input type="checkbox" aria-label={`Select ${c.row.original.name}`} className="h-4 w-4 accent-primary"
        checked={selected.has(c.row.original.id)} onChange={(e) => toggleOne(c.row.original.id, e.target.checked)} />,
    })] : []),
    col.accessor('itemNo', { header: 'Item ID', meta: { mobile: 'subtitle' }, cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span> }),
    col.accessor('itemCode', { header: 'Item Code', cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span> }),
    col.accessor('name', {
      header: 'Item Name',
      meta: { mobile: 'title' },
      cell: (c) => (
        <div className="min-w-[140px]">
          <div className="font-semibold">{titleCase(c.getValue())}</div>
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
            {canReceive && i.status === 'active' && i.unitPrice == null && (
              <Button
                size="sm"
                variant="outline"
                className="text-amber-700 dark:text-amber-400"
                disabled={requestPriceM.isPending}
                onClick={() => requestPriceM.mutate({ itemId: i.id }, {
                  onSuccess: () => toast.success(`Price requested for ${i.name} — Finance will set it.`),
                  onError: (e) => toast.error(errorMessage(e)),
                })}
              >
                <Tag className="mr-1 h-3.5 w-3.5" />Request price
              </Button>
            )}
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
  ], [canEdit, canReceive, session.me.data, selected, rows]);

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadStoreItems(token);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <StorePage
      session={session}
      subtitle="Master list of dry items. Prices are set in Price Control and quantities in Store Stock."
      needs="view"
      actions={
        <>
          <Button variant="outline" onClick={() => void handleDownload()} disabled={downloading}>
            <Download className="mr-1.5 h-4 w-4" />
            {downloading ? 'Preparing…' : 'Download Excel'}
          </Button>
          {canEdit && (
            <Button variant="outline" onClick={() => setImporting(true)}>
              <Upload className="mr-1.5 h-4 w-4" />
              Upload Excel
            </Button>
          )}
          {canEdit && (
            <Button onClick={() => setEditing({})}>
              <Plus className="mr-1.5 h-4 w-4" />
              New Item
            </Button>
          )}
        </>
      }
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
        <div className="ml-auto flex items-center gap-1">
          <Button size="sm" variant={view === 'list' ? 'default' : 'outline'} onClick={() => setView('list')} aria-label="List view"><List className="h-4 w-4" /></Button>
          <Button size="sm" variant={view === 'grid' ? 'default' : 'outline'} onClick={() => setView('grid')} aria-label="Grid view"><LayoutGrid className="h-4 w-4" /></Button>
          <span className="ml-2 text-[13px] text-muted-foreground">{rows.length} of {all.length} items</span>
        </div>
      </div>

      {canEdit && selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-primary/5 px-3 py-2 text-sm">
          <b>{selected.size} selected</b>
          <Button size="sm" variant="outline" disabled={bulkM.isPending} onClick={() => runBulk('activate')}><Power className="mr-1 h-3.5 w-3.5 text-emerald-700" />Activate</Button>
          <Button size="sm" variant="outline" disabled={bulkM.isPending} onClick={() => runBulk('deactivate')}><Power className="mr-1 h-3.5 w-3.5 text-red-700" />Deactivate</Button>
          <Button size="sm" variant="outline" disabled={bulkM.isPending} onClick={() => { setBulkCatTo(categories[0] ?? ''); setShowBulkCat(true); }}><Tag className="mr-1 h-3.5 w-3.5" />Change category</Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={clearSel}>Clear</Button>
        </div>
      )}

      {itemsQ.isError ? (
        <ErrorBlock error={itemsQ.error} onRetry={() => void itemsQ.refetch()} />
      ) : view === 'grid' ? (
        rows.length === 0 ? (
          <EmptyState
            icon={Package}
            title={all.length ? 'No items match these filters' : 'No dry items yet'}
            description={all.length ? 'Clear a filter to see more.' : 'Add the first dry item the store keeps.'}
            action={!all.length && canEdit ? <Button size="sm" onClick={() => setEditing({})}><Plus className="mr-1.5 h-4 w-4" />New Item</Button> : undefined}
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {rows.map((i) => (
              <ItemCard key={i.id} item={i} canEdit={canEdit} selected={selected.has(i.id)}
                onToggle={(on) => toggleOne(i.id, on)} onView={() => setViewing(i.id)} onEdit={() => setEditing({ id: i.id })} onToggleStatus={() => setToggling(i)} />
            ))}
          </div>
        )
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          loading={itemsQ.isLoading}
          sortable
          toolbar={false}
          stickyFirstColumn
          columnChooser
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
      {viewing && <ItemViewDialog token={token} id={viewing} canEdit={canEdit} onClose={() => setViewing(null)} />}
      {importing && <StoreItemImportDialog token={token} onClose={() => setImporting(false)} />}

      {showBulkCat && (
        <Dialog open onOpenChange={(o) => !o && !bulkM.isPending && setShowBulkCat(false)}>
          <DialogContent className="md:max-w-sm">
            <DialogHeader>
              <DialogTitle>Change category</DialogTitle>
              <DialogDescription>Move {selected.size} item{selected.size === 1 ? '' : 's'} to a category.</DialogDescription>
            </DialogHeader>
            <Field label="Category">
              <select className={inputCls()} value={bulkCatTo} onChange={(e) => setBulkCatTo(e.target.value)}>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowBulkCat(false)} disabled={bulkM.isPending}>Cancel</Button>
              <Button onClick={() => runBulk('set_category', bulkCatTo)} disabled={bulkM.isPending || !bulkCatTo}>{bulkM.isPending ? 'Saving…' : 'Change category'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

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
  const suppliersQ = useStoreSuppliers(token);
  const [tried, setTried] = useState(false);
  const [f, setF] = useState<Form>(() => item
    ? { itemCode: item.itemCode, name: item.name, category: item.category, baseUnit: item.baseUnit, purchaseUnit: item.purchaseUnit, conversionQty: String(item.conversionQty), minStock: String(item.minStock), remarks: item.remarks ?? '', reorderQty: item.reorderQty ? String(item.reorderQty) : '', maxLevel: item.maxLevel ? String(item.maxLevel) : '', safetyStock: item.safetyStock ? String(item.safetyStock) : '', leadTimeDays: item.leadTimeDays != null ? String(item.leadTimeDays) : '', preferredSupplierId: item.preferredSupplierId ?? '', storageType: item.storageType ?? 'dry', trackExpiry: item.trackExpiry ?? false, description: item.description ?? '' }
    : { itemCode: '', name: '', category: categories[0] ?? '', baseUnit: baseUnits[0] ?? 'KG', purchaseUnit: purchaseUnits[0] ?? 'Bag', conversionQty: '', minStock: '', remarks: '', reorderQty: '', maxLevel: '', safetyStock: '', leadTimeDays: '', preferredSupplierId: '', storageType: 'dry', trackExpiry: false, description: '' });
  // Only the string-valued fields go through this setter; storageType/trackExpiry use setF directly.
  type StrKey = { [K in keyof Form]: string extends Form[K] ? K : never }[keyof Form];
  const set = (k: StrKey) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const input: StoreItemInput = {
    itemCode: f.itemCode.trim().toUpperCase(),
    name: f.name.trim(),
    category: f.category,
    baseUnit: f.baseUnit,
    purchaseUnit: f.purchaseUnit,
    conversionQty: Number(f.conversionQty),
    minStock: f.minStock === '' ? NaN : Number(f.minStock),
    remarks: f.remarks.trim() || null,
    reorderQty: f.reorderQty === '' ? undefined : Number(f.reorderQty),
    maxLevel: f.maxLevel === '' ? undefined : Number(f.maxLevel),
    safetyStock: f.safetyStock === '' ? undefined : Number(f.safetyStock),
    leadTimeDays: f.leadTimeDays === '' ? null : Number(f.leadTimeDays),
    preferredSupplierId: f.preferredSupplierId || null,
    storageType: f.storageType,
    trackExpiry: f.trackExpiry,
    description: f.description.trim() || null,
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
          <Field label="Reorder quantity" hint={`How many ${f.baseUnit} to order when low`}>
            <input inputMode="decimal" className={inputCls()} value={f.reorderQty} onChange={(x) => set('reorderQty')(x.target.value.replace(/[^\d.]/g, ''))} placeholder="0" />
          </Field>
          <Field label="Max level" hint="Target maximum stock (0 = none)">
            <input inputMode="decimal" className={inputCls()} value={f.maxLevel} onChange={(x) => set('maxLevel')(x.target.value.replace(/[^\d.]/g, ''))} placeholder="0" />
          </Field>
          <Field label="Safety stock">
            <input inputMode="decimal" className={inputCls()} value={f.safetyStock} onChange={(x) => set('safetyStock')(x.target.value.replace(/[^\d.]/g, ''))} placeholder="0" />
          </Field>
          <Field label="Lead time (days)">
            <input inputMode="numeric" className={inputCls()} value={f.leadTimeDays} onChange={(x) => set('leadTimeDays')(x.target.value.replace(/[^\d]/g, ''))} placeholder="e.g. 3" />
          </Field>
          <Field label="Storage">
            <select className={inputCls()} value={f.storageType} onChange={(x) => setF((s) => ({ ...s, storageType: x.target.value as Form['storageType'] }))}>
              <option value="dry">Dry</option>
              <option value="chilled">Chilled</option>
              <option value="frozen">Frozen</option>
            </select>
          </Field>
          <Field label="Preferred supplier">
            <select className={inputCls()} value={f.preferredSupplierId} onChange={(x) => set('preferredSupplierId')(x.target.value)}>
              <option value="">—</option>
              {(suppliersQ.data ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={f.trackExpiry} onChange={(x) => setF((s) => ({ ...s, trackExpiry: x.target.checked }))} className="h-4 w-4 accent-primary" />
          Track expiry dates for this item
        </label>
        <Field label="Description" optional>
          <Textarea rows={2} value={f.description} onChange={(x) => set('description')(x.target.value)} />
        </Field>
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

/** One item as a card for the grid view, with selection + quick actions. */
function ItemCard({ item, canEdit, selected, onToggle, onView, onEdit, onToggleStatus }: {
  item: StoreItem;
  canEdit: boolean;
  selected: boolean;
  onToggle: (on: boolean) => void;
  onView: () => void;
  onEdit: () => void;
  onToggleStatus: () => void;
}) {
  return (
    <div className={`flex flex-col gap-2 rounded-xl border border-border bg-card p-3 ${selected ? 'ring-2 ring-primary' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold">{titleCase(item.name)}</div>
          <div className="font-mono text-xs text-muted-foreground">{item.itemNo} · {item.itemCode}</div>
        </div>
        {canEdit && <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={selected} onChange={(e) => onToggle(e.target.checked)} aria-label={`Select ${item.name}`} />}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Pill tone="muted">{item.category}</Pill>
        <span>In store: <b className="tabular-nums text-foreground">{qty(item.availableQty, item.baseUnit)}</b></span>
        <Pill tone={item.status === 'active' ? 'green' : 'muted'}>{item.status === 'active' ? 'Active' : 'Inactive'}</Pill>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" onClick={onView}><Eye className="mr-1 h-3.5 w-3.5" />View</Button>
        {canEdit && <Button size="sm" variant="outline" onClick={onEdit}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>}
        {canEdit && (
          <Button size="sm" variant="outline" className={item.status === 'active' ? 'text-red-700' : 'text-emerald-700'} onClick={onToggleStatus}>
            <Power className="mr-1 h-3.5 w-3.5" />{item.status === 'active' ? 'Deactivate' : 'Activate'}
          </Button>
        )}
      </div>
    </div>
  );
}

/** An item's barcodes (Items v2) — only rendered when the `barcodes` module is on. */
function ItemBarcodes({ token, item, canEdit }: { token: string; item: StoreItem; canEdit: boolean }) {
  const session = useStoreSession();
  const on = Boolean(session.me.data?.features?.barcodes);
  const bcQ = useStoreItemBarcodes(token, on ? item.id : null);
  const addM = useAddStoreItemBarcode(token);
  const delM = useDeleteStoreItemBarcode(token);
  const [code, setCode] = useState('');
  const [type, setType] = useState<StoreBarcodeType>('ean');

  if (!on) return null;

  const add = () => {
    const c = code.trim();
    if (!c) return;
    addM.mutate({ itemId: item.id, input: { code: c, type } }, {
      onSuccess: () => { toast.success('Barcode added.'); setCode(''); },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  const codes = bcQ.data ?? [];
  return (
    <div>
      <div className="mb-1.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Barcodes</div>
      {bcQ.isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {codes.map((b) => (
            <li key={b.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <span className="font-mono">{b.code}</span>
                <Pill tone="muted">{b.type.toUpperCase()}</Pill>
              </span>
              {canEdit && (
                <Button size="sm" variant="ghost" className="text-red-700" aria-label={`Remove ${b.code}`} disabled={delM.isPending}
                  onClick={() => delM.mutate(b.id, { onSuccess: () => toast.success('Barcode removed.'), onError: (e) => toast.error(errorMessage(e)) })}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          ))}
          {codes.length === 0 && <li className="text-sm text-muted-foreground">No barcodes.</li>}
        </ul>
      )}
      {canEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input className={inputCls() + ' font-mono'} value={code} maxLength={60} onChange={(ev) => setCode(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && add()} placeholder="Scan or type a barcode" aria-label="Barcode" />
          <select className={inputCls()} value={type} onChange={(ev) => setType(ev.target.value as StoreBarcodeType)} aria-label="Barcode type">
            {STORE_BARCODE_TYPES.map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
          </select>
          <Button variant="outline" onClick={add} disabled={addM.isPending || !code.trim()}><Plus className="mr-1 h-4 w-4" />Add</Button>
        </div>
      )}
    </div>
  );
}

/** An item's purchase packages (Items v2): the default plus any extra ones. */
function ItemPackages({ token, item, canEdit }: { token: string; item: StoreItem; canEdit: boolean }) {
  const pkgsQ = useStoreItemPackages(token, item.id);
  const lookupsQ = useStoreLookups(token);
  const purchaseUnits = lookupValues(lookupsQ.data, 'purchase_unit');
  const addM = useAddStoreItemPackage(token);
  const delM = useDeleteStoreItemPackage(token);
  const [name, setName] = useState(item.purchaseUnit);
  const [qty, setQty] = useState('');

  const add = () => {
    const q = Number(qty);
    if (!name || !(q > 0)) return;
    addM.mutate({ itemId: item.id, input: { packageName: name, packageQty: q } }, {
      onSuccess: () => { toast.success('Package added.'); setQty(''); },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  const pkgs = pkgsQ.data ?? [];
  return (
    <div>
      <div className="mb-1.5 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Purchase packages</div>
      {pkgsQ.isLoading ? (
        <Skeleton className="h-10 w-full" />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {pkgs.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                1 {p.packageName} = <b className="tabular-nums">{num(p.packageQty)}</b> {item.baseUnit}
                {p.isDefault && <Pill tone="blue">Default</Pill>}
              </span>
              {canEdit && !p.isDefault && (
                <Button size="sm" variant="ghost" className="text-red-700" aria-label={`Remove ${p.packageName}`} disabled={delM.isPending}
                  onClick={() => delM.mutate(p.id, { onSuccess: () => toast.success('Package removed.'), onError: (e) => toast.error(errorMessage(e)) })}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          ))}
          {pkgs.length === 0 && <li className="text-sm text-muted-foreground">No packages recorded.</li>}
        </ul>
      )}
      {canEdit && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select className={inputCls()} value={name} onChange={(ev) => setName(ev.target.value)} aria-label="Package unit">
            {purchaseUnits.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <input inputMode="decimal" className={inputCls() + ' max-w-[140px]'} value={qty} onChange={(ev) => setQty(ev.target.value.replace(/[^\d.]/g, ''))} placeholder={`${item.baseUnit} per ${name || 'pack'}`} aria-label="Base units per package" />
          <Button variant="outline" onClick={add} disabled={addM.isPending || !name || !(Number(qty) > 0)}><Plus className="mr-1 h-4 w-4" />Add package</Button>
        </div>
      )}
    </div>
  );
}

function ItemViewDialog({ token, id, canEdit, onClose }: { token: string; id: string; canEdit: boolean; onClose: () => void }) {
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
            <ItemPackages token={token} item={i} canEdit={canEdit} />
            <ItemBarcodes token={token} item={i} canEdit={canEdit} />
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
