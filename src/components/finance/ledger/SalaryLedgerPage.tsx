'use client';

import { useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  FINANCE_PAYMENT_METHOD_LABELS,
  type EmployeeResignation,
  type FinanceEmployee,
  type LedgerCell,
  type PageSize,
  type SalaryLedgerPayment,
  type SalaryLedgerSort,
  type SalaryLedgerStatusFilter,
} from '@mb/shared';
import {
  useEmployeeProfile,
  useFinanceEmployees,
  useFinanceMutation,
  useSalaryLedger,
  useSalaryLedgerPayments,
} from '@/lib/finance';
import { useDebounce } from '@/hooks/useDebounce';
import { ROUTES } from '@/utils/routes';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Pagination } from '@/components/data-engine/Pagination';
import { PrintButton } from '@/components/shared/PrintButton';
import { useFinanceAbilities, type FinanceAbilities } from '../finance-ui';
import { ResignationDialog } from './ResignationDialog';
import {
  LedgerControls,
  LedgerEmpty,
  LedgerError,
  LedgerGrid,
  LedgerHeader,
  LedgerLegend,
  LedgerSearch,
  LedgerSelect,
  LedgerSheet,
  LedgerSkeleton,
  niceDate,
  niceDateTime,
  periodLabel,
  SheetFields,
  SheetLoading,
  SheetNote,
  SheetTotal,
  SourceBadge,
  SourceItem,
  SummaryCards,
  useLedgerFormat,
  YearPicker,
  type LedgerGridRow,
} from './ledger-ui';

/**
 * Salary Ledger — approved salary, per employee, per month, for one year.
 *
 * READ-ONLY, and not by leaving buttons out: the API behind it has no write.
 * A figure is here because a payslip was approved on the Payroll page, and it
 * changes only when that payslip does. Nothing on this page can add an
 * employee, type an amount, edit a month or approve anything.
 *
 * The one action it carries is recording a resignation — which changes no
 * figure. It is a fact about the employee, it goes through its own endpoint
 * with its own permission, and what it does to the ledger is close the months
 * after it.
 */

type Selection = { kind: 'cell'; employeeId: string; year: number; month: number } | { kind: 'employee'; employeeId: string };

const STATUS_OPTIONS: { value: SalaryLedgerStatusFilter; label: string }[] = [
  { value: 'all', label: 'All employees' },
  { value: 'active', label: 'Active' },
  { value: 'resigned', label: 'Resigned' },
  { value: 'unpaid', label: 'Has unpaid months' },
  { value: 'pending', label: 'Has pending approval' },
];

const SORT_OPTIONS: { value: SalaryLedgerSort; label: string }[] = [
  { value: 'code', label: 'Employee code' },
  { value: 'name', label: 'Employee name' },
  { value: 'total', label: 'Year total' },
];

