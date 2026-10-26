'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Eye, Flag } from 'lucide-react';
import {
  UNPAID_DAILY_TRANSFER_STATUSES,
  type DailyTransferCheck,
  type DailyTransferCheckRow,
  type DailyTransferStatus,
} from '@mb/shared';
import { SectionError } from '@/components/dashboard/branch-v2/parts';
import { SUMMARY_TONE, SummaryTile, SummaryTileSkeleton, longDate } from '@/components/shared/MonthlySummary';
import { Button } from '@/components/ui/button';
import { formatCurrency } from '@/utils/currency';
import { cn } from '@/lib/utils';
import { CASH_TRANSFER_STATUS_STYLES, shortBranch } from './cashTransferShared';

/**
 * Missing Daily Cash Transfers — the alert above Finance → Cash Transfer
 * Details' table.
 *
 * Lays out the server's check (GET /api/finance/cash-transfers/missing; the
 * rules are in cash-transfer-missing.service.ts) and decides nothing itself:
 * which branches are expected, which dates are due, and each (date, branch)'s
 * status all come from there. It follows the table's Branch and Date filters,
 * not its status, channel or search, which describe transfers rather than days.
 *
 * Unpaid days and transfers awaiting Finance are listed by default; approved
 * days only on request. "View" points the table below at that branch and date.
 */

const STATUS: Record<DailyTransferStatus, { label: string; className: string; reason: string; flag?: boolean }> = {
  missing: {
    label: 'Missing',
    className: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400',
    reason: 'No cash transfer recorded for this business date',
  },
  rejected: {
    label: 'Rejected',
    className: CASH_TRANSFER_STATUS_STYLES.rejected,
    reason: 'Finance rejected the transfer — the branch has to send it again',
    flag: true,
  },
  fuel_only: {
    label: 'Fuel only',
    className: 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-400',
    reason: 'Only fuel charges were sent — no Total Amount',
    flag: true,
  },
  pending: {
    label: 'Pending Approval',
    className: CASH_TRANSFER_STATUS_STYLES.pending,
    reason: 'Submitted — awaiting Finance approval',
  },
  approved: {
    label: 'Submitted / Approved',
    className: CASH_TRANSFER_STATUS_STYLES.approved,
    reason: 'Approved by Finance',
  },
};

const isUnpaid = (s: DailyTransferStatus) => UNPAID_DAILY_TRANSFER_STATUSES.includes(s);

function StatusBadge({ status }: { status: DailyTransferStatus }) {
  const s = STATUS[status];
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', s.className)}>
      {s.flag && <Flag className="h-3 w-3" aria-label="Needs attention" />}
      {s.label}
    </span>
  );
}

/** What the row's money column says: the amount that makes the status, or what was refused or sent instead. */
function amountOf(r: DailyTransferCheckRow): string {
  if (r.status === 'approved' || r.status === 'pending') return formatCurrency(r.submittedAmount);
  if (r.status === 'rejected') {
    return `${formatCurrency(r.transfers.filter((t) => t.status === 'rejected').reduce((s, t) => s + t.amount, 0))} rejected`;
  }
  if (r.status === 'fuel_only') return `Fuel ${formatCurrency(r.transfers.reduce((s, t) => s + t.fuelCharges, 0))}`;
  return '—';
}

const transferNos = (r: DailyTransferCheckRow) => (r.transfers.length ? r.transfers.map((t) => t.transferNo).join(', ') : '—');

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** "2 unpaid · 1 pending" — what a date's group holds, leaving out what it does not. */
function groupNote(rows: DailyTransferCheckRow[]): string {
  const unpaid = rows.filter((r) => isUnpaid(r.status)).length;
  const pending = rows.filter((r) => r.status === 'pending').length;
  const parts = [unpaid && plural(unpaid, 'unpaid branch', 'unpaid branches'), pending && `${pending} pending`].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'all approved';
}

