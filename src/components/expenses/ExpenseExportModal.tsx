'use client';

import { useState } from 'react';
import { businessDateStr, businessDaysAgoStr } from '@mb/shared';
import { apiCall } from '@/utils/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { FileSpreadsheet, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export interface ExpenseExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
}

/**
 * Export shop expenses over a chosen window.
 *
 * The page itself only ever shows the last 7 business days, so this is the only
 * way to get at anything older — which is why the window opens on those same 7
 * days rather than on today: the common pull is "what the page shows, as a
 * file", and anything longer is a deliberate widening from there.
 *
 * The sheet is built server-side (exceljs) and arrives as a Blob; the browser
 * has no spreadsheet library. See /api/expenses/export.
 */
export function ExpenseExportModal({ open, onOpenChange, token }: ExpenseExportModalProps) {
  const today = businessDateStr();
  // The same helper the list route defaults to, rather than local date maths —
  // the business day rolls over at 2 AM, so a plain `new Date()` minus six days
  // lands on the wrong day for anyone working the late shift.
  const weekAgo = businessDaysAgoStr(6);

  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const [busy, setBusy] = useState(false);

  async function exportSheet(type: 'excel' | 'csv') {
    setBusy(true);
    try {
      const blob = await apiCall<Blob>(
        `/api/expenses/export?from=${from}&to=${to}&type=${type}`,
        {},
        token,
      );
      // Name the file after the window it covers, so two pulls taken the same day
      // for different ranges don't overwrite each other in the Downloads folder.
      const scope = from === to ? from : `${from}_to_${to}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `mountain-bakes-expenses-${scope}.${type === 'csv' ? 'csv' : 'xlsx'}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success(`${type === 'csv' ? 'CSV' : 'Excel'} exported`);
      onOpenChange(false);
    } catch (err) {
      // The API refuses a range over its row cap with a real message — surface it
      // rather than the generic failure, since it tells the user what to do.
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
            <FileSpreadsheet className="h-5 w-5 text-primary" /> Export Expenses
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every expense booked in the window you choose, with a total.
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
          <Button variant="outline" onClick={() => exportSheet('csv')} disabled={busy}>CSV</Button>
          <Button onClick={() => exportSheet('excel')} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
            Export Excel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
