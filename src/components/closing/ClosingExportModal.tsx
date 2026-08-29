'use client';

import { useState } from 'react';
import { businessDateStr } from '@mb/shared';
import { apiCall } from '@/utils/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { FileSpreadsheet, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export interface ClosingExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  /** Seeds both ends of the window — the day the page is currently showing. */
  defaultDate?: string;
}

/**
 * Pulls the closing sheet over a window — one row per business day, the same
 * figures the page states for a single date.
 *
 * No branch picker, unlike the Collections export: RouteGuard only lets a branch
 * role reach `/branch-closing`, so the window is always the caller's own shop.
 * The server refuses to widen it — these numbers reconcile against one physical
 * cash drawer, and a total spanning several shops reconciles with nothing.
 *
 * The money comes from `computeClosingTotals` in @mb/shared, which is also what
 * the page behind this dialog renders, so the sheet and the screen cannot
 * disagree about a day.
 */
export function ClosingExportModal({ open, onOpenChange, token, defaultDate }: ClosingExportModalProps) {
  const today = businessDateStr();
  const seed = defaultDate || today;
  const [from, setFrom] = useState(seed);
  const [to, setTo] = useState(seed);
  const [busy, setBusy] = useState(false);

  async function exportExcel() {
    setBusy(true);
    try {
      const blob = await apiCall<Blob>(
        `/api/branch-closing/export?from=${from}&to=${to}&type=excel`,
        {},
        token,
      );
      const window = from === to ? from : `${from}_to_${to}`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `mountain-bakes-closing-${window}.xlsx`;
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
            <FileSpreadsheet className="h-5 w-5 text-primary" /> Export Closing
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            One row per day — sales, discounts, expenses, net, cash and stock on hand.
          </p>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

          {/* The screen's own 7-day expense warning does NOT apply here, and saying
              so is the point: that limit belongs to the expenses LIST endpoint the
              page reads, while the export queries the range directly. A window
              older than a week is complete in the sheet even where the screen
              would have to say it could not show it. */}
          <p className="text-xs text-muted-foreground">
            Expenses are included for the whole window, including days older than the
            seven the page itself can show.
          </p>
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
