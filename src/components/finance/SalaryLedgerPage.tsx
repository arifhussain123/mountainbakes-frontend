'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { createColumnHelper } from '@tanstack/react-table';
import {
  EDITABLE_DOC_STATUSES,
  FINANCE_ACCOUNT_LABELS,
  FINANCE_PAYMENT_METHOD_LABELS,
  type EmployeeAdvance,
  type FinanceEmployee,
  type SalaryPayment,
} from '@mb/shared';
import {
  useEmployeeAdvances,
  useFinanceEmployees,
  useFinanceMutation,
  useSalaryPayments,
  useSalaryRevisions,
} from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable } from '@/components/shared/DataTable';
import { AttachmentGallery } from '@/components/shared/AttachmentGallery';
import { FinancePageHeader, Money, ReadOnlyNotice, StatusBadge, useFinanceAbilities } from './finance-ui';
import { DocumentActions, FilterBar, FilterField, FilterSelect } from './finance-actions';
import { EmployeeAdvanceForm, EmployeeForm, SalaryForm, SalaryRevisionForm } from './SalaryForms';
import { Eye, HandCoins, Pencil, Plus, TrendingUp, UserPlus } from 'lucide-react';

/**
 * The salary ledger, the advances against it, and the payroll master behind
 * both, on three tabs.
 *
 * They are one screen because they are one job: nobody manages an employee
 * record except in the course of paying them, and nobody records an advance
 * except against the payslip that will take it back. Splitting any of them onto
 * its own nav item would add finance pages that get opened once a quarter.
 *
 * Both documents walk the same approval path as every other one — approval is
 * what posts the payment to the ledger under the Salaries head. They share that
 * head deliberately: the advance books the cash when it leaves, the payslip
 * books only the net, and the two come to the right total. See migration 87.
 */

const salaryCol = createColumnHelper<SalaryPayment>();
const employeeCol = createColumnHelper<FinanceEmployee>();
const advanceCol = createColumnHelper<EmployeeAdvance>();
const BASE_PATH = '/api/finance/payroll/salaries';
const ADVANCE_PATH = '/api/finance/payroll/advances';

