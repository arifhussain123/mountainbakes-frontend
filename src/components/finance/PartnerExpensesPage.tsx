'use client';

import { useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import {
  EDITABLE_DOC_STATUSES,
  FINANCE_ACCOUNT_LABELS,
  FINANCE_PAYMENT_METHOD_LABELS,
  type FinancePartner,
  type PartnerExpense,
  type PartnerShareRow,
  type PartnerTxnKind,
} from '@mb/shared';
import { useFinancePartners, usePartnerExpenses, usePartnerShareSummary } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable } from '@/components/shared/DataTable';
import { AttachmentGallery } from '@/components/shared/AttachmentGallery';
import { cn } from '@/lib/utils';
import { FinancePageHeader, Money, ReadOnlyNotice, StatusBadge, useFinanceAbilities } from './finance-ui';
import { DateFilter, DocumentActions, FilterBar, FilterField, FilterSelect } from './finance-actions';
import { PartnerDetailForm, PartnerTxnForm } from './CompanyTransactionForms';
import { Eye, HandCoins, Pencil, Plus } from 'lucide-react';

/**
 * Company Transaction Details — four tabs over the same underlying idea:
 * money moving between the company and the people who own it.
 *
 * Branch share is deliberately NOT here: the payout document
 * (branch_share_payments, /api/finance/branch-share) and its BranchShareForm
 * still exist server-side, they just have no entry point on this page.
 *
 *   Advance Expense / Draw Company Share — partner_expenses rows, split by
 *     txnKind. An ADVANCE is lent against a partner's future share; a DRAW is
 *     a partner taking money they're already entitled to. Both post as an
 *     expense under EXP-PARTNER and both reduce the balance shown in Partner
 *     Share Detail, tracked separately because that table shows them
 *     separately.
 *   Partner Share Detail — the reconciliation: total expenses (excluding
 *     partner advances/draws), total company share, the grand total the four
 *     partners split 25% each, and each partner's advance/draw/balance.
 *     Computed on read (finance-documents.service.ts#getPartnerShareSummary),
 *     never stored, so a reversal or adjustment is reflected automatically.
 */

/**
 * Tab triggers rendered as cards rather than the default compact segmented
 * control: a bigger hit area (comfortable on the tablets the branches use), a
 * real border + shadow, and a lift on hover. Applied per-trigger here instead
 * of in `ui/tabs.tsx` so the rest of the app keeps the standard tab look.
 *
 * Two of these carry a `group-data-[variant=…]/tabs-list:` or `dark:` prefix
 * they don't obviously need. That is deliberate: `ui/tabs.tsx` sets
 * `…/tabs-list:data-active:shadow-sm` and `dark:data-active:border-input`, and
 * a bare `data-active:shadow-xl` does NOT displace them — `cn()`/tailwind-merge
 * only collapses classes whose modifiers match, so both survive and the base
 * rule wins the cascade on specificity. Matching the prefix is what makes
 * tailwind-merge drop the base value.
 */
const TAB_CARD =
  'h-auto flex-none rounded-xl border border-border bg-card px-5 py-3 text-sm font-semibold shadow-md ' +
  'transition-all duration-150 hover:-translate-y-0.5 hover:border-primary/50 hover:bg-accent ' +
  'hover:text-foreground hover:shadow-xl active:translate-y-0 ' +
  'data-active:border-primary dark:data-active:border-primary ' +
  'data-active:bg-background data-active:text-foreground ' +
  'group-data-[variant=default]/tabs-list:data-active:shadow-xl';

