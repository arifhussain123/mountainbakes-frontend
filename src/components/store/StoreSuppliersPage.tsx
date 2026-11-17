'use client';

import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Pencil, Plus, Truck } from 'lucide-react';
import type { StoreSupplier, StoreSupplierInput } from '@mb/shared';
import { StoreSupplierInputSchema } from '@mb/shared';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useSaveStoreSupplier, useStoreSuppliers } from '@/lib/store';
import { Denied, ErrorBlock, Field, Pill, StorePage, errorMessage, inputCls, num, useStoreSession } from './parts';

/**
 * Suppliers (Phase 2, behind the `suppliers` module flag). The shared supplier
 * master — the same list WhatsApp Purchasing uses — so a supplier added here is
 * available to Receiving and, from Phase 3, Purchase Orders.
 */

const col = createColumnHelper<StoreSupplier>();

interface Form {
  name: string; category: string; contactPerson: string; phone: string; whatsappNumber: string;
  email: string; ntn: string; strn: string; paymentTerms: string; leadTimeDays: string; address: string; notes: string;
}

const emptyForm = (s?: StoreSupplier): Form => ({
  name: s?.name ?? '', category: s?.category ?? '', contactPerson: s?.contactPerson ?? '', phone: s?.phone ?? '',
  whatsappNumber: s?.whatsappNumber ?? '', email: s?.email ?? '', ntn: s?.ntn ?? '', strn: s?.strn ?? '',
  paymentTerms: s?.paymentTerms ?? '', leadTimeDays: s?.leadTimeDays != null ? String(s.leadTimeDays) : '',
  address: s?.address ?? '', notes: s?.notes ?? '',
});

