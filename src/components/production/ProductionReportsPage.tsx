'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Printer } from 'lucide-react';
import { toast } from 'sonner';
import { businessDateStr, type ProductionStockRow } from '@mb/shared';
import { formatDate } from '@/utils/date';
// This report is driven by a single date (see PREPARED_REPORT) rather than the
// period dropdown, and is derived client-side from the production-stock pool.
const PREPARED_REPORT = 'prepared-by-date';

const REPORTS = [
  { value: 'production', label: 'Production (Daily)' },
  { value: PREPARED_REPORT, label: 'Prepared Items (By Date)' },
  { value: 'branch-demand', label: 'Branch Demand' },
  { value: 'approved-orders', label: 'Approved Orders' },
  { value: 'pending-balance', label: 'Pending Balance' },
  { value: 'returned-products', label: 'Returned Products' },
  { value: 'production-stock', label: 'Production Stock' },
  { value: 'branch-stock', label: 'Branch Stock' },
  { value: 'production-expenses', label: 'Production Expenses' },
];

const PERIODS = [
  { value: 'daily', label: 'Today' },
  { value: 'weekly', label: 'This Week' },
  { value: 'monthly', label: 'This Month' },
  { value: 'yearly', label: 'This Year' },
];

interface ReportData {
  title: string;
  headers: string[];
  rows: (string | number)[][];
}

// Build the "all items with qty, for one date" table from the production-stock
// pool rows. `preparedToday` reflects the queried Karachi day (see useProductionStock).
// We list every item that had any prepared units that day, alphabetically, with a total.
function buildPreparedReport(rows: ProductionStockRow[] | undefined, date: string): ReportData {
  const prepared = (rows ?? [])
    .filter((r) => r.preparedToday > 0)
    .sort((a, b) => a.productName.localeCompare(b.productName));
  const body: (string | number)[][] = prepared.map((r) => [r.productName, r.preparedToday]);
  if (prepared.length > 0) {
    body.push(['Total', prepared.reduce((sum, r) => sum + r.preparedToday, 0)]);
  }
  return {
    title: `Prepared Items — ${formatDate(date)}`,
    headers: ['Item', 'Qty Prepared'],
    rows: body,
  };
}

export function ProductionReportsPage() {
  const { token } = useAuth();
  const [report, setReport] = useState('production');
  const [period, setPeriod] = useState('monthly');
  const [date, setDate] = useState(businessDateStr());

  const isPrepared = report === PREPARED_REPORT;

  // Period-based reports come pre-shaped from the backend.
  const summaryQuery = useQuery({
    queryKey: ['productionReport', report, period],
    queryFn: () => apiCall<ReportData>(`/api/production-reports/summary?report=${report}&period=${period}`, {}, token),
    enabled: !!token && !isPrepared,
  });

  // The "Prepared Items (By Date)" report reads the production-stock pool for one day.
  const preparedQuery = useQuery({
    queryKey: ['productionPreparedReport', date],
    queryFn: () => apiCall<{ rows: ProductionStockRow[]; date: string }>(`/api/production-stock?date=${date}`, {}, token),
    enabled: !!token && isPrepared,
  });

  const loading = isPrepared ? preparedQuery.isLoading : summaryQuery.isLoading;
  // Surface request failures so a 500 reads as an error (with retry), not as an
  // empty report — the two are very different and must not look the same.
  const error = isPrepared ? preparedQuery.error : summaryQuery.error;
  const refetch = () => (isPrepared ? preparedQuery.refetch() : summaryQuery.refetch());
  const data: ReportData | undefined = isPrepared
    ? buildPreparedReport(preparedQuery.data?.rows, date)
    : summaryQuery.data;

  async function handleExport(type: 'pdf' | 'excel' | 'csv') {
    try {
      const blob = await apiCall<Blob>(`/api/production-reports/export?report=${report}&period=${period}&type=${type}`, {}, token);
      const ext = type === 'excel' ? 'xlsx' : type;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mountain-bakes-${report}-${period}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${type.toUpperCase()} exported`);
    } catch {
      toast.error('Export failed');
    }
  }

  return (
    <div className="space-y-6 print-area">
      {/* Controls */}
      <div className="flex flex-wrap items-end justify-between gap-3 no-print">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Report</label>
            <Select value={report} onValueChange={(v) => { if (v) setReport(v); }}>
              <SelectTrigger className="h-9 w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {REPORTS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {isPrepared ? (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Date</label>
              <Input type="date" value={date} max={businessDateStr()} onChange={(e) => setDate(e.target.value)} className="h-9 w-40" />
            </div>
          ) : (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Period</label>
              <Select value={period} onValueChange={(v) => { if (v) setPeriod(v); }}>
                <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERIODS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isPrepared && (
            <>
              <Button variant="outline" size="sm" className="h-9" onClick={() => handleExport('pdf')}>PDF</Button>
              <Button variant="outline" size="sm" className="h-9" onClick={() => handleExport('excel')}>Excel</Button>
              <Button variant="outline" size="sm" className="h-9" onClick={() => handleExport('csv')}>CSV</Button>
            </>
          )}
          <Button variant="outline" size="sm" className="h-9" onClick={() => window.print()}>
            <Printer className="mr-1.5 h-3.5 w-3.5" /> Print
          </Button>
        </div>
      </div>

      {/* Preview */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{data?.title ?? 'Report'}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-72 w-full" />
          ) : error ? (
            <div className="py-12 text-center">
              <p className="text-sm font-medium text-destructive">Couldn&apos;t load this report.</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
                {error instanceof Error ? error.message : 'The request failed. Please try again.'}
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>Retry</Button>
            </div>
          ) : !data || data.rows.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No data for this report and period.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50 text-left">
                    {data.headers.map((h) => (
                      <th key={h} className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((row, i) => (
                    <tr key={i} className="border-t hover:bg-muted/30">
                      {row.map((cell, j) => (
                        <td key={j} className={`px-3 py-2 ${j === 0 ? 'font-medium' : 'tabular-nums'}`}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
