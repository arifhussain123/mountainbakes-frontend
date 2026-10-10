'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Search } from 'lucide-react';
import {
  karachiDateStr,
  karachiTimeStr,
  RecordResignationSchema,
  RESIGNATION_REASONS,
  type EmployeeResignation,
  type FinanceEmployee,
  type RecordResignationInput,
  type ResignationImpact,
} from '@mb/shared';
import { useEmployeeProfile, useEmployeeSearch, useFinanceMutation, useSalaryLedgerPayments } from '@/lib/finance';
import { useDebounce } from '@/hooks/useDebounce';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useMoney } from '../finance-ui';
import { MONTHS_LONG, niceDate, periodLabel } from './ledger-ui';

/**
 * Record an employee's resignation.
 *
 * Find the employee by code or by name, read their record back, enter when and
 * why, confirm. Everything shown about the employee is what the API returned
 * for that id — nothing is filled in here.
 *
 * WHAT THIS SENDS is a date, a time and a reason. Who recorded it and when are
 * taken by the server from the session and its own clock; the employee is the
 * one in the URL. The checks that matter (already resigned, before joining, in
 * the future, not allowed for this role) are the server's, and its answer is
 * shown as it comes back.
 *
 * WHAT IT DOES NOT DO: delete the employee, or touch a single payslip. The
 * note above the confirmation says what will be left standing.
 */

interface ResignationResult {
  resignation: EmployeeResignation;
  impact: ResignationImpact;
  employee: FinanceEmployee;
}

const monthOf = (date: string) => periodLabel(Number(date.slice(0, 4)), Number(date.slice(5, 7)));

