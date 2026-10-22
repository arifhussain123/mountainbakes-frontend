'use client';

import { verifyDailySale, type MethodReconciliation, type VerifyRecordFields } from '@mb/shared';
import { MethodDiffBadge, VerificationBadge, exactMoney } from './parts';

/**
 * One day's counted money against its table — Cash, Easypaisa, and Bank where
 * the day had any — and whether the day is VERIFIED.
 *
 * Everything shown is `verifyDailySale` over the record, whose differences are
 * the database's own, so it follows the record: another day, another branch, a
 * re-read of the sales or a corrected count all arrive as a new record and the
 * panel re-states itself. Nothing here can change a figure.
 */

const TABLE_LABEL = { cash: 'Cash on Table', easypaisa: 'Easypaisa on Table', bank: 'Bank on Table' } as const;
const COUNTED_LABEL = { cash: 'Counted Cash', easypaisa: 'Received Easypaisa', bank: 'Received Bank' } as const;
const TITLE = { cash: 'Cash', easypaisa: 'Easypaisa', bank: 'Bank' } as const;

function MethodCard({ recon, symbol }: { recon: MethodReconciliation; symbol: string }) {
  const note =
    recon.status === 'short'
      ? 'Less than the table.'
      : recon.status === 'over'
        ? 'More than the table.'
        : recon.status === 'missing'
          ? 'Not entered yet.'
          : 'Matches the table exactly.';

  return (
    <div data-testid={`recon-${recon.method}`} className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{TITLE[recon.method]}</p>
        <MethodDiffBadge recon={recon} symbol={symbol} />
      </div>
      <dl className="space-y-1 text-sm">
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">
            {TABLE_LABEL[recon.method]}
            {recon.method === 'cash' ? <span className="block text-xs">cash sales less cash expense</span> : null}
          </dt>
          <dd className="tabular-nums">{recon.tableAmount === null ? '—' : exactMoney(recon.tableAmount, symbol)}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3">
          <dt className="text-muted-foreground">{COUNTED_LABEL[recon.method]}</dt>
          <dd className="tabular-nums">{recon.counted === null ? 'Not entered' : exactMoney(recon.counted, symbol)}</dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

export function ReconciliationPanel({ record, symbol = 'Rs.' }: { record: VerifyRecordFields; symbol?: string }) {
  const v = verifyDailySale(record, symbol);
  const methods = [v.cash, v.easypaisa, ...(v.bank ? [v.bank] : [])];
  return (
    <section aria-label="Cash and Easypaisa verification" className="space-y-2">
      <div className="flex items-center justify-between gap-2 border-b pb-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Counted vs Table</p>
        <VerificationBadge verified={v.verified} />
      </div>
      {!v.verified && (
        <p role="status" className="text-xs text-red-700 dark:text-red-400">
          Not verified: {v.problems.join(' · ')}
        </p>
      )}
      <div className={methods.length === 3 ? 'grid gap-3 sm:grid-cols-3' : 'grid gap-3 sm:grid-cols-2'}>
        {methods.map((m) => (
          <MethodCard key={m.method} recon={m} symbol={symbol} />
        ))}
      </div>
    </section>
  );
}
