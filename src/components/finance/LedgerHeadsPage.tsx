'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  CreateLedgerHeadSchema,
  type CreateLedgerHeadInput,
  type LedgerHead,
  type LedgerHeadType,
} from '@mb/shared';
import { useFinanceMutation, useLedgerHeads } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils';
import { FinancePageHeader, ReadOnlyNotice, useFinanceAbilities } from './finance-ui';
import { Lock, Pencil, Plus } from 'lucide-react';

/**
 * The chart of accounts.
 *
 * Grouped by `groupName` rather than listed flat, because that is how an
 * accountant reads one — Utilities together, Payroll together — and because
 * thirty heads in one alphabetical column is unusable.
 *
 * Two rules the UI has to make visible, both enforced by database triggers:
 *
 *   * A SYSTEM head (the ones the automatic postings resolve by code) can be
 *     renamed but never deactivated. Its toggle is disabled and carries a lock.
 *   * A head is never DELETED, only deactivated. Every voucher ever filed under
 *     it still names it, so there is no delete button anywhere on this page —
 *     the absence is the design, not an omission.
 */

export function LedgerHeadsPage() {
  const abilities = useFinanceAbilities();
  const [creating, setCreating] = useState<LedgerHeadType | null>(null);
  const [editing, setEditing] = useState<LedgerHead | null>(null);

  const { data, isLoading } = useLedgerHeads(true);
  const heads = data ?? [];

  return (
    <div className="space-y-6">
      <FinancePageHeader
        title="Ledger Heads"
        description="The chart of accounts. Heads are deactivated, never deleted — historical vouchers still name them."
      />

      <ReadOnlyNotice abilities={abilities} />

      <Tabs defaultValue="income">
        <TabsList>
          <TabsTrigger value="income">Income</TabsTrigger>
          <TabsTrigger value="expense">Expense</TabsTrigger>
        </TabsList>

        {(['income', 'expense'] as const).map((type) => (
          <TabsContent key={type} value={type} className="mt-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {heads.filter((h) => h.type === type && h.isActive).length} active{' '}
                {type === 'income' ? 'income' : 'expense'} heads
              </p>
              {abilities.configure && (
                <Button size="sm" onClick={() => setCreating(type)}>
                  <Plus className="h-3.5 w-3.5" />
                  New {type} head
                </Button>
              )}
            </div>

            <HeadGroups
              heads={heads.filter((h) => h.type === type)}
              loading={isLoading}
              canConfigure={abilities.configure}
              onEdit={setEditing}
            />
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={creating !== null} onOpenChange={(open) => !open && setCreating(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>New {creating} head</DialogTitle>
          </DialogHeader>
          {creating && <LedgerHeadForm type={creating} onSuccess={() => setCreating(null)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit {editing?.name}</DialogTitle>
          </DialogHeader>
          {editing && <LedgerHeadForm head={editing} type={editing.type} onSuccess={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------

function HeadGroups({
  heads,
  loading,
  canConfigure,
  onEdit,
}: {
  heads: LedgerHead[];
  loading: boolean;
  canConfigure: boolean;
  onEdit: (head: LedgerHead) => void;
}) {
  if (loading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (heads.length === 0) {
    return <EmptyState title="No ledger heads yet" description="Create one to start filing vouchers against it." />;
  }

  // Ungrouped heads collect under "Other" rather than floating above the groups,
  // where they read as if they belonged to the first one.
  const groups = new Map<string, LedgerHead[]>();
  for (const head of heads) {
    const key = head.groupName ?? 'Other';
    groups.set(key, [...(groups.get(key) ?? []), head]);
  }

  return (
    <div className="space-y-5">
      {Array.from(groups.entries()).map(([group, items]) => (
        <div key={group}>
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</h3>
          <div className="divide-y overflow-hidden rounded-lg border bg-card">
            {items
              .slice()
              .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
              .map((head) => (
                <HeadRow key={head.id} head={head} canConfigure={canConfigure} onEdit={onEdit} />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function HeadRow({
  head,
  canConfigure,
  onEdit,
}: {
  head: LedgerHead;
  canConfigure: boolean;
  onEdit: (head: LedgerHead) => void;
}) {
  const mut = useFinanceMutation();

  async function toggleActive(next: boolean) {
    try {
      await mut.mutateAsync({
        path: `/api/finance/heads/${head.id}`,
        method: 'PUT',
        body: { isActive: next },
      });
      toast.success(next ? `${head.name} reactivated` : `${head.name} deactivated`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update this head');
    }
  }

  return (
    <div className={cn('flex items-center gap-3 p-3', !head.isActive && 'opacity-60')}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{head.name}</span>
          <span className="font-mono text-xs text-muted-foreground">{head.code}</span>
          {head.isSystem && (
            <Badge variant="secondary" className="gap-1">
              <Lock className="h-3 w-3" />
              System
            </Badge>
          )}
          {!head.isActive && <Badge variant="secondary">Inactive</Badge>}
        </div>
        {head.description && <p className="mt-0.5 truncate text-sm text-muted-foreground">{head.description}</p>}
      </div>

      {canConfigure && (
        <div className="flex flex-shrink-0 items-center gap-2">
          <Switch
            checked={head.isActive}
            // A system head has nowhere for the automatic postings to go if it is
            // switched off, so the trigger refuses it — do not offer the switch.
            disabled={head.isSystem || mut.isPending}
            onCheckedChange={(checked) => void toggleActive(Boolean(checked))}
            aria-label={head.isActive ? `Deactivate ${head.name}` : `Reactivate ${head.name}`}
          />
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${head.name}`} onClick={() => onEdit(head)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function LedgerHeadForm({
  head,
  type,
  onSuccess,
}: {
  head?: LedgerHead;
  type: LedgerHeadType;
  onSuccess?: () => void;
}) {
  const mut = useFinanceMutation();

  const form = useForm<CreateLedgerHeadInput>({
    resolver: zodResolver(CreateLedgerHeadSchema),
    defaultValues: {
      code: head?.code ?? '',
      name: head?.name ?? '',
      type,
      description: head?.description ?? '',
      groupName: head?.groupName ?? '',
      sortOrder: head?.sortOrder ?? 0,
    },
  });

  async function save(data: CreateLedgerHeadInput) {
    try {
      if (head) {
        // code and type are absent from the update payload on purpose: the code
        // is what reports group on and what the automatic postings resolve by,
        // so changing it would restate every voucher already filed under it.
        await mut.mutateAsync({
          path: `/api/finance/heads/${head.id}`,
          method: 'PUT',
          body: {
            name: data.name,
            description: data.description || null,
            groupName: data.groupName || null,
            sortOrder: data.sortOrder,
          },
        });
        toast.success('Ledger head updated');
      } else {
        await mut.mutateAsync({ path: '/api/finance/heads', body: data });
        toast.success('Ledger head created');
      }
      onSuccess?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save this ledger head');
    }
  }

  const errors = form.formState.errors;

  return (
    <form onSubmit={form.handleSubmit(save)} className="space-y-4">
      <div className="space-y-1">
        <Label>Code</Label>
        <Input
          placeholder={type === 'income' ? 'INC-DONATIONS' : 'EXP-SECURITY'}
          disabled={Boolean(head)}
          className="font-mono uppercase"
          {...form.register('code')}
        />
        {errors.code && <p className="text-xs text-destructive">{errors.code.message}</p>}
        <p className="text-xs text-muted-foreground">
          {head
            ? 'The code is fixed once created — reports and automatic postings key on it.'
            : 'Letters, numbers and dashes. Used by reports and exports; it cannot be changed later.'}
        </p>
      </div>

      <div className="space-y-1">
        <Label>Name</Label>
        <Input placeholder="e.g. Security Services" {...form.register('name')} />
        {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>Group (optional)</Label>
          <Input placeholder="e.g. Utilities" {...form.register('groupName')} />
        </div>
        <div className="space-y-1">
          <Label>Sort order</Label>
          <Input type="number" min={0} step={10} {...form.register('sortOrder', { valueAsNumber: true })} />
        </div>
      </div>

      <div className="space-y-1">
        <Label>Description (optional)</Label>
        <Textarea rows={2} placeholder="What belongs under this head" {...form.register('description')} />
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={mut.isPending}>
        {mut.isPending ? 'Saving…' : head ? 'Save changes' : 'Create head'}
      </Button>
    </form>
  );
}
