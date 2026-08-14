'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useAuth } from '@/hooks/useAuth';
import { useCreateBranchUserRequest } from '@/lib/queries';
import {
  BRANCH_SHIFTS,
  BRANCH_SHIFT_LABELS,
  CreateBranchUserRequestSchema,
  type BranchShift,
  type CreateBranchUserRequestInput,
} from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

const EMPTY: CreateBranchUserRequestInput = {
  displayName: '',
  email: '',
  phone: '',
  shift: 'morning',
  note: '',
};

/**
 * What a branch manager sends to Admin.
 *
 * There is no branch field and no password field, and that is not an oversight
 * on the form — the API takes the branch from the manager's JWT (so an account
 * can only ever be opened on their own branch) and the admin sets the password
 * at approval, so a credential never sits in the queue waiting to be read.
 */
export function RequestBranchUserForm({ onSuccess }: { onSuccess?: () => void }) {
  const { token } = useAuth();
  const create = useCreateBranchUserRequest(token);

  const form = useForm<CreateBranchUserRequestInput>({
    resolver: zodResolver(CreateBranchUserRequestSchema),
    defaultValues: EMPTY,
  });
  const shift = form.watch('shift');

  async function onSubmit(data: CreateBranchUserRequestInput) {
    try {
      await create.mutateAsync(data);
      toast.success('Request sent to Admin');
      form.reset(EMPTY);
      onSuccess?.();
    } catch (err) {
      // The API answers 409 both for an address that is already a login and for
      // one already sitting in the queue; either way its message names which.
      toast.error(err instanceof Error ? err.message : 'Failed to send the request');
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
      <div className="space-y-1">
        <Label>Staff Name</Label>
        <Input placeholder="e.g. Ahmed Raza" {...form.register('displayName')} />
        {form.formState.errors.displayName && (
          <p className="text-xs text-destructive">{form.formState.errors.displayName.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <Label>Email (this becomes the login)</Label>
        <Input type="email" placeholder="name@example.com" {...form.register('email')} />
        {form.formState.errors.email && (
          <p className="text-xs text-destructive">{form.formState.errors.email.message}</p>
        )}
      </div>

      <div className="space-y-1">
        <Label>Phone (optional)</Label>
        <Input placeholder="03xx-xxxxxxx" {...form.register('phone')} />
      </div>

      <div className="space-y-2">
        <Label>Shift</Label>
        <div className="grid grid-cols-2 gap-2">
          {BRANCH_SHIFTS.map((s: BranchShift) => (
            <button
              key={s}
              type="button"
              onClick={() => form.setValue('shift', s, { shouldValidate: true })}
              className={cn(
                'rounded-lg border px-3 py-2 text-sm font-medium transition-colors',
                shift === s ? 'border-primary bg-primary/10 text-primary' : 'border-input hover:bg-accent',
              )}
            >
              {BRANCH_SHIFT_LABELS[s]}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          A label for your records. It does not restrict when the account can sign in.
        </p>
      </div>

      <div className="space-y-1">
        <Label>Note for Admin (optional)</Label>
        <Textarea placeholder="Why the account is needed, when it starts…" {...form.register('note')} />
      </div>

      <Button type="submit" className="w-full" size="lg" disabled={create.isPending}>
        {create.isPending ? 'Sending…' : 'Send Request to Admin'}
      </Button>
    </form>
  );
}
