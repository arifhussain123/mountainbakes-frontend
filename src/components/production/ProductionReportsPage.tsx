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
import { ResponsiveMatrix } from '@/components/shared/ResponsiveMatrix';
import { PrintButton } from '@/components/shared/PrintButton';
import { toast } from 'sonner';
import { businessDateStr } from '@mb/shared';

// This report is driven by a From/To date window (see PREPARED_REPORT) rather
// than the period dropdown. It is built server-side off the production-stock
// ledger, so the same rows the preview shows are what the exporters write.
const PREPARED_REPORT = 'prepared-detail';

const REPORTS = [
  { value: 'production', label: 'Production (Daily)' },
  { value: PREPARED_REPORT, label: 'Prepared Items (Date-wise)' },
  { value: 'branch-demand', label: 'Branch Demand' },
  { value: 'approved-orders', label: 'Approved Orders' },
  { value: 'pending-balance', label: 'Pending Balance' },
  { value: 'returned-products', label: 'Returned Products' },
  { value: 'production-stock', label: 'Production Stock' },
  { value: 'branch-stock', label: 'Branch Stock' },
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

export function ProductionReportsPage() {
  const { token } = useAuth();
  const [report, setReport] = useState('production');
  const [period, setPeriod] = useState('monthly');
  const today = businessDateStr();
  // Both ends default to today, so opening the report answers "what did we
  // prepare today?" before anything is touched.
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  const isPrepared = report === PREPARED_REPORT;

  // One endpoint for every report: period-driven ones send `period`, the
  // date-wise one sends `from`/`to`. The server ignores whichever it doesn't use.
  const rangeParams = isPrepared ? `&from=${from}&to=${to}` : '';
  const query = useQuery({
    queryKey: ['productionReport', report, period, isPrepared ? from : '', isPrepared ? to : ''],
    queryFn: () =>
      apiCall<ReportData>(`/api/production-reports/summary?report=${report}&period=${period}${rangeParams}`, {}, token),
    enabled: !!token,
  });

  const loading = query.isLoading;
  // Surface request failures so a 500 reads as an error (with retry), not as an
  // empty report — the two are very different and must not look the same.
  const error = query.error;
  const refetch = () => query.refetch();
  const data: ReportData | undefined = query.data;

  async function handleExport(type: 'pdf' | 'excel' | 'csv') {
    try {
      const blob = await apiCall<Blob>(
        `/api/production-reports/export?report=${report}&period=${period}${rangeParams}&type=${type}`,
        {},
        token,
      );
      const ext = type === 'excel' ? 'xlsx' : type;
      // Name the file after the window it covers — two exports pulled the same
      // day for different date ranges must not collide in the Downloads folder.
      const scope = isPrepared ? (from === to ? from : `${from}_to_${to}`) : period;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `mountain-bakes-${report}-${scope}.${ext}`;
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
      <div className="flex flex-col items-stretch gap-3 no-print sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Report</label>
            <Select value={report} onValueChange={(v) => { if (v) setReport(v); }}>
              <SelectTrigger className="h-9 w-full sm:w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {REPORTS.map((r) => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {isPrepared ? (
            <>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">From</label>
                <Input
                  type="date"
                  value={from}
                  max={to || today}
                  onChange={(e) => setFrom(e.target.value || today)}
                  className="h-9 w-full sm:w-40"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">To</label>
                <Input
                  type="date"
                  value={to}
                  min={from}
                  max={today}
                  onChange={(e) => setTo(e.target.value || today)}
                  className="h-9 w-full sm:w-40"
                />
              </div>
            </>
          ) : (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Period</label>
              <Select value={period} onValueChange={(v) => { if (v) setPeriod(v); }}>
                <SelectTrigger className="h-9 w-full sm:w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PERIODS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="h-9" onClick={() => handleExport('pdf')}>PDF</Button>
          <Button variant="outline" size="sm" className="h-9" onClick={() => handleExport('excel')}>Excel</Button>
          <Button variant="outline" size="sm" className="h-9" onClick={() => handleExport('csv')}>CSV</Button>
          <PrintButton variant="outline" size="sm" buttonClassName="h-9" />
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
          ) : (
            <ResponsiveMatrix
              headers={data?.headers ?? []}
              rows={data?.rows ?? []}
              emptyTitle="No data for this report and period"
              emptyDescription="Try a different report type or date range."
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
