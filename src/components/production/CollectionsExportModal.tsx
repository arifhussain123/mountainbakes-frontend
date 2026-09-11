'use client';

import { useState } from 'react';
import { businessDateStr } from '@mb/shared';
import { apiCall } from '@/utils/api';
import { useBranches } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { FileSpreadsheet, Download, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

/** Sentinel for "every branch". Empty string is not usable as a Select value. */
const ALL_BRANCHES = 'all';

export interface CollectionsExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
}

/**
 * Pulls the Collections sheet — one row per delivery, carrying what the branch
 * owes for it.
 *
 * The figures are the ones the company copy of the next slip prints, read from
 * the same `getPreviousOrderBalance` the slip itself uses, so a rider's paper and
 * this spreadsheet cannot disagree about an amount.
 *
 * Worth knowing before reading a short sheet: a delivery is billed against the
 * one that FOLLOWS it, because that pair is what fixes the window its returns and
 * discounts are counted in. So a branch's most recent delivery has no figure yet
 * and is not a row here. The sheet's last line says how many were held back for
 * that reason rather than leaving the gap silent.
 */
export function CollectionsExportModal({ open, onOpenChange, token }: CollectionsExportModalProps) {
  const today = businessDateStr();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [branchId, setBranchId] = useState(ALL_BRANCHES);
  const [busy, setBusy] = useState(false);

  // Only fetched while the dialog is open — the Production Orders page behind it
  // has no other use for the branch list.
  const branchesQ = useBranches(token, { enabled: open });
  const branches = branchesQ.data ?? [];

  // base-ui resolves the closed trigger's label from `items`, not from the
  // SelectItem children — those only mount once the popup opens. Without it the
  // trigger renders the raw value, so the default reads "all" rather than
  // "All branches".
  const branchItems = [
    { value: ALL_BRANCHES, label: 'All branches' },
    ...branches.map((b) => ({ value: b.id, label: b.name })),
  ];

  async function exportExcel() {
    setBusy(true);
    try {
      const scope = branchId === ALL_BRANCHES ? '' : `&branchId=${encodeURIComponent(branchId)}`;
      const blob = await apiCall<Blob>(
        `/api/production-reports/export?report=collections&from=${from}&to=${to}${scope}&type=excel`,
        {},
        token,
      );
      // Named after the window AND the branch, so a run for one branch does not
      // overwrite the all-branches pull taken the same day.
      const window = from === to ? from : `${from}_to_${to}`;
      const who = branchId === ALL_BRANCHES
        ? 'all-branches'
        : (branches.find((b) => b.id === branchId)?.name ?? 'branch').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `mountain-bakes-collections-${who}-${window}.xlsx`;
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
            <FileSpreadsheet className="h-5 w-5 text-primary" /> Collections
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            One row per delivery — delivered value, company share, returns, discount and
            the amount to collect.
          </p>
        </div>

        <div className="space-y-3 px-5 py-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Branch</label>
            <Select items={branchItems} value={branchId} onValueChange={(v) => v && setBranchId(v)}>
              <SelectTrigger className="h-9 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {branchItems.map((b) => (
                  <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

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

          {/* Said here rather than discovered in the sheet: a range ending today
              will usually be one delivery per branch short, and that is correct
              rather than missing data. */}
          <p className="text-xs text-muted-foreground">
            A delivery is billed against the one after it, so each branch&apos;s most recent
            delivery has no amount yet. The sheet&apos;s last line counts any held back.
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
