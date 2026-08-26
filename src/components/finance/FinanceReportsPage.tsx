'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  businessDateStr,
  FINANCE_REPORT_LABELS,
  FINANCE_REPORT_TYPES,
  type FinanceReport,
  type FinanceReportType,
  type ReportCellFormat,
} from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranches } from '@/lib/queries';
import {
  downloadFinanceReport,
  useFinanceEmployees,
  useFinanceReport,
  useLedgerHeads,
} from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils';
import { FinancePageHeader, useMoney } from './finance-ui';
import { DateFilter, FilterBar, FilterField, FilterSelect } from './finance-actions';
import { FileSpreadsheet, FileText, Table2 } from 'lucide-react';

/**
 * The ten reports.
 *
 * ONE renderer for all of them, because the API returns one shape for all of
 * them: a title, some columns, some rows and some totals (see FinanceReport).
 * Ten bespoke report screens would be ten places to fix a column alignment, and
 * they would drift from the PDF and the spreadsheet — which are rendered from
 * the SAME descriptor server-side, and are the reason the printed copy and the
 * screen cannot disagree.
 *
 * What varies per report is only which FILTERS make sense, and that is the table
 * below.
 */

/** Which inputs each report actually uses. Anything not listed is not sent. */
const REPORT_FIELDS: Record<FinanceReportType, readonly string[]> = {
  daily_cash_book: ['from', 'to', 'branchId'],
  general_ledger: ['from', 'to', 'ledgerHeadId', 'branchId'],
  income_statement: ['from', 'to', 'branchId'],
  expense_report: ['from', 'to', 'ledgerHeadId', 'branchId'],
  profit_loss: ['from', 'to', 'branchId'],
  company_share: ['from', 'to', 'branchId'],
  branch_share: ['from', 'to', 'branchId'],
  salary: ['salaryMonth', 'department', 'employeeId'],
  partner_expense: ['from', 'to', 'partnerName'],
  trial_balance: ['from', 'to'],
};

