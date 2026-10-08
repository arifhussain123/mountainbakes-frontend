import { useState } from 'react';
import { toast } from 'sonner';

import { apiCall } from '@/utils/api';
import { logger } from '@/utils/logger';
import { saveBlob } from '@/utils/saveBlob';

export type SalesExportType = 'excel' | 'pdf';

/**
 * Download the Daily Sales report for one window.
 *
 * Shared by the Daily Sales section and the Branch Dashboard so both export the
 * same file from the same endpoint. The API re-resolves the branch scope for the
 * export exactly as it does for the screen, so an export can never contain a
 * branch the caller is not allowed to read.
 */
export function useSalesExport(
  token: string,
  params: { from: string; to: string; topLimit: number; compare: boolean; branchId?: string | null },
) {
  const [exporting, setExporting] = useState<SalesExportType | null>(null);
  const { from, to, topLimit, compare, branchId } = params;

  async function exportReport(type: SalesExportType) {
    setExporting(type);
    try {
      const query = new URLSearchParams({
        from,
        to,
        topLimit: String(topLimit),
        compare: String(compare),
        type,
      });
      if (branchId) query.set('branchId', branchId);

      const blob = await apiCall<Blob>(`/api/sales-analytics/export?${query.toString()}`, {}, token);
      const scope = from === to ? from : `${from}_to_${to}`;
      saveBlob(blob, `mountain-bakes-daily-sales-${scope}.${type === 'excel' ? 'xlsx' : 'pdf'}`);
      toast.success(`${type === 'excel' ? 'Excel' : 'PDF'} exported`);
    } catch (err) {
      logger.error('Daily Sales export failed', err);
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(null);
    }
  }

  return { exporting, exportReport };
}