export function PartnerExpensesPage() {
  const abilities = useFinanceAbilities();

  return (
    <div className="space-y-6">
      <FinancePageHeader
        title="Company Transaction Details"
        description="Partner advances and draws, and the partner profit-share reconciliation."
      />

      <ReadOnlyNotice abilities={abilities} />

      <Tabs defaultValue="advance">
        <TabsList className="h-auto w-full flex-wrap justify-start gap-3 bg-transparent p-0">
          <TabsTrigger value="advance" className={TAB_CARD}>
            Advance Expense
          </TabsTrigger>
          <TabsTrigger value="draw" className={TAB_CARD}>
            Draw Company Share
          </TabsTrigger>
          <TabsTrigger value="partner-share" className={TAB_CARD}>
            Partner Share Detail
          </TabsTrigger>
          <TabsTrigger value="partner-detail" className={TAB_CARD}>
            Partner Detail
          </TabsTrigger>
        </TabsList>

        <TabsContent value="advance" className="mt-4">
          <PartnerLedgerTab txnKind="advance" abilities={abilities} />
        </TabsContent>
        <TabsContent value="draw" className="mt-4">
          <PartnerLedgerTab txnKind="draw" abilities={abilities} />
        </TabsContent>
        <TabsContent value="partner-share" className="mt-4">
          <PartnerShareDetailTab />
        </TabsContent>
        <TabsContent value="partner-detail" className="mt-4">
          <PartnerDetailTab abilities={abilities} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Advance Expense / Draw Company Share
// ---------------------------------------------------------------------------

const expenseCol = createColumnHelper<PartnerExpense>();
const PARTNER_BASE_PATH = '/api/finance/partner-expenses';

function PartnerLedgerTab({
  txnKind,
  abilities,
}: {
  txnKind: PartnerTxnKind;
  abilities: ReturnType<typeof useFinanceAbilities>;
}) {
  const [status, setStatus] = useState('');
  const [partnerId, setPartnerId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<PartnerExpense | null>(null);
  const [viewing, setViewing] = useState<PartnerExpense | null>(null);

  const partnersQ = useFinancePartners();
  const { data, isLoading } = usePartnerExpenses({
    txnKind,
    status: status || undefined,
    partnerId: partnerId || undefined,
    from: from || undefined,
    to: to || undefined,
  });

  const rows = data ?? [];
  const total = rows.reduce((sum, r) => sum + r.amount, 0);
  const label = txnKind === 'advance' ? 'Advance' : 'Draw';

  const columns = [
    expenseCol.accessor('expenseNo', {
      header: 'No',
      meta: { mobile: 'subtitle' },
      cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue()}</span>,
    }),
    expenseCol.accessor('partnerName', {
      header: 'Partner',
      meta: { mobile: 'title' },
      cell: (i) => <span className="font-medium">{i.getValue()}</span>,
    }),
    expenseCol.accessor('businessDate', { header: 'Date', cell: (i) => <span className="text-sm">{i.getValue()}</span> }),
    expenseCol.accessor('amount', {
      header: 'Amount',
      cell: (i) => <Money value={i.getValue()} className="font-semibold text-red-600 dark:text-red-400" />,
    }),
    expenseCol.accessor('paymentMethod', {
      header: 'Payment Method',
      cell: (i) => <span className="text-sm">{FINANCE_PAYMENT_METHOD_LABELS[i.getValue()] ?? i.getValue()}</span>,
    }),
    expenseCol.accessor('status', {
      header: 'Status',
      meta: { mobile: 'badge' },
      cell: (i) => <StatusBadge status={i.getValue()} />,
    }),
    expenseCol.display({
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
            <DocumentActions doc={row} basePath={PARTNER_BASE_PATH} abilities={abilities} label={row.expenseNo} />
          </div>
        );
      },
    }),
  ];

  return (
    <div className="space-y-4">
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
            value={partnerId}
            onChange={setPartnerId}
            allLabel="All partners"
            options={(partnersQ.data ?? []).map((p) => ({ value: p.id, label: p.name }))}
          />
        </FilterField>
        <FilterField label="From">
          <DateFilter value={from} onChange={setFrom} />
        </FilterField>
        <FilterField label="To">
          <DateFilter value={to} onChange={setTo} />
        </FilterField>
        <div className="ml-auto flex items-end gap-3">
          {rows.length > 0 && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Total for this selection</p>
              <Money value={total} className="text-lg font-bold" />
            </div>
          )}
          {abilities.create && (
            <Button size="sm" className="h-11 md:h-9" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" />
              New {label.toLowerCase()}
            </Button>
          )}
        </div>
      </FilterBar>

      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        searchPlaceholder="Search by partner…"
        empty={
          <div className="p-6">
            <HandCoins className="mx-auto mb-2 h-8 w-8 text-muted-foreground/60" aria-hidden />
            <p className="text-center font-medium">No {label.toLowerCase()}s yet</p>
          </div>
        }
      />

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>New {label.toLowerCase()}</DialogTitle>
          </DialogHeader>
          <PartnerTxnForm txnKind={txnKind} onSuccess={() => setCreating(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit {editing?.expenseNo}</DialogTitle>
          </DialogHeader>
          {editing && <PartnerTxnForm txnKind={txnKind} expense={editing} onSuccess={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewing?.expenseNo}</DialogTitle>
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
                  <p className="text-xs text-muted-foreground">Partner</p>
                  <p className="font-medium">{viewing.partnerName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Amount</p>
                  <Money value={viewing.amount} className="font-semibold text-red-600 dark:text-red-400" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Payment Method</p>
                  <p className="font-medium">{FINANCE_PAYMENT_METHOD_LABELS[viewing.paymentMethod] ?? viewing.paymentMethod}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Paid From</p>
                  <p className="font-medium">{FINANCE_ACCOUNT_LABELS[viewing.account]}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Requested By</p>
                  <p className="font-medium">{viewing.requestedByName || '—'}</p>
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
                    <p className="text-xs text-muted-foreground">Note</p>
                    <p className="font-medium whitespace-pre-wrap break-words">{viewing.notes.trim()}</p>
                  </div>
                )}
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Photo</p>
                  <AttachmentGallery
                    attachments={viewing.attachments}
                    title={`${viewing.expenseNo} handover`}
                    emptyText="No photo — this request predates the requirement."
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

// ---------------------------------------------------------------------------
// Partner Share Detail
// ---------------------------------------------------------------------------

function PartnerShareDetailTab() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [viewingPartner, setViewingPartner] = useState<PartnerShareRow | null>(null);

  const summaryQ = usePartnerShareSummary(from || undefined, to || undefined);
  const summary = summaryQ.data;

  return (
    <div className="space-y-6">
      <FilterBar>
        <FilterField label="From">
          <DateFilter value={from} onChange={setFrom} />
        </FilterField>
        <FilterField label="To">
          <DateFilter value={to} onChange={setTo} />
        </FilterField>
      </FilterBar>

      {summary && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Expenses (excl. partner advance/draw)</p>
              <Money value={summary.totalExpense} className="text-xl font-bold text-red-600 dark:text-red-400" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total Company Share</p>
              <Money value={summary.totalCompanyShare} className="text-xl font-bold text-emerald-600 dark:text-emerald-400" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Grand Total</p>
              <Money value={summary.grandTotal} className="text-xl font-bold" />
            </CardContent>
          </Card>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-2 font-semibold">Partner</th>
              <th className="p-2 text-right font-semibold">25% Share</th>
              <th className="p-2 text-right font-semibold">Advance Payment</th>
              <th className="p-2 text-right font-semibold">Draw Total</th>
              <th className="p-2 text-right font-semibold">Balance</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {(summary?.partners ?? []).map((p) => (
              <tr key={p.id} className="border-t">
                <td className="p-2 font-medium">{p.name}</td>
                <td className="p-2 text-right tabular-nums">
                  <Money value={p.sharePctAmount} />
                </td>
                <td className="p-2 text-right tabular-nums">
                  <Money value={p.advancePaid} blankZero />
                </td>
                <td className="p-2 text-right tabular-nums">
                  <Money value={p.drawPaid} blankZero />
                </td>
                <td className="p-2 text-right tabular-nums font-semibold">
                  <Money value={p.balance} className={cn(p.balance < 0 && 'text-red-600 dark:text-red-400')} />
                </td>
                <td className="p-2 text-right">
                  <Button variant="ghost" size="icon-sm" aria-label="View" onClick={() => setViewingPartner(p)}>
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={viewingPartner !== null} onOpenChange={(open) => !open && setViewingPartner(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewingPartner?.name}</DialogTitle>
          </DialogHeader>
          {viewingPartner && <PartnerHistoryDetail row={viewingPartner} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Partner Detail — the profile registry: name, father name, DOB, join date,
// founder/co-founder, address, contact, emergency contact. Editing goes
// through one "Add detail of Partner" button rather than a per-row action:
// there are only ever the four fixed partners, so the entry point is picking
// who from a dropdown, not a table full of edit icons.
// ---------------------------------------------------------------------------

function PartnerDetailTab({ abilities }: { abilities: ReturnType<typeof useFinanceAbilities> }) {
  const [adding, setAdding] = useState(false);
  const [viewing, setViewing] = useState<FinancePartner | null>(null);

  const partnersQ = useFinancePartners();
  const partners = partnersQ.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        {abilities.configure && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add detail of Partner
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left">
            <tr>
              <th className="p-2 font-semibold">Name</th>
              <th className="p-2 font-semibold">Father Name</th>
              <th className="p-2 font-semibold">Date of Birth</th>
              <th className="p-2 font-semibold">Date of Join</th>
              <th className="p-2 font-semibold">Type</th>
              <th className="p-2 font-semibold">Contact Number</th>
              <th className="p-2" />
            </tr>
          </thead>
          <tbody>
            {partners.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="p-2 font-medium">{p.name}</td>
                <td className="p-2 text-muted-foreground">{p.fatherName ?? '—'}</td>
                <td className="p-2 text-muted-foreground">{p.dateOfBirth ?? '—'}</td>
                <td className="p-2 text-muted-foreground">{p.joinedOn ?? '—'}</td>
                <td className="p-2 text-muted-foreground capitalize">{p.partnerType?.replace('_', '-') ?? '—'}</td>
                <td className="p-2 text-muted-foreground">{p.contactNumber ?? '—'}</td>
                <td className="p-2 text-right">
                  <Button variant="ghost" size="icon-sm" aria-label="View" onClick={() => setViewing(p)}>
                    <Eye className="h-3.5 w-3.5" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add detail of Partner</DialogTitle>
          </DialogHeader>
          <AddPartnerDetailFlow partners={partners} onSuccess={() => setAdding(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewing?.name}</DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div>
                  <p className="text-xs text-muted-foreground">Father Name</p>
                  <p className="font-medium">{viewing.fatherName ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Type</p>
                  <p className="font-medium capitalize">{viewing.partnerType?.replace('_', '-') ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Date of Birth</p>
                  <p className="font-medium">{viewing.dateOfBirth ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Date of Join</p>
                  <p className="font-medium">{viewing.joinedOn ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Contact Number</p>
                  <p className="font-medium">{viewing.contactNumber ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Emergency Number</p>
                  <p className="font-medium">{viewing.emergencyNumber ?? '—'}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Address</p>
                  <p className="font-medium whitespace-pre-wrap break-words">{viewing.address ?? '—'}</p>
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

/** Pick a partner first, then edit their profile — the dropdown IS the "add" step, since all four partners already exist. */
function AddPartnerDetailFlow({
  partners,
  onSuccess,
}: {
  partners: FinancePartner[];
  onSuccess?: () => void;
}) {
  const [partnerId, setPartnerId] = useState('');
  const selected = partners.find((p) => p.id === partnerId) ?? null;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label>Partner</Label>
        <Select value={partnerId} onValueChange={(v) => setPartnerId((v as string) ?? '')}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select a partner" />
          </SelectTrigger>
          <SelectContent>
            {partners.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {selected && <PartnerDetailForm partner={selected} onSuccess={onSuccess} />}
    </div>
  );
}

function PartnerHistoryDetail({ row }: { row: PartnerShareRow }) {
  const { data, isLoading } = usePartnerExpenses({ partnerId: row.id });
  const txns = data ?? [];

  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div>
          <p className="text-xs text-muted-foreground">25% Share</p>
          <Money value={row.sharePctAmount} className="font-semibold" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Balance</p>
          <Money value={row.balance} className={cn('font-semibold', row.balance < 0 && 'text-red-600 dark:text-red-400')} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Advance Paid</p>
          <Money value={row.advancePaid} blankZero />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Draw Paid</p>
          <Money value={row.drawPaid} blankZero />
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Transaction history</p>
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : txns.length === 0 ? (
          <p className="text-xs text-muted-foreground">No advances or draws recorded yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {txns.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 p-2.5">
                <div>
                  <p className="font-medium capitalize">
                    {t.txnKind} <span className="text-xs font-normal text-muted-foreground">· {t.businessDate}</span>
                  </p>
                  <p className="font-mono text-xs text-muted-foreground">{t.expenseNo}</p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={t.status} />
                  <Money value={t.amount} className="font-semibold" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
