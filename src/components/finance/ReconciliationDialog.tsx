'use client';

import { useState } from 'react';
import { businessDateStr, type LedgerReconciliationRow } from '@mb/shared';
import { useLedgerReconciliation } from '@/lib/finance';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { formatDate } from '@/utils/date';
import { saveBlob } from '@/utils/saveBlob';
import { cn } from '@/lib/utils';
import { Download } from 'lucide-react';
import { Money } from './finance-ui';

/**
 * Collection slip against Demand Record, demand by demand — read only
 * (GET /api/finance/branch-account/reconciliation). Each figure is its own
 * track's: the slip's Amount to Collect, the record's Company Share. The gap is
 * split into the price basis (the slip prices goods at today's price, the
 * record at the order's) and the rest. Nothing here changes either track.
 */

const STATUS: Record<LedgerReconciliationRow['status'], { label: string; className: string }> = {
  match: { label: 'Match', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400' },
  differs: { label: 'Differs', className: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400' },
  not_billed: { label: 'No slip yet', className: 'bg-muted text-muted-foreground' },
  billed_other: { label: 'Skipped by slip', className: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400' },
};

export function ReconciliationDialog({
  open,
  onOpenChange,
  branchId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId?: string;
}) {
  const today = businessDateStr();
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [onlyGaps, setOnlyGaps] = useState(true);
  const q = useLedgerReconciliation(from, to, branchId, { enabled: open });
  const data = q.data;
  const rows = (data?.rows ?? []).filter((r) => !onlyGaps || r.status !== 'match');

  const exportCsv = () => {
    if (!data) return;
    const esc = (v: unknown) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      ['Branch', 'Demand', 'Date', 'Rule', 'Status', 'Billed on', 'Record Delivered', 'Record Return', 'Record Discount', 'Record Company Share',
        'Slip Delivered', 'Slip Return', 'Slip Discount', 'Slip Company Share', 'Slip Amount to Collect', 'Price difference', 'Collect difference'],
      ...data.rows.map((r) => [
        r.branchName, r.demandNumber, r.date, r.shareOnDelivered ? 'Share on Delivered' : 'Share on net', STATUS[r.status].label,
        r.slip?.billedOn ?? '', r.record.delivered, r.record.returns, r.record.discount, r.record.companyShare,
        r.slip?.delivered ?? '', r.slip?.returns ?? '', r.slip?.discount ?? '', r.slip?.companyShare ?? '', r.slip?.amountToCollect ?? '',
        r.priceDifference, r.collectDifference,
      ]),
    ];
    const csv = lines.map((l) => l.map(esc).join(',')).join('\n');
    saveBlob(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }), `reconciliation-${data.from}_to_${data.to}.csv`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton className="max-h-[90vh] overflow-y-auto md:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Reconciliation · slip against Demand Record</DialogTitle>
          <DialogDescription>
            For each demand: what its collection slip asked the rider to collect, beside the Company Share the Demand Record
            booked. Read only. Price difference: the slip values goods at today&apos;s price, the record at the order&apos;s.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            From
            <Input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value || from)} className="w-40" />
          </label>
          <label className="space-y-1 text-xs font-medium text-muted-foreground">
            To
            <Input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value || to)} className="w-40" />
          </label>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} />
            Only demands that do not match
          </label>
          <Button variant="outline" size="sm" className="ml-auto" disabled={!data} onClick={exportCsv}>
            <Download className="h-3.5 w-3.5" /> Export CSV
          </Button>
        </div>

        {q.isLoading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Comparing every slip with its record…</p>
        ) : q.isError ? (
          <p className="py-8 text-center text-sm text-destructive">{q.error instanceof Error ? q.error.message : 'Could not load the report.'}</p>
        ) : data ? (
          <>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Branch</th>
                    <th className="px-3 py-2 text-right font-medium">Demands</th>
                    <th className="px-3 py-2 text-right font-medium">Match</th>
                    <th className="px-3 py-2 text-right font-medium">Differs</th>
                    <th className="px-3 py-2 text-right font-medium">Record share</th>
                    <th className="px-3 py-2 text-right font-medium">Slip collect</th>
                    <th className="px-3 py-2 text-right font-medium">Price diff.</th>
                    <th className="px-3 py-2 text-right font-medium">Collect diff.</th>
                  </tr>
                </thead>
                <tbody>
                  {data.branches.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">No demands in this period.</td></tr>
                  ) : data.branches.map((b) => (
                    <tr key={b.branchId} className="border-b last:border-0">
                      <td className="px-3 py-2 font-medium">{b.branchName}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.demands}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.match}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{b.differs + b.billedOther}</td>
                      <td className="px-3 py-2 text-right tabular-nums"><Money value={b.recordShare} /></td>
                      <td className="px-3 py-2 text-right tabular-nums"><Money value={b.slipCollect} /></td>
                      <td className="px-3 py-2 text-right tabular-nums"><Money value={b.priceDifference} /></td>
                      <td className={cn('px-3 py-2 text-right font-semibold tabular-nums', b.collectDifference !== 0 && 'text-amber-700 dark:text-amber-400')}>
                        <Money value={b.collectDifference} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[52rem] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Demand</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 text-right font-medium">Record Delivered</th>
                    <th className="px-3 py-2 text-right font-medium">Slip Delivered</th>
                    <th className="px-3 py-2 text-right font-medium">Record Share</th>
                    <th className="px-3 py-2 text-right font-medium">Slip Collect</th>
                    <th className="px-3 py-2 text-right font-medium">Collect diff.</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">{onlyGaps ? 'Every billed demand matches.' : 'No demands.'}</td></tr>
                  ) : rows.map((r) => (
                    <tr key={r.orderId} className="border-b align-top last:border-0">
                      <td className="px-3 py-2">
                        <span className="font-mono font-medium">{r.demandNumber}</span>
                        <span className="block text-xs text-muted-foreground">
                          {r.branchName} · {formatDate(r.date)} · {r.shareOnDelivered ? 'share on Delivered' : 'share on net'}
                          {r.slip ? ` · slip on ${r.slip.billedOn}` : ''}
                        </span>
                      </td>
                      <td className="px-3 py-2"><Badge variant="secondary" className={STATUS[r.status].className}>{STATUS[r.status].label}</Badge></td>
                      <td className="px-3 py-2 text-right tabular-nums"><Money value={r.record.delivered} /></td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.slip && r.status !== 'billed_other' ? <Money value={r.slip.delivered} /> : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums"><Money value={r.record.companyShare} /></td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.slip && r.status !== 'billed_other' ? <Money value={r.slip.amountToCollect} /> : '—'}</td>
                      <td className={cn('px-3 py-2 text-right font-semibold tabular-nums', r.collectDifference !== 0 && 'text-amber-700 dark:text-amber-400')}>
                        {r.status === 'match' || r.status === 'differs' ? <Money value={r.collectDifference} /> : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              Before 1 Nov 2026 the two tracks also used different formulas (the slip took the share of the gross and then the
              whole Return and Discount off; the record took the share of the net). From 1 Nov both take the share of Delivered
              and subtract neither, so any remaining gap is the price basis or a slip that billed a different demand.
            </p>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
