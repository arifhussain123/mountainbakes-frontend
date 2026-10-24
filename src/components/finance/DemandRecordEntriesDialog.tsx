'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { businessDateStr, type BranchAccountAdjustment } from '@mb/shared';
import { useDemandRecordAdjustments, useFinanceMutation } from '@/lib/finance';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDate, formatDateTime } from '@/utils/date';
import { cn } from '@/lib/utils';
import { Plus, Undo2 } from 'lucide-react';
import { Money, type FinanceAbilities } from './finance-ui';

/**
 * Finance's own entries in the Demand Record: one opening balance per branch
 * (everything owed from before the go-live day) and reasoned adjustments.
 *
 * Nothing here is ever edited or deleted. A wrong entry is undone by a
 * reversal — its exact opposite, dated today — and both stay on record. Each
 * submission carries a request id made when the form opens, so a double click
 * or a retry after a dropped connection posts once.
 */

type BranchItem = { value: string; label: string };

/**
 * A v4 UUID — the API requires one. `crypto.randomUUID` needs a secure context,
 * which the deployed app has and a plain-HTTP dev host on a LAN IP does not;
 * `getRandomValues` works on both.
 */
function newRequestId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const KIND_LABELS: Record<BranchAccountAdjustment['kind'], string> = {
  opening: 'Opening balance',
  adjustment: 'Adjustment',
  reversal: 'Reversal',
};

