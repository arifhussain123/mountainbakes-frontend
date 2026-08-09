'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { createColumnHelper } from '@tanstack/react-table';
import {
  EDITABLE_DOC_STATUSES,
  FINANCE_ACCOUNT_LABELS,
  FINANCE_PAYMENT_METHOD_LABELS,
  type FinanceEmployee,
  type SalaryPayment,
} from '@mb/shared';
import { useFinanceEmployees, useFinanceMutation, useSalaryPayments, useSalaryRevisions } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable } from '@/components/shared/DataTable';
import { FinancePageHeader, Money, ReadOnlyNotice, StatusBadge, useFinanceAbilities } from './finance-ui';
import { DocumentActions, FilterBar, FilterField, FilterSelect } from './finance-actions';
import { EmployeeForm, SalaryForm, SalaryRevisionForm } from './SalaryForms';
import { Eye, Pencil, Plus, TrendingUp, UserPlus } from 'lucide-react';

/**
 * The salary ledger and the payroll master behind it, on two tabs.
 *
 * They are one screen because they are one job: nobody manages an employee
 * record except in the course of paying them. Splitting the master onto its own
 * nav item would add a twelfth finance page that gets opened once a quarter.
 *
 * A payslip walks the same approval path as every other document — approval is
 * what posts the payment to the ledger under the Salaries head.
 */

const salaryCol = createColumnHelper<SalaryPayment>();
const employeeCol = createColumnHelper<FinanceEmployee>();
const BASE_PATH = '/api/finance/payroll/salaries';

export function SalaryLedgerPage() {
  const abilities = useFinanceAbilities();

  return (
    <div className="space-y-6">
      <FinancePageHeader
        title="Salary Ledger"
        description="Payslips and the payroll master. An approved payslip posts to the ledger as a salary payment."
      />

      <ReadOnlyNotice abilities={abilities} />

      <Tabs defaultValue="salaries">
        <TabsList>
          <TabsTrigger value="salaries">Salaries</TabsTrigger>
          <TabsTrigger value="employees">Employees</TabsTrigger>
        </TabsList>

        <TabsContent value="salaries" className="mt-4">
          <SalariesTab abilities={abilities} />
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
          {viewing && (
            <div className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <StatusBadge status={viewing.status} />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Salary Month</p>
                  <p className="font-medium tabular-nums">{viewing.salaryMonth}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Employee</p>
                  <p className="font-medium">{viewing.employeeName}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Department</p>
                  <p className="font-medium">{viewing.department} · {viewing.designation}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Payment Date</p>
                  <p className="font-medium">{viewing.paymentDate ?? '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Payment Method</p>
                  <p className="font-medium">{FINANCE_PAYMENT_METHOD_LABELS[viewing.paymentMethod] ?? viewing.paymentMethod}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Account</p>
                  <p className="font-medium">{FINANCE_ACCOUNT_LABELS[viewing.account]}</p>
                </div>
              </div>

              <dl className="space-y-1.5">
                <div className="flex items-baseline justify-between text-muted-foreground">
                  <dt>Salary</dt>
                  <dd><Money value={viewing.grossSalary} /></dd>
                </div>
                <div className="flex items-baseline justify-between text-muted-foreground">
                  <dt>Bonus</dt>
                  <dd><Money value={viewing.bonus} blankZero className="text-emerald-600 dark:text-emerald-400" /></dd>
                </div>
                <div className="flex items-baseline justify-between text-muted-foreground">
                  <dt>Deduction</dt>
                  <dd><Money value={viewing.deductions} blankZero className="text-red-600 dark:text-red-400" /></dd>
                </div>
                <div className="flex items-baseline justify-between border-t pt-1.5 font-semibold">
                  <dt>Net Salary</dt>
                  <dd><Money value={viewing.netSalary} /></dd>
                </div>
              </dl>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
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
