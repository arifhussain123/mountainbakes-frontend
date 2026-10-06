'use client';

import { useEffect } from 'react';
import type { BranchStockHistoryRow, StockReconciliation } from '@mb/shared';

import { useBranchStockDay, useBranchStockHistory } from '@/lib/queries';
import { useStockRealtime } from '@/hooks/useStockRealtime';
import { Skeleton } from '@/components/ui/skeleton';
import { endDifference } from '@/components/stock/BranchStockStatement';
import { addDays } from '../daily-sales/ranges';
import { logger } from '@/utils/logger';
import { cn } from '@/lib/utils';

import { Panel, PanelEmpty, SectionBanner, SectionError, Tile } from './parts';
import { barPct, dayLabel, fullDate } from './model';

/** The history table always reads a week — this is a dashboard card, not a report. */
const HISTORY_DAYS = 7;

const GAIN = 'text-emerald-600 dark:text-emerald-400';
const LOSS = 'text-red-600 dark:text-red-400';

/**
 * The stock half of the dashboard: today's ledger three ways (statement, tiles,
 * flow bars) and the last seven business days as a table.
 *
 * AMOUNTS ARE STOCK VALUED AT TODAY'S PRICE LIST, not money taken — Sold here is
 * `units × current price` and will differ from Sales above. See
 * `BranchStockHistoryCard` for why that is the design.
 *
 * Today and seven days, whatever the period toggle says: what is on the shelf
 * is a fact about now.
 */
export function StockSection({
  token,
  branchId,
  today,
  money,
}: {
  token: string;
  branchId: string | null;
  today: string;
  money: (n: number) => string;
}) {
  const dayQ = useBranchStockDay(token, { date: today, branchId });
  const historyQ = useBranchStockHistory(token, { branchId, days: HISTORY_DAYS });
  // Same invalidation stream the Stock page rides: a sale or a Production
  // approval moves stock, and this section is a view of exactly those movements.
  useStockRealtime();

  useEffect(() => {
    if (dayQ.error) logger.error('Branch dashboard: stock day request failed', dayQ.error);
    if (historyQ.error) logger.error('Branch dashboard: stock history request failed', historyQ.error);
  }, [dayQ.error, historyQ.error]);

  const row = dayQ.data?.row ?? null;
  const loading = dayQ.isPending;

  return (
    <>
      <SectionBanner title="Stock" tone="expense">
        <span className="text-[11px] text-white/75">Valued at current prices · {fullDate(today)}</span>
      </SectionBanner>

      {dayQ.isError && !row ? (
        <SectionError what="today's stock" onRetry={() => dayQ.refetch()} retrying={dayQ.isFetching} />
      ) : (
        <div className="flex flex-wrap gap-3">
          <Panel title="Stock Detail" tone="warm" className="flex-[1_1_300px]" bodyClassName="px-3.5 pt-1 pb-2.5">
            {loading || !row ? (
              <div className="space-y-2 py-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : (
              <StockLedger row={row} reconciliation={dayQ.data?.reconciliation ?? null} money={money} />
            )}
          </Panel>

          <div className="grid min-w-0 flex-[1_1_300px] grid-cols-2 content-start gap-2.5">
            <Tile
              label="Previous"
              value={money(row?.openingAmount ?? 0)}
              note={row ? `${qty(row.openingQty)} items carried in` : undefined}
              swatch="bg-fin-ink-muted"
              loading={loading}
            />
            <Tile
              label="New Stock"
              value={money(row?.newAmount ?? 0)}
              note={row ? `${qty(row.newQty)} items` : undefined}
              swatch="bg-emerald-600"
              loading={loading}
            />
            <Tile
              label="Sold"
              value={money(row?.soldAmount ?? 0)}
              note={row ? `${qty(row.soldQty)} items` : undefined}
              swatch="bg-primary"
              loading={loading}
            />
            <Tile
              label="Remaining"
              value={money(row?.balanceAmount ?? 0)}
              note={row ? `${qty(row.balanceQty)} items · ${qty(endDifference(row).qty)} difference` : undefined}
              swatch="bg-primary"
              inverted
              loading={loading}
            />
          </div>

          <Panel title="Stock Flow · Qty" tone="warm" className="flex-[1_1_300px]">
            {loading || !row ? <Skeleton className="h-[202px] w-full" /> : <StockFlow row={row} />}
          </Panel>
        </div>
      )}

      <Panel
        title={`Branch Stock History · ${HISTORY_DAYS} days`}
        tone="warm"
        bodyClassName="p-0"
        aside={
          <span className="text-[11px] text-muted-foreground">
            Sold is valued at current prices, not the till total
          </span>
        }
      >
        {historyQ.isPending ? (
          <div className="space-y-2 p-3.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : historyQ.isError && !historyQ.data ? (
          <div className="p-3.5">
            <SectionError
              what="stock history"
              onRetry={() => historyQ.refetch()}
              retrying={historyQ.isFetching}
            />
          </div>
        ) : (historyQ.data?.rows ?? []).length === 0 ? (
          <PanelEmpty>Days appear here once stock starts moving in this branch.</PanelEmpty>
        ) : (
          <>
            <StockHistory rows={historyQ.data!.rows} money={money} />
            {/* Only when the ledger read actually hit its cap. Silence would read
                as "this is the whole period". */}
            {historyQ.data!.capped && (
              <p className="border-t px-3.5 py-2 text-[11px] text-muted-foreground">
                Too much history to summarise in one read — showing from {fullDate(historyQ.data!.from)} onwards.
              </p>
            )}
          </>
        )}
      </Panel>
    </>
  );
}

