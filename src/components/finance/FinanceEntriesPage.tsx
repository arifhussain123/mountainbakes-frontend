'use client';

import { useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import {
  EDITABLE_DOC_STATUSES,
  FINANCE_ACCOUNT_LABELS,
  FINANCE_PAYMENT_METHOD_LABELS,
  type FinanceTransaction,
} from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranches } from '@/lib/queries';
import { useFinanceEntries, useLedgerHeads } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable } from '@/components/shared/DataTable';
import { AttachmentGallery } from '@/components/shared/AttachmentGallery';
import { FinancePageHeader, Money, ReadOnlyNotice, StatusBadge, useFinanceAbilities } from './finance-ui';
import { DateFilter, DocumentActions, FilterBar, FilterField, FilterSelect } from './finance-actions';
import { FinanceEntryForm } from './FinanceEntryForm';
import { Eye, Pencil, Plus } from 'lucide-react';

/**
 * Manual income and expense entries — everything that does not arrive from a
 * branch closing, a payslip or a partner withdrawal.
 *
 * Income and expense share one screen because they share one document type: the
 * ledger head decides which side of the books a row lands on, and splitting them
 * into two near-identical pages would mean two places to fix an approval bug.
 * The Type filter is there for anyone who wants them apart.
 */

const col = createColumnHelper<FinanceTransaction>();
const BASE_PATH = '/api/finance/income/entries';

