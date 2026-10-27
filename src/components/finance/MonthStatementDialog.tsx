'use client';

import { useState } from 'react';
import { balanceStanding, businessDateStr, type MonthStatement, type MonthStatementBranch } from '@mb/shared';
import { useMonthStatement, type DemandRecordScope } from '@/lib/finance';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDate } from '@/utils/date';
import { saveBlob } from '@/utils/saveBlob';
import { cn } from '@/lib/utils';
import { Download } from 'lucide-react';
import { Money } from './finance-ui';

/**
 * Month-end statement: each branch's month on one page, for sign-off — the
 * remaining payment (the Demand Record over the month) beside the remaining
 * stock (the stock ledger over the same days). Both are worked out by the API
 * (getMonthStatement); nothing here is summed except the all-branch line.
 *
 * The two never count the same goods twice: the company share is charged when
 * stock is DELIVERED, so stock still on hand at month end is already in the
 * payment. Selling it later changes nothing; returning it lowers the payment.
 */
export function MonthStatementDialog({
  open,
  onOpenChange,
  scope,
  startDate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  scope: DemandRecordScope;
  startDate: string;
}) {
  const thisMonth = businessDateStr().slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const q = useMonthStatement(month, scope, { enabled: open });
  const s = q.data;
  const many = (s?.branches.length ?? 0) > 1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton className="max-h-[90vh] overflow-y-auto md:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Month-end statement</DialogTitle>
          <DialogDescription>
            Remaining payment and remaining stock for the month. Stock left at month end was already charged when it was
            delivered: selling it later changes nothing, returning it lowers the payment.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <label htmlFor="month-statement-month" className="text-xs font-medium text-muted-foreground">Month</label>
            <Input
              id="month-statement-month"
              type="month"
              value={month}
              min={startDate.slice(0, 7)}
              max={thisMonth}
              onChange={(e) => e.target.value && setMonth(e.target.value)}
              className="h-11 w-44 md:h-9"
            />
          </div>
          {s && (
            <p className="pb-2 text-sm text-muted-foreground">
              {formatDate(s.from)} – {formatDate(s.to)} ·{' '}
              {s.complete ? 'month complete' : <span className="font-medium text-amber-700 dark:text-amber-400">month still running</span>}
            </p>
          )}
          <Button variant="outline" size="sm" className="ml-auto" disabled={!s} onClick={() => s && exportCsv(s)}>
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
        </div>

        {q.isLoading && <div className="h-48 animate-pulse rounded-lg bg-muted" />}
        {q.isError && (
          <div className="flex items-center justify-between rounded border border-destructive/40 px-3 py-2 text-sm">
            <span className="text-destructive">{q.error instanceof Error ? q.error.message : 'Could not load the statement.'}</span>
            <Button variant="outline" size="sm" onClick={() => void q.refetch()}>Retry</Button>
          </div>
        )}
        {s && (
          <div className="space-y-4">
            {many && <AllBranches statement={s} />}
            {s.branches.map((b) => <BranchStatement key={b.branchId} b={b} showName={many || scope === 'finance'} />)}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AllBranches({ statement }: { statement: MonthStatement }) {
  const sum = (f: (b: MonthStatementBranch) => number) => statement.branches.reduce((t, b) => t + f(b), 0);
  const pendingReturns = sum((b) => b.pending.returns.count);
  const pendingDeposits = sum((b) => b.pending.deposits.count);
  return (
    <section className="grid grid-cols-2 gap-3 rounded-lg border border-primary/40 bg-card p-4 sm:grid-cols-4">
      <Stat label="Closing balance, all branches"><Balance value={sum((b) => b.payment.closingBalance)} /></Stat>
      <Stat label="Share received"><Money value={sum((b) => b.payment.received)} /></Stat>
      <Stat label="Closing stock value"><Money value={sum((b) => b.stock.closingAmount)} /></Stat>
      <Stat label="Still pending">
        <span className={cn(pendingReturns + pendingDeposits > 0 && 'text-amber-700 dark:text-amber-400')}>
          {pendingReturns} returns · {pendingDeposits} deposits
        </span>
      </Stat>
    </section>
  );
}

function BranchStatement({ b, showName }: { b: MonthStatementBranch; showName: boolean }) {
  const p = b.payment;
  const st = b.stock;
  const pendingReturns = b.pending.returns;
  const pendingDeposits = b.pending.deposits;
  return (
    <section className="rounded-lg border bg-card">
      {showName && <h3 className="border-b px-4 py-2.5 text-sm font-semibold">{b.branchName.replace(/\s+branch$/i, '')}</h3>}
      <div className="grid gap-x-8 gap-y-4 p-4 md:grid-cols-2">
        <div>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Remaining payment</h4>
          <Line label="Opening balance" value={<Balance value={p.openingBalance} />} />
          <Line label="Delivered" value={<Money value={p.delivered} />} muted />
          <Line label="− Returns" value={<Money value={p.returns} />} muted />
          <Line label="− Discount" value={<Money value={p.discount} />} muted />
          <Line label="G. Total" value={<Money value={p.gTotal} />} muted />
          <Line label="+ Company share" value={<Money value={p.companyShare} />} />
          {p.adjustments !== 0 && <Line label="+ Adjustments" value={<Money value={p.adjustments} />} />}
          <Line label="− Share received" value={<Money value={p.received} className="text-emerald-700 dark:text-emerald-400" />} />
          <Line label="Closing balance" value={<Balance value={p.closingBalance} />} total />
          <p className="mt-1.5 text-xs text-muted-foreground">
            {p.demands} {p.demands === 1 ? 'demand' : 'demands'}.
            {p.lastRowOpen && ' The last one is still open: returns and deposits made before the next demand still land in it.'}
          </p>
        </div>
        <div>
          <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Remaining stock</h4>
          <StockLine label="Opening stock" qty={st.openingQty} amount={st.openingAmount} />
          <StockLine label="+ New stock" qty={st.newQty} amount={st.newAmount} />
          <StockLine label="− Sold" qty={st.soldQty} amount={st.soldAmount} />
          <StockLine label="− Returned" qty={st.returnedQty} amount={st.returnedAmount} />
          {st.adjustmentQty !== 0 && <StockLine label="± Adjustments" qty={st.adjustmentQty} amount={st.adjustmentAmount} signed />}
          <StockLine label="Closing stock" qty={st.closingQty} amount={st.closingAmount} total />
          <p className="mt-1.5 text-xs text-muted-foreground">Valued at today&apos;s prices, as on the Stock page.</p>
        </div>
      </div>
      {(pendingReturns.count > 0 || pendingDeposits.count > 0) && (
        <p className="border-t bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          Not decided yet:{' '}
          {pendingReturns.count > 0 && <>{pendingReturns.count} {pendingReturns.count === 1 ? 'return' : 'returns'} (<Money value={pendingReturns.amount} />) waiting for Production</>}
          {pendingReturns.count > 0 && pendingDeposits.count > 0 && ' · '}
          {pendingDeposits.count > 0 && <>{pendingDeposits.count} {pendingDeposits.count === 1 ? 'deposit' : 'deposits'} (<Money value={pendingDeposits.amount} />) waiting for Finance</>}
          . The figures change once these are decided.
        </p>
      )}
    </section>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-0.5 text-base font-semibold tabular-nums">{children}</div>
    </div>
  );
}

function Line({ label, value, muted, total }: { label: string; value: React.ReactNode; muted?: boolean; total?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-0.5 text-sm', muted && 'pl-3 text-xs text-muted-foreground', total && 'mt-1 border-t pt-1.5 font-semibold')}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}

const qtyText = (n: number) => n.toLocaleString('en-PK', { maximumFractionDigits: 3 });

function StockLine({ label, qty, amount, total, signed }: { label: string; qty: number; amount: number; total?: boolean; signed?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-0.5 text-sm', total && 'mt-1 border-t pt-1.5 font-semibold')}>
      <span>{label}</span>
      <span className="tabular-nums">
        {signed && qty > 0 ? '+' : ''}{qtyText(qty)} <span className="text-muted-foreground">·</span> <Money value={amount} />
      </span>
    </div>
  );
}

/** A balance with what it means: owed, settled, or paid ahead (a credit). */
function Balance({ value }: { value: number }) {
  const standing = balanceStanding(value);
  return (
    <span className="inline-flex items-baseline gap-1">
      <Money value={standing === 'credit' ? -value : value} className={cn(standing === 'credit' && 'text-emerald-700 dark:text-emerald-400')} />
      {standing !== 'owed' && <span className="text-[11px] font-normal text-muted-foreground">{standing === 'credit' ? 'credit' : 'settled'}</span>}
    </span>
  );
}

function exportCsv(s: MonthStatement) {
  const header = [
    'Branch', 'Opening Balance', 'Delivered', 'Returns', 'Discount', 'G. Total', 'Company Share', 'Adjustments',
    'Share Received', 'Closing Balance', 'Demands',
    'Opening Stock Qty', 'Opening Stock Value', 'New Stock Qty', 'New Stock Value', 'Sold Qty', 'Sold Value',
    'Returned Qty', 'Returned Value', 'Stock Adjustment Qty', 'Stock Adjustment Value', 'Closing Stock Qty', 'Closing Stock Value',
    'Pending Returns', 'Pending Returns Amount', 'Pending Deposits', 'Pending Deposits Amount',
  ];
  const lines = s.branches.map(({ branchName, payment: p, stock: st, pending }) => [
    branchName, p.openingBalance, p.delivered, p.returns, p.discount, p.gTotal, p.companyShare, p.adjustments,
    p.received, p.closingBalance, p.demands,
    st.openingQty, st.openingAmount, st.newQty, st.newAmount, st.soldQty, st.soldAmount,
    st.returnedQty, st.returnedAmount, st.adjustmentQty, st.adjustmentAmount, st.closingQty, st.closingAmount,
    pending.returns.count, pending.returns.amount, pending.deposits.count, pending.deposits.amount,
  ]);
  lines.push([]);
  lines.push([`${s.from} to ${s.to}${s.complete ? '' : ' (month still running)'}. Stock valued at today's prices.`]);
  const csv = [header, ...lines]
    .map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  const who = s.branches.length === 1 ? s.branches[0]!.branchName.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'all-branches';
  saveBlob(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }), `month-end-statement-${who}-${s.month}.csv`);
}