export function FinanceReportsPage() {
  const { token } = useAuth();
  const today = businessDateStr();
  // Default window: the current month to date, which is what a report is asked
  // for far more often than a single day.
  const monthStart = `${today.slice(0, 7)}-01`;

  const [type, setType] = useState<FinanceReportType>('daily_cash_book');
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [branchId, setBranchId] = useState('');
  const [ledgerHeadId, setLedgerHeadId] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [department, setDepartment] = useState('');
  const [salaryMonth, setSalaryMonth] = useState(today.slice(0, 7));
  const [downloading, setDownloading] = useState<string | null>(null);

  const branchesQ = useBranches(token ?? '');
  const headsQ = useLedgerHeads(true);
  const employeesQ = useFinanceEmployees(true);

  const fields = REPORT_FIELDS[type];
  const uses = (field: string) => fields.includes(field);

  // Only the fields this report uses reach the API. Sending a stale partnerName
  // to a Trial Balance would be rejected by the query schema at best and quietly
  // narrow the result at worst.
  const query = useMemo(() => {
    const q: Record<string, unknown> = { type };
    if (uses('from')) q['from'] = from;
    if (uses('to')) q['to'] = to;
    if (uses('branchId') && branchId) q['branchId'] = branchId;
    if (uses('ledgerHeadId') && ledgerHeadId) q['ledgerHeadId'] = ledgerHeadId;
    if (uses('partnerName') && partnerName) q['partnerName'] = partnerName;
    if (uses('employeeId') && employeeId) q['employeeId'] = employeeId;
    if (uses('department') && department) q['department'] = department;
    if (uses('salaryMonth') && salaryMonth) q['salaryMonth'] = salaryMonth;
    return q;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, from, to, branchId, ledgerHeadId, partnerName, employeeId, department, salaryMonth]);

  const { data: report, isLoading, isError, error } = useFinanceReport(query);

  const departments = Array.from(new Set((employeesQ.data ?? []).map((e) => e.department))).sort();

  async function download(format: 'pdf' | 'excel' | 'csv') {
    if (!token) return;
    setDownloading(format);
    try {
      await downloadFinanceReport(query, format, token);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not export this report');
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="space-y-6">
      <FinancePageHeader
        title="Finance Reports"
        description="The same figures on screen and on paper — the export renders the report you are looking at."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={!report || downloading !== null} onClick={() => void download('pdf')}>
              <FileText className="h-3.5 w-3.5" />
              {downloading === 'pdf' ? 'Preparing…' : 'PDF'}
            </Button>
            <Button variant="outline" size="sm" disabled={!report || downloading !== null} onClick={() => void download('excel')}>
              <FileSpreadsheet className="h-3.5 w-3.5" />
              {downloading === 'excel' ? 'Preparing…' : 'Excel'}
            </Button>
            <Button variant="outline" size="sm" disabled={!report || downloading !== null} onClick={() => void download('csv')}>
              <Table2 className="h-3.5 w-3.5" />
              {downloading === 'csv' ? 'Preparing…' : 'CSV'}
            </Button>
          </div>
        }
      />

      <FilterBar>
        <FilterField label="Report" className="min-w-[14rem] flex-1 space-y-1 sm:flex-none">
          <FilterSelect
            value={type}
            onChange={(v) => setType((v || 'daily_cash_book') as FinanceReportType)}
            allLabel="Daily Cash Book"
            options={FINANCE_REPORT_TYPES.map((t) => ({ value: t, label: FINANCE_REPORT_LABELS[t] }))}
          />
        </FilterField>

        {uses('from') && (
          <FilterField label="From">
            <DateFilter value={from} onChange={setFrom} max={today} />
          </FilterField>
        )}
        {uses('to') && (
          <FilterField label="To">
            <DateFilter value={to} onChange={setTo} max={today} />
          </FilterField>
        )}
        {uses('salaryMonth') && (
          <FilterField label="Salary month">
            <Input
              type="month"
              value={salaryMonth}
              onChange={(e) => setSalaryMonth(e.target.value)}
              className="h-11 md:h-9"
            />
          </FilterField>
        )}
        {uses('branchId') && (
          <FilterField label="Branch">
            <FilterSelect
              value={branchId}
              onChange={setBranchId}
              allLabel="All branches"
              options={(branchesQ.data ?? []).map((b) => ({ value: b.id, label: b.name }))}
            />
          </FilterField>
        )}
        {uses('ledgerHeadId') && (
          <FilterField label="Ledger head">
            <FilterSelect
              value={ledgerHeadId}
              onChange={setLedgerHeadId}
              allLabel="All heads"
              options={(headsQ.data ?? []).map((h) => ({ value: h.id, label: h.name }))}
            />
          </FilterField>
        )}
        {uses('department') && (
          <FilterField label="Department">
            <FilterSelect
              value={department}
              onChange={setDepartment}
              allLabel="All departments"
              options={departments.map((d) => ({ value: d, label: d }))}
            />
          </FilterField>
        )}
        {uses('employeeId') && (
          <FilterField label="Employee">
            <FilterSelect
              value={employeeId}
              onChange={setEmployeeId}
              allLabel="All employees"
              options={(employeesQ.data ?? []).map((e) => ({ value: e.id, label: e.name }))}
            />
          </FilterField>
        )}
        {uses('partnerName') && (
          <FilterField label="Partner">
            <Input
              placeholder="Partner name"
              value={partnerName}
              onChange={(e) => setPartnerName(e.target.value)}
              className="h-11 md:h-9"
            />
          </FilterField>
        )}
      </FilterBar>

      {isError ? (
        <EmptyState
          title="Could not build this report"
          description={error instanceof Error ? error.message : 'Please try again.'}
        />
      ) : isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full rounded-lg" />
          <Skeleton className="h-80 w-full rounded-lg" />
        </div>
      ) : report ? (
        <ReportView report={report} />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ReportView({ report }: { report: FinanceReport }) {
  const { format: money } = useMoney();

  /** Render one cell the way its column says to. */
  function cell(value: string | number | null, fmt?: ReportCellFormat) {
    if (value === null || value === '') return '—';
    if (fmt === 'money') return money(Number(value));
    if (fmt === 'number') return Number(value).toLocaleString('en-PK');
    return String(value);
  }

  const alignOf = (align?: 'left' | 'right' | 'center') =>
    align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';

  return (
    <div className="space-y-4">
      {/* Letterhead. Matches the PDF's header so a printed copy and the screen
          are recognisably the same document. */}
      <Card>
        <CardContent className="p-5">
          <h3 className="text-lg font-semibold">{report.title}</h3>
          <p className="text-sm text-muted-foreground">{report.subtitle}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {report.periodFrom} to {report.periodTo} · generated {new Date(report.generatedAt).toLocaleString('en-PK')} by{' '}
            {report.generatedBy}
          </p>

          {report.summary.length > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-4 border-t pt-4 lg:grid-cols-4">
              {report.summary.map((s) => (
                <div key={s.label}>
                  <p className="text-xs text-muted-foreground">{s.label}</p>
                  <p className="text-lg font-bold tabular-nums">
                    {s.format === 'number' ? s.value.toLocaleString('en-PK') : money(s.value)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {report.rows.length === 0 ? (
        <EmptyState
          title="Nothing in this period"
          description="No entries matched the report's filters."
        />
      ) : (
        <>
          {/* Desktop table. A report is a document — it keeps the table shape at
              every width above md and scrolls horizontally rather than being
              re-flowed, because a column that moves is a column an auditor
              cannot cross-check against the PDF. */}
          <div className="hidden overflow-x-auto rounded-lg border bg-card md:block print-table-wrap">
            <Table>
              <TableHeader>
                <TableRow data-table-head>
                  {report.columns.map((c) => (
                    <TableHead
                      key={c.key}
                      className={cn(
                        'whitespace-nowrap text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                        alignOf(c.align ?? (c.format === 'money' || c.format === 'number' ? 'right' : 'left')),
                      )}
                    >
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.rows.map((row, i) => (
                  <TableRow key={i} className="hover:bg-muted/30">
                    {report.columns.map((c) => (
                      <TableCell
                        key={c.key}
                        className={cn(
                          'text-sm',
                          (c.format === 'money' || c.format === 'number') && 'tabular-nums',
                          alignOf(c.align ?? (c.format === 'money' || c.format === 'number' ? 'right' : 'left')),
                        )}
                      >
                        {cell(row[c.key] ?? null, c.format)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}

                {Object.keys(report.totals).length > 0 && (
                  <TableRow className="border-t-2 bg-muted/40 font-semibold hover:bg-muted/40">
                    {report.columns.map((c, idx) => {
                      const total = report.totals[c.key];
                      return (
                        <TableCell
                          key={c.key}
                          className={cn(
                            'text-sm',
                            (c.format === 'money' || c.format === 'number') && 'tabular-nums',
                            alignOf(c.align ?? (c.format === 'money' || c.format === 'number' ? 'right' : 'left')),
                          )}
                        >
                          {/* The first column carries the word "Total"; every
                              other column shows a figure only if the server
                              computed one for it. */}
                          {total !== undefined ? cell(total, c.format) : idx === 0 ? 'Total' : ''}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {/* Phone: each row as a labelled block. */}
          <div className="space-y-3 md:hidden">
            {report.rows.map((row, i) => (
              <div key={i} className="rounded-lg border bg-card p-3">
                <dl className="space-y-1 text-sm">
                  {report.columns.map((c) => (
                    <div key={c.key} className="flex items-baseline justify-between gap-3">
                      <dt className="text-xs text-muted-foreground">{c.label}</dt>
                      <dd
                        className={cn(
                          'min-w-0 truncate text-right font-medium',
                          (c.format === 'money' || c.format === 'number') && 'tabular-nums',
                        )}
                      >
                        {cell(row[c.key] ?? null, c.format)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}

            {Object.keys(report.totals).length > 0 && (
              <div className="rounded-lg border bg-muted/40 p-3">
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Totals</p>
                <dl className="space-y-1 text-sm">
                  {report.columns
                    .filter((c) => report.totals[c.key] !== undefined)
                    .map((c) => (
                      <div key={c.key} className="flex items-baseline justify-between gap-3">
                        <dt className="text-muted-foreground">{c.label}</dt>
                        <dd className="font-semibold tabular-nums">{cell(report.totals[c.key] ?? null, c.format)}</dd>
                      </div>
                    ))}
                </dl>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
