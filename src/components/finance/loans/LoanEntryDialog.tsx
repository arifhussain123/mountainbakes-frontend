'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  businessDateStr,
  CreateLoanEntrySchema,
  FINANCE_PAYMENT_METHOD_LABELS,
  FINANCE_PAYMENT_METHODS,
  LOAN_ENTRY_HEAD_TYPE,
  LOAN_ENTRY_TYPE_LABELS,
  type Attachment,
  type CreateLoanEntryInput,
  type LoanEntry,
  type LoanEntryType,
} from '@mb/shared';
import { ArrowDownLeft, ArrowUpRight, HandCoins } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useBranches } from '@/lib/queries';
import { useFinanceMutation, useLedgerHeads } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PhotoCapture } from '@/components/shared/PhotoCapture';
import { LoanClientPicker } from './LoanClientPicker';

/** One id per opened form, so a retried Save is the same entry (the API replays it). */
function newRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Plain http has no randomUUID; a v4-shaped id from Math.random is enough for a retry key.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const CHOICES: { type: LoanEntryType; icon: typeof HandCoins; side: string; help: string }[] = [
  { type: 'paid_payment', icon: ArrowUpRight, side: 'Credit', help: 'A payment against a loan balance. Reduces what is outstanding.' },
  { type: 'refundable_loan', icon: HandCoins, side: 'Debit', help: 'A loan that is to be refunded. Increases the balance.' },
  { type: 'receivable_loan', icon: ArrowDownLeft, side: 'Debit', help: 'A loan to be received, optionally for a branch. Increases the balance.' },
];

/**
 * + New Entry: pick one of the three entry types, then fill its form.
 *
 * Saving POSTS AT ONCE — there is no approval step for the loan register — and
 * the entry gets its LN- voucher from the server. Nothing here is General
 * Ledger income or expense; the ledger head only classifies the entry.
 */
