'use client';

import { ArrowUpRight } from 'lucide-react';
import { DEPOSIT_MATCH_DAYS, type AppSettings, type FinanceDailySaleRow } from '@mb/shared';
import { useFinanceDailySaleDay } from '@/lib/finance';
import { ROUTES } from '@/utils/routes';
import { addDays } from '@/components/dashboard/daily-sales/ranges';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { displayDate } from '@/components/daily-sale/columns';
import { DailySaleViewDialogShell } from '@/components/daily-sale/DailySaleViewDialog';
import {
  DepositDifferenceBadge,
  DepositStatusBadge,
  exactMoney,
} from '@/components/daily-sale/parts';
import { cn } from '@/lib/utils';

/**
 * Cash Transfers, already narrowed to one branch and a span of dates — where
 * Finance decides whether a deposit arrived.
 *
 * A link with a query string rather than a client-side push, on purpose: that
 * page takes its filters from the address when it mounts, and a hard navigation
 * is the one way to be sure the address is already in place when it does.
 * Naming any filter also replaces its default "pending only", so the approved
 * deposits behind a received figure are on the list rather than filtered out.
 */
export function depositsHref(branchId: string, from: string, to: string): string {
  const params = new URLSearchParams({
    branchId,
    'businessDate.gte': from,
    'businessDate.lte': to,
  });
  return `${ROUTES.FINANCE_CASH_TRANSFERS}/?${params}`;
}

/** The dates a day's deposit is looked for on: the day itself and the days after it. */
export function depositWindowHref(row: Pick<FinanceDailySaleRow, 'branchId' | 'businessDate'>): string {
  return depositsHref(row.branchId, row.businessDate, addDays(row.businessDate, DEPOSIT_MATCH_DAYS));
}

/**
 * The branch's View popup, opened by Finance.
 *
 * The same dialog body the branch sees — summary, history, print sheet — fed by
 * Finance's read. Addressed by branch and date rather than by record id because
 * the day Finance most often opens has sales but no stored record yet, and
 * Finance never creates one.
 */
export function FinanceDailySaleViewDialog({
  day,
  onClose,
  settings,
  initialTab,
  autoPrint,
}: {
  day: { branchId: string; businessDate: string } | null;
  onClose: () => void;
  settings: AppSettings | null;
  initialTab: 'summary' | 'history';
  autoPrint: boolean;
}) {
  const { data, isLoading } = useFinanceDailySaleDay(day);

  return (
    <DailySaleViewDialogShell
      open={day !== null}
      onOpenChange={(open) => !open && onClose()}
      detail={day ? data : undefined}
      isLoading={isLoading}
      settings={settings}
      initialTab={initialTab}
      autoPrint={autoPrint}
    />
  );
}

/**
 * One branch day's Company Share against the deposit found for it.
 *
 * The table's three finance columns give the answer; this shows how it was
 * reached — the share and what it is a share of, which deposits were set against
 * the day and on what date they were handed over, and whether they were found by
 * amount, are only the nearest amount, or only the ones dated that day. It reads the row it was opened on and
 * fetches nothing.
 *
 * It decides nothing. Whether a deposit arrived is decided on the deposit, on
 * Cash Transfers, where the slip's photo is — the button below goes there.
 */
export function DepositCheckDialog({
  row,
  onClose,
  symbol,
}: {
  row: FinanceDailySaleRow | null;
  onClose: () => void;
  symbol: string;
}) {
  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="md:max-w-lg">
        {row && <DepositCheckBody row={row} symbol={symbol} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function DepositCheckBody({
  row,
  symbol,
  onClose,
}: {
  row: FinanceDailySaleRow;
  symbol: string;
  onClose: () => void;
}) {
  const r = row.reconciliation;
  const lastDay = addDays(row.businessDate, DEPOSIT_MATCH_DAYS);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Deposit check</DialogTitle>
        <DialogDescription>
          {row.branchName} · {displayDate(row.businessDate)}. The day&apos;s Company Share against the
          deposit received for it.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap items-center gap-2">
        <DepositStatusBadge status={r.status} />
        {r.match !== 'none' && (
          <span className="text-xs text-muted-foreground">
            {r.match === 'amount'
              ? 'A deposit of the same amount was found.'
              : r.match === 'nearest'
                ? 'No deposit of the same amount — the nearest one, under 1,000 away, is shown.'
                : 'No deposit within 1,000 of the share — the one deposited that day is shown.'}
          </span>
        )}
        {r.extraCount > 0 && (
          <span className="text-xs text-muted-foreground">
            {r.extraCount === 1
              ? '1 deposit handed over this day paid no day by amount, so it is added here as received this day.'
              : `${r.extraCount} deposits handed over this day paid no day by amount, so they are added here as received this day.`}
          </span>
        )}
      </div>

      <div className="space-y-1.5 rounded-lg border bg-muted/40 p-3 text-sm">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Total Sale</span>
          <span className="tabular-nums">{exactMoney(row.autoTotalSale, symbol)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Company Share ({row.companySharePct}%)</span>
          <span className="font-semibold tabular-nums">{exactMoney(r.expected, symbol)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Received (approved)</span>
          <span className="font-semibold tabular-nums">{exactMoney(r.received, symbol)}</span>
        </div>
        {r.pending > 0 && (
          <div className="flex justify-between gap-4 text-amber-700 dark:text-amber-400">
            <span>Awaiting approval</span>
            <span className="tabular-nums">{exactMoney(r.pending, symbol)}</span>
          </div>
        )}
        <div className="flex items-center justify-between gap-4 border-t pt-1.5">
          <span className="font-medium">Deposit Difference</span>
          <DepositDifferenceBadge difference={r.difference} symbol={symbol} />
        </div>
      </div>

      <div className="space-y-1.5 text-xs text-muted-foreground">
        <p>
          Difference is Company Share less Received: short is share not yet received, over is more
          than the share. A deposit is looked for by amount among this branch&apos;s deposits dated{' '}
          {displayDate(row.businessDate)} to {displayDate(lastDay)}, and each deposit is set against one
          day only.
        </p>
        {r.provisional && (
          <p>
            This day&apos;s record is still open, so its Total Sale and Company Share can still move with
            the day&apos;s sales.
          </p>
        )}
        {r.pending > 0 && <p>A deposit awaiting approval is never counted as received.</p>}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Deposits set against this day ({r.deposits.length})
        </p>
        {r.deposits.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No deposit dated {displayDate(row.businessDate)} to {displayDate(lastDay)} is free to set against
            this day.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {r.deposits.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">
                    {d.transferNo}
                    {d.voucherNo && <span className="ml-2 text-xs text-muted-foreground">{d.voucherNo}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    Handed over {displayDate(d.businessDate)} · Cash {exactMoney(d.cashAmount, symbol)} ·
                    Easypaisa {exactMoney(d.easypaisaAmount, symbol)} · Bank {exactMoney(d.bankAmount, symbol)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold tabular-nums">{exactMoney(d.amount, symbol)}</span>
                  <Badge
                    className={cn(
                      'border-0',
                      d.status === 'approved'
                        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400'
                        : 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
                    )}
                  >
                    {d.status === 'approved' ? 'Approved' : 'Awaiting approval'}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
        <a href={depositWindowHref(row)} className={buttonVariants()}>
          Open in Cash Transfers
          <ArrowUpRight className="h-4 w-4" />
        </a>
      </DialogFooter>
    </>
  );
}
