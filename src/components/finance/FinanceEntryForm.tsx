'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  businessDateStr,
  CreateFinanceTransactionSchema,
  FINANCE_ACCOUNT_LABELS,
  FINANCE_PAYMENT_METHOD_LABELS,
  FINANCE_PAYMENT_METHODS,
  type CreateFinanceTransactionInput,
  type FinanceTransaction,
  type LedgerHeadType,
} from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranches } from '@/lib/queries';
import { useFinanceMutation, useLedgerHeads } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * Raise a manual income or expense document.
 *
 * The income/expense toggle is LOCAL STATE, not a form field. The API takes only
 * a ledger head id and reads the type off the head itself — trusting a
 * client-supplied type would let a mis-set toggle book an expense as income (see
 * the note at the top of finance.schemas.ts). Here it only filters which heads
 * the dropdown offers.
 *
 * Two submit buttons rather than a "save as draft" checkbox: an accountant
 * filling this in either wants it in front of an approver now or wants to come
 * back to it, and that is a decision made at the moment of pressing, not while
 * reading the form.
 */
export function FinanceEntryForm({
  entry,
  onSuccess,
}: {
  /** Present when editing an existing draft or rejected document. */
  entry?: FinanceTransaction;
  onSuccess?: () => void;
}) {
  const { token } = useAuth();
  const branchesQ = useBranches(token ?? '');
  const headsQ = useLedgerHeads();
  const mut = useFinanceMutation();

  const [headType, setHeadType] = useState<LedgerHeadType>(entry?.txnType ?? 'expense');

  const form = useForm<CreateFinanceTransactionInput>({
    resolver: zodResolver(CreateFinanceTransactionSchema),
    defaultValues: {
      ledgerHeadId: entry?.ledgerHeadId ?? '',
      branchId: entry?.branchId ?? null,
      description: entry?.description ?? '',
      amount: (entry?.amount ?? undefined) as unknown as number,
      paymentMethod: (entry?.paymentMethod as CreateFinanceTransactionInput['paymentMethod']) ?? 'cash',
      account: entry?.account ?? 'cash',
      businessDate: entry?.businessDate ?? businessDateStr(),
      referenceNo: entry?.referenceNo ?? '',
      notes: entry?.notes ?? '',
      asDraft: false,
    },
  });

  const heads = (headsQ.data ?? []).filter((h) => h.type === headType);
  const ledgerHeadId = form.watch('ledgerHeadId');
  const account = form.watch('account');
  const paymentMethod = form.watch('paymentMethod');
  const branchId = form.watch('branchId');

  async function save(data: CreateFinanceTransactionInput, asDraft: boolean) {
    try {
      if (entry) {
        // Editing only ever touches a draft or a rejected document — a posted one
        // has no update path at all, by design.
        await mut.mutateAsync({
          path: `/api/finance/income/entries/${entry.id}`,
          method: 'PUT',
          body: { ...data, asDraft: undefined },
        });
        toast.success('Entry updated');
      } else {
        await mut.mutateAsync({
          path: '/api/finance/income/entries',
          body: { ...data, asDraft },
        });
        toast.success(asDraft ? 'Saved as a draft' : 'Submitted for approval');
      }
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save this entry');
    }
  }

  const errors = form.formState.errors;

  return (
    <form onSubmit={form.handleSubmit((d) => save(d, false))} className="space-y-4">
      {/* Which side of the books. Disabled while editing: changing it would mean
          a different head, and the document's type is what an approver already
          saw when it was submitted. */}
      <div className="space-y-2">
        <Label>Type</Label>
        <div className="grid grid-cols-2 gap-2">
          {(['income', 'expense'] as const).map((t) => (
            <button
              key={t}
              type="button"
              disabled={Boolean(entry)}
              onClick={() => {
                setHeadType(t);
                form.setValue('ledgerHeadId', '');
              }}
              className={cn(
                'rounded-lg border px-3 py-2 text-sm font-medium capitalize transition-colors disabled:opacity-50',
                headType === t ? 'border-primary bg-primary/10 text-primary' : 'border-input hover:bg-accent',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <Label>Ledger head</Label>
        <Select
          value={ledgerHeadId}
          onValueChange={(v) => form.setValue('ledgerHeadId', (v as string) ?? '', { shouldValidate: true })}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={headsQ.isLoading ? 'Loading…' : 'Select a ledger head'} />
          </SelectTrigger>
          <SelectContent>
            {heads.map((h) => (
              <SelectItem key={h.id} value={h.id}>
                {h.name}
                {h.groupName ? ` · ${h.groupName}` : ''}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.ledgerHeadId && <p className="text-xs text-destructive">{errors.ledgerHeadId.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Business date</Label>
          <Input type="date" {...form.register('businessDate')} />
          {errors.businessDate && <p className="text-xs text-destructive">{errors.businessDate.message}</p>}
        </div>
        <div className="space-y-1">
          <Label>Amount</Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            placeholder="0.00"
            {...form.register('amount', { valueAsNumber: true })}
          />
          {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}
        </div>
      </div>

      <div className="space-y-1">
        <Label>Description</Label>
        <Input placeholder="e.g. October office rent" {...form.register('description')} />
        {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
      </div>

      <div className="space-y-2">
        <Label>Account</Label>
        <div className="grid grid-cols-2 gap-2">
          {(['cash', 'bank'] as const).map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => form.setValue('account', a)}
              className={cn(
                'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                account === a ? 'border-primary bg-primary/10 text-primary' : 'border-input hover:bg-accent',
              )}
            >
              {FINANCE_ACCOUNT_LABELS[a]}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <Label>Payment method</Label>
        <Select
          value={paymentMethod}
          onValueChange={(v) =>
            form.setValue('paymentMethod', (v as CreateFinanceTransactionInput['paymentMethod']) ?? 'cash')
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {FINANCE_PAYMENT_METHODS.map((m) => (
              <SelectItem key={m} value={m}>
                {FINANCE_PAYMENT_METHOD_LABELS[m] ?? m}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label>Branch (optional)</Label>
        <Select
          value={branchId ?? '__none__'}
          onValueChange={(v) => form.setValue('branchId', v === '__none__' ? null : ((v as string) ?? null))}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Company-wide" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Company-wide</SelectItem>
            {(branchesQ.data ?? []).map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <Label>Reference (optional)</Label>
        <Input placeholder="Cheque no, invoice no, transfer reference" {...form.register('referenceNo')} />
      </div>

      <div className="space-y-1">
        <Label>Notes (optional)</Label>
        <Textarea rows={2} placeholder="Anything an approver should know" {...form.register('notes')} />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        {!entry && (
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="flex-1"
            disabled={mut.isPending}
            onClick={() => void form.handleSubmit((d) => save(d, true))()}
          >
            Save as draft
          </Button>
        )}
        <Button type="submit" size="lg" className="flex-1" disabled={mut.isPending}>
          {mut.isPending ? 'Saving…' : entry ? 'Save changes' : 'Submit for approval'}
        </Button>
      </div>
    </form>
  );
}