function qty(n: number): string {
  return Math.round(n).toLocaleString();
}

function signedQty(n: number): string {
  // A real minus sign, not a hyphen, so the column of figures lines up.
  return n > 0 ? `+${qty(n)}` : n < 0 ? `−${qty(-n)}` : qty(n);
}

const LEDGER_GRID = 'grid grid-cols-[1fr_56px_96px] items-center gap-2';

/**
 * One business day as a statement.
 *
 * Every line is the API's figure. The closing balance is printed, not re-added;
 * "End difference" is what the lines above fail to account for and is zero on a
 * healthy day.
 */
function StockLedger({
  row,
  reconciliation,
  money,
}: {
  row: BranchStockHistoryRow;
  reconciliation: StockReconciliation | null;
  money: (n: number) => string;
}) {
  const diff = endDifference(row);
  const lines: { key: string; label: string; date: string; qty: string; amount: number; tone?: string; bold?: boolean }[] =
    [
      { key: 'opening', label: 'Previous balance', date: addDays(row.date, -1), qty: qty(row.openingQty), amount: row.openingAmount },
      { key: 'new', label: 'New stock items', date: row.date, qty: signedQty(row.newQty), amount: row.newAmount, tone: GAIN },
      { key: 'sold', label: 'Sale stock items', date: row.date, qty: signedQty(-row.soldQty), amount: row.soldAmount, tone: LOSS },
    ];
  // Shown only on the days they happened, so the common day stays five lines.
  if (row.returnedQty !== 0 || row.returnedAmount !== 0) {
    lines.push({ key: 'returned', label: 'Returned to production', date: row.date, qty: signedQty(-row.returnedQty), amount: row.returnedAmount, tone: 'text-amber-600 dark:text-amber-400' });
  }
  if (row.adjustmentQty !== 0 || row.adjustmentAmount !== 0) {
    lines.push({ key: 'adjustment', label: 'Stock adjustment', date: row.date, qty: signedQty(row.adjustmentQty), amount: row.adjustmentAmount, tone: 'text-sky-600 dark:text-sky-400' });
  }
  lines.push(
    { key: 'balance', label: 'Remaining stock items', date: row.date, qty: qty(row.balanceQty), amount: row.balanceAmount, bold: true, tone: row.balanceQty < 0 ? 'text-destructive' : undefined },
    { key: 'difference', label: 'End difference', date: row.date, qty: qty(diff.qty), amount: diff.amount, tone: diff.isZero ? undefined : 'text-destructive' },
  );

  return (
    <div role="table" aria-label={`Stock detail for ${fullDate(row.date)}`}>
      <div
        role="row"
        className={cn(LEDGER_GRID, 'border-b py-[7px] text-[9px] font-bold tracking-[0.06em] text-muted-foreground uppercase')}
      >
        <span role="columnheader">Detail</span>
        <span role="columnheader" className="text-right">Qty</span>
        <span role="columnheader" className="text-right">Amount</span>
      </div>
      {lines.map((l) => (
        <div key={l.key} role="row" className={cn(LEDGER_GRID, 'border-b border-border/60 py-[7px] text-xs')}>
          <div role="cell" className="min-w-0">
            <div className={l.bold ? 'font-extrabold' : 'font-medium'}>{l.label}</div>
            <div className="text-[10px] text-muted-foreground">{fullDate(l.date)}</div>
          </div>
          <span role="cell" className={cn('text-right font-bold tabular-nums', l.tone)}>{l.qty}</span>
          <span role="cell" className={cn('text-right font-bold tabular-nums', l.tone)}>{money(l.amount)}</span>
        </div>
      ))}
      <ReconciliationNote reconciliation={reconciliation} />
    </div>
  );
}

/**
 * Whether this statement agrees with the Stock page's per-product balances.
 * Says nothing when the API sent no cross-check — absent is not "agrees".
 */
