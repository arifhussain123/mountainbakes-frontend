'use client';

import type { DemandRecordRow } from '@mb/shared';
import { useDemandRecordDetail, type DemandRecordScope } from '@/lib/finance';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatDate, formatDateTime } from '@/utils/date';
import { cn } from '@/lib/utils';
import { Money } from './finance-ui';

/**
 * One Demand Record row, opened: how each figure was reached, and every record
 * behind it. The lists come from the same rules the row was computed with
 * (services/branch-account.service.ts), so each section adds up to its figure.
 */
export function DemandRecordDetailDialog({
  row,
  onClose,
  scope = 'finance',
}: {
  row: DemandRecordRow | null;
  onClose: () => void;
  scope?: DemandRecordScope;
}) {
  const q = useDemandRecordDetail(row?.branchId ?? null, row?.orderId ?? null, scope);
  const d = q.data;
  const r = d?.row ?? row;

  return (
    <Dialog open={!!row} onOpenChange={(o) => !o && onClose()}>
      <DialogContent showCloseButton className="max-h-[90vh] overflow-y-auto md:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {r?.orderId ? `${r.demandNumber}` : 'Opening'} · {r?.branchName}
          </DialogTitle>
          <DialogDescription>
            {r?.orderId
              ? `Delivered demand of ${r ? formatDate(r.businessDate) : ''}, with everything up to the branch's next demand.`
              : "The branch's opening balance, and anything between the go-live day and its first demand."}
          </DialogDescription>
        </DialogHeader>

        {r && (
          <div className="space-y-5 text-sm">
            <Calculation row={r} />
            {r.open && (
              <Note tone="amber">No later demand yet, so returns and deposits made from now on still land in this row.</Note>
            )}
            {!r.pctFrozen && r.orderId && (
              <Note tone="amber">No share % was frozen for this demand, so today&apos;s {r.sharePct}% is used.</Note>
            )}
            {r.unpricedLines > 0 && (
              <Note tone="red">{r.unpricedLines} line(s) have no price on record and are counted at zero.</Note>
            )}

            {q.isLoading && <div className="h-32 animate-pulse rounded bg-muted" />}
            {q.isError && (
              <div className="flex items-center justify-between rounded border border-destructive/40 px-3 py-2">
                <span className="text-destructive">{q.error instanceof Error ? q.error.message : 'Could not load the records.'}</span>
                <Button variant="outline" size="sm" onClick={() => void q.refetch()}>Retry</Button>
              </div>
            )}
            {d && (
              <>
                {r.orderId && (
                  <Section title="Delivered" total={r.delivered}>
                    <SourceTable
                      headers={['Product', 'Ordered', 'Delivered', 'Unit price', 'Amount']}
                      rows={d.lines.map((l) => [
                        l.productName,
                        l.orderedQty,
                        l.deliveredQty,
                        l.unitPrice === null ? <span className="text-destructive">no price</span> : (
                          <span title={l.priceSource === 'order' ? 'Price on the demand line' : 'Price in force on the demand date'}>
                            <Money value={l.unitPrice} />{l.priceSource === 'price_history' && <span className="text-muted-foreground"> †</span>}
                          </span>
                        ),
                        <Money key="a" value={l.amount} />,
                      ])}
                    />
                    {d.lines.some((l) => l.priceSource === 'price_history') && (
                      <p className="mt-1 text-xs text-muted-foreground">† no price on the line (added at verification): the price in force on the demand date.</p>
                    )}
                  </Section>
                )}
                <Section title="Returns (accepted)" total={r.returns}>
                  <SourceTable
                    headers={['Date', 'Product', 'Qty', 'Unit price', 'Amount']}
                    rows={d.returns.map((x) => [formatDate(x.businessDate), x.productName, x.qty, x.unitPrice === null ? '—' : <Money key="u" value={x.unitPrice} />, <Money key="a" value={x.amount} />])}
                  />
                </Section>
                <Section title="Discounts (approved)" total={r.discount}>
                  <SourceTable
                    headers={['Claimed', 'Against', 'Reason', 'Amount']}
                    rows={d.discounts.map((x) => [formatDateTime(x.createdAt), x.linked ? 'this demand' : (x.demandNumber ?? '—'), x.reason, <Money key="a" value={x.amount} />])}
                  />
                </Section>
                <Section title="Share Received (approved cash transfers)" total={r.received}>
                  <SourceTable
                    headers={['Transfer', 'Voucher', 'Date', 'Amount']}
                    rows={d.payments.map((p) => [p.transferNo ?? '—', p.voucherNo ?? '—', formatDate(p.businessDate), <Money key="a" value={p.amount} />])}
                  />
                </Section>
                <Section title="Finance entries" total={r.adjustments}>
                  <SourceTable
                    headers={['Kind', 'Date', 'Reason', 'By', 'Amount']}
                    rows={d.adjustments.map((a) => [a.kind, formatDate(a.businessDate), a.reason, a.createdByName ?? '—', <Money key="a" value={a.amount} />])}
                  />
                </Section>
                <div className="rounded-lg border bg-muted/30 px-3 py-2">
                  <p className="font-medium">Actual Sales: <Money value={d.sales.amount} /> <span className="font-normal text-muted-foreground">({d.sales.count} sale(s), staff and cancelled excluded)</span></p>
                  <p className="text-xs text-muted-foreground">
                    Share on these sales at {r.sharePct}%: <Money value={r.shareOnSales} />. Shown for comparison only — what counts as
                    received is the approved cash above.
                  </p>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Calculation({ row: r }: { row: DemandRecordRow }) {
  const line = (label: string, value: number, opts?: { sign?: string; strong?: boolean; muted?: boolean }) => (
    <div className={cn('flex justify-between gap-4', opts?.strong && 'font-semibold', opts?.muted && 'text-muted-foreground')}>
      <span>{opts?.sign && <span className="inline-block w-4">{opts.sign}</span>}{label}</span>
      <Money value={value} />
    </div>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1 rounded-lg border px-3 py-2">
        {line('Delivered', r.delivered)}
        {line('Returns', r.returns, { sign: '−' })}
        {line('Discount', r.discount, { sign: '−' })}
        <div className="border-t" />
        {line('G. Total', r.gTotal, { strong: true })}
        <div className="flex justify-between gap-4 text-muted-foreground">
          <span>× Share %</span>
          <span className="tabular-nums">{r.sharePct}%{r.pctFrozen ? ' (frozen)' : " (today's)"}</span>
        </div>
        {line('Company Share', r.companyShare, { strong: true })}
      </div>
      <div className="space-y-1 rounded-lg border px-3 py-2">
        {line('Previous Balance', r.previousBalance)}
        {line('Company Share', r.companyShare, { sign: '+' })}
        {line('Adjustments', r.adjustments, { sign: '+' })}
        {line('Share Received', r.received, { sign: '−' })}
        <div className="border-t" />
        {line('Closing Balance', r.closingBalance, { strong: true })}
        <p className="text-xs text-muted-foreground">
          {r.closingBalance > 0 ? 'Still owed to the company.' : r.closingBalance < 0 ? 'Paid ahead: a credit for the branch.' : 'Settled.'}
        </p>
      </div>
    </div>
  );
}

function Section({ title, total, children }: { title: string; total: number; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="font-semibold">{title}</h4>
        <Money value={total} className="font-semibold" />
      </div>
      {children}
    </section>
  );
}

function SourceTable({ headers, rows }: { headers: string[]; rows: React.ReactNode[][] }) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">None.</p>;
  return (
    <div className="overflow-x-auto rounded border">
      <table className="w-full text-xs">
        <thead className="bg-muted/50">
          <tr>{headers.map((h, i) => <th key={h} className={cn('px-2 py-1.5 font-medium', i === headers.length - 1 ? 'text-right' : 'text-left')}>{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((cells, i) => (
            <tr key={i}>
              {cells.map((c, j) => <td key={j} className={cn('px-2 py-1.5 align-top', j === cells.length - 1 && 'text-right')}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Note({ tone, children }: { tone: 'amber' | 'red'; children: React.ReactNode }) {
  return (
    <p className={cn(
      'rounded border px-3 py-2 text-xs',
      tone === 'amber' && 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
      tone === 'red' && 'border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200',
    )}>
      {children}
    </p>
  );
}