export function DemandRecordEntriesDialog({
  open,
  onOpenChange,
  branchItems,
  startDate,
  abilities,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchItems: BranchItem[];
  startDate: string;
  abilities: FinanceAbilities;
}) {
  const q = useDemandRecordAdjustments(undefined, { enabled: open });
  const [posting, setPosting] = useState(false);
  const [reversing, setReversing] = useState<BranchAccountAdjustment | null>(null);
  const entries = q.data ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton className="max-h-[90vh] overflow-y-auto md:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Opening balances & adjustments</DialogTitle>
          <DialogDescription>
            Positive amounts raise what a branch owes the company; negative amounts are a credit. Entries are never
            edited — reverse one to undo it.
          </DialogDescription>
        </DialogHeader>

        {abilities.approve && (
          <div>
            <Button size="sm" onClick={() => setPosting(true)}>
              <Plus className="mr-1.5 h-4 w-4" /> New entry
            </Button>
          </div>
        )}

        {q.isLoading ? (
          <div className="h-24 animate-pulse rounded bg-muted" />
        ) : q.isError ? (
          <div className="flex items-center justify-between rounded border border-destructive/40 px-3 py-2 text-sm">
            <span className="text-destructive">{q.error instanceof Error ? q.error.message : 'Could not load entries.'}</span>
            <Button variant="outline" size="sm" onClick={() => void q.refetch()}>Retry</Button>
          </div>
        ) : entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No entries yet. Start with each branch&apos;s opening balance as of {formatDate(startDate)}.
          </p>
        ) : (
          <div className="divide-y rounded-lg border">
            {entries.map((e) => (
              <div key={e.id} className={cn('flex flex-wrap items-start justify-between gap-3 px-3 py-2.5 text-sm', e.reversedBy && 'opacity-60')}>
                <div className="min-w-0 space-y-0.5">
                  <p className="font-medium">
                    {e.branchName} · {KIND_LABELS[e.kind]}
                    {e.reversedBy && <span className="ml-2 text-xs font-normal text-destructive">reversed</span>}
                  </p>
                  <p className="text-muted-foreground">{e.reason}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(e.businessDate)} · by {e.createdByName ?? '—'} · {formatDateTime(e.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Money value={e.amount} signed className="font-semibold" />
                  {abilities.approve && e.kind !== 'reversal' && !e.reversedBy && (
                    <Button variant="ghost" size="sm" onClick={() => setReversing(e)}>
                      <Undo2 className="mr-1.5 h-4 w-4" /> Reverse
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Mounted only while open, so each opening starts a clean form with a fresh request id. */}
        {posting && <NewEntryDialog onClose={() => setPosting(false)} branchItems={branchItems} startDate={startDate} />}
        {reversing && <ReverseDialog key={reversing.id} entry={reversing} onClose={() => setReversing(null)} />}
      </DialogContent>
    </Dialog>
  );
}

function NewEntryDialog({
  onClose,
  branchItems,
  startDate,
}: {
  onClose: () => void;
  branchItems: BranchItem[];
  startDate: string;
}) {
  const today = businessDateStr();
  // One id per opened form: a retry of THIS submission reuses it and posts once.
  const [requestId] = useState(newRequestId);
  const [branchId, setBranchId] = useState('');
  const [kind, setKind] = useState<'opening' | 'adjustment'>('opening');
  const [direction, setDirection] = useState<'owes' | 'credit'>('owes');
  const [amount, setAmount] = useState('');
  const [businessDate, setBusinessDate] = useState(today);
  const [reason, setReason] = useState('');
  const mut = useFinanceMutation<{ entry: BranchAccountAdjustment; replayed: boolean }>();

  const kindItems = [
    { value: 'opening', label: 'Opening balance' },
    { value: 'adjustment', label: 'Adjustment' },
  ];
  const directionItems = [
    { value: 'owes', label: 'Branch owes more (+)' },
    { value: 'credit', label: 'Credit to the branch (−)' },
  ];

  async function submit() {
    const n = Number(amount);
    if (!branchId) return void toast.error('Choose a branch');
    if (!Number.isFinite(n) || n <= 0) return void toast.error('Enter an amount above zero');
    if (reason.trim().length < 3) return void toast.error('Give a reason of at least 3 characters');
    try {
      const r = await mut.mutateAsync({
        path: '/api/finance/branch-account/adjustments',
        body: {
          requestId,
          branchId,
          kind,
          amount: direction === 'credit' ? -n : n,
          ...(kind === 'adjustment' ? { businessDate } : {}),
          reason: reason.trim(),
        },
      });
      toast.success(r.replayed ? 'Already recorded' : 'Entry recorded');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not record the entry');
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>New entry</DialogTitle>
          <DialogDescription>
            {kind === 'opening'
              ? `What the branch owed the company before ${formatDate(startDate)}. One per branch.`
              : 'A reasoned correction. Dated in the past, it lands after that day\'s demands and carries through every later balance.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Branch</Label>
            <Select items={branchItems} value={branchId} onValueChange={(v) => setBranchId((v as string) ?? '')}>
              <SelectTrigger className="h-11 w-full md:h-9"><SelectValue placeholder="Choose a branch" /></SelectTrigger>
              <SelectContent>
                {branchItems.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Kind</Label>
              <Select items={kindItems} value={kind} onValueChange={(v) => v && setKind(v as 'opening' | 'adjustment')}>
                <SelectTrigger className="h-11 w-full md:h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {kindItems.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Date</Label>
              <Input
                type="date"
                value={kind === 'opening' ? startDate : businessDate}
                disabled={kind === 'opening'}
                min={startDate}
                max={today}
                onChange={(e) => setBusinessDate(e.target.value || today)}
                className="h-11 md:h-9"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Direction</Label>
              <Select items={directionItems} value={direction} onValueChange={(v) => v && setDirection(v as 'owes' | 'credit')}>
                <SelectTrigger className="h-11 w-full md:h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {directionItems.map((d) => <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Amount (Rs.)</Label>
              <Input type="number" inputMode="decimal" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-11 md:h-9" />
            </div>
          </div>
          <div className="space-y-1">
            <Label>Reason</Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Balance agreed with the branch manager at go-live" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={mut.isPending} onClick={() => void submit()}>{mut.isPending ? 'Recording…' : 'Record'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReverseDialog({ entry, onClose }: { entry: BranchAccountAdjustment; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [requestId] = useState(newRequestId);
  const mut = useFinanceMutation<{ entry: BranchAccountAdjustment; replayed: boolean }>();

  async function submit() {
    if (reason.trim().length < 3) return void toast.error('Give a reason of at least 3 characters');
    try {
      await mut.mutateAsync({ path: `/api/finance/branch-account/adjustments/${entry.id}/reverse`, body: { requestId, reason: reason.trim() } });
      toast.success('Entry reversed');
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not reverse the entry');
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>Reverse this entry</DialogTitle>
          <DialogDescription>
            Posts <Money value={-entry.amount} /> to {entry.branchName}, dated today. The original stays on record.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label>Reason</Label>
          <Textarea autoFocus rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Entered against the wrong branch" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={mut.isPending} onClick={() => void submit()}>
            {mut.isPending ? 'Reversing…' : 'Reverse'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
