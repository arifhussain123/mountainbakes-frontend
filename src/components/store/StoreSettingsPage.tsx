'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import type { StoreLookup, StoreLookupKind } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useAddStoreLookup, useSaveStoreSettings, useSetStoreLookupActive, useStoreAudit, useStoreLookups } from '@/lib/store';
import { Card, CardHead, ErrorBlock, Fact, Field, Pill, StorePage, errorMessage, fdt, inputCls, useStoreSession } from './parts';

/**
 * Store Settings (Admin): the department's name and go-live date, and the
 * pick-lists every Store form reads — categories, units, adjustment reasons.
 * A value in use can be switched off (it stops being offered) but never
 * deleted, so old records keep reading correctly.
 */

const KINDS: Array<{ kind: StoreLookupKind; title: string; hint: string }> = [
  { kind: 'category', title: 'Categories', hint: 'Item categories on Store Items.' },
  { kind: 'base_unit', title: 'Base units', hint: 'The unit stock is counted in. KG and Litre allow fractions; others are whole units.' },
  { kind: 'purchase_unit', title: 'Purchase units / packages', hint: 'What items are bought in; Price Control prices one of these.' },
  { kind: 'adjust_reason', title: 'Adjustment reasons', hint: '"Opening stock" and "Returned from Production" are built in.' },
];

export function StoreSettingsPage() {
  const session = useStoreSession();
  const { token, me } = session;
  const lookupsQ = useStoreLookups(token, true);
  const auditQ = useStoreAudit(token, { limit: 30 }, session.can('accounts'));
  const saveM = useSaveStoreSettings(token);
  const store = me.data?.store;
  const [name, setName] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const nameV = name ?? store?.name ?? '';
  const openingV = opening ?? store?.openingDate ?? '';

  return (
    <StorePage session={session} needs="accounts" subtitle="Department details and the lists the Store forms offer.">
      <Card>
        <CardHead title="Department" />
        <div className="grid gap-4 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Fact k="Store ID" v={store?.storeCode ?? '—'} className="sm:col-span-3" />
          <Field label="Store name" required>
            <input className={inputCls(!nameV.trim())} value={nameV} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Go-live date" optional hint="Receipts and adjustments can't be dated before it.">
            <input type="date" className={inputCls()} value={openingV} max={session.today || undefined} onChange={(e) => setOpening(e.target.value)} />
          </Field>
          <Button
            disabled={saveM.isPending || !nameV.trim()}
            onClick={() => saveM.mutate({ name: nameV.trim(), openingDate: openingV || null }, {
              onSuccess: () => { toast.success('Store settings saved.'); setName(null); setOpening(null); },
              onError: (e) => toast.error(errorMessage(e)),
            })}
          >
            {saveM.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Card>

      {lookupsQ.isLoading ? (
        <Skeleton className="h-48 w-full rounded-2xl" />
      ) : lookupsQ.isError ? (
        <ErrorBlock error={lookupsQ.error} onRetry={() => void lookupsQ.refetch()} />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {KINDS.map((k) => (
            <LookupCard key={k.kind} token={token} kind={k.kind} title={k.title} hint={k.hint} rows={(lookupsQ.data ?? []).filter((l) => l.kind === k.kind)} />
          ))}
        </div>
      )}

      <Card>
        <CardHead title="Recent Store changes" />
        {auditQ.isLoading ? (
          <Skeleton className="m-4 h-16" />
        ) : (auditQ.data?.rows ?? []).length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Nothing recorded yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {auditQ.data!.rows.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 px-4 py-2.5 text-sm">
                <Pill tone="muted" className="capitalize">{e.entity}</Pill>
                <b>{e.entityRef ?? '—'}</b>
                <span className="capitalize">{e.action}</span>
                {e.detail ? <span className="text-muted-foreground">· {e.detail}</span> : null}
                <span className="text-xs text-muted-foreground">· {e.actorName} · {fdt(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </StorePage>
  );
}

function LookupCard({ token, kind, title, hint, rows }: { token: string; kind: StoreLookupKind; title: string; hint: string; rows: StoreLookup[] }) {
  const addM = useAddStoreLookup(token);
  const setM = useSetStoreLookupActive(token);
  const [value, setValue] = useState('');
  const add = () => {
    const v = value.trim();
    if (!v) return;
    addM.mutate({ kind, value: v }, {
      onSuccess: () => { toast.success(`"${v}" added.`); setValue(''); },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };
  return (
    <Card>
      <CardHead title={title} />
      <p className="px-4 pt-3 text-xs text-muted-foreground">{hint}</p>
      <ul className="flex flex-col divide-y divide-border px-4 py-2">
        {rows.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-3 py-2 text-sm">
            <span className={l.isActive ? '' : 'text-muted-foreground line-through'}>{l.value}</span>
            <Switch
              checked={l.isActive}
              disabled={setM.isPending}
              aria-label={`${l.isActive ? 'Switch off' : 'Switch on'} ${l.value}`}
              onCheckedChange={(on: boolean) => setM.mutate({ id: l.id, active: on }, { onError: (e) => toast.error(errorMessage(e)) })}
            />
          </li>
        ))}
      </ul>
      <div className="flex gap-2 border-t border-border p-3">
        <input className={inputCls()} value={value} maxLength={40} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder={`Add to ${title.toLowerCase()}`} aria-label={`New ${title}`} />
        <Button variant="outline" onClick={add} disabled={addM.isPending || !value.trim()}><Plus className="mr-1 h-4 w-4" />Add</Button>
      </div>
    </Card>
  );
}
