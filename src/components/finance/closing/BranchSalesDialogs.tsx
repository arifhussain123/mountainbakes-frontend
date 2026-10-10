'use client';

import { ArrowUpRight } from 'lucide-react';
import type { AppSettings, FinanceDailySaleRow } from '@mb/shared';
import { useFinanceDailySaleDay } from '@/lib/finance';
import { ROUTES } from '@/utils/routes';
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
 * Where Finance decides a branch day's deposits — Cash Transfers, already
 * narrowed to that branch and date.
 *
 * A link with a query string rather than a client-side push, on purpose: that
 * page takes its filters from the address when it mounts, and a hard navigation
 * is the one way to be sure the address is already in place when it does.
 * Naming any filter also replaces its default "pending only", so the approved
 * deposits behind a received figure are on the list rather than filtered out.
 */
export function depositsHref(branchId: string, businessDate: string): string {
  const params = new URLSearchParams({
    branchId,
    'businessDate.gte': businessDate,
    'businessDate.lte': businessDate,
  });
  return `${ROUTES.FINANCE_CASH_TRANSFERS}/?${params}`;
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
 * One branch day's recorded money against its deposits, channel by channel.
 *
 * The table's three finance columns give the total; this is where a reader finds
 * WHICH channel is out, and the deposits behind the received figure. It reads the
 * row it was opened on and fetches nothing.
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
  const showPending = r.pendingCount > 0;

  const lines = [
    { label: 'Cash', hint: 'Cash on Table', key: 'cash' },
    { label: 'Easypaisa', hint: null, key: 'easypaisa' },
    { label: 'Bank', hint: null, key: 'bank' },
  ] as const;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Deposit check</DialogTitle>
        <DialogDescription>
          {row.branchName} · {displayDate(row.businessDate)}. What the day recorded against the
          deposits Finance has approved for it.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-wrap items-center gap-2">
        <DepositStatusBadge status={r.status} />
        {r.totalMatches && (
          <span className="text-xs text-muted-foreground">
            The total agrees, but not through the same channels.
          </span>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border bg-muted/40">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-3 py-2 text-left font-semibold">Channel</th>
              <th className="px-3 py-2 text-right font-semibold">Recorded</th>
              <th className="px-3 py-2 text-right font-semibold">Received</th>
              {showPending && <th className="px-3 py-2 text-right font-semibold">Awaiting</th>}
              <th className="px-3 py-2 text-right font-semibold">Difference</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.key} className="border-b last:border-0">
                <td className="px-3 py-2">
                  {line.label}
                  {line.hint && <span className="block text-xs text-muted-foreground">{line.hint}</span>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{exactMoney(r.expected[line.key], symbol)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{exactMoney(r.received[line.key], symbol)}</td>
                {showPending && (
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-amber-700 dark:text-amber-400">
                    {exactMoney(r.pending[line.key], symbol)}
                  </td>
                )}
                <td className="whitespace-nowrap px-3 py-2 text-right">
                  <DepositDifferenceBadge difference={r.difference[line.key]} symbol={symbol} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t font-semibold">
              <td className="px-3 py-2">Total</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{exactMoney(r.expected.total, symbol)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{exactMoney(r.received.total, symbol)}</td>
              {showPending && (
                <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-amber-700 dark:text-amber-400">
                  {exactMoney(r.pending.total, symbol)}
                </td>
              )}
              <td className="whitespace-nowrap px-3 py-2 text-right">
                <DepositDifferenceBadge difference={r.difference.total} symbol={symbol} />
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="space-y-1.5 text-xs text-muted-foreground">
        <p>Difference is recorded less received: short is money not yet received, over is more than recorded.</p>
        {r.provisional && (
          <p>
            This day&apos;s record is still open, so the recorded figures can still move with the
            day&apos;s sales.
          </p>
        )}
        {row.expectedCashInHand < 0 && (
          <p>
            Cash on Table was {exactMoney(row.expectedCashInHand, symbol)} — the day&apos;s cash expenses
            were more than its cash sales — so no cash is expected.
          </p>
        )}
        {row.autoFoodpanda > 0 && (
          <p>
            Foodpanda took {exactMoney(row.autoFoodpanda, symbol)}. It has no deposit channel and is
            not part of this comparison; if the branch deposited it through Easypaisa, Easypaisa
            reads over by that amount.
          </p>
        )}
        {showPending && <p>A deposit awaiting approval is never counted as received.</p>}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Deposits ({r.deposits.length})
        </p>
        {r.deposits.length === 0 ? (
          <p className="text-sm text-muted-foreground">No deposit has been submitted for this day.</p>
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
                    Cash {exactMoney(d.cashAmount, symbol)} · Easypaisa {exactMoney(d.easypaisaAmount, symbol)} · Bank{' '}
                    {exactMoney(d.bankAmount, symbol)}
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
        <a href={depositsHref(row.branchId, row.businessDate)} className={buttonVariants()}>
          Open in Cash Transfers
          <ArrowUpRight className="h-4 w-4" />
        </a>
      </DialogFooter>
    </>
  );
}
