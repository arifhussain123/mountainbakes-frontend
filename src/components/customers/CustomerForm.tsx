'use client';

import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { CreateCustomerSchema, type CreateCustomerInput, type Branch, type Customer } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

export function CustomerForm({ customer, onSuccess }: { customer?: Customer | null; onSuccess?: () => void }) {
  const { token, user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const form = useForm<CreateCustomerInput>({
    resolver: zodResolver(CreateCustomerSchema),
    defaultValues: customer ? {
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      address: customer.address,
      branchId: customer.branchId,
    } : {
      name: '', phone: '', email: '', address: '',
      branchId: user?.branchId || '',
    },
  });

  useEffect(() => {
    if (!token || user?.role === 'branch_manager') return;
    apiCall<{ branches: Branch[] }>('/api/branches', {}, token)
      .then((r) => setBranches(r.branches ?? []))
      .catch((err) => {
        console.error('Failed to load branches', err);
        toast.error('Could not load branches');
      });
  }, [token, user?.role]);

  async function onSubmit(data: CreateCustomerInput) {
    setSubmitting(true);
    try {
      if (customer) {
        await apiCall(`/api/customers/${customer.id}`, { method: 'PUT', body: JSON.stringify(data) }, token);
        toast.success('Customer updated');
      } else {
        await apiCall('/api/customers', { method: 'POST', body: JSON.stringify(data) }, token);
        toast.success('Customer added');
      }
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save customer');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1">
        <Label>Full Name</Label>
        <Input {...form.register('name')} placeholder="Ahmed Khan" />
        {form.formState.errors.name && <p className="text-xs text-destructive">{form.formState.errors.name.message}</p>}
      </div>

      <div className="space-y-1">
        <Label>Phone Number</Label>
        <Input {...form.register('phone')} placeholder="03001234567" />
        {form.formState.errors.phone && <p className="text-xs text-destructive">{form.formState.errors.phone.message}</p>}
      </div>

      <div className="space-y-1">
        <Label>Email (optional)</Label>
        <Input type="email" {...form.register('email')} placeholder="ahmed@example.com" />
      </div>

      <div className="space-y-1">
        <Label>Address (optional)</Label>
        <Input {...form.register('address')} placeholder="Street, area, city" />
      </div>

      {user?.role !== 'branch_manager' && (
        <div className="space-y-1">
          <Label>Branch</Label>
          <Select
            items={branches.map((b) => ({ value: b.id, label: b.name }))}
            value={form.watch('branchId') || null}
            onValueChange={(v) => form.setValue('branchId', (v as string) ?? '', { shouldValidate: true })}
          >
            <SelectTrigger className="w-full"><SelectValue placeholder="Select branch" /></SelectTrigger>
            <SelectContent>
              {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      )}

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? 'Savingâ€¦' : customer ? 'Update Customer' : 'Add Customer'}
      </Button>
    </form>
  );
}