export function FinanceEntriesPage() {
  const { token } = useAuth();
  const abilities = useFinanceAbilities();

  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [branchId, setBranchId] = useState('');
  const [ledgerHeadId, setLedgerHeadId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<FinanceTransaction | null>(null);
  const [viewing, setViewing] = useState<FinanceTransaction | null>(null);

  const branchesQ = useBranches(token ?? '');
  const headsQ = useLedgerHeads(true);
  const { data, isLoading } = useFinanceEntries({
    status: status || undefined,
    type: type || undefined,
    branchId: branchId || undefined,
    ledgerHeadId: ledgerHeadId || undefined,
    from: from || undefined,
    to: to || undefined,
  });

  const rows = data ?? [];

  const columns = [
    col.accessor('txnNo', {
      header: 'Entry No',
      meta: { mobile: 'subtitle' },
      cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue()}</span>,
    }),
    col.accessor('businessDate', { header: 'Date', cell: (i) => <span className="text-sm">{i.getValue()}</span> }),
    col.accessor('ledgerHeadName', {
      header: 'Ledger Head',
      meta: { mobile: 'title' },
      cell: (i) => (
        <span className="font-medium">
          {i.getValue()}
          <span
            className={
              i.row.original.txnType === 'income'
                ? 'ml-2 text-xs font-normal text-emerald-600 dark:text-emerald-400'
                : 'ml-2 text-xs font-normal text-red-600 dark:text-red-400'
            }
          >
            {i.row.original.txnType}
          </span>
        </span>
      ),
    }),
    col.accessor('description', { header: 'Description', meta: { mobileFull: true }, cell: (i) => <span className="text-sm">{i.getValue()}</span> }),
    col.accessor('branchName', {
      header: 'Branch',
      cell: (i) => <span className="text-sm text-muted-foreground">{i.getValue() ?? 'Company-wide'}</span>,
    }),
    col.accessor('notes', {
      header: 'Notes',
      cell: (i) => (i.getValue() ? <span className="text-sm text-muted-foreground">{i.getValue()}</span> : null),
    }),
    col.accessor('amount', {
      header: 'Amount',
      cell: (i) => (
        <Money
          value={i.getValue()}
          className={
            i.row.original.txnType === 'income'
              ? 'font-semibold text-emerald-600 dark:text-emerald-400'
              : 'font-semibold text-red-600 dark:text-red-400'
          }
        />
      ),
    }),
    col.accessor('paymentMethod', {
      header: 'Method',
      cell: (i) => <span className="text-sm">{FINANCE_PAYMENT_METHOD_LABELS[i.getValue()] ?? i.getValue()}</span>,
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
            <Button variant="ghost" size="icon-sm" aria-label="View" onClick={() => setViewing(row)}>
              <Eye className="h-3.5 w-3.5" />
            </Button>
            {EDITABLE_DOC_STATUSES.includes(row.status) && abilities.create && (
              <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => setEditing(row)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            <DocumentActions doc={row} basePath={BASE_PATH} abilities={abilities} label={row.txnNo} />
          </div>
        );
      },
    }),
  ];

  return (
    <div className="space-y-6">
      <FinancePageHeader
        title="Income & Expense Entries"
        description="Manual documents. Nothing here reaches the ledger until it is approved."
        actions={
          abilities.create && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" />
              New entry
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
        <FilterField label="Type">
          <FilterSelect
            value={type}
            onChange={setType}
            allLabel="Income & expense"
            options={[
              { value: 'income', label: 'Income' },
              { value: 'expense', label: 'Expense' },
            ]}
          />
        </FilterField>
        <FilterField label="Ledger head">
          <FilterSelect
            value={ledgerHeadId}
            onChange={setLedgerHeadId}
            allLabel="All heads"
            options={(headsQ.data ?? []).map((h) => ({ value: h.id, label: h.name }))}
          />
        </FilterField>
        <FilterField label="Branch">
          <FilterSelect
            value={branchId}
            onChange={setBranchId}
            allLabel="All branches"
            options={(branchesQ.data ?? []).map((b) => ({ value: b.id, label: b.name }))}
          />
        </FilterField>
        <FilterField label="From">
          <DateFilter value={from} onChange={setFrom} />
        </FilterField>
        <FilterField label="To">
          <DateFilter value={to} onChange={setTo} />
        </FilterField>
      </FilterBar>

      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        searchPlaceholder="Search entries…"
      />

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>New income or expense entry</DialogTitle>
          </DialogHeader>
          <FinanceEntryForm onSuccess={() => setCreating(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit {editing?.txnNo}</DialogTitle>
          </DialogHeader>
          {editing && <FinanceEntryForm entry={editing} onSuccess={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewing?.txnNo}</DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <StatusBadge status={viewing.status} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Date</p>
                  <p className="font-medium">{viewing.businessDate}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Type</p>
                  <p className="font-medium capitalize">{viewing.txnType}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Ledger Head</p>
                  <p className="font-medium">{viewing.ledgerHeadName}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Description</p>
                  <p className="font-medium">{viewing.description}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Amount</p>
                  <Money
                    value={viewing.amount}
                    className={
                      viewing.txnType === 'income'
                        ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                        : 'font-semibold text-red-600 dark:text-red-400'
                    }
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Payment Method</p>
                  <p className="font-medium">{FINANCE_PAYMENT_METHOD_LABELS[viewing.paymentMethod] ?? viewing.paymentMethod}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Account</p>
                  <p className="font-medium">{FINANCE_ACCOUNT_LABELS[viewing.account]}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Branch</p>
                  <p className="font-medium">{viewing.branchName ?? 'Company-wide'}</p>
                </div>
                {viewing.referenceNo && (
                  <div>
                    <p className="text-xs text-muted-foreground">Reference</p>
                    <p className="font-medium">{viewing.referenceNo}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs text-muted-foreground">Created By</p>
                  <p className="font-medium">{viewing.createdByName ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Approved By</p>
                  <p className="font-medium">{viewing.approvedByName ?? '—'}</p>
                </div>
                {viewing.status === 'rejected' && viewing.rejectionReason && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">Rejection Reason</p>
                    <p className="font-medium whitespace-pre-wrap break-words">{viewing.rejectionReason}</p>
                  </div>
                )}
                {viewing.notes?.trim() && (
                  <div className="col-span-2">
                    <p className="text-xs text-muted-foreground">Notes</p>
                    <p className="font-medium whitespace-pre-wrap break-words">{viewing.notes.trim()}</p>
                  </div>
                )}
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Photo</p>
                  <AttachmentGallery
                    attachments={viewing.attachments}
                    title={`${viewing.txnNo} receipt`}
                    emptyText="No photo — this entry predates the requirement."
                    className="mt-1"
                  />
                </div>
              </div>

              <Button variant="outline" className="w-full" onClick={() => setViewing(null)}>
                Close
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
