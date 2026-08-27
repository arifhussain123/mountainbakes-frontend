'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { usePriceHistory } from '@/lib/queries';import { exportPriceHistory, formatBusinessDate } from '@/utils/productPrice';
import { DataTable } from '@/components/shared/DataTable';
import { ExpandableText } from '@/components/shared/ExpandableText';
import { Button } from '@/components/ui/button';
import type { PriceHistoryDoc } from '@mb/shared';
import { createColumnHelper } from '@tanstack/react-table';
import { toast } from 'sonner';
import { FileSpreadsheet, FileText } from 'lucide-react';

const col = createColumnHelper<PriceHistoryDoc>();

/** Trims an ISO timestamp to its date part before formatting as DD-MM-YYYY. */
const dmy = (d?: string | null) => formatBusinessDate(d ? String(d).slice(0, 10) : d);

const STATUS_PILL: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  scheduled: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
  superseded: 'bg-muted text-muted-foreground',
};

export function PriceHistoryPage() {
  const { user, token } = useAuth();
  const [exporting, setExporting] = useState(false);

  const historyQ = usePriceHistory(token);
  const rows = historyQ.data ?? [];
  const loading = historyQ.isLoading;

  useEffect(() => {
    if (historyQ.isError) toast.error('Failed to load price history');
  }, [historyQ.isError]);

  async function handleExport(type: 'excel' | 'csv') {
    setExporting(true);
    try {
      await exportPriceHistory({ type, token });
    } catch {
      toast.error('Export failed');
    } finally {
      setExporting(false);
    }
  }

  if (user && user.role !== 'super_admin') {
    return <p className="py-12 text-center text-sm text-muted-foreground">Access denied — Super Admin only.</p>;
  }

  const columns = [
    col.accessor('priceNumber', { header: 'ID', meta: { mobile: 'subtitle' }, cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue()}</span> }),
    col.accessor('productName', {
      header: 'Product',
      meta: { mobile: 'title' },
      cell: (i) => (
        <div>
          <p className="font-medium">{i.getValue()}</p>
          <p className="font-mono text-xs text-muted-foreground">{i.row.original.productCode}</p>
        </div>
      ),
    }),
    col.accessor('oldPrice', { header: 'Old Price', cell: (i) => <span className="tabular-nums text-muted-foreground">Rs.{Number(i.getValue() ?? 0).toLocaleString()}</span> }),
    col.accessor('newPrice', { header: 'New Price', cell: (i) => <span className="font-semibold tabular-nums text-primary">Rs.{Number(i.getValue() ?? 0).toLocaleString()}</span> }),
    col.accessor('effectiveDate', { header: 'Effective Date', cell: (i) => <span className="tabular-nums">{dmy(i.getValue())}</span> }),
    col.accessor('changedByName', { header: 'Changed By', cell: (i) => <span className="text-sm">{i.getValue() || '—'}</span> }),
    col.accessor('changedOn', { header: 'Changed On', cell: (i) => <span className="tabular-nums text-muted-foreground">{dmy(i.getValue())}</span> }),
    col.accessor('status', {
      header: 'Status',
      meta: { mobile: 'badge' },
      cell: (i) => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${STATUS_PILL[i.getValue()] ?? 'bg-muted text-muted-foreground'}`}>
          {i.getValue()}
        </span>
      ),
    }),
    col.accessor('reason', { header: 'Reason', meta: { mobileFull: true }, cell: (i) => <ExpandableText text={i.getValue()} className="text-sm text-muted-foreground" /> }),
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Price History</h2>
          <p className="text-sm text-muted-foreground">Every price change, permanently recorded. Read-only — cannot be edited or deleted.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => handleExport('excel')} disabled={exporting || !rows.length}>
            <FileSpreadsheet className="mr-1.5 h-4 w-4" /> Excel
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport('csv')} disabled={exporting || !rows.length}>
            <FileText className="mr-1.5 h-4 w-4" /> CSV
          </Button>
        </div>
      </div>
      <DataTable columns={columns} data={rows} loading={loading} searchPlaceholder="Search product, code, reason…" />
    </div>
  );
}