export function LoanEntryDialog({
  open,
  onOpenChange,
  defaultClientId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The client chosen on the ledger, pre-filled into the form. */
  defaultClientId?: string | null;
}) {
  const [type, setType] = useState<LoanEntryType | null>(null);
  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) setType(null);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[92vh] overflow-y-auto md:max-w-lg">
        <DialogHeader>
          <DialogTitle>{type ? `New ${LOAN_ENTRY_TYPE_LABELS[type]}` : 'New Entry'}</DialogTitle>
          <DialogDescription>
            {type
              ? 'Recorded in the loan register only — never in General Ledger income or expense.'
              : 'Choose what you are recording.'}
          </DialogDescription>
        </DialogHeader>

        {type ? (
          <LoanEntryForm
            key={type}
            entryType={type}
            defaultClientId={defaultClientId ?? null}
            onBack={() => setType(null)}
            onSaved={() => close(false)}
          />
        ) : (
          <div className="grid gap-2">
            {CHOICES.map(({ type: t, icon: Icon, side, help }) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className="flex items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5"
              >
                <span className="rounded-lg bg-primary/10 p-2 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 font-medium">
                    {LOAN_ENTRY_TYPE_LABELS[t]}
                    <span
                      className={
                        side === 'Debit'
                          ? 'text-xs font-normal text-emerald-600 dark:text-emerald-400'
                          : 'text-xs font-normal text-red-600 dark:text-red-400'
                      }
                    >
                      {side}
                    </span>
                  </span>
                  <span className="block text-sm text-muted-foreground">{help}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LoanEntryForm({
  entryType,
  defaultClientId,
  onBack,
  onSaved,
}: {
  entryType: LoanEntryType;
  defaultClientId: string | null;
  onBack: () => void;
  onSaved: () => void;
}) {
  const { token } = useAuth();
  const branchesQ = useBranches(token ?? '');
  const headsQ = useLedgerHeads();
  const mut = useFinanceMutation<{ entry: LoanEntry }>();
  const [photos, setPhotos] = useState<Attachment[]>([]);

  const form = useForm<CreateLoanEntryInput>({
    resolver: zodResolver(CreateLoanEntrySchema),
    defaultValues: {
      requestId: newRequestId(),
      entryType,
      clientId: defaultClientId ?? '',
      ledgerHeadId: '',
      branchId: null,
      businessDate: businessDateStr(),
      amount: undefined as unknown as number,
      paymentMethod: entryType === 'paid_payment' ? 'cash' : null,
      description: '',
      note: '',
      attachmentIds: [],
    },
  });
  const errors = form.formState.errors;
  const clientId = form.watch('clientId');
  const ledgerHeadId = form.watch('ledgerHeadId');
  const paymentMethod = form.watch('paymentMethod');
  const branchId = form.watch('branchId');

  // Paid Payment and Refundable Loan classify under an Expense head, Receivable
  // Loan under an Income head. The server refuses any other pairing.
  const headType = LOAN_ENTRY_HEAD_TYPE[entryType];
  const heads = (headsQ.data ?? []).filter((h) => h.type === headType);
  // `items` lets each Select show the label of its value rather than the raw id.
  const headItems = heads.map((h) => ({ value: h.id, label: h.groupName ? `${h.name} · ${h.groupName}` : h.name }));
  const branchItems = [
    { value: '__none__', label: 'No branch' },
    ...(branchesQ.data ?? []).map((b) => ({ value: b.id, label: b.name })),
  ];
  const methodItems = FINANCE_PAYMENT_METHODS.map((m) => ({ value: m, label: FINANCE_PAYMENT_METHOD_LABELS[m] ?? m }));

  async function save(data: CreateLoanEntryInput) {
    try {
      const { entry } = await mut.mutateAsync({ path: '/api/finance/loans/entries', body: data });
      toast.success(`${entry.voucherNo} posted — ${LOAN_ENTRY_TYPE_LABELS[entry.entryType]} for ${entry.clientName}`);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save this entry');
    }
  }

  return (
    <form onSubmit={form.handleSubmit((d) => save(d))} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="loan-client">
          Name <span className="text-destructive">*</span>
        </Label>
        <LoanClientPicker
          id="loan-client"
          activeOnly
          value={clientId || null}
          invalid={Boolean(errors.clientId)}
          onChange={(c) => form.setValue('clientId', c?.id ?? '', { shouldValidate: true })}
        />
        {errors.clientId && <p className="text-xs text-destructive">{errors.clientId.message}</p>}
      </div>

      {entryType === 'receivable_loan' && (
        <div className="space-y-1">
          <Label>Branch name (optional)</Label>
          <Select
            items={branchItems}
            value={branchId ?? '__none__'}
            onValueChange={(v) => form.setValue('branchId', v === '__none__' ? null : ((v as string) ?? null))}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="No branch" />
            </SelectTrigger>
            <SelectContent>
              {branchItems.map((b) => (
                <SelectItem key={b.value} value={b.value}>
                  {b.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1">
        <Label>
          Ledger head <span className="text-destructive">*</span>
          <span className="ml-1 font-normal text-muted-foreground">({headType === 'income' ? 'Income' : 'Expense'} heads)</span>
        </Label>
        <Select
          items={headItems}
          value={ledgerHeadId}
          onValueChange={(v) => form.setValue('ledgerHeadId', (v as string) ?? '', { shouldValidate: true })}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder={headsQ.isLoading ? 'Loading…' : 'Select a ledger head'} />
          </SelectTrigger>
          <SelectContent>
            {headItems.map((h) => (
              <SelectItem key={h.value} value={h.value}>
                {h.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.ledgerHeadId && <p className="text-xs text-destructive">{errors.ledgerHeadId.message}</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label>
            Business date <span className="text-destructive">*</span>
          </Label>
          <Input type="date" max={businessDateStr()} {...form.register('businessDate')} />
          {errors.businessDate && <p className="text-xs text-destructive">{errors.businessDate.message}</p>}
        </div>
        <div className="space-y-1">
          <Label>
            Amount <span className="text-destructive">*</span>
          </Label>
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

      {entryType === 'paid_payment' && (
        <div className="space-y-1">
          <Label>
            Payment method <span className="text-destructive">*</span>
          </Label>
          <Select
            items={methodItems}
            value={paymentMethod ?? ''}
            onValueChange={(v) =>
              form.setValue('paymentMethod', (v as CreateLoanEntryInput['paymentMethod']) ?? null, { shouldValidate: true })
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a payment method" />
            </SelectTrigger>
            <SelectContent>
              {methodItems.map((m) => (
                <SelectItem key={m.value} value={m.value}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {errors.paymentMethod && <p className="text-xs text-destructive">{errors.paymentMethod.message}</p>}
        </div>
      )}

      <div className="space-y-1">
        <Label>
          Description <span className="text-destructive">*</span>
        </Label>
        <Input placeholder="e.g. Loan for October stock" {...form.register('description')} />
        {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
      </div>

      <div className="space-y-1">
        <Label>Note (optional)</Label>
        <Textarea rows={2} {...form.register('note')} />
      </div>

      <PhotoCapture
        entity="finance_loan_entry"
        value={photos}
        onChange={(next) => {
          setPhotos(next);
          form.setValue('attachmentIds', next.map((a) => a.id));
        }}
        label="Supporting photo (optional)"
        disabled={mut.isPending}
        hint="A cheque, agreement or transfer slip, if there is one."
      />

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button type="button" variant="ghost" onClick={onBack} disabled={mut.isPending}>
          Back
        </Button>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="outline" onClick={onSaved} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={mut.isPending}>
            {mut.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </form>
  );
}