export function MissingCashTransfersPanel({
  check,
  isLoading,
  isError,
  isFetching,
  onRetry,
  onView,
}: {
  check: DailyTransferCheck | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching: boolean;
  onRetry: () => void;
  onView: (row: DailyTransferCheckRow) => void;
}) {
  const [showApproved, setShowApproved] = useState(false);

  const groups = useMemo(() => {
    const out: { date: string; rows: DailyTransferCheckRow[] }[] = [];
    for (const r of check?.rows ?? []) {
      if (r.status === 'approved' && !showApproved) continue;
      const last = out[out.length - 1];
      if (last?.date === r.date) last.rows.push(r);
      else out.push({ date: r.date, rows: [r] });
    }
    return out;
  }, [check, showApproved]);

  if (isError && !check) {
    return <SectionError what="the missing cash transfers check" onRetry={onRetry} retrying={isFetching} />;
  }

  const s = check?.summary;
  const unpaid = s ? s.missing + s.rejected + s.fuelOnly : 0;
  // The all-clear is said only once the server has checked real branches over real due dates.
  const checkedSomething = !!check && check.branches > 0 && check.dates > 0;

  return (
    <section
      aria-label="Missing Daily Cash Transfers"
      className={cn(
        'space-y-4 rounded-lg border p-4 transition-opacity',
        unpaid > 0 ? 'border-amber-300 bg-amber-50/70 dark:border-amber-900 dark:bg-amber-950/20' : 'bg-card',
        isFetching && check && 'opacity-70',
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <AlertTriangle className={cn('h-4 w-4', unpaid > 0 ? 'text-amber-600' : 'text-muted-foreground')} />
            Missing Daily Cash Transfers
          </h2>
          <p className="text-sm text-muted-foreground">
            {check ? (
              check.dates > 0 ? (
                <>
                  {plural(check.branches, 'active branch', 'active branches')} checked for{' '}
                  {check.from === check.to ? longDate(check.from) : `${longDate(check.from)} – ${longDate(check.to)}`}.{' '}
                  Today ({longDate(check.today)}) is checked once its business day closes at 02:00.
                </>
              ) : (
                <>Nothing in this date range is due yet — today ({longDate(check.today)}) is checked once its business day closes at 02:00.</>
              )
            ) : (
              <span className="inline-block w-80 max-w-full animate-pulse rounded-md bg-muted align-top">{' '}</span>
            )}
          </p>
        </div>
        {!!s && s.approved > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setShowApproved((v) => !v)}>
            {showApproved ? 'Hide approved' : `Show approved (${s.approved})`}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {isLoading || !s ? (
          Array.from({ length: 3 }, (_, i) => <SummaryTileSkeleton key={i} />)
        ) : (
          <>
            <SummaryTile
              label="Branches with Missing Payments"
              value={s.missingBranches.toLocaleString()}
              sub={`${plural(unpaid, 'unpaid day', 'unpaid days')} · ${s.rejected} rejected · ${s.fuelOnly} fuel only`}
              tone={s.missingBranches > 0 ? SUMMARY_TONE.negative : SUMMARY_TONE.positive}
            />
            <SummaryTile
              label="Affected Business Dates"
              value={s.affectedDates.toLocaleString()}
              sub={`of ${plural(check!.dates, 'date', 'dates')} checked`}
              tone={s.affectedDates > 0 ? SUMMARY_TONE.warning : SUMMARY_TONE.positive}
            />
            <SummaryTile
              label="Awaiting Approval"
              value={s.pendingTransfers.toLocaleString()}
              sub={`${plural(s.pending, 'branch-day', 'branch-days')} submitted, not yet approved`}
              tone={s.pendingTransfers > 0 ? SUMMARY_TONE.warning : SUMMARY_TONE.neutral}
            />
          </>
        )}
      </div>

      {isLoading || !check ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : (
        <>
          {checkedSomething && unpaid === 0 && (
            <p className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              All required branches have submitted their daily cash transfers.
            </p>
          )}
          {check.dates > 0 && check.branches === 0 && (
            <p className="text-sm text-muted-foreground">No active branches to check.</p>
          )}

          {groups.length > 0 && (
            <>
              {/* Tablet and desktop: one table, grouped by business date. */}
              <div className="hidden overflow-x-auto rounded-md border bg-card md:block">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 font-medium">Branch</th>
                      <th className="px-3 py-2 font-medium">Payment Status</th>
                      <th className="px-3 py-2 font-medium">Transfer ID</th>
                      <th className="px-3 py-2 text-right font-medium">Submitted Amount</th>
                      <th className="px-3 py-2 font-medium">Reason / Status</th>
                      <th className="px-3 py-2 font-medium">Action</th>
                    </tr>
                  </thead>
                  {groups.map((g) => (
                    <tbody key={g.date} className="border-t">
                      <tr className="bg-muted/30">
                        <th colSpan={6} scope="rowgroup" className="px-3 py-1.5 text-left text-xs font-semibold">
                          {longDate(g.date)}
                          <span className="ml-2 font-normal text-muted-foreground">{groupNote(g.rows)}</span>
                        </th>
                      </tr>
                      {g.rows.map((r) => (
                        <tr key={r.branchId} className={cn('border-t', isUnpaid(r.status) && 'bg-amber-50/60 dark:bg-amber-950/10')}>
                          <td className="px-3 py-2 font-medium">{shortBranch(r.branchName)}</td>
                          <td className="px-3 py-2"><StatusBadge status={r.status} /></td>
                          <td className="px-3 py-2 font-mono text-xs">{transferNos(r)}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{amountOf(r)}</td>
                          <td className="px-3 py-2 text-muted-foreground">{STATUS[r.status].reason}</td>
                          <td className="px-3 py-2">
                            <Button variant="ghost" size="sm" onClick={() => onView(r)}>
                              <Eye className="mr-1.5 h-4 w-4" /> View
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  ))}
                </table>
              </div>

              {/* Phone: compact cards under each date. */}
              <div className="space-y-3 md:hidden">
                {groups.map((g) => (
                  <div key={g.date} className="space-y-2">
                    <p className="text-xs font-semibold">{longDate(g.date)}</p>
                    {g.rows.map((r) => (
                      <div
                        key={r.branchId}
                        className={cn('rounded-md border bg-card p-3', isUnpaid(r.status) && 'border-amber-300 dark:border-amber-900')}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-medium">{shortBranch(r.branchName)}</p>
                            <p className="text-xs text-muted-foreground">{STATUS[r.status].reason}</p>
                          </div>
                          <StatusBadge status={r.status} />
                        </div>
                        {r.transfers.length > 0 && (
                          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                            <span className="font-mono">{transferNos(r)}</span>
                            <span className="tabular-nums">{amountOf(r)}</span>
                          </div>
                        )}
                        <Button variant="outline" size="sm" className="mt-2 w-full" onClick={() => onView(r)}>
                          <Eye className="mr-1.5 h-4 w-4" /> View
                        </Button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </section>
  );
}
