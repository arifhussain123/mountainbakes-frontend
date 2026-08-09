'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { businessDateStr, type FinanceDayClosing } from '@mb/shared';
import { useClosingHistory, useDayClosing, useFinanceMutation } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils';
import { FinancePageHeader, Money, ReadOnlyNotice, useFinanceAbilities } from './finance-ui';
import { DateFilter, FilterField } from './finance-actions';
import { CalendarCheck, Lock, LockOpen } from 'lucide-react';

/**
 * Daily Closing — the day's figures, and the act of signing them off.
 *
 * The carry-forward the brief asks for needs no code here and no stored number
 * anywhere: `finance_day_summary` computes a day's opening balance as everything
 * posted BEFORE it, so yesterday's closing IS today's opening by construction.
 * A stored running total would be a second source of truth that could drift from
 * the entries behind it, and the first person to find the drift would be an
 * auditor.
 *
 * Closing a day locks it: nothing may be posted into a closed date afterwards,
 * which is what keeps a signed-off closing balance the one that was signed off.
 * Corrections go to the current open day as adjustment entries.
 */
export function DailyClosingPage() {
  const abilities = useFinanceAbilities();
  const today = businessDateStr();

  const [date, setDate] = useState(today);
  const [confirming, setConfirming] = useState(false);

  const { data: closing, isLoading } = useDayClosing(date);
  const { data: history, isLoading: historyLoading } = useClosingHistory(30);

  const isClosed = closing?.status === 'closed';

  return (
    <div className="space-y-6">
      <FinancePageHeader
        title="Daily Closing"
        description="Opening and closing position for a business date. Yesterday's closing carries into today automatically."
        actions={
          abilities.approve &&
          !isClosed && (
            <Button size="sm" disabled={isLoading} onClick={() => setConfirming(true)}>
              <Lock className="h-3.5 w-3.5" />
              Close this day
            </Button>
          )
        }
      />

      <ReadOnlyNotice abilities={abilities} />

      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
        <FilterField label="Business date">
          {/* Future dates cannot be closed and have no figures — the picker says
              so rather than letting the server explain it after the fact. */}
          <DateFilter value={date} onChange={setDate} max={today} />
        </FilterField>
        {closing && (
          <Badge
            variant="secondary"
            className={cn(
              'mb-1 gap-1',
              isClosed
                ? 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
            )}
          >
            {isClosed ? <Lock className="h-3 w-3" /> : <LockOpen className="h-3 w-3" />}
            {isClosed ? 'Closed' : 'Open'}
          </Badge>
        )}
        {isClosed && closing?.closedByName && (
          <p className="mb-1.5 text-sm text-muted-foreground">
            Signed off by {closing.closedByName}
            {closing.closedAt ? ` on ${new Date(closing.closedAt).toLocaleString('en-PK')}` : ''}
          </p>
        )}
      </div>

      {/* The closing statement, in the order the brief lists it — which is also
          the order it is read aloud when a day is signed off. */}
      <Card>
        <CardContent className="p-5">
          <div className="grid grid-cols-1 gap-x-8 gap-y-1 sm:grid-cols-2">
            <ClosingLine label="Opening Balance" value={closing?.openingBalance} loading={isLoading} />
            <ClosingLine label="Cash in Hand" value={closing?.cashInHand} loading={isLoading} />
            <ClosingLine label="Total Income" value={closing?.totalIncome} loading={isLoading} tone="income" />
            <ClosingLine label="Bank Balance" value={closing?.bankBalance} loading={isLoading} />
            <ClosingLine label="Total Expenses" value={closing?.totalExpenses} loading={isLoading} tone="expense" />
            <ClosingLine label="Vouchers Posted" value={closing?.entryCount} loading={isLoading} count />
            <ClosingLine label="Net Balance" value={closing?.netBalance} loading={isLoading} signed />
            <ClosingLine label="Closing Balance" value={closing?.closingBalance} loading={isLoading} emphasis />
          </div>

          <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
            Net Balance is income less expenses for {date} alone. Closing Balance is the opening balance plus that
            net — and becomes the next day&apos;s opening balance.
          </p>
        </CardContent>
      </Card>

      {/* Recent closings */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Recent closings</h3>

        {historyLoading ? (
          <Skeleton className="h-48 w-full rounded-lg" />
        ) : (history ?? []).length === 0 ? (
          <EmptyState
            icon={CalendarCheck}
            title="No days closed yet"
            description="Closing a day locks its figures and stops anything else being posted into it."
          />
        ) : (
          <>
            <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    {['Date', 'Opening', 'Income', 'Expenses', 'Net', 'Cash', 'Bank', 'Closing', 'Closed By'].map((h) => (
                      <TableHead
                        key={h}
                        className={cn(
                          'text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                          !['Date', 'Closed By'].includes(h) && 'text-right',
                        )}
                      >
                        {h}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(history ?? []).map((c) => (
                    <TableRow
                      key={c.businessDate}
                      className="cursor-pointer hover:bg-muted/30"
                      onClick={() => setDate(c.businessDate)}
                    >
                      <TableCell className="whitespace-nowrap text-sm font-medium">{c.businessDate}</TableCell>
                      <TableCell className="text-right"><Money value={c.openingBalance} /></TableCell>
                      <TableCell className="text-right"><Money value={c.totalIncome} className="text-emerald-600 dark:text-emerald-400" /></TableCell>
                      <TableCell className="text-right"><Money value={c.totalExpenses} className="text-red-600 dark:text-red-400" /></TableCell>
                      <TableCell className="text-right"><Money value={c.netBalance} signed /></TableCell>
                      <TableCell className="text-right"><Money value={c.cashInHand} /></TableCell>
                      <TableCell className="text-right"><Money value={c.bankBalance} /></TableCell>
                      <TableCell className="text-right font-semibold"><Money value={c.closingBalance} /></TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.closedByName ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-3 md:hidden">
              {(history ?? []).map((c) => (
                <ClosingCard key={c.businessDate} closing={c} onOpen={() => setDate(c.businessDate)} />
              ))}
            </div>
          </>
        )}
      </div>

      <CloseDayDialog
        open={confirming}
        onOpenChange={setConfirming}
        date={date}
        closing={closing}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------

function ClosingLine({
  label,
  value,
  loading,
  emphasis,
  signed,
  count,
  tone,
}: {
  label: string;
  value: number | undefined;
  loading?: boolean;
  emphasis?: boolean;
  signed?: boolean;
  /** A plain integer, not money — the voucher count. */
  count?: boolean;
  tone?: 'income' | 'expense';
}) {
  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 border-b py-2.5 last:border-b-0',
        emphasis && 'border-b-0 font-semibold',
      )}
    >
      <span className={cn('text-sm', emphasis ? 'font-semibold' : 'text-muted-foreground')}>{label}</span>
      {loading ? (
        <Skeleton className="h-5 w-24" />
      ) : count ? (
        <span className="tabular-nums font-medium">{value ?? 0}</span>
      ) : (
        <Money
          value={value}
          signed={signed}
          className={cn(
            emphasis && 'text-lg font-bold',
            tone === 'income' && 'text-emerald-600 dark:text-emerald-400',
            tone === 'expense' && 'text-red-600 dark:text-red-400',
          )}
        />
      )}
    </div>
  );
}

function ClosingCard({ closing, onOpen }: { closing: FinanceDayClosing; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="w-full rounded-lg border bg-card p-3 text-left">
      <div className="flex items-center justify-between">
        <span className="font-medium">{closing.businessDate}</span>
        <Money value={closing.closingBalance} className="font-semibold" />
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <div className="flex items-baseline justify-between">
          <dt className="text-muted-foreground">Opening</dt>
          <dd className="font-medium"><Money value={closing.openingBalance} /></dd>
        </div>
        <div className="flex items-baseline justify-between">
          <dt className="text-muted-foreground">Net</dt>
          <dd className="font-medium"><Money value={closing.netBalance} signed /></dd>
        </div>
        <div className="flex items-baseline justify-between">
          <dt className="text-muted-foreground">Income</dt>
          <dd className="font-medium"><Money value={closing.totalIncome} /></dd>
        </div>
        <div className="flex items-baseline justify-between">
          <dt className="text-muted-foreground">Expenses</dt>
          <dd className="font-medium"><Money value={closing.totalExpenses} /></dd>
        </div>
      </dl>
    </button>
  );
}

/**
 * Confirm and close.
 *
 * The API refuses to close a day that still has anything awaiting approval, and
 * says how many — that message is surfaced verbatim, because "3 items for
 * 2026-08-06 are still awaiting approval" is more useful than anything this
 * dialog could paraphrase.
 */
function CloseDayDialog({
  open,
  onOpenChange,
  date,
  closing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  date: string;
  closing: FinanceDayClosing | undefined;
}) {
  const [notes, setNotes] = useState('');
  const mut = useFinanceMutation();

  async function submit() {
    try {
      await mut.mutateAsync({
        path: '/api/finance/closing',
        body: { businessDate: date, notes: notes.trim() || null },
      });
      toast.success(`${date} closed and locked`);
      setNotes('');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not close this day');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>Close {date}</DialogTitle>
          <DialogDescription>
            These figures become the day&apos;s signed-off record. Nothing further can be posted into {date}; later
            corrections go to the current open day as adjustment entries.
          </DialogDescription>
        </DialogHeader>

        {closing && (
          <div className="space-y-1.5 rounded-lg border bg-muted/40 p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Opening balance</span>
              <Money value={closing.openingBalance} />
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Income</span>
              <Money value={closing.totalIncome} />
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Expenses</span>
              <Money value={closing.totalExpenses} />
            </div>
            <div className="flex justify-between border-t pt-1.5 font-semibold">
              <span>Closing balance</span>
              <Money value={closing.closingBalance} />
            </div>
          </div>
        )}

        <div className="space-y-1">
          <Label>Notes (optional)</Label>
          <Textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything worth recording against this day"
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={mut.isPending} onClick={() => void submit()}>
            {mut.isPending ? 'Closing…' : 'Close and lock'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