export function ResignationDialog({
  open,
  onOpenChange,
  employeeId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Opened from an employee's row: skip the search. */
  employeeId?: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="overflow-y-auto md:max-w-xl">
        <DialogHeader>
          <DialogTitle>Employee resignation</DialogTitle>
          <DialogDescription>
            Salary history is kept. Ordinary salary closes after the resignation month.
          </DialogDescription>
        </DialogHeader>
        {/* Mounted with the dialog, so each opening starts from a clean form. */}
        {open && <ResignationForm initialEmployeeId={employeeId ?? null} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ResignationForm({ initialEmployeeId, onDone }: { initialEmployeeId: string | null; onDone: () => void }) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(initialEmployeeId);
  const [date, setDate] = useState(() => karachiDateStr());
  const [time, setTime] = useState(() => karachiTimeStr());
  const [reason, setReason] = useState('');
  const [remarks, setRemarks] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');

  const term = useDebounce(query.trim(), 250);
  const searchQ = useEmployeeSearch(term, selectedId === null);
  const profileQ = useEmployeeProfile(selectedId);
  const paymentsQ = useSalaryLedgerPayments(selectedId ? { employeeId: selectedId, limit: 500 } : null);
  const mutation = useFinanceMutation<ResignationResult, RecordResignationInput>();
  const { format } = useMoney();

  const profile = profileQ.data;
  const employee = profile?.employee;
  const existing = employee?.resignation ?? null;
  const results = (searchQ.data ?? []).slice(0, 8);

  function pick(id: string) {
    setSelectedId(id);
    setError('');
    setConfirmed(false);
  }

  async function submit() {
    if (!employee || mutation.isPending) return;
    const parsed = RecordResignationSchema.safeParse({
      resignationDate: date,
      resignationTime: time,
      reason,
      remarks: remarks.trim() || null,
    });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? 'Check the form and try again.');
      return;
    }
    if (!confirmed) {
      setError('Tick the confirmation box to continue.');
      return;
    }
    setError('');
    try {
      const result = await mutation.mutateAsync({
        path: `/api/finance/payroll/employees/${employee.id}/resignation`,
        body: parsed.data,
      });
      toast.success(`Resignation recorded — ${employee.name}`, {
        description: `${niceDate(result.resignation.resignationDate)}. Salary closes after ${MONTHS_LONG[Number(date.slice(5, 7)) - 1]}.`,
      });
      if (result.impact.approvedAfter.length > 0) {
        toast.warning('Approved salary after the resignation month', {
          description: `${result.impact.approvedAfter.map((p) => p.salaryNo).join(', ')} — kept as they are and flagged for review in the Salary Ledger.`,
          duration: 12_000,
        });
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The resignation could not be recorded.');
    }
  }

  // What the resignation will leave standing, read from the payslips on record.
  const lastMonth = date.slice(0, 7);
  const later = (paymentsQ.data?.payments ?? []).filter((p) => p.salaryMonth > lastMonth);
  const laterPending = later.filter((p) => p.exclusion === 'pending' || p.exclusion === 'draft').length;
  const laterApproved = later.filter((p) => p.counted).length;

  return (
    <div className="space-y-4">
      {selectedId === null && (
        <>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              type="search"
              aria-label="Search by employee code or name"
              placeholder="Search by employee code or name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-11 pl-9 md:h-10"
            />
          </div>
          <div className="overflow-hidden rounded-lg border">
            {searchQ.isLoading ? (
              <div className="space-y-2 p-3">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-4/5" />
              </div>
            ) : searchQ.isError ? (
              <p className="p-3.5 text-[13px] text-red-700 dark:text-red-300">
                Employees could not be loaded. {searchQ.error instanceof Error ? searchQ.error.message : ''}
              </p>
            ) : results.length === 0 ? (
              <p className="p-3.5 text-[13px] text-muted-foreground">
                {term ? `No employee matches “${term}”.` : 'No employees on the payroll yet.'}
              </p>
            ) : (
              <ul className="divide-y">
                {results.map((e) => (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => pick(e.id)}
                      className="flex min-h-11 w-full items-center justify-between gap-2.5 px-3 py-2 text-left hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
                    >
                      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
                        <span className="font-mono text-xs text-muted-foreground">{e.employeeCode}</span>
                        <span className="text-sm font-semibold">{e.name}</span>
                        <span className="text-[12.5px] text-muted-foreground">{e.department}</span>
                      </span>
                      {e.resignation ? (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11.5px] font-semibold text-red-800 dark:bg-red-950 dark:text-red-300">
                          Resigned
                        </span>
                      ) : (
                        !e.isActive && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[11.5px] font-semibold text-muted-foreground">
                            Inactive
                          </span>
                        )
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      {selectedId !== null && profileQ.isLoading && (
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-24 w-full" />
        </div>
      )}

      {selectedId !== null && profileQ.isError && (
        <Notice tone="danger">
          This employee&apos;s record could not be loaded. {profileQ.error instanceof Error ? profileQ.error.message : ''}
        </Notice>
      )}

      {employee && profile && (
        <>
          <div className="space-y-2.5 rounded-lg border bg-muted/50 px-3.5 py-3">
            <div className="flex items-center justify-between gap-2.5">
              <p className="text-[15px] font-bold">
                {employee.name}{' '}
                <span className="font-mono text-[13px] font-medium text-muted-foreground">{employee.employeeCode}</span>
              </p>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => {
                  setSelectedId(null);
                  setError('');
                }}
              >
                Change
              </Button>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-3">
              {(
                [
                  ['Department', employee.department],
                  ['Designation', employee.designation],
                  ['Branch', employee.branchName ?? 'Head office'],
                  ['Joining date', employee.joinedOn ? niceDate(employee.joinedOn) : 'Not on file'],
                  ['Status', existing ? 'Resigned' : employee.isActive ? 'Active' : 'Inactive'],
                  ['Salary rate', format(employee.baseSalary)],
                  [
                    'Last approved salary',
                    profile.lastApprovedSalary
                      ? `${monthOf(`${profile.lastApprovedSalary.salaryMonth}-01`)} · ${format(profile.lastApprovedSalary.amount)}`
                      : 'None',
                  ],
                  ['Contact', employee.phone || 'Not on file'],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="flex flex-col gap-px">
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="font-semibold break-words">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {existing ? (
            <Notice tone="danger">
              A resignation is already recorded for this employee ({niceDate(existing.resignationDate)} · {existing.reason}
              ). A second one cannot be added. If it is wrong, cancel it from the employee&apos;s details and record it
              again — both records are kept.
            </Notice>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="resignation-date">Resignation date</Label>
                  <Input
                    id="resignation-date"
                    type="date"
                    value={date}
                    min={employee.joinedOn ?? undefined}
                    max={karachiDateStr()}
                    onChange={(e) => {
                      setDate(e.target.value);
                      setError('');
                    }}
                    className="h-11 md:h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="resignation-time">Time (PKT, UTC+5)</Label>
                  <Input
                    id="resignation-time"
                    type="time"
                    value={time}
                    onChange={(e) => {
                      setTime(e.target.value);
                      setError('');
                    }}
                    className="h-11 md:h-9"
                  />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="resignation-reason">Reason</Label>
                  <select
                    id="resignation-reason"
                    value={reason}
                    onChange={(e) => {
                      setReason(e.target.value);
                      setError('');
                    }}
                    className="h-11 w-full rounded-lg border border-input bg-transparent px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:h-9 md:text-sm"
                  >
                    <option value="">Select a reason</option>
                    {RESIGNATION_REASONS.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="resignation-remarks">
                    Remarks {reason === 'Other' ? '(required for “Other”)' : '(optional)'}
                  </Label>
                  <Textarea
                    id="resignation-remarks"
                    rows={2}
                    maxLength={500}
                    value={remarks}
                    onChange={(e) => {
                      setRemarks(e.target.value);
                      setError('');
                    }}
                  />
                </div>
              </div>

              {date && (
                <Notice tone="warning">
                  Salary records up to {monthOf(date)} stay as they are. {monthOf(date)} can still take an approved salary;
                  later months close for ordinary salary.
                  {laterPending > 0 &&
                    ` ${laterPending} payslip${laterPending > 1 ? 's' : ''} awaiting approval for later months will stay pending and can no longer be approved.`}
                  {laterApproved > 0 &&
                    ` ${laterApproved} payslip${laterApproved > 1 ? 's' : ''} already approved for later months will be kept and flagged for review.`}
                </Notice>
              )}

              <label className="flex cursor-pointer items-start gap-2.5 text-[13.5px]">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => {
                    setConfirmed(e.target.checked);
                    setError('');
                  }}
                  className="mt-0.5 size-4 accent-primary"
                />
                <span>
                  I confirm {employee.name} has resigned on the date above. The server time and my user account will be
                  recorded.
                </span>
              </label>
            </>
          )}
        </>
      )}

      {error && <Notice tone="danger">{error}</Notice>}

      <div className="flex flex-col-reverse gap-2 border-t pt-3.5 sm:flex-row sm:justify-end">
        <Button variant="outline" className="h-11 md:h-9" onClick={onDone}>
          Cancel
        </Button>
        <Button
          className="h-11 min-w-[170px] bg-red-700 text-white hover:bg-red-800 md:h-9"
          disabled={!employee || Boolean(existing) || !confirmed || mutation.isPending}
          onClick={() => void submit()}
        >
          {mutation.isPending ? 'Recording…' : 'Submit resignation'}
        </Button>
      </div>
    </div>
  );
}

function Notice({ tone, children }: { tone: 'warning' | 'danger'; children: React.ReactNode }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : undefined}
      className={
        tone === 'danger'
          ? 'rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] text-pretty text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200'
          : 'rounded-md bg-amber-50 px-3 py-2.5 text-[13px] text-pretty text-amber-950 dark:bg-amber-950/40 dark:text-amber-100'
      }
    >
      {children}
    </div>
  );
}
