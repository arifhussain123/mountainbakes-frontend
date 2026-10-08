'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  businessDateStr,
  FINANCE_ACCOUNTS,
  FINANCE_ACCOUNT_LABELS,
  FINANCE_PAYMENT_METHODS,
  FINANCE_PAYMENT_METHOD_LABELS,
  type LedgerEntry,
} from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranches } from '@/lib/queries';
import { useFinanceMutation, useLedgerHeads } from '@/lib/finance';
import { ApiError } from '@/utils/api';
import { formatDate } from '@/utils/date';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Money, useMoney } from './finance-ui';

/**
 * The Daily Ledger's Edit and Delete.
 *
 *   EDIT   = change the same entry. The voucher keeps its PV-/RV- number;
 *            nothing is reversed and no new voucher is posted.
 *   DELETE = delete the entry. Nothing is posted to cancel it.
 *
 * Both are one request to the API, which does the whole change in one database
 * transaction and records who changed what in the audit trail. The voucher
 * number and the side of the book (receipt or payment) are not fields here and
 * are not sent.
 */

const selectClass = 'h-11 w-full rounded-md border bg-background px-2 text-base md:h-9 md:text-sm';
const amountOf = (e: LedgerEntry) => (e.debit > 0 ? e.debit : e.credit);

type Draft = {
  amount: string;
  entryDate: string;
  ledgerHeadId: string;
  branchId: string;
  paymentMethod: string;
  account: string;
  description: string;
};

const draftOf = (e: LedgerEntry): Draft => ({
  amount: String(amountOf(e)),
  entryDate: e.entryDate,
  ledgerHeadId: e.ledgerHeadId ?? '',
  branchId: e.branchId ?? '',
  paymentMethod: e.paymentMethod ?? '',
  account: e.account,
  description: e.description,
});

