'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '@/hooks/useAuth';
import { useCreateProductionExpense } from '@/lib/queries';
import { CreateProductionExpenseSchema, type CreateProductionExpenseInput, businessDateStr } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const CATEGORIES = ['Ingredients', 'Packaging', 'Utilities', 'Rent', 'Salaries', 'Maintenance', 'Transport', 'Equipment', 'Other'];
const METHODS: { value: 'cash' | 'easypaisa' | 'bank_account'; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'easypaisa', label: 'Easypaisa' },
  { value: 'bank_account', label: 'Bank' },
];

export function ProductionExpenseForm({ onSuccess }: { onSuccess?: () => void }) {
  const { token } = useAuth();
  const createMut = useCreateProductionExpense(token);

  const form = useForm<CreateProductionExpenseInput>({
    resolver: zodResolver(CreateProductionExpenseSchema),
    defaultValues: {
      date: businessDateStr(), category: '', description: '', amount: undefined as unknown as number,
      paymentMethod: 'cash', supplier: '', notes: '',
    },
  });
  const paymentMethod = form.watch('paymentMethod');
  const category = form.watch('category');

  async function onSubmit(data: CreateProductionExpenseInput) {
    try {
      await createMut.mutateAsync(data as unknown as Record<string, unknown>);
      toast.success('Expense saved');
      form.reset({ date: businessDateStr(), category: '', description: '', amount: undefined as unknown as number, paymentMethod: 'cash', supplier: '', notes: '' });
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save expense');
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
            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        {form.formState.errors.category && <p className="text-xs text-destructive">{form.formState.errors.category.message}</p>}
      </div>

      <div className="space-y-1">
        <Label>Description</Label>
        <Input placeholder="e.g. Flour &amp; sugar purchase" {...form.register('description')} />
        {form.formState.errors.description && <p className="text-xs text-destructive">{form.formState.errors.description.message}</p>}
      </div>

      <div className="space-y-2">
        <Label>Payment Method</Label>
        <div className="grid grid-cols-3 gap-2">
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
        <Label>Supplier (optional)</Label>
        <Input placeholder="Supplier name" {...form.register('supplier')} />
      </div>

      <div className="space-y-1">
        <Label>Notes (optional)</Label>
        <Textarea placeholder="Any notes…" {...form.register('notes')} />
      </div>

      <Button type="submit" className="w-full" size="lg" disabled={createMut.isPending}>
        {createMut.isPending ? 'Saving…' : 'Save Expense'}
      </Button>
    </form>
  );
}
