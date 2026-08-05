'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { createColumnHelper } from '@tanstack/react-table';
import {
  businessDateStr,
  CreatePartnerExpenseSchema,
  EDITABLE_DOC_STATUSES,
  FINANCE_ACCOUNT_LABELS,
  FINANCE_PAYMENT_METHOD_LABELS,
  FINANCE_PAYMENT_METHODS,
  type CreatePartnerExpenseInput,
  type PartnerExpense,
} from '@mb/shared';
import { useFinanceMutation, useLedgerHeads, usePartnerExpenses } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable } from '@/components/shared/DataTable';
import { cn } from '@/lib/utils';
import { FinancePageHeader, Money, ReadOnlyNotice, StatusBadge, useFinanceAbilities } from './finance-ui';
import { DateFilter, DocumentActions, FilterBar, FilterField, FilterSelect } from './finance-actions';
import { HandCoins, Pencil, Plus } from 'lucide-react';

/**
 * Partner Expenses — money drawn by a partner, kept in its own section.
 *
 * Mechanically this is a manual expense document with a partner name attached,
 * and it deliberately stays separate from Income & Expense Entries: a partner
 * withdrawal is the line owners look at first and want to see on its own, not
 * filtered out of a list of electricity bills. The brief asks for the section by
 * name for the same reason.
 *
 * `requestedBy` is the signed-in user, filled in server-side — a request that
 * could name someone else as its requester would be worthless in an audit.
 */

const col = createColumnHelper<PartnerExpense>();
const BASE_PATH = '/api/finance/partner-expenses';

