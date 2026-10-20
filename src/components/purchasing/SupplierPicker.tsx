'use client';

import { useMemo, useState } from 'react';
import { SupplierInputSchema, type Supplier } from '@mb/shared';
import { UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox';
import { useCreateSupplier, usePurchaseSuppliers } from '@/lib/purchasing';
import { issuesByPath } from './purchasing-model';
import { Check, Field, errorMessage } from './parts';

/** Search name, code, contact and number — the four things a person remembers a supplier by. */
function matches(s: Supplier | null, query: string): boolean {
  if (s == null) return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const digits = q.replace(/\D/g, '');
  return (
    s.name.toLowerCase().includes(q) ||
    s.supplierCode.toLowerCase().includes(q) ||
    (s.contactPerson ?? '').toLowerCase().includes(q) ||
    (digits.length >= 3 && s.whatsappNumber.replace(/\D/g, '').includes(digits))
  );
}

/**
 * The searchable supplier select. A Combobox rather than a Select for the same
 * reason the stock dialogs use one: the list can be long and this has to work
 * on a phone. Inactive suppliers are left out — the API's Verify refuses them.
 */
export function SupplierPicker({
  token,
  value,
  onChange,
  invalid,
  id,
}: {
  token: string;
  /** The supplier object, not its id: one just registered is not in the list until it refetches. */
  value: Supplier | null;
  onChange: (s: Supplier | null) => void;
  invalid?: boolean;
  id?: string;
}) {
  const suppliersQ = usePurchaseSuppliers(token);
  const active = useMemo(() => {
    const list = (suppliersQ.data?.suppliers ?? []).filter((s) => s.isActive);
    return value && !list.some((s) => s.id === value.id) ? [value, ...list] : list;
  }, [suppliersQ.data, value]);
  return (
    <Combobox
      items={active}
      filter={matches}
      value={value}
      onValueChange={(s: Supplier | null) => onChange(s)}
      itemToStringLabel={(s: Supplier) => s.name}
      itemToStringValue={(s: Supplier) => s.id}
      isItemEqualToValue={(a: Supplier, b: Supplier) => a?.id === b?.id}
    >
      <ComboboxInput
        id={id}
        aria-label="Supplier"
        aria-invalid={invalid}
        placeholder={suppliersQ.isLoading ? 'Loading suppliers…' : 'Search supplier…'}
        className="text-base sm:text-sm"
      />
      <ComboboxContent>
        <ComboboxEmpty>No supplier found. Register one below.</ComboboxEmpty>
        <ComboboxList>
          {(s: Supplier) => (
            <ComboboxItem key={s.id} value={s}>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">{s.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {s.supplierCode} · {s.whatsappNumber}
                  {s.category ? ` · ${s.category}` : ''}
                  {!s.whatsappOptInAt ? ' · no WhatsApp consent' : ''}
                </span>
              </div>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

/**
 * Register a supplier without leaving the demand form (POST /suppliers).
 *
 * The consent box is not a formality: WhatsApp's policy, and the API, refuse to
 * register a number whose owner has not agreed to be messaged by Mountain
 * Bakes. It is unticked every time the form opens so nobody inherits a tick
 * they did not give.
 */
export function RegisterSupplierForm({
  token,
  onCreated,
  onCancel,
}: {
  token: string;
  onCreated: (s: Supplier) => void;
  onCancel: () => void;
}) {
  const create = useCreateSupplier(token);
  const [f, setF] = useState({
    name: '',
    whatsappNumber: '',
    contactPerson: '',
    phone: '',
    category: '',
    address: '',
    paymentTerms: '',
    notes: '',
    whatsappOptIn: false,
    whatsappOptInSource: '',
  });
  const [attempted, setAttempted] = useState(false);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));

  const body = {
    name: f.name,
    whatsappNumber: f.whatsappNumber,
    contactPerson: f.contactPerson.trim() || null,
    phone: f.phone.trim() || null,
    category: f.category.trim() || null,
    address: f.address.trim() || null,
    paymentTerms: f.paymentTerms.trim() || null,
    notes: f.notes.trim() || null,
    whatsappOptIn: f.whatsappOptIn,
    whatsappOptInSource: f.whatsappOptInSource.trim() || null,
  };
  const parsed = SupplierInputSchema.safeParse(body);
  const errors = parsed.success ? {} : issuesByPath(parsed.error.issues);
  const consentError = !f.whatsappOptIn ? 'Confirm the supplier agreed to receive WhatsApp messages.' : null;
  const show = (k: string) => (attempted ? errors[k] : undefined);

  async function submit() {
    setAttempted(true);
    if (!parsed.success || consentError || create.isPending) return;
    try {
      const s = await create.mutateAsync({ ...body, whatsappOptIn: true });
      toast.success(`Registered ${s.name} (${s.supplierCode})`);
      onCreated(s);
    } catch (err) {
      toast.error(errorMessage(err, 'Could not register the supplier'));
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-dashed p-3">
      <p className="flex items-center gap-2 text-sm font-medium">
        <UserPlus className="h-4 w-4" aria-hidden /> Register a supplier
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Supplier name" htmlFor="sup-name" error={show('name')}>
          <Input id="sup-name" value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={120} aria-invalid={!!show('name')} />
        </Field>
        <Field label="WhatsApp number" htmlFor="sup-wa" error={show('whatsappNumber')} hint="e.g. 0300 1234567 or +92 300 1234567">
          <Input id="sup-wa" inputMode="tel" value={f.whatsappNumber} onChange={(e) => set('whatsappNumber', e.target.value)} maxLength={30} aria-invalid={!!show('whatsappNumber')} />
        </Field>
        <Field label="Contact person (optional)" htmlFor="sup-contact">
          <Input id="sup-contact" value={f.contactPerson} onChange={(e) => set('contactPerson', e.target.value)} maxLength={120} />
        </Field>
        <Field label="Other phone (optional)" htmlFor="sup-phone">
          <Input id="sup-phone" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} maxLength={30} />
        </Field>
        <Field label="Category (optional)" htmlFor="sup-cat">
          <Input id="sup-cat" value={f.category} onChange={(e) => set('category', e.target.value)} maxLength={60} placeholder="Flour, dairy, packaging…" />
        </Field>
        <Field label="Payment terms (optional)" htmlFor="sup-terms">
          <Input id="sup-terms" value={f.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} maxLength={200} />
        </Field>
        <Field label="Address (optional)" htmlFor="sup-address" className="sm:col-span-2">
          <Textarea id="sup-address" value={f.address} onChange={(e) => set('address', e.target.value)} maxLength={300} rows={2} />
        </Field>
      </div>
      <Check id="sup-optin" checked={f.whatsappOptIn} onChange={(v) => set('whatsappOptIn', v)}>
        The supplier agreed to receive WhatsApp messages from Mountain Bakes on this number.
      </Check>
      {attempted && consentError && <p className="text-xs text-destructive">{consentError}</p>}
      {f.whatsappOptIn && (
        <Field label="How they agreed (optional)" htmlFor="sup-optin-src">
          <Input
            id="sup-optin-src"
            value={f.whatsappOptInSource}
            onChange={(e) => set('whatsappOptInSource', e.target.value)}
            maxLength={200}
            placeholder="e.g. asked in person at the shop, 20 Oct"
          />
        </Field>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={create.isPending}>
          Cancel
        </Button>
        <Button size="sm" onClick={() => void submit()} disabled={create.isPending}>
          {create.isPending ? 'Registering…' : 'Register supplier'}
        </Button>
      </div>
    </div>
  );
}