export function EditLedgerEntryDialog({ entry, onClose }: { entry: LedgerEntry; onClose: () => void }) {
  const { token } = useAuth();
  const { format } = useMoney();
  const { data: branches = [] } = useBranches(token ?? '', { enabled: Boolean(token) });
  const { data: heads = [] } = useLedgerHeads();
  const mut = useFinanceMutation();

  const original = useMemo(() => draftOf(entry), [entry]);
  const [draft, setDraft] = useState<Draft>(original);
  const [reason, setReason] = useState('');
  const [conflict, setConflict] = useState('');
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  // A correction keeps the voucher on its side of the book: same-type categories only.
  const headOptions = heads.filter((h) => h.type === entry.ledgerHeadType);
  const today = businessDateStr();

  const amount = Number(draft.amount);
  const amountBad = !/^\d{1,12}(\.\d{1,2})?$/.test(draft.amount.trim()) || !(amount > 0);
  const changed = (Object.keys(original) as (keyof Draft)[]).filter((k) =>
    k === 'amount' ? Math.round(amount * 100) !== Math.round(Number(original.amount) * 100) : draft[k].trim() !== original[k].trim(),
  );
  const descriptionBad = draft.description.trim().length < 2;
  const blocked = mut.isPending || changed.length === 0 || amountBad || descriptionBad || reason.trim().length < 5 || draft.entryDate > today;

  const label: Record<keyof Draft, string> = {
    amount: 'Amount',
    entryDate: 'Date',
    ledgerHeadId: 'Category',
    branchId: 'Branch',
    paymentMethod: 'Payment method',
    account: 'Account',
    description: 'Description',
  };
  const shown = (k: keyof Draft, v: string) => {
    if (k === 'amount') return format(Number(v || 0));
    if (k === 'entryDate') return formatDate(v);
    if (k === 'ledgerHeadId') return heads.find((h) => h.id === v)?.name ?? (v === original.ledgerHeadId ? entry.ledgerHeadName : '—');
    if (k === 'branchId') return v ? (branches.find((b) => b.id === v)?.name ?? entry.branchName ?? '—') : 'Company-wide';
    if (k === 'paymentMethod') return FINANCE_PAYMENT_METHOD_LABELS[v] ?? (v || '—');
    if (k === 'account') return FINANCE_ACCOUNT_LABELS[v as keyof typeof FINANCE_ACCOUNT_LABELS] ?? v;
    return v;
  };

  async function submit() {
    setConflict('');
    const changes: Record<string, unknown> = {};
    const expected: Record<string, unknown> = {};
    for (const k of changed) {
      changes[k] = k === 'amount' ? amount : draft[k].trim();
      expected[k] = k === 'amount' ? Number(original.amount) : original[k];
    }
    try {
      await mut.mutateAsync({
        path: `/api/finance/ledger/${entry.id}`,
        method: 'PATCH',
        body: { reason: reason.trim(), changes, expected },
      });
      toast.success('Ledger entry updated successfully.');
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409 && (err.details as { code?: string } | undefined)?.code === 'conflict') {
        setConflict(err.message);
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Could not update this entry');
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !mut.isPending && onClose()}>
      <DialogContent className="overflow-y-auto md:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            Edit <span className="font-mono">{entry.voucherNo}</span>
          </DialogTitle>
          <DialogDescription>
            This changes the entry itself. It keeps the number {entry.voucherNo}; nothing is reversed and no new voucher
            is created.
          </DialogDescription>
        </DialogHeader>

        {conflict && (
          <p role="alert" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
            {conflict} Close this window and open the entry again to see its latest values.
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="le-amount">Amount ({entry.debit > 0 ? 'Debit' : 'Credit'})</Label>
            <Input
              id="le-amount"
              inputMode="decimal"
              value={draft.amount}
              onChange={(e) => set('amount', e.target.value.replace(/[^\d.]/g, ''))}
              aria-invalid={amountBad || undefined}
              className="tabular-nums"
            />
            {amountBad && <p className="text-xs text-destructive">Enter an amount greater than 0, up to 2 decimal places.</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="le-date">Date</Label>
            <Input id="le-date" type="date" max={today} value={draft.entryDate} onChange={(e) => set('entryDate', e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="le-branch">Branch</Label>
            <select id="le-branch" value={draft.branchId} onChange={(e) => set('branchId', e.target.value)} className={selectClass}>
              <option value="">Company-wide</option>
              {original.branchId && !branches.some((b) => b.id === original.branchId) && (
                <option value={original.branchId}>{entry.branchName ?? '—'}</option>
              )}
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="le-head">Category</Label>
            <select id="le-head" value={draft.ledgerHeadId} onChange={(e) => set('ledgerHeadId', e.target.value)} className={selectClass}>
              {!headOptions.some((h) => h.id === original.ledgerHeadId) && (
                <option value={original.ledgerHeadId}>{entry.ledgerHeadName}</option>
              )}
              {headOptions.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="le-method">Payment method</Label>
            <select id="le-method" value={draft.paymentMethod} onChange={(e) => set('paymentMethod', e.target.value)} className={selectClass}>
              {!(FINANCE_PAYMENT_METHODS as readonly string[]).includes(original.paymentMethod) && (
                <option value={original.paymentMethod}>{original.paymentMethod || '—'}</option>
              )}
              {FINANCE_PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {FINANCE_PAYMENT_METHOD_LABELS[m] ?? m}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="le-account">Account</Label>
            <select id="le-account" value={draft.account} onChange={(e) => set('account', e.target.value)} className={selectClass}>
              {FINANCE_ACCOUNTS.map((a) => (
                <option key={a} value={a}>
                  {FINANCE_ACCOUNT_LABELS[a]}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="le-desc">Description</Label>
            <Input id="le-desc" value={draft.description} maxLength={300} onChange={(e) => set('description', e.target.value)} />
          </div>
        </div>

        <div className="rounded-md bg-muted/50 px-3 py-2 text-sm">
          <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Changes</p>
          {changed.length === 0 ? (
            <p className="text-muted-foreground">No changes yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {changed.map((k) => (
                <li key={k} className="break-words tabular-nums">
                  <span className="text-muted-foreground">{label[k]}:</span> {shown(k, original[k])} →{' '}
                  <span className="font-semibold">{shown(k, draft[k])}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-1">
          <Label htmlFor="le-reason">Reason</Label>
          <Textarea id="le-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this entry is being changed" />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={blocked}>
            {mut.isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteLedgerEntryDialog({ entry, onClose }: { entry: LedgerEntry; onClose: () => void }) {
  const mut = useFinanceMutation();
  const [reason, setReason] = useState('');

  async function submit() {
    try {
      await mut.mutateAsync({
        path: `/api/finance/ledger/${entry.id}`,
        method: 'DELETE',
        body: { reason: reason.trim() },
      });
      toast.success('Ledger entry deleted successfully.');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not delete this entry');
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !mut.isPending && onClose()}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete Ledger Entry?</DialogTitle>
          <DialogDescription>This will delete the selected ledger entry. No reversal is posted.</DialogDescription>
        </DialogHeader>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-md bg-muted/50 px-3 py-2.5 text-sm">
          <dt className="text-muted-foreground">PV/RV</dt>
          <dd className="font-mono font-medium">{entry.voucherNo}</dd>
          <dt className="text-muted-foreground">Date</dt>
          <dd>{formatDate(entry.entryDate)}</dd>
          <dt className="text-muted-foreground">Branch</dt>
          <dd>{entry.branchName ?? 'Company-wide'}</dd>
          <dt className="text-muted-foreground">Category</dt>
          <dd>{entry.ledgerHeadName}</dd>
          <dt className="text-muted-foreground">Amount</dt>
          <dd>
            <Money value={amountOf(entry)} className="font-semibold" /> {entry.debit > 0 ? '(Debit)' : '(Credit)'}
          </dd>
        </dl>

        <div className="space-y-1">
          <Label htmlFor="le-del-reason">Reason</Label>
          <Textarea id="le-del-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this entry is being deleted" autoFocus />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={mut.isPending || reason.trim().length < 5}>
            {mut.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
