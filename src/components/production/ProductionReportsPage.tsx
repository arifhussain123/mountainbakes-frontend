'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Printer } from 'lucide-react';
import { toast } from 'sonner';
import { useProductionRealtime } from '@/hooks/useProductionRealtime';

const REPORTS = [
  { value: 'production', label: 'Production (Daily)' },
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

export function ProductionReportsPage() {
  const { token } = useAuth();
  useProductionRealtime();

  const [report, setReport] = useState('production');
  const [period, setPeriod] = useState('monthly');

  const { data, isLoading: loading } = useQuery({
    queryKey: ['productionReport', report, period],
    queryFn: () => apiCall<ReportData>(`/api/production-reports/summary?report=${report}&period=${period}`, {}, token),
    enabled: !!token,
  });

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
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Period</label>
            <Select value={period} onValueChange={(v) => { if (v) setPeriod(v); }}>
              <SelectTrigger className="h-9 w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PERIODS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" className="h-9" onClick={() => handleExport('pdf')}>PDF</Button>
          <Button variant="outline" size="sm" className="h-9" onClick={() => handleExport('excel')}>Excel</Button>
          <Button variant="outline" size="sm" className="h-9" onClick={() => handleExport('csv')}>CSV</Button>
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
