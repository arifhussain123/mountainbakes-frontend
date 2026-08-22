'use client';

import { useState } from 'react';
import { businessDateStr } from '@mb/shared';
import { apiCall } from '@/utils/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { FileSpreadsheet, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export interface PreparedDetailExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  /** Seeds both ends of the window — the day the page is currently showing. */
  defaultDate?: string;
}

/**
 * Pulls the "Prepared Items (Date-wise)" sheet — one row per product, totalled
 * over the window — straight from the Production Stock page, so the export does
 * not require a detour through Production Reports.
 *
 * It hits the same `prepared-detail` report the Reports page previews, so the
 * two can never disagree about what a window contains.
 */
export function PreparedDetailExportModal({ open, onOpenChange, token, defaultDate }: PreparedDetailExportModalProps) {
  const today = businessDateStr();
  const seed = defaultDate || today;
  const [from, setFrom] = useState(seed);
  const [to, setTo] = useState(seed);
  const [busy, setBusy] = useState(false);

  async function exportExcel() {
    setBusy(true);
    try {
      const blob = await apiCall<Blob>(
        `/api/production-reports/export?report=prepared-detail&from=${from}&to=${to}&type=excel`,
        {},
        token,
      );
      // Name the file after the window it covers, so two pulls taken the same day
      // for different ranges don't overwrite each other in the Downloads folder.
      const scope = from === to ? from : `${from}_to_${to}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `mountain-bakes-prepared-detail-${scope}.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success('Excel exported');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent showCloseButton className="gap-0 p-0 sm:max-w-md">
        <div className="border-b bg-card px-5 py-4">
          <h2 className="flex items-center gap-2 font-heading text-base font-semibold sm:text-lg">
            <FileSpreadsheet className="h-5 w-5 text-primary" /> Prepared Detail
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            One row per product, totalled over the window you choose.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-3 px-5 py-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">From</label>
            <Input
              type="date"
              value={from}
              max={to || today}
              onChange={(e) => setFrom(e.target.value || today)}
              className="h-9 w-full"
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
              className="h-9 w-full"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 border-t bg-muted/40 px-5 py-3 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button onClick={exportExcel} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
            Export Excel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