export function SalaryLedgerPage() {
  const abilities = useFinanceAbilities();

  return (
    <div className="space-y-6">
      <FinancePageHeader
        title="Salary Ledger"
        description="Payslips, advances and the payroll master. Approving either document posts it to the ledger under Salaries."
      />

      <ReadOnlyNotice abilities={abilities} />

      <Tabs defaultValue="salaries">
        <TabsList>
          <TabsTrigger value="salaries">Salaries</TabsTrigger>
          <TabsTrigger value="advances">Advances</TabsTrigger>
          <TabsTrigger value="employees">Employees</TabsTrigger>
        </TabsList>

        <TabsContent value="salaries" className="mt-4">
          <SalariesTab abilities={abilities} />
        </TabsContent>

        <TabsContent value="advances" className="mt-4">
          <AdvancesTab abilities={abilities} />
        </TabsContent>

        <TabsContent value="employees" className="mt-4">
          <EmployeesTab abilities={abilities} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SalariesTab({ abilities }: { abilities: ReturnType<typeof useFinanceAbilities> }) {
  const [status, setStatus] = useState('');
  const [salaryMonth, setSalaryMonth] = useState('');
  const [department, setDepartment] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SalaryPayment | null>(null);
  const [viewing, setViewing] = useState<SalaryPayment | null>(null);

  const employeesQ = useFinanceEmployees(true);
  const { data, isLoading } = useSalaryPayments({
    status: status || undefined,
    salaryMonth: salaryMonth || undefined,
    department: department || undefined,
  });

  const rows = data ?? [];
  const monthTotal = rows.reduce((sum, r) => sum + r.netSalary, 0);

  // Departments come off the employee master rather than a hardcoded list —
  // a bakery's departments are whatever the payroll says they are.
  const departments = Array.from(new Set((employeesQ.data ?? []).map((e) => e.department))).sort();

  const columns = [
    salaryCol.accessor('salaryNo', {
      header: 'Payslip No',
      meta: { mobile: 'subtitle' },
      cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue()}</span>,
    }),
    salaryCol.accessor('employeeName', {
      header: 'Employee',
      meta: { mobile: 'title' },
      cell: (i) => <span className="font-medium">{i.getValue()}</span>,
    }),
    salaryCol.accessor('department', { header: 'Department', cell: (i) => <span className="text-sm">{i.getValue()}</span> }),
    salaryCol.accessor('designation', { header: 'Designation', cell: (i) => <span className="text-sm text-muted-foreground">{i.getValue()}</span> }),
    salaryCol.accessor('salaryMonth', { header: 'Month', cell: (i) => <span className="text-sm tabular-nums">{i.getValue()}</span> }),
    salaryCol.accessor('grossSalary', { header: 'Salary', cell: (i) => <Money value={i.getValue()} /> }),
    salaryCol.accessor('bonus', { header: 'Bonus', cell: (i) => <Money value={i.getValue()} blankZero className="text-emerald-600 dark:text-emerald-400" /> }),
    salaryCol.accessor('deductions', { header: 'Deduction', cell: (i) => <Money value={i.getValue()} blankZero className="text-red-600 dark:text-red-400" /> }),
    salaryCol.accessor('netSalary', { header: 'Net Salary', cell: (i) => <Money value={i.getValue()} className="font-semibold" /> }),
    salaryCol.accessor('paymentDate', {
      header: 'Payment Date',
      cell: (i) => <span className="text-sm">{i.getValue() ?? '—'}</span>,
    }),
    salaryCol.accessor('status', {
      header: 'Status',
      meta: { mobile: 'badge' },
      cell: (i) => <StatusBadge status={i.getValue()} />,
    }),
    salaryCol.display({
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
            <DocumentActions doc={row} basePath={BASE_PATH} abilities={abilities} label={row.salaryNo} />
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
        <FilterField label="Salary month">
          <Input
            type="month"
            value={salaryMonth}
            onChange={(e) => setSalaryMonth(e.target.value)}
            className="h-11 md:h-9"
          />
        </FilterField>
        <FilterField label="Department">
          <FilterSelect
            value={department}
            onChange={setDepartment}
            allLabel="All departments"
            options={departments.map((d) => ({ value: d, label: d }))}
          />
        </FilterField>
        <div className="ml-auto flex items-end gap-3">
          {rows.length > 0 && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Net for this selection</p>
              <Money value={monthTotal} className="text-lg font-bold" />
            </div>
          )}
          {abilities.create && (
            <Button size="sm" className="h-11 md:h-9" onClick={() => setCreating(true)}>
              <Plus className="h-3.5 w-3.5" />
              New payslip
            </Button>
          )}
        </div>
      </FilterBar>

      <DataTable columns={columns} data={rows} loading={isLoading} searchPlaceholder="Search by employee…" />

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>New payslip</DialogTitle>
          </DialogHeader>
          <SalaryForm onSuccess={() => setCreating(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit {editing?.salaryNo}</DialogTitle>
          </DialogHeader>
          {editing && <SalaryForm salary={editing} onSuccess={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewing?.salaryNo}</DialogTitle>
          </DialogHeader>
          {viewing && <SalaryDetail salary={viewing} onClose={() => setViewing(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * One payslip in full, including the advances its Deduction is made of.
 *
 * Its own component so the advance lookup is a hook scoped to an open dialog
 * rather than a query fired on every row of the table behind it.
 */
function SalaryDetail({ salary, onClose }: { salary: SalaryPayment; onClose: () => void }) {
  const recoveredQ = useEmployeeAdvances({ salaryId: salary.id });
  const recovered = recoveredQ.data ?? [];
  const recoveredTotal = recovered.reduce((t, a) => t + a.totalAmount, 0);

  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div>
          <p className="text-xs text-muted-foreground">Status</p>
          <StatusBadge status={salary.status} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Salary Month</p>
          <p className="font-medium tabular-nums">{salary.salaryMonth}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Employee</p>
          <p className="font-medium">{salary.employeeName}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Department</p>
          <p className="font-medium">{salary.department} · {salary.designation}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Payment Date</p>
          <p className="font-medium">{salary.paymentDate ?? '—'}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Payment Method</p>
          <p className="font-medium">{FINANCE_PAYMENT_METHOD_LABELS[salary.paymentMethod] ?? salary.paymentMethod}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Account</p>
          <p className="font-medium">{FINANCE_ACCOUNT_LABELS[salary.account]}</p>
        </div>
      </div>

      <dl className="space-y-1.5">
        <div className="flex items-baseline justify-between text-muted-foreground">
          <dt>Salary</dt>
          <dd><Money value={salary.grossSalary} /></dd>
        </div>
        <div className="flex items-baseline justify-between text-muted-foreground">
          <dt>Bonus</dt>
          <dd><Money value={salary.bonus} blankZero className="text-emerald-600 dark:text-emerald-400" /></dd>
        </div>
        <div className="flex items-baseline justify-between text-muted-foreground">
          <dt>Deduction</dt>
          <dd><Money value={salary.deductions} blankZero className="text-red-600 dark:text-red-400" /></dd>
        </div>
        <div className="flex items-baseline justify-between border-t pt-1.5 font-semibold">
          <dt>Net Salary</dt>
          <dd><Money value={salary.netSalary} /></dd>
        </div>
      </dl>

      {recovered.length > 0 && (
        <div className="space-y-1.5 rounded-lg border p-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Advances recovered</p>
            <Money value={recoveredTotal} className="text-sm font-semibold" />
          </div>
          {/* What the Deduction above is made of — the question an auditor asks
              first, and one the figures alone cannot answer. */}
          <ul className="divide-y">
            {recovered.map((a) => (
              <li key={a.id} className="flex items-baseline justify-between gap-3 py-1.5">
                <span className="min-w-0">
                  <span className="block font-mono text-xs text-muted-foreground">
                    {a.advanceNo} · {a.businessDate}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {[
                      a.advanceAmount > 0 ? `Advance ${a.advanceAmount.toLocaleString()}` : null,
                      a.bonusAmount > 0 ? `Bonus ${a.bonusAmount.toLocaleString()}` : null,
                      a.loanAmount > 0 ? `Loan ${a.loanAmount.toLocaleString()}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <Money value={a.totalAmount} className="shrink-0 text-sm" />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div>
          <p className="text-xs text-muted-foreground">Created By</p>
          <p className="font-medium">{salary.createdByName ?? '—'}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Approved By</p>
          <p className="font-medium">{salary.approvedByName ?? '—'}</p>
        </div>
        {salary.status === 'rejected' && salary.rejectionReason && (
          <div className="col-span-2">
            <p className="text-xs text-muted-foreground">Rejection Reason</p>
            <p className="font-medium whitespace-pre-wrap break-words">{salary.rejectionReason}</p>
          </div>
        )}
        {salary.notes?.trim() && (
          <div className="col-span-2">
            <p className="text-xs text-muted-foreground">Notes</p>
            <p className="font-medium whitespace-pre-wrap break-words">{salary.notes.trim()}</p>
          </div>
        )}
        <div className="col-span-2">
          <p className="text-xs text-muted-foreground">Photo</p>
          <AttachmentGallery
            attachments={salary.attachments}
            title={`${salary.salaryNo} payslip`}
            emptyText="No photo — this payslip predates the requirement."
            className="mt-1"
          />
        </div>
      </div>

      <Button variant="outline" className="w-full" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Advances — money handed over between payslips.
 *
 * The Recovered column is the one to read: an advance is a debt until a payslip
 * takes it back, and "Outstanding" here is exactly what the next payslip's
 * Deduction gets prefilled with. A row claimed by a payslip that was later
 * rejected reads Outstanding again, which is the correct answer — the deduction
 * that was going to settle it never posted.
 */
function AdvancesTab({ abilities }: { abilities: ReturnType<typeof useFinanceAbilities> }) {
  const [status, setStatus] = useState('');
  const [department, setDepartment] = useState('');
  const [recovery, setRecovery] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<EmployeeAdvance | null>(null);
  const [viewing, setViewing] = useState<EmployeeAdvance | null>(null);

  const employeesQ = useFinanceEmployees(true);
  const { data, isLoading } = useEmployeeAdvances({
    // "Still to recover" is a posted-only view, so it replaces the status filter
    // rather than combining with it — a draft advance is owed by nobody yet.
    status: recovery === 'outstanding' ? undefined : status || undefined,
    outstandingOnly: recovery === 'outstanding' || undefined,
    department: department || undefined,
  });

  const rows = data ?? [];
  const total = rows.reduce((sum, r) => sum + r.totalAmount, 0);
  const departments = Array.from(new Set((employeesQ.data ?? []).map((e) => e.department))).sort();

  const columns = [
    advanceCol.accessor('advanceNo', {
      header: 'Advance No',
      meta: { mobile: 'subtitle' },
      cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue()}</span>,
    }),
    advanceCol.accessor('employeeName', {
      header: 'Employee',
      meta: { mobile: 'title' },
      cell: (i) => <span className="font-medium">{i.getValue()}</span>,
    }),
    advanceCol.accessor('department', {
      header: 'Department',
      cell: (i) => <span className="text-sm">{i.getValue()}</span>,
    }),
    advanceCol.accessor('businessDate', {
      header: 'Date',
      cell: (i) => <span className="text-sm tabular-nums">{i.getValue()}</span>,
    }),
    advanceCol.accessor('advanceAmount', { header: 'Advance', cell: (i) => <Money value={i.getValue()} blankZero /> }),
    advanceCol.accessor('bonusAmount', {
      header: 'Bonus',
      cell: (i) => <Money value={i.getValue()} blankZero className="text-emerald-600 dark:text-emerald-400" />,
    }),
    advanceCol.accessor('loanAmount', { header: 'Loan', cell: (i) => <Money value={i.getValue()} blankZero /> }),
    advanceCol.accessor('totalAmount', {
      header: 'Paid',
      cell: (i) => <Money value={i.getValue()} className="font-semibold" />,
    }),
    advanceCol.accessor('isRecovered', {
      header: 'Recovered',
      cell: (i) => {
        const row = i.row.original;
        // Only a posted advance is owed at all — a draft or pending one has not
        // moved any money yet, so neither answer applies to it.
        if (!['posted', 'locked'].includes(row.status)) return <span className="text-sm text-muted-foreground">—</span>;
        return i.getValue() ? (
          <Badge
            variant="secondary"
            className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
          >
            {row.recoveredBySalaryNo ?? 'Recovered'}
          </Badge>
        ) : (
          <Badge variant="secondary" className="bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Outstanding
          </Badge>
        );
      },
    }),
    advanceCol.accessor('status', {
      header: 'Status',
      meta: { mobile: 'badge' },
      cell: (i) => <StatusBadge status={i.getValue()} />,
    }),
    advanceCol.display({
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
            <DocumentActions doc={row} basePath={ADVANCE_PATH} abilities={abilities} label={row.advanceNo} />
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
        <FilterField label="Recovery">
          <FilterSelect
            value={recovery}
            onChange={setRecovery}
            allLabel="All advances"
            options={[{ value: 'outstanding', label: 'Still to recover' }]}
          />
        </FilterField>
        <FilterField label="Department">
          <FilterSelect
            value={department}
            onChange={setDepartment}
            allLabel="All departments"
            options={departments.map((d) => ({ value: d, label: d }))}
          />
        </FilterField>
        <div className="ml-auto flex items-end gap-3">
          {rows.length > 0 && (
            <div className="text-right">
              <p className="text-xs text-muted-foreground">
                {recovery === 'outstanding' ? 'Still to recover' : 'Paid in this selection'}
              </p>
              <Money value={total} className="text-lg font-bold" />
            </div>
          )}
          {abilities.create && (
            <Button size="sm" className="h-11 md:h-9" onClick={() => setCreating(true)}>
              <HandCoins className="h-3.5 w-3.5" />
              New advance
            </Button>
          )}
        </div>
      </FilterBar>

      <DataTable columns={columns} data={rows} loading={isLoading} searchPlaceholder="Search by employee…" />

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>New advance payment</DialogTitle>
          </DialogHeader>
          <EmployeeAdvanceForm onSuccess={() => setCreating(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit {editing?.advanceNo}</DialogTitle>
          </DialogHeader>
          {editing && <EmployeeAdvanceForm advance={editing} onSuccess={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewing?.advanceNo}</DialogTitle>
          </DialogHeader>
          {viewing && <AdvanceDetail advance={viewing} onClose={() => setViewing(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AdvanceDetail({ advance, onClose }: { advance: EmployeeAdvance; onClose: () => void }) {
  const posted = ['posted', 'locked'].includes(advance.status);

  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div>
          <p className="text-xs text-muted-foreground">Status</p>
          <StatusBadge status={advance.status} />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Date</p>
          <p className="font-medium tabular-nums">{advance.businessDate}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Employee</p>
          <p className="font-medium">{advance.employeeName}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Department</p>
          <p className="font-medium">{advance.department} · {advance.designation}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Payment Method</p>
          <p className="font-medium">
            {FINANCE_PAYMENT_METHOD_LABELS[advance.paymentMethod] ?? advance.paymentMethod}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Paid From</p>
          <p className="font-medium">{FINANCE_ACCOUNT_LABELS[advance.account]}</p>
        </div>
      </div>

      <dl className="space-y-1.5">
        <div className="flex items-baseline justify-between text-muted-foreground">
          <dt>Advance</dt>
          <dd><Money value={advance.advanceAmount} blankZero /></dd>
        </div>
        <div className="flex items-baseline justify-between text-muted-foreground">
          <dt>Bonus</dt>
          <dd><Money value={advance.bonusAmount} blankZero className="text-emerald-600 dark:text-emerald-400" /></dd>
        </div>
        <div className="flex items-baseline justify-between text-muted-foreground">
          <dt>Loan</dt>
          <dd><Money value={advance.loanAmount} blankZero /></dd>
        </div>
        <div className="flex items-baseline justify-between border-t pt-1.5 font-semibold">
          <dt>Paid</dt>
          <dd><Money value={advance.totalAmount} /></dd>
        </div>
      </dl>

      <div className="rounded-lg border p-3">
        <p className="text-xs text-muted-foreground">Recovery</p>
        {advance.isRecovered ? (
          <p className="font-medium">
            Deducted on {advance.recoveredBySalaryNo}
            {advance.recoveredAt ? '' : ' — that payslip has not posted yet'}
          </p>
        ) : posted ? (
          <p className="font-medium">Outstanding — the next payslip deducts it.</p>
        ) : (
          <p className="font-medium text-muted-foreground">Nothing to recover until this is approved.</p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div>
          <p className="text-xs text-muted-foreground">Created By</p>
          <p className="font-medium">{advance.createdByName ?? '—'}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Approved By</p>
          <p className="font-medium">{advance.approvedByName ?? '—'}</p>
        </div>
        {advance.status === 'rejected' && advance.rejectionReason && (
          <div className="col-span-2">
            <p className="text-xs text-muted-foreground">Rejection Reason</p>
            <p className="font-medium whitespace-pre-wrap break-words">{advance.rejectionReason}</p>
          </div>
        )}
        {advance.notes?.trim() && (
          <div className="col-span-2">
            <p className="text-xs text-muted-foreground">Notes</p>
            <p className="font-medium whitespace-pre-wrap break-words">{advance.notes.trim()}</p>
          </div>
        )}
        <div className="col-span-2">
          <p className="text-xs text-muted-foreground">Photo</p>
          <AttachmentGallery
            attachments={advance.attachments}
            title={`${advance.advanceNo} handover`}
            emptyText="No photo was captured with this advance."
            className="mt-1"
          />
        </div>
      </div>

      <Button variant="outline" className="w-full" onClick={onClose}>
        Close
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------

function EmployeesTab({ abilities }: { abilities: ReturnType<typeof useFinanceAbilities> }) {
  const [includeInactive, setIncludeInactive] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<FinanceEmployee | null>(null);
  const [revising, setRevising] = useState<FinanceEmployee | null>(null);
  const [viewingEmployee, setViewingEmployee] = useState<FinanceEmployee | null>(null);

  const { data, isLoading } = useFinanceEmployees(includeInactive);
  const mut = useFinanceMutation();

  async function toggleActive(employee: FinanceEmployee) {
    try {
      await mut.mutateAsync({
        path: `/api/finance/payroll/employees/${employee.id}`,
        method: 'PUT',
        body: { isActive: !employee.isActive },
      });
      toast.success(employee.isActive ? `${employee.name} deactivated` : `${employee.name} reactivated`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update this employee');
    }
  }

  const columns = [
    employeeCol.accessor('employeeCode', {
      header: 'Code',
      meta: { mobile: 'subtitle' },
      cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue()}</span>,
    }),
    employeeCol.accessor('name', {
      header: 'Name',
      meta: { mobile: 'title' },
      cell: (i) => <span className="font-medium">{i.getValue()}</span>,
    }),
    employeeCol.accessor('department', { header: 'Department', cell: (i) => <span className="text-sm">{i.getValue()}</span> }),
    employeeCol.accessor('designation', { header: 'Designation', cell: (i) => <span className="text-sm text-muted-foreground">{i.getValue()}</span> }),
    employeeCol.accessor('branchName', {
      header: 'Branch',
      cell: (i) => <span className="text-sm text-muted-foreground">{i.getValue() ?? 'Head office'}</span>,
    }),
    employeeCol.accessor('baseSalary', {
      header: 'Base Salary',
      cell: (i) => (
        <span>
          <Money value={i.getValue()} />
          {i.row.original.pendingRevision && (
            <span className="ml-1.5 text-xs text-amber-600 dark:text-amber-400">
              → {i.row.original.pendingRevision.effectiveFrom}
            </span>
          )}
        </span>
      ),
    }),
    employeeCol.accessor('phone', {
      header: 'Phone',
      cell: (i) => <span className="text-sm text-muted-foreground">{i.getValue() ?? '—'}</span>,
    }),
    employeeCol.accessor('isActive', {
      header: 'Active',
      meta: { mobile: 'badge' },
      cell: (i) =>
        i.getValue() ? (
          <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            Active
          </Badge>
        ) : (
          <Badge variant="secondary">Inactive</Badge>
        ),
    }),
    employeeCol.display({
      id: 'actions',
      header: '',
      cell: (i) => {
        const row = i.row.original;
        return (
          <div className="flex items-center justify-end gap-1">
            <Button variant="ghost" size="icon-sm" aria-label="View" onClick={() => setViewingEmployee(row)}>
              <Eye className="h-3.5 w-3.5" />
            </Button>
            {abilities.configure && (
              <>
                {row.isActive && (
                  <Button variant="ghost" size="icon-sm" aria-label="Revise salary" onClick={() => setRevising(row)}>
                    <TrendingUp className="h-3.5 w-3.5" />
                  </Button>
                )}
                <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => setEditing(row)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="sm" disabled={mut.isPending} onClick={() => void toggleActive(row)}>
                  {row.isActive ? 'Deactivate' : 'Reactivate'}
                </Button>
              </>
            )}
          </div>
        );
      },
    }),
  ];

  return (
    <div className="space-y-4">
      <FilterBar>
        <FilterField label="Show">
          <FilterSelect
            value={includeInactive ? 'all' : 'active'}
            onChange={(v) => setIncludeInactive(v === 'all')}
            allLabel="Active only"
            options={[
              { value: 'active', label: 'Active only' },
              { value: 'all', label: 'Including inactive' },
            ]}
          />
        </FilterField>
        {abilities.configure && (
          <Button size="sm" className="ml-auto h-11 md:h-9" onClick={() => setCreating(true)}>
            <UserPlus className="h-3.5 w-3.5" />
            Add employee
          </Button>
        )}
      </FilterBar>

      <DataTable columns={columns} data={data ?? []} loading={isLoading} searchPlaceholder="Search employees…" />

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>Add employee</DialogTitle>
          </DialogHeader>
          <EmployeeForm onSuccess={() => setCreating(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit {editing?.name}</DialogTitle>
          </DialogHeader>
          {editing && <EmployeeForm employee={editing} onSuccess={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={revising !== null} onOpenChange={(open) => !open && setRevising(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>Revise salary — {revising?.name}</DialogTitle>
          </DialogHeader>
          {revising && <SalaryRevisionForm employee={revising} onSuccess={() => setRevising(null)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={viewingEmployee !== null} onOpenChange={(open) => !open && setViewingEmployee(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto md:max-w-lg">
          <DialogHeader>
            <DialogTitle>{viewingEmployee?.name}</DialogTitle>
          </DialogHeader>
          {viewingEmployee && <EmployeeDetail employee={viewingEmployee} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmployeeDetail({ employee }: { employee: FinanceEmployee }) {
  const revisionsQ = useSalaryRevisions(employee.id);
  const revisions = revisionsQ.data ?? [];

  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <div>
          <p className="text-xs text-muted-foreground">Code</p>
          <p className="font-mono font-medium">{employee.employeeCode}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Department</p>
          <p className="font-medium">{employee.department} · {employee.designation}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Branch</p>
          <p className="font-medium">{employee.branchName ?? 'Head office'}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Phone</p>
          <p className="font-medium">{employee.phone ?? '—'}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Current Salary</p>
          <Money value={employee.baseSalary} className="font-semibold" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Joined On</p>
          <p className="font-medium">{employee.joinedOn ?? '—'}</p>
        </div>
      </div>

      {employee.pendingRevision && (
        <div className="space-y-0.5 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-800 dark:text-amber-300">
            Scheduled change
          </p>
          <p>
            <Money value={employee.pendingRevision.newSalary} className="font-semibold" /> effective{' '}
            {employee.pendingRevision.effectiveFrom}
          </p>
          <p className="text-xs text-muted-foreground">{employee.pendingRevision.reason}</p>
        </div>
      )}

      <div>
        <p className="mb-1.5 text-xs font-medium text-muted-foreground">Salary history</p>
        {revisionsQ.isLoading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : revisions.length === 0 ? (
          <p className="text-xs text-muted-foreground">No revisions recorded yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {revisions.map((r) => (
              <li key={r.id} className="space-y-0.5 p-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium">
                    <Money value={r.previousSalary} className="text-muted-foreground line-through" />{' '}
                    <Money value={r.newSalary} className="font-semibold" />
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{r.effectiveFrom}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {r.reason} · {r.changedByName}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