export function PartnerExpensesPage() {
  const abilities = useFinanceAbilities();

  const [status, setStatus] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PartnerExpense | null>(null);

  const { data, isLoading } = usePartnerExpenses({
    status: status || undefined,
    partnerName: partnerName || undefined,
    from: from || undefined,
    to: to || undefined,
  });

  const rows = data ?? [];
  // The partner list is derived from the rows rather than a master table: there
  // is no partners table, and inventing one for a filter dropdown would be a
  // schema change in service of a select box.
  const partners = Array.from(new Set(rows.map((r) => r.partnerName))).sort();
  const total = rows.reduce((sum, r) => sum + r.amount, 0);

  const columns = [
    col.accessor('expenseNo', {
      header: 'Expense No',
      meta: { mobile: 'subtitle' },
      cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue()}</span>,
    }),
    col.accessor('partnerName', {
      header: 'Partner',
      meta: { mobile: 'title' },
      cell: (i) => <span className="font-medium">{i.getValue()}</span>,
    }),
    col.accessor('ledgerHeadName', { header: 'Expense Head', cell: (i) => <span className="text-sm">{i.getValue()}</span> }),
    col.accessor('description', { header: 'Description', meta: { mobileFull: true }, cell: (i) => <span className="text-sm">{i.getValue()}</span> }),
    col.accessor('businessDate', { header: 'Date', cell: (i) => <span className="text-sm">{i.getValue()}</span> }),
    col.accessor('amount', {
      header: 'Amount',
      cell: (i) => <Money value={i.getValue()} className="font-semibold text-red-600 dark:text-red-400" />,
    }),
    col.accessor('paymentMethod', {
      header: 'Payment Method',
      cell: (i) => <span className="text-sm">{FINANCE_PAYMENT_METHOD_LABELS[i.getValue()] ?? i.getValue()}</span>,
    }),
    col.accessor('requestedByName', {
      header: 'Requested By',
      cell: (i) => <span className="text-sm text-muted-foreground">{i.getValue() || '—'}</span>,
    }),
    col.accessor('approvedByName', {
      header: 'Approved By',
      cell: (i) => <span className="text-sm text-muted-foreground">{i.getValue() ?? '—'}</span>,
    }),
    col.accessor('status', {
      header: 'Status',
      meta: { mobile: 'badge' },
      cell: (i) => <StatusBadge status={i.getValue()} />,
    }),
    col.display({
      id: 'actions',
      header: '',
      cell: (i) => {
        const row = i.row.original;
        return (
          <div className="flex items-center justify-end gap-1">
            {EDITABLE_DOC_STATUSES.includes(row.status) && abilities.create && (
              <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => setEditing(row)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            <DocumentActions doc={row} basePath={BASE_PATH} abilities={abilities} label={row.expenseNo} />
          </div>
        );
      },
    }),
  ];

  return (
    <div className="space-y-6">
      <FinancePageHeader
        title="Partner Expenses"
        description="Partner withdrawals and expenses. Only approved requests are posted to the ledger."
        actions={
          abilities.create && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" />
              New request
            </Button>
          )
        }
      />

      <ReadOnlyNotice abilities={abilities} />

      <FilterBar>
        <FilterField label="Status">
          <FilterSelect
            value={status}
            onChange={setStatus}
            allLabel="Any status"
            options={[
              { value: 'pending', label: 'Pending Approval' },
              { value: 'draft', label: 'Draft' },
              { value: 'posted', label: 'Posted' },
              { value: 'locked', label: 'Locked' },
              { value: 'rejected', label: 'Rejected' },
            ]}
          />
        </FilterField>
        <FilterField label="Partner">
          <FilterSelect
            value={partnerName}
            onChange={setPartnerName}
            allLabel="All partners"
            options={partners.map((p) => ({ value: p, label: p }))}
          />
        </FilterField>
        <FilterField label="From">
          <DateFilter value={from} onChange={setFrom} />
        </FilterField>
        <FilterField label="To">
          <DateFilter value={to} onChange={setTo} />
        </FilterField>
        {rows.length > 0 && (
          <div className="ml-auto text-right">
            <p className="text-xs text-muted-foreground">Total for this selection</p>
            <Money value={total} className="text-lg font-bold" />
          </div>
        )}
      </FilterBar>

      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        searchPlaceholder="Search by partner or description…"
        empty={
          <div className="p-6">
            <HandCoins className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60" aria-hidden />
            <p className="text-center font-medium">No partner expenses</p>
            <p className="text-center text-sm text-muted-foreground">
              Requests raised here go to a Finance approver before they reach the book.
            </p>
          </div>
        }
      />

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>New partner expense</DialogTitle>
          </DialogHeader>
          <PartnerExpenseForm onSuccess={() => setCreating(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit {editing?.expenseNo}</DialogTitle>
          </DialogHeader>
          {editing && <PartnerExpenseForm expense={editing} onSuccess={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PartnerExpenseForm({
  expense,
  onSuccess,
}: {
  expense?: PartnerExpense;
  onSuccess?: () => void;
}) {
  const headsQ = useLedgerHeads();
  const mut = useFinanceMutation();

  const form = useForm<CreatePartnerExpenseInput>({
    resolver: zodResolver(CreatePartnerExpenseSchema),
    defaultValues: {
      partnerName: expense?.partnerName ?? '',
      ledgerHeadId: expense?.ledgerHeadId ?? '',
      description: expense?.description ?? '',
      amount: (expense?.amount ?? undefined) as unknown as number,
      paymentMethod: (expense?.paymentMethod as CreatePartnerExpenseInput['paymentMethod']) ?? 'cash',
      account: expense?.account ?? 'cash',
      businessDate: expense?.businessDate ?? businessDateStr(),
      notes: expense?.notes ?? '',
      asDraft: false,
    },
  });

  // Expense heads only. A partner withdrawal booked against an income head would
  // post as money coming in, which is the opposite of what happened.
  const heads = (headsQ.data ?? []).filter((h) => h.type === 'expense');
  const ledgerHeadId = form.watch('ledgerHeadId');
  const account = form.watch('account');
  const paymentMethod = form.watch('paymentMethod');

  async function save(data: CreatePartnerExpenseInput, asDraft: boolean) {
    try {
      if (expense) {
        await mut.mutateAsync({
          path: `${BASE_PATH}/${expense.id}`,
          method: 'PUT',
          body: { ...data, asDraft: undefined },
        });
        toast.success('Request updated');
      } else {
        await mut.mutateAsync({ path: BASE_PATH, body: { ...data, asDraft } });
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
        <Label>Partner name</Label>
        <Input placeholder="Partner's full name" {...form.register('partnerName')} />
        {errors.partnerName && <p className="text-xs text-destructive">{errors.partnerName.message}</p>}
      </div>

      <div className="space-y-1">
        <Label>Expense head</Label>
        <Select
          value={ledgerHeadId}
          onValueChange={(v) => form.setValue('ledgerHeadId', (v as string) ?? '', { shouldValidate: true })}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={headsQ.isLoading ? 'Loading…' : 'Select an expense head'} />
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

      <div className="space-y-1">
        <Label>Description</Label>
        <Input placeholder="What the money is for" {...form.register('description')} />
        {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
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
        <Label>Notes (optional)</Label>
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
