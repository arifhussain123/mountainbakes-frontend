'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import {
  businessDateStr,
  CreateLoanClientSchema,
  LOAN_ENTRY_TYPE_LABELS,
  type CreateLoanClientInput,
  type LoanClient,
  type LoanClientWithBalance,
} from '@mb/shared';
import { Eye, Pencil, Plus, Power, TriangleAlert, UsersRound } from 'lucide-react';
import { useFinanceMutation, useLoanClient, useLoanClients, useLoanLedger } from '@/lib/finance';
import { ApiError } from '@/utils/api';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { FinancePageHeader, Money, StatusBadge, useFinanceAbilities } from '../finance-ui';

/**
 * Detail of Clients — everyone in the loan register, with their totals.
 *
 * Clients are never deleted (their entries must keep pointing at them); they
 * are deactivated, which keeps them out of the entry forms. Editing a client
 * keeps the same id, so every past entry shows the corrected details.
 */
export function LoanClientsTab() {
  const abilities = useFinanceAbilities();
  const clientsQ = useLoanClients();
  const mut = useFinanceMutation<{ client: LoanClient }>();
  const [editing, setEditing] = useState<LoanClientWithBalance | 'new' | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);

  async function toggleActive(c: LoanClientWithBalance) {
    try {
      await mut.mutateAsync({ path: `/api/finance/loans/clients/${c.id}/status`, method: 'PUT', body: { isActive: !c.isActive } });
      toast.success(`${c.clientName} ${c.isActive ? 'deactivated' : 'activated'}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change the client');
    }
  }

  const columns = useMemo<ColumnDef<LoanClientWithBalance>[]>(
    () => [
      {
        accessorKey: 'clientCode',
        header: 'Client ID',
        meta: { mobile: 'subtitle' },
        cell: ({ row }) => <span className="font-mono text-xs">{row.original.clientCode}</span>,
      },
      {
        accessorKey: 'companyName',
        header: 'Company Name',
        cell: ({ row }) => <span className="block max-w-[10rem] whitespace-normal">{row.original.companyName ?? '—'}</span>,
      },
      {
        accessorKey: 'clientName',
        header: 'Client Name',
        meta: { mobile: 'title' },
        cell: ({ row }) => <span className="font-medium">{row.original.clientName}</span>,
      },
      { accessorKey: 'mobileNumber', header: 'Mobile Number', cell: ({ row }) => row.original.mobileNumber ?? '—' },
      { accessorKey: 'whatsappNumber', header: 'WhatsApp Number', cell: ({ row }) => row.original.whatsappNumber ?? '—' },
      {
        accessorKey: 'address',
        header: 'Address',
        meta: { mobileFull: true },
        cell: ({ row }) => <span className="line-clamp-2 block min-w-[8rem] max-w-[11rem] whitespace-normal">{row.original.address ?? '—'}</span>,
      },
      {
        accessorKey: 'totalDebit',
        header: 'Total Loan',
        meta: { align: 'right' },
        cell: ({ row }) => <Money value={row.original.totalDebit} className="text-emerald-600 dark:text-emerald-400" />,
      },
      {
        accessorKey: 'totalCredit',
        header: 'Loan Paid',
        meta: { align: 'right' },
        cell: ({ row }) => <Money value={row.original.totalCredit} className="text-red-600 dark:text-red-400" />,
      },
      {
        accessorKey: 'balance',
        header: 'Balance',
        meta: { align: 'right' },
        cell: ({ row }) => <Money value={row.original.balance} className="font-semibold" />,
      },
      {
        id: 'status',
        accessorFn: (c) => (c.isActive ? 'active' : 'inactive'),
        header: 'Status',
        meta: { mobile: 'badge' },
        cell: ({ row }) => (
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-xs font-medium',
              row.original.isActive
                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {row.original.isActive ? 'Active' : 'Inactive'}
          </span>
        ),
      },
      {
        id: 'actions',
        header: 'Action',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex items-center justify-end gap-0.5">
            <Button variant="ghost" size="icon-sm" title="View" aria-label={`View ${row.original.clientName}`} onClick={() => setViewing(row.original.id)}>
              <Eye className="h-3.5 w-3.5" />
            </Button>
            {abilities.create && (
              <Button variant="ghost" size="icon-sm" title="Edit" aria-label={`Edit ${row.original.clientName}`} onClick={() => setEditing(row.original)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            {abilities.adjust && (
              <Button
                variant="ghost"
                size="icon-sm"
                title={row.original.isActive ? 'Deactivate' : 'Activate'}
                aria-label={`${row.original.isActive ? 'Deactivate' : 'Activate'} ${row.original.clientName}`}
                disabled={mut.isPending}
                onClick={() => void toggleActive(row.original)}
              >
                <Power className={cn('h-3.5 w-3.5', row.original.isActive ? 'text-destructive' : 'text-emerald-600')} />
              </Button>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [abilities.create, abilities.adjust, mut.isPending],
  );

  return (
    <div className="space-y-6">
      <FinancePageHeader
        title="Detail of Clients"
        description="Everyone in the loan register. Click View for a client's complete loan history."
        actions={
          abilities.create && (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="h-3.5 w-3.5" />
              New Client Entry
            </Button>
          )
        }
      />

      <DataTable
        columns={columns}
        data={clientsQ.data ?? []}
        loading={clientsQ.isLoading}
        searchPlaceholder="Search client, company, ID or number…"
        sortable
        empty={
          <EmptyState
            icon={UsersRound}
            title="No clients yet"
            description="Add a client before recording a loan or a payment."
            className="border-0"
          />
        }
      />

      <LoanClientFormDialog
        client={editing === 'new' ? null : editing}
        open={editing !== null}
        onClose={() => setEditing(null)}
      />
      <LoanClientDetailDialog clientId={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------

interface DuplicateClient {
  clientCode: string;
  clientName: string;
  mobileNumber: string | null;
}

function duplicateOf(err: unknown): DuplicateClient | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null;
  const d = err.details as { code?: string; existing?: DuplicateClient } | undefined;
  return d?.code === 'duplicate_client' && d.existing ? d.existing : null;
}

/** New Client Entry, and Edit — the same form. */
function LoanClientFormDialog({
  client,
  open,
  onClose,
}: {
  client: LoanClientWithBalance | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto md:max-w-lg">
        <DialogHeader>
          <DialogTitle>{client ? `Edit ${client.clientCode}` : 'New Client Entry'}</DialogTitle>
          <DialogDescription>
            {client ? 'Changes show on every past entry — the history stays with the client.' : 'A client must exist before a loan or payment can be recorded.'}
          </DialogDescription>
        </DialogHeader>
        {open && <LoanClientForm key={client?.id ?? 'new'} client={client} onDone={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function LoanClientForm({ client, onDone }: { client: LoanClientWithBalance | null; onDone: () => void }) {
  const mut = useFinanceMutation<{ client: LoanClient }>();
  const [duplicate, setDuplicate] = useState<{ match: DuplicateClient; data: CreateLoanClientInput } | null>(null);
  const form = useForm<CreateLoanClientInput>({
    resolver: zodResolver(CreateLoanClientSchema),
    defaultValues: {
      companyName: client?.companyName ?? '',
      clientName: client?.clientName ?? '',
      mobileNumber: client?.mobileNumber ?? '',
      whatsappNumber: client?.whatsappNumber ?? '',
      address: client?.address ?? '',
      note: client?.note ?? '',
      confirmDuplicate: false,
    },
  });
  const errors = form.formState.errors;

  async function save(data: CreateLoanClientInput) {
    setDuplicate(null);
    try {
      const { client: saved } = await mut.mutateAsync(
        client
          ? { path: `/api/finance/loans/clients/${client.id}`, method: 'PUT', body: data }
          : { path: '/api/finance/loans/clients', body: data },
      );
      toast.success(client ? `${saved.clientName} updated` : `${saved.clientCode} — ${saved.clientName} added`);
      onDone();
    } catch (err) {
      const match = duplicateOf(err);
      if (match) {
        setDuplicate({ match, data });
        return;
      }
      toast.error(err instanceof Error ? err.message : 'Could not save the client');
    }
  }

  const field = (name: keyof CreateLoanClientInput, label: string, opts: { required?: boolean; placeholder?: string; type?: string } = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`client-${name}`}>
        {label} {opts.required && <span className="text-destructive">*</span>}
      </Label>
      <Input id={`client-${name}`} type={opts.type ?? 'text'} placeholder={opts.placeholder} {...form.register(name)} />
      {errors[name] && <p className="text-xs text-destructive">{String(errors[name]?.message)}</p>}
    </div>
  );

  return (
    <form onSubmit={form.handleSubmit((d) => save(d))} className="space-y-4">
      {field('companyName', 'Name of Company')}
      {field('clientName', 'Name of Client', { required: true })}
      <div className="grid gap-3 sm:grid-cols-2">
        {field('mobileNumber', 'Mobile Number', { type: 'tel', placeholder: '03001234567' })}
        {field('whatsappNumber', 'WhatsApp Number', { type: 'tel', placeholder: '03001234567' })}
      </div>
      <div className="space-y-1">
        <Label htmlFor="client-address">Address</Label>
        <Textarea id="client-address" rows={2} {...form.register('address')} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="client-note">Note</Label>
        <Textarea id="client-note" rows={2} {...form.register('note')} />
      </div>

      {duplicate && (
        <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
          <TriangleAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="flex-1 space-y-2 text-amber-900 dark:text-amber-200">
            <p>
              <span className="font-mono">{duplicate.match.clientCode}</span> — {duplicate.match.clientName}
              {duplicate.match.mobileNumber ? ` (${duplicate.match.mobileNumber})` : ''} already exists. Save this as a separate client
              only if it really is a different person.
            </p>
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setDuplicate(null)}>
                Go back
              </Button>
              <Button type="button" size="sm" disabled={mut.isPending} onClick={() => void save({ ...duplicate.data, confirmDuplicate: true })}>
                Save anyway
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onDone} disabled={mut.isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={mut.isPending}>
          {mut.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------

/** One client: details, the five totals, and their own ledger with a date filter. */
function LoanClientDetailDialog({ clientId, onClose }: { clientId: string | null; onClose: () => void }) {
  const today = businessDateStr();
  const [from, setFrom] = useState('2020-01-01');
  const [to, setTo] = useState(today);
  const detailQ = useLoanClient(clientId);
  const ledgerQ = useLoanLedger({ from: from > to ? to : from, to, clientId: clientId ?? undefined, limit: 500 }, Boolean(clientId));
  const c = detailQ.data?.client;
  const b = detailQ.data?.balance;
  const entries = ledgerQ.data?.entries ?? [];

  const info = (label: string, value: string | null | undefined) => (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-sm font-medium" title={value ?? undefined}>{value || '—'}</dd>
    </div>
  );
  const stat = (label: string, value: number | undefined, className?: string) => (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-semibold">
        <Money value={value} className={className} />
      </p>
    </div>
  );

  return (
    <Dialog open={!!clientId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto md:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{c ? `${c.clientName} · ${c.clientCode}` : 'Client'}</DialogTitle>
          <DialogDescription>Complete loan history. Totals are all posted entries; the table follows the dates below.</DialogDescription>
        </DialogHeader>

        {detailQ.isLoading || !c ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          // min-w-0: DialogContent is a grid, and without it the history
          // table's width stretches the whole dialog past its edge.
          <div className="min-w-0 space-y-5">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {info('Company Name', c.companyName)}
              {info('Client Name', c.clientName)}
              {info('Mobile Number', c.mobileNumber)}
              {info('WhatsApp Number', c.whatsappNumber)}
              {info('Address', c.address)}
              {info('Notes', c.note)}
            </dl>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {stat('Total Refundable Loan', b?.totalRefundable)}
              {stat('Total Receivable Loan', b?.totalReceivable)}
              {stat('Total Loan Payment', b?.totalDebit, 'text-emerald-600 dark:text-emerald-400')}
              {stat('Total Loan Paid', b?.totalCredit, 'text-red-600 dark:text-red-400')}
              {stat('Outstanding Balance', b?.balance)}
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-1">
                <Label htmlFor="client-from">From</Label>
                <Input id="client-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value || '2020-01-01')} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="client-to">To</Label>
                <Input id="client-to" type="date" value={to} max={today} onChange={(e) => setTo(e.target.value || today)} />
              </div>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    {['Date', 'Voucher No.', 'Entry Type', 'Ledger Head', 'Description', 'Debit', 'Credit', 'Running Balance', 'Status'].map((h) => (
                      <TableHead key={h} className={cn('text-xs', ['Debit', 'Credit', 'Running Balance'].includes(h) && 'text-right')}>
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableCell colSpan={7} className="text-xs uppercase tracking-wide text-muted-foreground">
                      Opening balance brought forward
                    </TableCell>
                    <TableCell className="text-right font-semibold">
                      <Money value={ledgerQ.data?.openingBalance} />
                    </TableCell>
                    <TableCell />
                  </TableRow>
                  {ledgerQ.isLoading ? (
                    <TableRow>
                      <TableCell colSpan={9}>
                        <Skeleton className="h-6 w-full" />
                      </TableCell>
                    </TableRow>
                  ) : entries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={9} className="py-6 text-center text-sm text-muted-foreground">
                        No entries in these dates.
                      </TableCell>
                    </TableRow>
                  ) : (
                    entries.map((e) => {
                      const cancelled = e.status === 'cancelled';
                      return (
                        <TableRow key={e.id} className={cn(cancelled && 'text-muted-foreground line-through decoration-1')}>
                          <TableCell className="whitespace-nowrap text-sm">{e.businessDate}</TableCell>
                          <TableCell className="whitespace-nowrap font-mono text-xs">{e.voucherNo}</TableCell>
                          <TableCell className="whitespace-nowrap text-sm">{LOAN_ENTRY_TYPE_LABELS[e.entryType]}</TableCell>
                          <TableCell className="text-sm">{e.ledgerHeadName}</TableCell>
                          <TableCell className="max-w-[14rem] text-sm">
                            <span className="line-clamp-2" title={e.description}>{e.description}</span>
                          </TableCell>
                          <TableCell className="text-right">
                            <Money value={cancelled ? 0 : e.debit} blankZero className="text-emerald-600 dark:text-emerald-400" />
                          </TableCell>
                          <TableCell className="text-right">
                            <Money value={cancelled ? 0 : e.credit} blankZero className="text-red-600 dark:text-red-400" />
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            <Money value={e.balance} />
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={e.status} />
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                  <TableRow className="border-t-2 bg-muted/40 font-semibold hover:bg-muted/40">
                    <TableCell colSpan={5} className="text-xs uppercase tracking-wide text-muted-foreground">
                      Totals · {ledgerQ.data?.total ?? 0} entries
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={ledgerQ.data?.totalDebit} className="text-emerald-600 dark:text-emerald-400" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={ledgerQ.data?.totalCredit} className="text-red-600 dark:text-red-400" />
                    </TableCell>
                    <TableCell className="text-right">
                      <Money value={ledgerQ.data?.closingBalance} />
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
            {(ledgerQ.data?.total ?? 0) > entries.length && (
              <p className="text-xs text-muted-foreground">
                Showing the first {entries.length} of {ledgerQ.data?.total} entries — narrow the dates, or open the Loan Ledger with this client selected.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