function ReconciliationNote({ reconciliation }: { reconciliation: StockReconciliation | null }) {
  if (!reconciliation) return null;
  if (reconciliation.difference === 0) {
    return <p className={cn('mt-2 text-[11px] font-semibold', GAIN)}>✓ Agrees with the Stock page</p>;
  }
  return (
    <div className="mt-2 text-[11px] text-destructive">
      <p className="font-semibold">
        Differs from the Stock page by {signedQty(reconciliation.difference)} ({qty(reconciliation.statementQty)} here,{' '}
        {qty(reconciliation.itemsQty)} there)
      </p>
      {reconciliation.reasons.length > 0 && (
        <p className="text-muted-foreground">
          {reconciliation.reasons.map((r) => `${r.productName} ${signedQty(r.qty)}`).join(' · ')}
        </p>
      )}
    </div>
  );
}

function StockFlow({ row }: { row: BranchStockHistoryRow }) {
  const bars = [
    { label: 'Previous', qty: row.openingQty, fill: 'bg-fin-ink-muted' },
    { label: 'New stock', qty: row.newQty, fill: 'bg-fin-share' },
    { label: 'Sold', qty: row.soldQty, fill: 'bg-primary' },
    { label: 'Remaining', qty: row.balanceQty, fill: 'bg-fin-ledger' },
  ];
  const max = Math.max(...bars.map((b) => b.qty));

  return (
    <div
      role="img"
      aria-label={bars.map((b) => `${b.label} ${qty(b.qty)}`).join(', ')}
      className="grid h-[202px] grid-cols-4 items-end gap-4"
    >
      {bars.map((b) => (
        <div key={b.label} className="flex h-full flex-col items-center justify-end gap-1">
          <span className="text-[11px] font-extrabold tabular-nums">{qty(b.qty)}</span>
          {/* 78% ceiling leaves the tallest bar room for its figure and label. */}
          <div
            className={cn('w-full max-w-12 rounded-t-[2px]', b.fill)}
            style={{ height: `${barPct(b.qty, max) * 0.78}%`, minHeight: b.qty > 0 ? 2 : 0 }}
          />
          <span className="text-center text-[10px] leading-tight text-muted-foreground">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

const HISTORY_GRID = 'grid grid-cols-[1.1fr_repeat(5,1fr)] items-center gap-2 px-3.5 py-2';

/**
 * `Ret / Adj` is what makes a row add up — returns to Production and admin
 * corrections, netted and signed, so Previous + New − Sold + Ret/Adj = Remaining.
 */
function StockHistory({ rows, money }: { rows: BranchStockHistoryRow[]; money: (n: number) => string }) {
  return (
    <div className="overflow-x-auto">
      <div role="table" aria-label="Branch stock history" className="min-w-[640px]">
        <div
          role="row"
          className={cn(HISTORY_GRID, 'border-b text-[9px] font-bold tracking-[0.06em] text-muted-foreground uppercase')}
        >
          <span role="columnheader">Date</span>
          {['Previous', 'New', 'Sold', 'Ret / Adj', 'Remaining'].map((h) => (
            <span key={h} role="columnheader" className="text-right">
              {h}
            </span>
          ))}
        </div>
        {rows.map((r) => {
          const otherQty = r.adjustmentQty - r.returnedQty;
          const otherAmount = r.adjustmentAmount - r.returnedAmount;
          return (
            <div
              key={r.date}
              role="row"
              className={cn(HISTORY_GRID, 'border-b border-border/60 transition-colors last:border-b-0 hover:bg-fin-row-hover')}
            >
              <span role="cell" className="text-xs font-bold">{dayLabel(r.date)}</span>
              <Figure q={qty(r.openingQty)} a={money(r.openingAmount)} />
              <Figure q={qty(r.newQty)} a={money(r.newAmount)} tone={r.newQty ? GAIN : undefined} />
              <Figure q={qty(r.soldQty)} a={money(r.soldAmount)} tone={r.soldQty ? LOSS : undefined} />
              {otherQty === 0 && otherAmount === 0 ? (
                <Figure q="—" a="" tone="text-muted-foreground/60" />
              ) : (
                <Figure q={signedQty(otherQty)} a={money(otherAmount)} tone="text-fin-share" />
              )}
              <Figure
                q={qty(r.balanceQty)}
                a={money(r.balanceAmount)}
                tone={r.balanceQty < 0 ? 'text-destructive' : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Quantity over amount — the shape every history cell takes. */
function Figure({ q, a, tone }: { q: string; a: string; tone?: string }) {
  return (
    <div role="cell" className="text-right">
      <div className={cn('text-xs font-extrabold tabular-nums', tone)}>{q}</div>
      <div className="text-[10px] text-muted-foreground tabular-nums">{a}</div>
    </div>
  );
}
