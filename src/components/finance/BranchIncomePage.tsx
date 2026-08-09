'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { createColumnHelper } from '@tanstack/react-table';
import { businessDateStr, type FinanceIncomeApproval } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranches } from '@/lib/queries';
import { useFinanceMutation, useFinanceSettings, useIncomeApprovals } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DataTable } from '@/components/shared/DataTable';
import { FinancePageHeader, Money, ReadOnlyNotice, StatusBadge, useFinanceAbilities } from './finance-ui';
import { DateFilter, FilterBar, FilterField, FilterSelect, RejectDialog } from './finance-actions';
import { ArrowDownToLine, BadgeCheck, Check, Eye, Info, X } from 'lucide-react';

/**
 * Branch Income — the pending list the brief's workflow ends at.
 *
 *   Branch closing → branch submits → Admin verifies → FINANCE APPROVES → ledger
 *
 * Nothing on this screen has touched the book yet. Approving is the single act
 * that posts it, and it posts THREE vouchers at once (the collection, the
 * company share and the branch share), which is why the confirm dialog spells
 * out the split before the button rather than showing it afterwards.
 *
 * The share percentages shown on a row are the ones SNAPSHOT on that row, not
 * the ones in settings today — an approved day must not restate itself when an
 * owner changes the split. For rows not yet approved the snapshot is the current
 * setting, so the preview is accurate either way.
 */

const col = createColumnHelper<FinanceIncomeApproval>();

/** Only these roles may perform the Admin-verifies step — mirrors requireIncomeVerifier. */
const VERIFIER_ROLES = ['super_admin', 'finance_admin', 'finance_manager'];

