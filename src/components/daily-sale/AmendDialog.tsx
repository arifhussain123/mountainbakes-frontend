'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  DAILY_SALE_AMEND_FIELDS,
  DAILY_SALE_FIELD_LABELS,
  type DailySaleAmendField,
  type DailySaleRecord,
} from '@mb/shared';
import { useAmendDailySale } from '@/lib/queries';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { exactMoney, orDash } from './parts';

/**
 * Admin amendment of a signed-off figure (§16).
 *
 * ─── Only a COUNTED figure appears in the list ───────────────────────────────
 * `DAILY_SALE_AMEND_FIELDS` holds the three manual columns and no auto one. An
 * auto figure is derived from `orders`, so a wrong one means a wrong SALE and is
 * corrected by correcting the sale — the Help Desk is the audited channel for
 * exactly that. Amending it here would leave the ledger and this record each
 * claiming to be right about the same day. `amend_daily_sale_record` refuses any
 * other field, so this list is the courtesy and the SQL is the boundary.
 *
 * ─── The old value is shown but never sent ───────────────────────────────────
 * It is on screen so the admin can see what they are changing; the RPC reads it
 * off the row it is about to change, inside the same transaction, and writes both
 * halves to the history. A client-supplied "old value" could not be trusted and
 * would only be a second thing to get out of step.
 */
export function AmendDialog({
  open,
  onOpenChange,
  record,
  token,
  currencySymbol = 'Rs.',
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  record: DailySaleRecord | null;
  token: string;
  currencySymbol?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>Amend Daily Sale Record</DialogTitle>
        </DialogHeader>
        {record?.id && (
          <AmendForm
            key={record.id}
            record={record}
            token={token}
            currencySymbol={currencySymbol}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

const CURRENT_BY_FIELD: Record<DailySaleAmendField, keyof DailySaleRecord> = {
  manual_cash: 'manualCash',
  manual_easypaisa: 'manualEasypaisa',
  manual_bank: 'manualBank',
};

function AmendForm({
  record,
  token,
  currencySymbol,
  onDone,
}: {
  record: DailySaleRecord;
  token: string;
  currencySymbol: string;
  onDone: () => void;
}) {
  const amend = useAmendDailySale(token);
  const [field, setField] = useState<DailySaleAmendField>('manual_cash');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const current = record[CURRENT_BY_FIELD[field]] as number | null;

  async function submit() {
    const n = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(n) || n < 0) {
      toast.error('Enter the corrected amount');
      return;
    }
    if (Math.round(n * 100) !== n * 100) {
      toast.error('An amount can have at most 2 decimal places');
      return;
    }
    if (reason.trim().length < 3) {
      toast.error('Say why this figure is being amended');
      return;
    }

    try {
      await amend.mutateAsync({ id: record.id!, field, amount: n, reason: reason.trim() });
      toast.success('Figure amended — the original is kept in the history');
      onDone();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not amend the record');
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/40 p-3 text-sm">
        <p className="font-medium">{record.branchName}</p>
        <p className="text-muted-foreground">Business date {record.businessDate}</p>
      </div>

      <div className="space-y-1">
        <Label>Figure to amend</Label>
        <Select value={field} onValueChange={(v) => setField((v as DailySaleAmendField) ?? 'manual_cash')}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Pick a figure" />
          </SelectTrigger>
          <SelectContent>
            {DAILY_SALE_AMEND_FIELDS.map((f) => (
              <SelectItem key={f} value={f}>
                {DAILY_SALE_FIELD_LABELS[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Current value: {orDash(current, (v) => exactMoney(v, currencySymbol))}
        </p>
      </div>

      <div className="space-y-1">
        <Label>Corrected amount</Label>
        <Input
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
          className="tabular-nums"
        />
      </div>

      <div className="space-y-1">
        <Label>Reason</Label>
        <Textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Cash counting correction — Rs. 500 note found under the tray"
        />
        <p className="text-xs text-muted-foreground">
          Recorded in the history with the original figure, your name and the time. No sale
          is changed by an amendment.
        </p>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" className="flex-1" onClick={onDone} disabled={amend.isPending}>
          Cancel
        </Button>
        <Button className="flex-1" onClick={submit} disabled={amend.isPending}>
          {amend.isPending ? 'Saving…' : 'Save Amendment'}
        </Button>
      </div>
    </div>
  );
}
