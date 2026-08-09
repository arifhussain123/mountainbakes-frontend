'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  businessDateStr,
  CreateBranchSharePaymentSchema,
  CreatePartnerExpenseSchema,
  FINANCE_ACCOUNT_LABELS,
  FINANCE_PAYMENT_METHOD_LABELS,
  FINANCE_PAYMENT_METHODS,
  UpdateFinancePartnerSchema,
  type BranchSharePayment,
  type CreateBranchSharePaymentInput,
  type CreatePartnerExpenseInput,
  type FinancePartner,
  type PartnerExpense,
  type PartnerTxnKind,
  type UpdateFinancePartnerInput,
} from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranches } from '@/lib/queries';
import { useFinanceMutation, useFinancePartners } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

/**
 * Forms for the Company Transaction Details page — a partner advance/draw, a
 * branch share payout, and the partner profile edit ("Add Partner Detail").
 */

// ---------------------------------------------------------------------------
// Partner advance / draw
// ---------------------------------------------------------------------------

export function PartnerTxnForm({
  txnKind,
  expense,
  onSuccess,
}: {
  txnKind: PartnerTxnKind;
  /** Present when editing a draft or rejected record. */
  expense?: PartnerExpense;
  onSuccess?: () => void;
}) {
  const partnersQ = useFinancePartners();
  const mut = useFinanceMutation();

  const form = useForm<CreatePartnerExpenseInput>({
    resolver: zodResolver(CreatePartnerExpenseSchema),
    defaultValues: {
      partnerId: expense?.partnerId ?? '',
      txnKind: expense?.txnKind ?? txnKind,
      amount: (expense?.amount ?? undefined) as unknown as number,
      paymentMethod: (expense?.paymentMethod as CreatePartnerExpenseInput['paymentMethod']) ?? 'cash',
      account: expense?.account ?? 'cash',
      businessDate: expense?.businessDate ?? businessDateStr(),
      notes: expense?.notes ?? '',
      asDraft: false,
    },
  });

  const partnerId = form.watch('partnerId');
  const account = form.watch('account');
  const paymentMethod = form.watch('paymentMethod');
  const partners = partnersQ.data ?? [];

  async function save(data: CreatePartnerExpenseInput, asDraft: boolean) {
    try {
      if (expense) {
        // partnerId and txnKind can't change after creation — see
        // UpdatePartnerExpenseSchema for why.
        await mut.mutateAsync({
          path: `/api/finance/partner-expenses/${expense.id}`,
          method: 'PUT',
          body: {
            amount: data.amount,
            paymentMethod: data.paymentMethod,
            account: data.account,
            businessDate: data.businessDate,
            notes: data.notes,
          },
        });
        toast.success('Updated');
      } else {
        await mut.mutateAsync({ path: '/api/finance/partner-expenses', body: { ...data, asDraft } });
        toast.success(asDraft ? 'Saved as a draft' : 'Submitted for approval');
      }
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save this request');
    }
  }

  const errors = form.formState.errors;

  return (
    <form onSubmit={form.handleSubmit((d) => save(d, false))} className="space-y-4">
      <div className="space-y-1">
        <Label>Partner</Label>
        <Select
          value={partnerId}
          onValueChange={(v) => form.setValue('partnerId', (v as string) ?? '', { shouldValidate: true })}
          disabled={Boolean(expense)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={partnersQ.isLoading ? 'Loading…' : 'Select a partner'} />
          </SelectTrigger>
          <SelectContent>
            {partners.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.partnerId && <p className="text-xs text-destructive">{errors.partnerId.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Date</Label>
          <Input type="date" {...form.register('businessDate')} />
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

      <div className="space-y-2">
        <Label>Paid from</Label>
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
          onValueChange={(v) => form.setValue('paymentMethod', (v as CreatePartnerExpenseInput['paymentMethod']) ?? 'cash')}
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
        <Label>Note (optional)</Label>
        <Textarea rows={2} placeholder="Anything an approver should know" {...form.register('notes')} />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        {!expense && (
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
          {mut.isPending ? 'Saving…' : expense ? 'Save changes' : 'Submit for approval'}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Branch share payout
// ---------------------------------------------------------------------------

export function BranchShareForm({
  payment,
  onSuccess,
}: {
  payment?: BranchSharePayment;
  onSuccess?: () => void;
}) {
  const { token } = useAuth();
  const branchesQ = useBranches(token ?? '');
  const mut = useFinanceMutation();

  const form = useForm<CreateBranchSharePaymentInput>({
    resolver: zodResolver(CreateBranchSharePaymentSchema),
    defaultValues: {
      branchId: payment?.branchId ?? '',
      amount: payment?.amount ?? 0,
      bonus: payment?.bonus ?? 0,
      paymentMethod: (payment?.paymentMethod as CreateBranchSharePaymentInput['paymentMethod']) ?? 'cash',
      account: payment?.account ?? 'cash',
      businessDate: payment?.businessDate ?? businessDateStr(),
      notes: payment?.notes ?? '',
      asDraft: false,
    },
  });

  const branchId = form.watch('branchId');
  const account = form.watch('account');
  const paymentMethod = form.watch('paymentMethod');

  async function save(data: CreateBranchSharePaymentInput, asDraft: boolean) {
    try {
      if (payment) {
        await mut.mutateAsync({
          path: `/api/finance/branch-share/${payment.id}`,
          method: 'PUT',
          body: {
            amount: data.amount,
            bonus: data.bonus,
            paymentMethod: data.paymentMethod,
            account: data.account,
            businessDate: data.businessDate,
            notes: data.notes,
          },
        });
        toast.success('Updated');
      } else {
        await mut.mutateAsync({ path: '/api/finance/branch-share', body: { ...data, asDraft } });
        toast.success(asDraft ? 'Saved as a draft' : 'Submitted for approval');
      }
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save this payment');
    }
  }

  const errors = form.formState.errors;

  return (
    <form onSubmit={form.handleSubmit((d) => save(d, false))} className="space-y-4">
      <div className="space-y-1">
        <Label>Branch</Label>
        <Select
          value={branchId}
          onValueChange={(v) => form.setValue('branchId', (v as string) ?? '', { shouldValidate: true })}
          disabled={Boolean(payment)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={branchesQ.isLoading ? 'Loading…' : 'Select a branch'} />
          </SelectTrigger>
          <SelectContent>
            {(branchesQ.data ?? []).map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.branchId && <p className="text-xs text-destructive">{errors.branchId.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Date</Label>
          <Input type="date" {...form.register('businessDate')} />
        </div>
        <div className="space-y-1">
          <Label>Share amount</Label>
          <Input
            type="number"
            min={0}
            step="0.01"
            inputMode="decimal"
            placeholder="0.00"
            {...form.register('amount', { valueAsNumber: true })}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Bonus (optional)</Label>
        <Input
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          placeholder="0.00"
          {...form.register('bonus', { valueAsNumber: true })}
        />
        <p className="text-xs text-muted-foreground">
          Posts separately to Production Expenses, with a note naming the branch.
        </p>
      </div>
      {errors.amount && <p className="text-xs text-destructive">{errors.amount.message}</p>}

      <div className="space-y-2">
        <Label>Paid from</Label>
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
          onValueChange={(v) => form.setValue('paymentMethod', (v as CreateBranchSharePaymentInput['paymentMethod']) ?? 'cash')}
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
        <Label>Note (optional)</Label>
        <Textarea rows={2} placeholder="Anything an approver should know" {...form.register('notes')} />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        {!payment && (
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
          {mut.isPending ? 'Saving…' : payment ? 'Save changes' : 'Submit for approval'}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Partner profile ("Add Partner Detail")
// ---------------------------------------------------------------------------

export function PartnerDetailForm({
  partner,
  onSuccess,
}: {
  partner: FinancePartner;
  onSuccess?: () => void;
}) {
  const mut = useFinanceMutation();

  const form = useForm<UpdateFinancePartnerInput>({
    resolver: zodResolver(UpdateFinancePartnerSchema),
    defaultValues: {
      fatherName: partner.fatherName ?? '',
      dateOfBirth: partner.dateOfBirth ?? '',
      joinedOn: partner.joinedOn ?? '',
      partnerType: partner.partnerType ?? null,
      address: partner.address ?? '',
      contactNumber: partner.contactNumber ?? '',
      emergencyNumber: partner.emergencyNumber ?? '',
    },
  });

  const partnerType = form.watch('partnerType');

  async function save(data: UpdateFinancePartnerInput) {
    try {
      await mut.mutateAsync({
        path: `/api/finance/partner-expenses/partners/${partner.id}`,
        method: 'PUT',
        body: data,
      });
      toast.success('Partner details saved');
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save partner details');
    }
  }

  return (
    <form onSubmit={form.handleSubmit(save)} className="space-y-4">
      <div className="space-y-1">
        <Label>Name</Label>
        <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm font-medium">{partner.name}</div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Father name</Label>
          <Input placeholder="Father's full name" {...form.register('fatherName')} />
        </div>
        <div className="space-y-1">
          <Label>Partner type</Label>
          <Select
            value={partnerType ?? '__none__'}
            onValueChange={(v) => form.setValue('partnerType', v === '__none__' ? null : (v as 'founder' | 'co_founder'))}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Not set" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">Not set</SelectItem>
              <SelectItem value="founder">Founder</SelectItem>
              <SelectItem value="co_founder">Co-Founder</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Date of birth</Label>
          <Input type="date" {...form.register('dateOfBirth')} />
        </div>
        <div className="space-y-1">
          <Label>Date of join</Label>
          <Input type="date" {...form.register('joinedOn')} />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Address</Label>
        <Textarea rows={2} placeholder="Residential address" {...form.register('address')} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Contact number</Label>
          <Input placeholder="03xx xxxxxxx" {...form.register('contactNumber')} />
        </div>
        <div className="space-y-1">
          <Label>Emergency number</Label>
          <Input placeholder="03xx xxxxxxx" {...form.register('emergencyNumber')} />
        </div>
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={mut.isPending}>
        {mut.isPending ? 'Saving…' : 'Save details'}
      </Button>
    </form>
  );
}