export function StoreSuppliersPage() {
  const session = useStoreSession();
  const { token, can, me } = session;
  const canManage = can('receive') || can('accounts');
  const featureOn = Boolean(me.data?.features?.suppliers);
  const suppliersQ = useStoreSuppliers(token, true);

  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ supplier?: StoreSupplier } | null>(null);

  const all = useMemo(() => suppliersQ.data ?? [], [suppliersQ.data]);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all.filter((s) => !term || `${s.name} ${s.supplierCode} ${s.category ?? ''} ${s.phone ?? ''} ${s.contactPerson ?? ''}`.toLowerCase().includes(term));
  }, [all, q]);

  const columns = useMemo(() => [
    col.accessor('supplierCode', { header: 'Supplier ID', meta: { mobile: 'subtitle' }, cell: (c) => <span className="whitespace-nowrap font-mono text-xs">{c.getValue()}</span> }),
    col.accessor('name', { header: 'Name', meta: { mobile: 'title' }, cell: (c) => <span className={c.row.original.isActive ? 'font-semibold' : 'font-semibold opacity-60'}>{c.getValue()}</span> }),
    col.accessor((s) => s.category ?? '—', { id: 'category', header: 'Category' }),
    col.accessor((s) => s.contactPerson ?? '—', { id: 'contact', header: 'Contact' }),
    col.accessor((s) => s.phone ?? '—', { id: 'phone', header: 'Phone', cell: (c) => <span className="whitespace-nowrap">{c.getValue()}</span> }),
    col.accessor((s) => s.leadTimeDays, { id: 'lead', header: 'Lead time', meta: { align: 'center' }, cell: (c) => <span className="tabular-nums">{c.getValue() == null ? '—' : `${num(c.getValue()!)} d`}</span> }),
    col.accessor((s) => (s.isActive ? 'Active' : 'Inactive'), {
      id: 'status', header: 'Status', meta: { mobile: 'badge' },
      cell: (c) => <Pill tone={c.row.original.isActive ? 'green' : 'muted'}>{c.row.original.isActive ? 'Active' : 'Inactive'}</Pill>,
    }),
    col.display({
      id: 'actions', header: '',
      cell: (c) => canManage ? (
        <Button size="sm" variant="outline" onClick={() => setEditing({ supplier: c.row.original })}><Pencil className="mr-1 h-3.5 w-3.5" />Edit</Button>
      ) : null,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [canManage]);

  return (
    <StorePage
      session={session}
      needs="receive"
      subtitle="Your suppliers — the same master WhatsApp Purchasing uses."
      actions={featureOn && canManage ? <Button onClick={() => setEditing({})}><Plus className="mr-1.5 h-4 w-4" />New supplier</Button> : null}
    >
      {!featureOn ? (
        <Denied text="The Suppliers module is off for this store. An Admin can turn it on in Store Settings → Modules." />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search supplier, code, category…" aria-label="Search" className={inputCls() + ' max-w-xs'} />
            <span className="ml-auto text-[13px] text-muted-foreground">{rows.length} of {all.length} suppliers</span>
          </div>

          {suppliersQ.isError ? (
            <ErrorBlock error={suppliersQ.error} onRetry={() => void suppliersQ.refetch()} />
          ) : (
            <DataTable
              columns={columns}
              data={rows}
              loading={suppliersQ.isLoading}
              sortable
              toolbar={false}
              stickyFirstColumn
              columnChooser
              pageSize={25}
              empty={
                <EmptyState
                  icon={Truck}
                  title={all.length ? 'No suppliers match' : 'No suppliers yet'}
                  description={all.length ? 'Try a different search.' : 'Add the suppliers the store buys from.'}
                  action={!all.length && canManage ? <Button size="sm" onClick={() => setEditing({})}><Plus className="mr-1.5 h-4 w-4" />New supplier</Button> : undefined}
                />
              }
            />
          )}
        </>
      )}

      {editing && <SupplierDialog token={token} supplier={editing.supplier ?? null} onClose={() => setEditing(null)} />}
    </StorePage>
  );
}

function SupplierDialog({ token, supplier, onClose }: { token: string; supplier: StoreSupplier | null; onClose: () => void }) {
  const saveM = useSaveStoreSupplier(token);
  const [tried, setTried] = useState(false);
  const [f, setF] = useState<Form>(() => emptyForm(supplier ?? undefined));
  const set = (k: keyof Form) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  const input: StoreSupplierInput = {
    name: f.name.trim(),
    contactPerson: f.contactPerson.trim() || null,
    phone: f.phone.trim() || null,
    whatsappNumber: f.whatsappNumber.trim() || null,
    email: f.email.trim() || null,
    category: f.category.trim() || null,
    address: f.address.trim() || null,
    ntn: f.ntn.trim() || null,
    strn: f.strn.trim() || null,
    paymentTerms: f.paymentTerms.trim() || null,
    leadTimeDays: f.leadTimeDays.trim() === '' ? null : Number(f.leadTimeDays),
    notes: f.notes.trim() || null,
  };
  const parsed = StoreSupplierInputSchema.safeParse(input);
  const errs: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
  const e = (k: string) => (tried ? errs[k] ?? null : null);

  const save = () => {
    if (!parsed.success) { setTried(true); return; }
    saveM.mutate({ id: supplier?.id, input: parsed.data }, {
      onSuccess: (s) => { toast.success(supplier ? `${s.name} updated.` : `${s.name} added as ${s.supplierCode}.`); onClose(); },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !saveM.isPending && onClose()}>
      <DialogContent className="md:max-w-[640px]">
        <DialogHeader>
          <DialogTitle>{supplier ? `Edit ${supplier.supplierCode}` : 'New supplier'}</DialogTitle>
          <DialogDescription>Shared with WhatsApp Purchasing. WhatsApp number is optional here.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required error={e('name')}>
            <input className={inputCls(!!e('name'))} value={f.name} onChange={(x) => set('name')(x.target.value)} placeholder="e.g. Khan Flour Mills" />
          </Field>
          <Field label="Category"><input className={inputCls()} value={f.category} onChange={(x) => set('category')(x.target.value)} placeholder="e.g. Flour" /></Field>
          <Field label="Contact person"><input className={inputCls()} value={f.contactPerson} onChange={(x) => set('contactPerson')(x.target.value)} /></Field>
          <Field label="Phone"><input className={inputCls()} value={f.phone} onChange={(x) => set('phone')(x.target.value)} /></Field>
          <Field label="WhatsApp number" error={e('whatsappNumber')} hint="International format, e.g. +923001234567">
            <input className={inputCls(!!e('whatsappNumber'))} value={f.whatsappNumber} onChange={(x) => set('whatsappNumber')(x.target.value)} placeholder="+92…" />
          </Field>
          <Field label="Email"><input className={inputCls()} value={f.email} onChange={(x) => set('email')(x.target.value)} /></Field>
          <Field label="NTN"><input className={inputCls()} value={f.ntn} onChange={(x) => set('ntn')(x.target.value)} /></Field>
          <Field label="STRN"><input className={inputCls()} value={f.strn} onChange={(x) => set('strn')(x.target.value)} /></Field>
          <Field label="Payment terms"><input className={inputCls()} value={f.paymentTerms} onChange={(x) => set('paymentTerms')(x.target.value)} placeholder="e.g. 30 days" /></Field>
          <Field label="Lead time (days)" error={e('leadTimeDays')}>
            <input inputMode="numeric" className={inputCls(!!e('leadTimeDays'))} value={f.leadTimeDays} onChange={(x) => set('leadTimeDays')(x.target.value.replace(/[^\d]/g, ''))} placeholder="e.g. 3" />
          </Field>
        </div>
        <Field label="Address"><Textarea rows={2} value={f.address} onChange={(x) => set('address')(x.target.value)} /></Field>
        <Field label="Notes"><Textarea rows={2} value={f.notes} onChange={(x) => set('notes')(x.target.value)} /></Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saveM.isPending}>Cancel</Button>
          <Button onClick={save} disabled={saveM.isPending}>{saveM.isPending ? 'Saving…' : 'Save supplier'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