export function BranchIncomePage() {
  const { token, user } = useAuth();
  const abilities = useFinanceAbilities();
  const today = businessDateStr();

  const [status, setStatus] = useState('pending');
  const [branchId, setBranchId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [importing, setImporting] = useState(false);
  const [approving, setApproving] = useState<FinanceIncomeApproval | null>(null);
  const [rejecting, setRejecting] = useState<FinanceIncomeApproval | null>(null);
  const [viewing, setViewing] = useState<FinanceIncomeApproval | null>(null);

  const branchesQ = useBranches(token ?? '');
  const { data: settings } = useFinanceSettings();
  const { data, isLoading } = useIncomeApprovals({
    status: status || undefined,
    branchId: branchId || undefined,
    from: from || undefined,
    to: to || undefined,
  });

  const verifyMut = useFinanceMutation();
  const canVerify = VERIFIER_ROLES.includes(user?.role ?? '');

  const rows = data ?? [];
  const pendingTotal = rows
    .filter((r) => r.status === 'pending_verification' || r.status === 'pending_approval')
    .reduce((sum, r) => sum + r.totalAmount, 0);

  // A branch that collected nothing has nothing to approve or split — it only
  // clutters the table with an all-zero row. Called out above it instead, so
  // it's still visible (a branch with zero collection every day is worth
  // noticing) without taking a table row.
  const zeroRows = rows.filter((r) => r.totalAmount === 0);
  const tableRows = rows.filter((r) => r.totalAmount !== 0);

  async function verify(approval: FinanceIncomeApproval) {
    try {
      await verifyMut.mutateAsync({ path: `/api/finance/income/${approval.id}/verify`, body: {} });
      toast.success(`${approval.branchName} verified — now with Finance for approval`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not verify this income');
    }
  }

  const columns = [
    col.accessor('referenceNo', {
      header: 'Reference',
      meta: { mobile: 'subtitle' },
      cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue()}</span>,
    }),
    col.accessor('branchName', {
      header: 'Branch',
      meta: { mobile: 'title' },
      cell: (i) => <span className="font-medium">{i.getValue()}</span>,
    }),
    col.accessor('businessDate', { header: 'Business Date', cell: (i) => <span className="text-sm">{i.getValue()}</span> }),
    col.accessor('totalAmount', {
      header: 'Collected',
      cell: (i) => <Money value={i.getValue()} className="font-semibold" />,
    }),
    col.accessor('branchExpenses', {
      header: 'Branch Exp.',
      cell: (i) => <Money value={i.getValue()} blankZero className="text-muted-foreground" />,
    }),
    col.accessor('netAmount', { header: 'Net', cell: (i) => <Money value={i.getValue()} /> }),
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
            {row.status === 'pending_verification' && canVerify && (
              <Button variant="outline" size="sm" disabled={verifyMut.isPending} onClick={() => void verify(row)}>
                <BadgeCheck className="h-3.5 w-3.5" />
                Verify
              </Button>
            )}
            {row.status === 'pending_approval' && abilities.approve && (
              <>
                <Button size="sm" onClick={() => setApproving(row)}>
                  <Check className="h-3.5 w-3.5" />
                  Approve
                </Button>
                <Button variant="destructive" size="sm" onClick={() => setRejecting(row)}>
                  <X className="h-3.5 w-3.5" />
                  Reject
                </Button>
              </>
            )}
            {row.status === 'rejected' && row.rejectionReason && (
              <span className="text-xs text-muted-foreground" title={row.rejectionReason}>
                {row.rejectionReason}
              </span>
            )}
          </div>
        );
      },
    }),
  ];

  return (
    <div className="space-y-6">
      <FinancePageHeader
        title="Branch Income Approvals"
        description="Approved branch closings, waiting to enter the book. Approving posts the collection and both share entries."
        actions={
          abilities.create && (
            <Button size="sm" onClick={() => setImporting(true)}>
              <ArrowDownToLine className="h-3.5 w-3.5" />
              Import branch closings
            </Button>
          )
        }
      />

      <ReadOnlyNotice abilities={abilities} />

      {settings && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-2.5">
              <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <p className="text-muted-foreground">
                Current split: <span className="font-medium text-foreground">{settings.companySharePct}% company</span>{' '}
                / <span className="font-medium text-foreground">{settings.branchSharePct}% branch</span>, struck on{' '}
                <span className="font-medium text-foreground">
                  {settings.shareBasis === 'gross' ? 'gross collection' : 'net of branch expenses'}
                </span>
                .{' '}
                {settings.requireAdminVerification
                  ? 'Admin verification is required before Finance can approve.'
                  : 'Admin verification is off — imported income goes straight to Finance.'}
              </p>
            </div>
            <div className="flex flex-shrink-0 items-center gap-6">
              {pendingTotal > 0 && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Awaiting a decision</p>
                  <Money value={pendingTotal} className="text-lg font-bold" />
                </div>
              )}
              {zeroRows.length > 0 && (
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Zero Collection</p>
                  <p className="text-lg font-bold text-amber-600 dark:text-amber-400">{zeroRows.length}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <FilterBar>
        <FilterField label="Status">
          <FilterSelect
            value={status}
            onChange={setStatus}
            allLabel="All"
            options={[
              { value: 'pending', label: 'Pending (any stage)' },
              { value: 'pending_verification', label: 'Pending Verification' },
              { value: 'pending_approval', label: 'Pending Approval' },
              { value: 'approved', label: 'Approved' },
              { value: 'rejected', label: 'Rejected' },
            ]}
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
          <DateFilter value={from} onChange={setFrom} max={today} />
        </FilterField>
        <FilterField label="To">
          <DateFilter value={to} onChange={setTo} max={today} />
        </FilterField>
      </FilterBar>

      <DataTable
        columns={columns}
        data={tableRows}
        loading={isLoading}
        searchPlaceholder="Search by branch or reference…"
      />

      <ImportDialog open={importing} onOpenChange={setImporting} />

      <ApproveIncomeDialog approval={approving} onClose={() => setApproving(null)} />

      {/* Mounted only while a row is selected, so the dialog can never hold a
          path built from an undefined id. */}
      {rejecting && (
        <RejectDialog
          open
          onOpenChange={(open) => !open && setRejecting(null)}
          path={`/api/finance/income/${rejecting.id}/reject`}
          label={`${rejecting.branchName} · ${rejecting.businessDate}`}
        />
      )}

      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle>{viewing?.branchName}</DialogTitle>
          </DialogHeader>
          {viewing && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <StatusBadge status={viewing.status} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Business Date</p>
                  <p className="font-medium">{viewing.businessDate}</p>
                </div>
                <div className="col-span-2">
                  <p className="text-xs text-muted-foreground">Reference</p>
                  <p className="font-mono font-medium">{viewing.referenceNo}</p>
                </div>
              </div>

              <dl className="space-y-1.5">
                <SplitRow label="Cash" value={viewing.cashAmount} />
                <SplitRow label="Easypaisa" value={viewing.easypaisaAmount} />
                <SplitRow label="Foodpanda" value={viewing.foodpandaAmount} />
                <SplitRow label="Bank" value={viewing.bankAmount} />
                <SplitRow label="Other" value={viewing.otherAmount} />
                <div className="flex items-baseline justify-between border-t pt-1.5 font-semibold">
                  <dt>Total collected</dt>
                  <dd>
                    <Money value={viewing.totalAmount} />
                  </dd>
                </div>
                <SplitRow label="Branch expenses" value={viewing.branchExpenses} />
                <div className="flex items-baseline justify-between font-medium">
                  <dt>Net</dt>
                  <dd>
                    <Money value={viewing.netAmount} />
                  </dd>
                </div>
              </dl>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div>
                  <p className="text-xs text-muted-foreground">Verified By</p>
                  <p className="font-medium">{viewing.verifiedByName ?? '—'}</p>
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

/**
 * Pull a business date's branch closings into the pending list.
 *
 * Idempotent server-side, so the button is safe to press twice; `refresh`
 * re-reads the branch figures over a row that has not been approved yet, which
 * is what a finance user wants after a branch corrects its closing.
 */
function ImportDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { token } = useAuth();
  const branchesQ = useBranches(token ?? '');
  const today = businessDateStr();

  const [date, setDate] = useState(today);
  const [branchId, setBranchId] = useState('');
  const [refresh, setRefresh] = useState(false);
  // `skipped` is a list of { branchName, reason }, not a count — see
  // ImportResult in the server's finance-income.service.ts.
  const mut = useFinanceMutation<{
    imported: number;
    refreshed: number;
    skipped: { branchName: string; reason: string }[];
  }>();

  async function submit() {
    try {
      const result = await mut.mutateAsync({
        path: '/api/finance/income/import',
        body: {
          businessDate: date,
          ...(branchId ? { branchId } : {}),
          refresh,
        },
      });
      const parts = [
        `${result.imported} imported`,
        result.refreshed > 0 ? `${result.refreshed} refreshed` : null,
        result.skipped.length > 0 ? `${result.skipped.length} skipped` : null,
      ].filter(Boolean);
      toast.success(parts.join(' · '));
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not import branch income');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>Import branch closings</DialogTitle>
          <DialogDescription>
            Reads the approved branch closings for a business date into the pending list. Nothing is posted to the
            ledger — that still needs a Finance approval.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>Business date</Label>
            <DateFilter value={date} onChange={setDate} max={today} />
          </div>

          <div className="space-y-1">
            <Label>Branch</Label>
            <FilterSelect
              value={branchId}
              onChange={setBranchId}
              allLabel="All branches"
              options={(branchesQ.data ?? []).map((b) => ({ value: b.id, label: b.name }))}
            />
          </div>

          <label className="flex items-start gap-2.5 rounded-lg border p-3 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4"
              checked={refresh}
              onChange={(e) => setRefresh(e.target.checked)}
            />
            <span>
              <span className="font-medium">Re-read figures for rows already imported</span>
              <span className="block text-xs text-muted-foreground">
                Only affects rows that have not been approved yet.
              </span>
            </span>
          </label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={mut.isPending} onClick={() => void submit()}>
            {mut.isPending ? 'Importing…' : 'Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Approving posts three vouchers (collection, company share, branch share) — the dialog shows the collection breakdown before it happens. */
function ApproveIncomeDialog({
  approval,
  onClose,
}: {
  approval: FinanceIncomeApproval | null;
  onClose: () => void;
}) {
  const mut = useFinanceMutation();

  async function submit() {
    if (!approval) return;
    try {
      await mut.mutateAsync({ path: `/api/finance/income/${approval.id}/approve`, body: {} });
      toast.success(`${approval.branchName} income posted to the ledger`);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not approve this income');
    }
  }

  return (
    <Dialog open={approval !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>Approve branch income</DialogTitle>
          <DialogDescription>
            This posts to the ledger immediately and cannot be undone — only reversed with an adjustment entry.
          </DialogDescription>
        </DialogHeader>

        {approval && (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="font-medium">
                {approval.branchName} · {approval.businessDate}
              </p>
              <p className="font-mono text-xs text-muted-foreground">{approval.referenceNo}</p>
            </div>

            <dl className="space-y-1.5">
              <SplitRow label="Cash" value={approval.cashAmount} />
              <SplitRow label="Easypaisa" value={approval.easypaisaAmount} />
              <SplitRow label="Foodpanda" value={approval.foodpandaAmount} />
              <SplitRow label="Bank" value={approval.bankAmount} />
              <SplitRow label="Other" value={approval.otherAmount} />
              <div className="flex items-baseline justify-between border-t pt-1.5 font-semibold">
                <dt>Total collected</dt>
                <dd>
                  <Money value={approval.totalAmount} />
                </dd>
              </div>
              <SplitRow label="Branch expenses" value={approval.branchExpenses} />
              <div className="flex items-baseline justify-between font-medium">
                <dt>Net</dt>
                <dd>
                  <Money value={approval.netAmount} />
                </dd>
              </div>
            </dl>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={mut.isPending} onClick={() => void submit()}>
            {mut.isPending ? 'Posting…' : 'Approve and post'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SplitRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between text-muted-foreground">
      <dt>{label}</dt>
      <dd>
        <Money value={value} blankZero />
      </dd>
    </div>
  );
}