export function SalaryLedgerPage() {
  const abilities = useFinanceAbilities();
  const fmt = useLedgerFormat();

  const [year, setYear] = useState<number | null>(null);
  const [tab, setTab] = useState('ledger');
  const [department, setDepartment] = useState('all');
  const [status, setStatus] = useState<SalaryLedgerStatusFilter>('all');
  const [sort, setSort] = useState<SalaryLedgerSort>('code');
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [resigning, setResigning] = useState<{ employeeId: string | null } | null>(null);

  const search = useDebounce(searchText.trim(), 300);
  const filtered = Boolean(search) || department !== 'all' || status !== 'all';

  const ledgerQ = useSalaryLedger({
    year: year ?? undefined,
    search: search || undefined,
    department: department === 'all' ? undefined : department,
    status,
    sort,
    page,
    pageSize,
  });
  const ledger = ledgerQ.data;
  // Until a year is picked the server decides (the current business year).
  const shownYear = year ?? ledger?.year ?? null;

  const reset = <T,>(set: (value: T) => void) => (value: T) => {
    set(value);
    setPage(1);
  };
  const canResign = abilities.configure;

  const rows: LedgerGridRow[] = (ledger?.rows ?? []).map((r) => ({
    id: r.employeeId,
    code: r.employeeCode,
    name: r.employeeName,
    sub: r.resignation
      ? `Resigned · ${niceDate(r.resignation.resignationDate)}`
      : `${r.department}${r.designation ? ` · ${r.designation}` : ''}${r.isActive ? '' : ' · Inactive'}`,
    subTone: r.resignation ? 'danger' : 'muted',
    cells: r.cells,
    total: r.total,
  }));

  const s = ledger?.summary;
  const cards = [
    {
      label: 'Total approved salary',
      value: s ? fmt.money(s.totalApproved) : '—',
      note: s ? `${s.paymentCount} approved payment${s.paymentCount === 1 ? '' : 's'} in ${shownYear}` : ' ',
    },
    {
      label: 'Employees on ledger',
      value: s ? String(s.employees) : '—',
      note: s ? `${s.activeEmployees} active · ${s.resignedEmployees} resigned` : ' ',
    },
    {
      label: 'Unpaid employee-months',
      value: s ? String(s.unpaidEmployeeMonths) : '—',
      note: 'Eligible months with no approved salary',
    },
    {
      label: 'Flagged for review',
      value: s ? String(s.flaggedMonths) : '—',
      note: s && s.flaggedMonths > 0 ? 'Approved after resignation date' : 'No conflicts',
      tone: s && s.flaggedMonths > 0 ? ('warning' as const) : ('default' as const),
    },
  ];

  return (
    <div className="print-area space-y-5">
      <LedgerHeader
        title="Salary Ledger"
        year={shownYear}
        description="Approved salary per employee and month, read from approved payslips. Payslips are raised and approved in Payroll."
        actions={
          <>
            <PrintButton variant="outline" size="sm" buttonClassName="h-11 md:h-9" showMenu={false} />
            {canResign && (
              <Button
                variant="outline"
                size="sm"
                className="h-11 hover:border-red-600 hover:text-red-700 md:h-9"
                onClick={() => setResigning({ employeeId: null })}
              >
                Resignation
              </Button>
            )}
          </>
        }
      />

      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList className="no-print">
          <TabsTrigger value="ledger">Annual ledger</TabsTrigger>
          <TabsTrigger value="payslips">Source payslips</TabsTrigger>
          <TabsTrigger value="employees">Employees</TabsTrigger>
        </TabsList>

        <TabsContent value="ledger" className="mt-4 space-y-4">
          <SummaryCards cards={cards} loading={ledgerQ.isLoading} />

          <LedgerControls>
            {shownYear !== null && (
              <YearPicker year={shownYear} years={ledger?.years ?? []} onChange={reset(setYear)} />
            )}
            <LedgerSelect
              id="ledger-department"
              label="Department"
              value={department}
              onChange={reset(setDepartment)}
              options={[
                { value: 'all', label: 'All departments' },
                ...(ledger?.departments ?? []).map((d) => ({ value: d, label: d })),
              ]}
            />
            <LedgerSelect id="ledger-status" label="Status" value={status} onChange={reset(setStatus)} options={STATUS_OPTIONS} />
            <LedgerSelect id="ledger-sort" label="Sort" value={sort} onChange={reset(setSort)} options={SORT_OPTIONS} />
            <LedgerSearch value={searchText} onChange={reset(setSearchText)} placeholder="Search by code or name…" />
          </LedgerControls>

          <LedgerLegend salary symbol={fmt.symbol} />

          {ledgerQ.isLoading ? (
            <LedgerSkeleton />
          ) : ledgerQ.isError || !ledger ? (
            <LedgerError
              message={ledgerQ.error instanceof Error ? ledgerQ.error.message : 'Check the connection and try again.'}
              onRetry={() => void ledgerQ.refetch()}
            />
          ) : rows.length === 0 ? (
            <LedgerEmpty
              title={filtered ? 'No results match these filters' : `No approved records for ${ledger.year}`}
              body={
                filtered
                  ? 'Clear the search or change the filters.'
                  : `Nothing has been approved for ${ledger.year} yet. Amounts appear here automatically once a payslip for this year is approved.`
              }
            />
          ) : (
            <>
              <LedgerGrid
                idHead="Employee Code"
                nameHead="Employee Name"
                year={ledger.year}
                rows={rows}
                monthTotals={ledger.monthTotals}
                yearTotal={ledger.yearTotal}
                cellNote={(cell: LedgerCell) => (cell.count > 1 ? `${cell.count} payments` : null)}
                onOpenRow={(employeeId) => setSelection({ kind: 'employee', employeeId })}
                onOpenCell={(employeeId, month) => setSelection({ kind: 'cell', employeeId, year: ledger.year, month })}
                stale={ledgerQ.isPlaceholderData}
              />
              <Pagination
                className="no-print"
                page={ledger.page}
                pageSize={ledger.pageSize}
                total={ledger.total}
                onPageChange={setPage}
                onPageSizeChange={reset(setPageSize)}
                loading={ledgerQ.isFetching}
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="payslips" className="mt-4 space-y-4">
          {shownYear !== null && (
            <SourcePayslips
              year={shownYear}
              years={ledger?.years ?? []}
              onYearChange={reset(setYear)}
              onOpen={(p) => setSelection({ kind: 'cell', employeeId: p.employeeId, year: p.year, month: p.month })}
            />
          )}
        </TabsContent>

        <TabsContent value="employees" className="mt-4">
          <EmployeeRoster
            canResign={canResign}
            onView={(employeeId) => setSelection({ kind: 'employee', employeeId })}
            onResign={(employeeId) => setResigning({ employeeId })}
          />
        </TabsContent>
      </Tabs>

      <CellSheet
        selection={selection?.kind === 'cell' ? selection : null}
        onClose={() => setSelection(null)}
      />
      <EmployeeSheet
        employeeId={selection?.kind === 'employee' ? selection.employeeId : null}
        abilities={abilities}
        onClose={() => setSelection(null)}
        onResign={(employeeId) => {
          setSelection(null);
          setResigning({ employeeId });
        }}
      />
      <ResignationDialog
        open={resigning !== null}
        employeeId={resigning?.employeeId}
        onOpenChange={(open) => !open && setResigning(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Source payslips — every payslip of the year, counted or not
// ---------------------------------------------------------------------------

function SourcePayslips({
  year,
  years,
  onYearChange,
  onOpen,
}: {
  year: number;
  years: { year: number; hasRecords: boolean }[];
  onYearChange: (year: number) => void;
  onOpen: (payment: SalaryLedgerPayment) => void;
}) {
  const fmt = useLedgerFormat();
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(20);
  const search = useDebounce(searchText.trim(), 300);

  const query = useSalaryLedgerPayments({
    year,
    search: search || undefined,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  const payments = query.data?.payments ?? [];

  return (
    <>
      <LedgerControls>
        <YearPicker
          year={year}
          years={years}
          onChange={(y) => {
            onYearChange(y);
            setPage(1);
          }}
        />
        <LedgerSearch
          value={searchText}
          onChange={(v) => {
            setSearchText(v);
            setPage(1);
          }}
          placeholder="Search by payslip, code or name…"
        />
      </LedgerControls>

      {query.isLoading ? (
        <LedgerSkeleton />
      ) : query.isError ? (
        <LedgerError
          message={query.error instanceof Error ? query.error.message : 'Check the connection and try again.'}
          onRetry={() => void query.refetch()}
        />
      ) : payments.length === 0 ? (
        <LedgerEmpty
          title={search ? 'No payslips match this search' : `No payslips for ${year}`}
          body={search ? 'Clear the search to see every payslip of the year.' : 'Payslips are raised and approved in Payroll.'}
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
            <table className="w-full text-sm tabular-nums">
              <thead data-table-head className="text-left">
                <tr>
                  {['Payslip No', 'Employee', 'Month', 'Salary', 'Bonus', 'Deduction', 'Net Salary', 'Payment Date', 'Status'].map((h) => (
                    <th key={h} scope="col" className="px-3 py-3 font-semibold whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr
                    key={p.id}
                    tabIndex={0}
                    onClick={() => onOpen(p)}
                    onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onOpen(p)}
                    className="cursor-pointer border-t outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
                  >
                    <td className="px-3 py-3 font-mono text-xs whitespace-nowrap text-muted-foreground">{p.salaryNo}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      <span className="font-medium">{p.employeeName}</span>{' '}
                      <span className="font-mono text-xs text-muted-foreground">{p.employeeCode}</span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">{p.salaryMonth}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{fmt.money(p.grossSalary)}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{p.bonus ? fmt.money(p.bonus) : '—'}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{p.deductions ? fmt.money(p.deductions) : '—'}</td>
                    <td className="px-3 py-3 font-semibold whitespace-nowrap">{fmt.money(p.netSalary)}</td>
                    <td className="px-3 py-3 whitespace-nowrap">{niceDate(p.paymentDate)}</td>
                    <td className="px-3 py-3">
                      <SourceBadge exclusion={p.exclusion} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="space-y-2 md:hidden">
            {payments.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onOpen(p)}
                  className="flex w-full flex-col gap-1 rounded-xl border bg-card p-3 text-left"
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{p.employeeName}</span>
                    <SourceBadge exclusion={p.exclusion} />
                  </span>
                  <span className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-mono text-xs text-muted-foreground">
                      {p.salaryNo} · {p.salaryMonth}
                    </span>
                    <span className="font-semibold tabular-nums">{fmt.money(p.netSalary)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          <Pagination
            page={page}
            pageSize={pageSize}
            total={query.data?.total ?? 0}
            onPageChange={setPage}
            onPageSizeChange={(n) => {
              setPageSize(n);
              setPage(1);
            }}
            loading={query.isFetching}
          />
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Employees — the roster, to look at and to record a resignation from
// ---------------------------------------------------------------------------

function EmployeeRoster({
  canResign,
  onView,
  onResign,
}: {
  canResign: boolean;
  onView: (employeeId: string) => void;
  onResign: (employeeId: string) => void;
}) {
  const query = useFinanceEmployees(true);
  const employees = [...(query.data ?? [])].sort((a, b) =>
    a.employeeCode.localeCompare(b.employeeCode, undefined, { numeric: true }),
  );

  if (query.isLoading) return <LedgerSkeleton />;
  if (query.isError) {
    return (
      <LedgerError
        message={query.error instanceof Error ? query.error.message : 'Check the connection and try again.'}
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (employees.length === 0) {
    return <LedgerEmpty title="No employees on the payroll" body="Employees are added in Payroll, under Employees." />;
  }

  const actions = (e: FinanceEmployee) => (
    <div className="flex justify-end gap-2">
      <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={() => onView(e.id)}>
        View details
      </Button>
      {canResign && !e.resignation && e.isActive && (
        <Button
          variant="outline"
          size="sm"
          className="h-11 font-semibold text-red-700 hover:border-red-600 hover:text-red-700 md:h-8 dark:text-red-400"
          onClick={() => onResign(e.id)}
        >
          Resignation
        </Button>
      )}
    </div>
  );

  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
        <table className="w-full text-sm">
          <thead data-table-head className="text-left">
            <tr>
              {['Code', 'Employee', 'Department', 'Designation', 'Joined', 'Status'].map((h) => (
                <th key={h} scope="col" className="px-3 py-3 font-semibold whitespace-nowrap">
                  {h}
                </th>
              ))}
              <th scope="col" className="px-3 py-3 text-right font-semibold">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id} className="border-t">
                <td className="px-3 py-3 font-mono text-xs whitespace-nowrap text-muted-foreground">{e.employeeCode}</td>
                <td className="px-3 py-3 font-semibold whitespace-nowrap">{e.name}</td>
                <td className="px-3 py-3">{e.department}</td>
                <td className="px-3 py-3 text-muted-foreground">{e.designation}</td>
                <td className="px-3 py-3 whitespace-nowrap">{niceDate(e.joinedOn)}</td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <EmploymentBadge employee={e} />
                </td>
                <td className="px-3 py-3">{actions(e)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-2 md:hidden">
        {employees.map((e) => (
          <li key={e.id} className="space-y-2.5 rounded-xl border bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold">{e.name}</p>
                <p className="font-mono text-xs text-muted-foreground">{e.employeeCode}</p>
                <p className="text-xs text-muted-foreground">
                  {e.department} · {e.designation} · Joined {niceDate(e.joinedOn)}
                </p>
              </div>
              <EmploymentBadge employee={e} />
            </div>
            {actions(e)}
          </li>
        ))}
      </ul>
    </>
  );
}

function EmploymentBadge({ employee }: { employee: FinanceEmployee }) {
  if (employee.resignation) {
    return (
      <span className="inline-block rounded bg-red-100 px-2 py-0.5 text-xs font-semibold whitespace-nowrap text-red-800 dark:bg-red-950 dark:text-red-300">
        Resigned · {niceDate(employee.resignation.resignationDate)}
      </span>
    );
  }
  return employee.isActive ? (
    <span className="inline-block rounded bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
      Active
    </span>
  ) : (
    <span className="inline-block rounded bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground">Inactive</span>
  );
}

// ---------------------------------------------------------------------------
// Drawers
// ---------------------------------------------------------------------------

function ResignationBlock({ resignation }: { resignation: EmployeeResignation }) {
  const [y, m] = resignation.resignationDate.split('-').map(Number) as [number, number];
  return (
    <SheetNote tone="danger">
      <p className="font-bold">
        Resigned {niceDate(resignation.resignationDate)} at {resignation.resignationTime} PKT
      </p>
      <p className="mt-1 text-foreground/90">
        Reason: {resignation.reason}
        {resignation.remarks ? ` — ${resignation.remarks}` : ''}
      </p>
      <p className="mt-1 text-muted-foreground">
        Recorded by {resignation.submittedByName || 'unknown'} · {niceDateTime(resignation.createdAt)} PKT
      </p>
      <p className="text-muted-foreground">Ordinary salary is closed after {periodLabel(y, m)}.</p>
    </SheetNote>
  );
}

function usePayslipLines() {
  const fmt = useLedgerFormat();
  return (p: SalaryLedgerPayment): (string | null | false)[] => [
    `Salary ${fmt.money(p.grossSalary)}`,
    p.bonus > 0 && `Bonus ${fmt.money(p.bonus)}`,
    p.deductions > 0 && `Deduction ${fmt.money(p.deductions)}`,
    FINANCE_PAYMENT_METHOD_LABELS[p.paymentMethod] ?? p.paymentMethod,
    p.voucherNo && `Voucher ${p.voucherNo}`,
    p.paymentDate && `Paid ${niceDate(p.paymentDate)}`,
    `Created by ${p.createdByName ?? 'unknown'} · ${niceDateTime(p.createdAt)}`,
    p.status === 'rejected'
      ? `Rejected by ${p.approvedByName ?? 'unknown'} · ${niceDateTime(p.approvedAt)}${p.rejectionReason ? ` — ${p.rejectionReason}` : ''}`
      : p.approvedByName && `Approved by ${p.approvedByName} · ${niceDateTime(p.approvedAt)}`,
    p.counted && p.countedAmount !== p.netSalary && `Voucher amended to ${fmt.money(p.countedAmount)}`,
    p.exclusion === 'voucher_removed' && 'Its voucher was removed from the Daily Ledger',
    p.notes?.trim() || null,
  ];
}

/** One employee, one month: the approved figure and every payslip behind or beside it. */
function CellSheet({
  selection,
  onClose,
}: {
  selection: { employeeId: string; year: number; month: number } | null;
  onClose: () => void;
}) {
  const fmt = useLedgerFormat();
  const lines = usePayslipLines();
  const profileQ = useEmployeeProfile(selection?.employeeId ?? null);
  const paymentsQ = useSalaryLedgerPayments(
    selection ? { employeeId: selection.employeeId, year: selection.year, month: selection.month, limit: 100 } : null,
  );

  const employee = profileQ.data?.employee;
  const data = paymentsQ.data;
  const period = selection ? periodLabel(selection.year, selection.month) : '';
  const periodKey = selection ? `${selection.year}-${String(selection.month).padStart(2, '0')}` : '';
  const resignation = employee?.resignation ?? null;
  const closed = Boolean(resignation && periodKey > resignation.resignationDate.slice(0, 7));
  const beforeJoining = Boolean(employee?.joinedOn && periodKey < employee.joinedOn.slice(0, 7));
  const conflict = (data?.payments ?? []).some((p) => p.counted && p.afterResignation);

  return (
    <LedgerSheet
      open={selection !== null}
      onClose={onClose}
      kicker={employee ? `${employee.employeeCode} · ${employee.department}` : ' '}
      title={employee?.name ?? 'Salary detail'}
      sub={period}
    >
      {profileQ.isLoading || paymentsQ.isLoading ? (
        <SheetLoading />
      ) : profileQ.isError || paymentsQ.isError || !employee || !data ? (
        <SheetNote tone="danger">These records could not be loaded. Close this panel and try again.</SheetNote>
      ) : (
        <>
          <SheetTotal
            value={fmt.money(data.countedTotal)}
            note={
              data.countedCount > 0
                ? `Approved · ${data.countedCount} payment${data.countedCount > 1 ? 's' : ''}`
                : 'No approved salary'
            }
          />
          {resignation && <ResignationBlock resignation={resignation} />}
          {conflict && resignation && (
            <SheetNote tone="warning">
              Approved after the resignation month ({niceDate(resignation.resignationDate)}). The payment is kept as it
              is and flagged for authorized review.
            </SheetNote>
          )}
          {data.payments.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[13px] font-bold text-foreground/80">Payment records</p>
              <ul className="space-y-2">
                {data.payments.map((p) => (
                  <SourceItem
                    key={p.id}
                    reference={p.salaryNo}
                    exclusion={p.exclusion}
                    amount={fmt.money(p.netSalary)}
                    lines={lines(p)}
                  />
                ))}
              </ul>
            </div>
          ) : (
            <SheetNote tone="info">
              {closed && resignation ? (
                <>
                  Closed: {employee.name} resigned on {niceDate(resignation.resignationDate)}. No ordinary salary is
                  recorded after the resignation month.
                </>
              ) : beforeJoining ? (
                <>
                  {employee.name} joined on {niceDate(employee.joinedOn)}, after this month.
                </>
              ) : (
                <>
                  No approved salary for {period}. Payslips are raised and approved in{' '}
                  <Link href={ROUTES.FINANCE_PAYROLL} className="font-semibold text-primary hover:underline">
                    Payroll
                  </Link>
                  .
                </>
              )}
            </SheetNote>
          )}
        </>
      )}
    </LedgerSheet>
  );
}

/** One employee: who they are on record, their resignation if any, and every payslip they have. */
function EmployeeSheet({
  employeeId,
  abilities,
  onClose,
  onResign,
}: {
  employeeId: string | null;
  abilities: FinanceAbilities;
  onClose: () => void;
  onResign: (employeeId: string) => void;
}) {
  const fmt = useLedgerFormat();
  const lines = usePayslipLines();
  const profileQ = useEmployeeProfile(employeeId);
  const paymentsQ = useSalaryLedgerPayments(employeeId ? { employeeId, limit: 500 } : null);

  const profile = profileQ.data;
  const employee = profile?.employee;
  const resignation = employee?.resignation ?? null;
  const cancelled = (profile?.resignations ?? []).filter((r) => r.status === 'cancelled');
  const statusLabel = resignation ? 'Resigned' : employee?.isActive ? 'Active' : 'Inactive';

  return (
    <LedgerSheet
      open={employeeId !== null}
      onClose={onClose}
      kicker={employee?.employeeCode ?? ' '}
      title={employee?.name ?? 'Employee'}
      sub={employee ? statusLabel : ' '}
    >
      {profileQ.isLoading ? (
        <SheetLoading />
      ) : profileQ.isError || !employee || !profile ? (
        <SheetNote tone="danger">This employee&apos;s record could not be loaded. Close this panel and try again.</SheetNote>
      ) : (
        <>
          <SheetTotal value={fmt.money(profile.allTimeApproved)} note="All-time approved salary" />

          {resignation && <ResignationBlock resignation={resignation} />}
          {resignation && abilities.configure && <CancelResignation employee={employee} />}

          <SheetFields
            fields={[
              ['Employee code', <span key="c" className="font-mono">{employee.employeeCode}</span>],
              ['Department', employee.department],
              ['Designation', employee.designation],
              ['Branch', employee.branchName ?? 'Head office'],
              ['Joining date', employee.joinedOn ? niceDate(employee.joinedOn) : 'Not on file'],
              ['Employment status', statusLabel],
              ['Current salary rate', fmt.money(employee.baseSalary)],
              ['Contact', employee.phone || 'Not on file'],
            ]}
          />

          {cancelled.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[13px] font-bold text-foreground/80">Cancelled resignations</p>
              <ul className="space-y-1.5">
                {cancelled.map((r) => (
                  <li key={r.id} className="rounded-lg border px-3 py-2 text-[12.5px] text-muted-foreground">
                    <span className="font-semibold text-foreground/80 line-through">
                      {niceDate(r.resignationDate)} · {r.reason}
                    </span>
                    <br />
                    Recorded by {r.submittedByName} · {niceDateTime(r.createdAt)}. Cancelled by {r.cancelledByName} ·{' '}
                    {niceDateTime(r.cancelledAt)} — {r.cancelReason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-[13px] font-bold text-foreground/80">Salary history</p>
            {paymentsQ.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : paymentsQ.isError ? (
              <SheetNote tone="danger">The salary history could not be loaded.</SheetNote>
            ) : (paymentsQ.data?.payments.length ?? 0) === 0 ? (
              <SheetNote tone="info">No payslips on record for this employee.</SheetNote>
            ) : (
              <ul className="space-y-2">
                {paymentsQ.data!.payments.map((p) => (
                  <SourceItem
                    key={p.id}
                    reference={`${p.salaryNo} · ${periodLabel(p.year, p.month)}`}
                    exclusion={p.exclusion}
                    amount={fmt.money(p.netSalary)}
                    lines={lines(p)}
                  />
                ))}
              </ul>
            )}
          </div>

          {abilities.configure && !resignation && employee.isActive && (
            <Button
              variant="outline"
              size="sm"
              className="h-11 self-start font-semibold text-red-700 hover:border-red-600 hover:text-red-700 md:h-9 dark:text-red-400"
              onClick={() => onResign(employee.id)}
            >
              Record resignation
            </Button>
          )}
        </>
      )}
    </LedgerSheet>
  );
}

/**
 * Cancel a resignation recorded in error. It asks for a reason and keeps the
 * record: the history shows the resignation, who cancelled it, when and why.
 */
function CancelResignation({ employee }: { employee: FinanceEmployee }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const mutation = useFinanceMutation<unknown, { reason: string }>();

  async function submit() {
    if (mutation.isPending) return;
    if (reason.trim().length < 3) {
      setError('Say why this resignation is being cancelled.');
      return;
    }
    try {
      await mutation.mutateAsync({
        path: `/api/finance/payroll/employees/${employee.id}/resignation/cancel`,
        body: { reason: reason.trim() },
      });
      toast.success(`Resignation cancelled — ${employee.name} is active again`);
      setOpen(false);
      setReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The resignation could not be cancelled.');
    }
  }

  if (!open) {
    return (
      <Button variant="link" size="sm" className="h-auto self-start p-0 text-[13px]" onClick={() => setOpen(true)}>
        Recorded in error? Cancel this resignation
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border p-3">
      <Label htmlFor="cancel-resignation-reason" className="text-[13px]">
        Why is this resignation being cancelled?
      </Label>
      <Textarea
        id="cancel-resignation-reason"
        rows={2}
        maxLength={300}
        value={reason}
        onChange={(e) => {
          setReason(e.target.value);
          setError('');
        }}
      />
      <p className="text-xs text-muted-foreground">
        The record is kept and marked cancelled, with your account and the time. {employee.name} becomes active again.
      </p>
      {error && (
        <p role="alert" className="text-[13px] text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={() => setOpen(false)}>
          Keep it
        </Button>
        <Button size="sm" className="h-11 md:h-8" disabled={mutation.isPending} onClick={() => void submit()}>
          {mutation.isPending ? 'Cancelling…' : 'Cancel resignation'}
        </Button>
      </div>
    </div>
  );
}
