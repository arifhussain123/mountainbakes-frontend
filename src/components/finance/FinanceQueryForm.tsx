'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '@/hooks/useAuth';
import { useBranches } from '@/lib/queries';
import { apiCall } from '@/utils/api';
import {
  CreateFinanceQuerySchema,
  FINANCE_QUERY_CATEGORIES,
  FINANCE_QUERY_TXN_TYPES,
  type CreateFinanceQueryInput,
  type FinanceQuery,
  businessDateStr,
} from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const DEFAULTS: CreateFinanceQueryInput = {
  date: businessDateStr(),
  title: '',
  amount: undefined as unknown as number,
  category: '',
  branchId: '',
  type: 'income',
  comment: '',
};

export function FinanceQueryForm({ query, onSuccess }: { query?: FinanceQuery | null; onSuccess?: () => void }) {
  const { token } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const branchesQ = useBranches(token ?? '');

  const form = useForm<CreateFinanceQueryInput>({
    resolver: zodResolver(CreateFinanceQuerySchema),
    defaultValues: query
      ? {
          date: query.date,
          title: query.title,
          amount: query.amount,
          category: query.category,
          branchId: query.branchId,
          type: query.type,
          comment: query.comment || '',
        }
      : DEFAULTS,
  });
  const category = form.watch('category');
  const branchId = form.watch('branchId');
  const type = form.watch('type');

  async function onSubmit(data: CreateFinanceQueryInput) {
    setSubmitting(true);
    try {
      if (query) {
        await apiCall(`/api/finance-queries/${query.id}`, { method: 'PATCH', body: JSON.stringify(data) }, token);
        toast.success('Finance record updated');
      } else {
        await apiCall('/api/finance-queries', { method: 'POST', body: JSON.stringify(data) }, token);
        toast.success('Finance record saved');
        form.reset(DEFAULTS);
      }
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save finance record');
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
          {form.formState.errors.date && <p className="text-xs text-destructive">{form.formState.errors.date.message}</p>}
        </div>
        <div className="space-y-1">
          <Label>Amount</Label>
          <Input type="number" min={0} step="0.01" placeholder="0" {...form.register('amount', { valueAsNumber: true })} />
          {form.formState.errors.amount && <p className="text-xs text-destructive">{form.formState.errors.amount.message}</p>}
        </div>
      </div>

      <div className="space-y-1">
        <Label>Title</Label>
        <Input placeholder="e.g. Daily Sale" {...form.register('title')} />
        {form.formState.errors.title && <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>}
      </div>

      <div className="space-y-2">
        <Label>Type</Label>
        {/* A single field, not two amount columns — the only way this record
            can be Income or Expense, never both. */}
        <div className="grid grid-cols-2 gap-2">
          {FINANCE_QUERY_TXN_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => form.setValue('type', t)}
              className={cn(
                'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                type === t ? 'border-primary bg-primary/10 text-primary' : 'border-input hover:bg-accent',
              )}
            >
              {t === 'income' ? 'Income' : 'Expense'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Category</Label>
          <Select value={category} onValueChange={(v) => form.setValue('category', (v as string) ?? '', { shouldValidate: true })}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Select category" /></SelectTrigger>
            <SelectContent>
              {FINANCE_QUERY_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
          {form.formState.errors.category && <p className="text-xs text-destructive">{form.formState.errors.category.message}</p>}
        </div>
        <div className="space-y-1">
          <Label>Branch</Label>
          <Select value={branchId || undefined} onValueChange={(v) => form.setValue('branchId', (v as string) ?? '', { shouldValidate: true })}>
            <SelectTrigger className="w-full"><SelectValue placeholder="Select branch" /></SelectTrigger>
            <SelectContent>
              {(branchesQ.data ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
          {form.formState.errors.branchId && <p className="text-xs text-destructive">{form.formState.errors.branchId.message}</p>}
        </div>
      </div>

      <div className="space-y-1">
        <Label>Comment</Label>
        <Textarea placeholder="Notes about this finance query…" rows={4} {...form.register('comment')} />
      </div>

      <Button type="submit" className="w-full" size="lg" disabled={submitting}>
        {submitting ? 'Saving…' : query ? 'Update Record' : 'Save Record'}
      </Button>
    </form>
  );
}
