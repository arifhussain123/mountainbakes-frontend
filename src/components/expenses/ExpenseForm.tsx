'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { CreateExpenseSchema, EXPENSE_CATEGORIES, type CreateExpenseInput, type ExpensePaymentMethod, businessDateStr } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const METHODS: { value: ExpensePaymentMethod; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'easypaisa', label: 'Easypaisa' },
];

export function ExpenseForm({ onSuccess }: { onSuccess?: () => void }) {
  const { token } = useAuth();
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<CreateExpenseInput>({
    resolver: zodResolver(CreateExpenseSchema),
    defaultValues: { date: businessDateStr(), category: '', description: '', paymentMethod: 'cash', amount: undefined, remarks: '' },
  });
  const paymentMethod = form.watch('paymentMethod');
  const category = form.watch('category');

  async function onSubmit(data: CreateExpenseInput) {
    setSubmitting(true);
    try {
      await apiCall('/api/expenses', { method: 'POST', body: JSON.stringify(data) }, token);
      toast.success('Expense saved');
      form.reset({ date: businessDateStr(), category: '', description: '', paymentMethod: 'cash', amount: undefined, remarks: '' });
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save expense');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Date</Label>
          <Input type="date" {...form.register('date')} />
        </div>
        <div className="space-y-1">
          <Label>Amount</Label>
          <Input type="number" min={0} step="0.01" placeholder="0" {...form.register('amount', { valueAsNumber: true })} />
          {form.formState.errors.amount && <p className="text-xs text-destructive">{form.formState.errors.amount.message}</p>}
        </div>
      </div>

      <div className="space-y-1">
        <Label>Category</Label>
        <Select value={category} onValueChange={(v) => form.setValue('category', (v as string) ?? '', { shouldValidate: true })}>
          <SelectTrigger className="w-full"><SelectValue placeholder="Select category" /></SelectTrigger>
          <SelectContent>
            {EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        {form.formState.errors.category && <p className="text-xs text-destructive">{form.formState.errors.category.message}</p>}
      </div>

      <div className="space-y-1">
        <Label>Expense Description</Label>
        <Input placeholder="e.g. Electricity bill" {...form.register('description')} />
        {form.formState.errors.description && <p className="text-xs text-destructive">{form.formState.errors.description.message}</p>}
      </div>

      <div className="space-y-2">
        <Label>Payment Method</Label>
        <div className="grid grid-cols-2 gap-2">
          {METHODS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => form.setValue('paymentMethod', m.value)}
              className={cn(
                'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                paymentMethod === m.value ? 'border-primary bg-primary/10 text-primary' : 'border-input hover:bg-accent',
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <Label>Remarks (optional)</Label>
        <Textarea placeholder="Any notes…" {...form.register('remarks')} />
      </div>

      <Button type="submit" className="w-full" size="lg" disabled={submitting}>
        {submitting ? 'Saving…' : 'Save Expense'}
      </Button>
    </form>
  );
}
