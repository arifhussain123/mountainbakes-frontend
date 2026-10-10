'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  History,
  MoreHorizontal,
  Printer,
  RotateCcw,
  Scale,
  ShoppingCart,
  Wallet,
} from 'lucide-react';
import {
  DAILY_SALE_MAX_WINDOW_DAYS,
  DEPOSIT_RECON_STATUS_LABELS,
  businessDateStr,
  karachiDateStr,
  karachiTimeStr,
  type FinanceDailySaleRow,
} from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { useFinanceDailySales } from '@/lib/finance';
import { useBranches } from '@/lib/queries';
import { ROUTES } from '@/utils/routes';
import { addDays } from '@/components/dashboard/daily-sales/ranges';
import {
  ALL_BRANCHES,
  DailySaleFilters,
  DailySaleNotices,
  DailySaleSummaryCards,
} from '@/components/daily-sale/board';
import {
  dailySaleRecordColumns,
  daysBetween,
  displayDate,
  paisaMoney,
} from '@/components/daily-sale/columns';
import { DepositDifferenceBadge, DepositStatusBadge, money } from '@/components/daily-sale/parts';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatCard } from '@/components/shared/StatCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { DepositCheckDialog, FinanceDailySaleViewDialog, depositsHref } from './BranchSalesDialogs';

/**
 * BRANCH SALES — every branch's Daily Sale Record, as Finance audits it.
 *
 * ─── The same board the branch has ───────────────────────────────────────────
 * The cards, the notices, the window filters and the columns from Date to Source
 * are the branch page's own (components/daily-sale), imported rather than
 * re-drawn. The rows are the branch's too: `/api/finance/daily-sales` composes
 * them with the function the branch endpoint calls. Nobody re-enters a sale for
 * Finance to see it, and there is no second table for the two to disagree in.
 *
 * ─── What Finance adds ───────────────────────────────────────────────────────
 * Three columns after Source, and nothing before it: what Finance has RECEIVED
 * for the day (its approved cash deposits), the difference, and where the day
 * stands. That difference is recorded less received and sits apart from the
 * branch's own Difference column, which is counted less system — two questions,
 * asked of the same day, and neither answers the other.
 *
 * ─── What Finance cannot do here ─────────────────────────────────────────────
 * Generate, feed, verify, lock or amend. Those are the branch's and the admin's,
 * and the API refuses them to a finance role whatever a screen offers. The one
 * decision that is Finance's — whether a deposit arrived — is taken on Cash
 * Transfers, beside the slip's photo; every row links there.
 *
 * ─── One day at a time, by default ───────────────────────────────────────────
 * The branch page opens on thirty days because its question is "which days are
 * not signed off". Finance's is "what came in today", so this opens on today's
 * business date, with a step to the day either side. The From/To fields are the
 * same ones and still take a window.
 */
export function BranchSalesTab() {
  const { token } = useAuth();
  const { settings } = useSettings();
  const symbol = settings?.currencySymbol || 'Rs.';

  const today = businessDateStr();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [branchId, setBranchId] = useState<string>(ALL_BRANCHES);

  const branches = useBranches(token);
  const effectiveBranchId = branchId !== ALL_BRANCHES ? branchId : null;

  // The API caps the window, so a range wider than the cap is not requested at
  // all — the card below says so, which is more use than a failed request.
  const windowTooWide = daysBetween(from, to) > DAILY_SALE_MAX_WINDOW_DAYS;

  const { data, isLoading, isFetching, isError, error, refetch, dataUpdatedAt } = useFinanceDailySales({
    from,
    to,
    branchId: effectiveBranchId,
    enabled: !windowTooWide,
  });

  const [viewDay, setViewDay] = useState<{ branchId: string; businessDate: string } | null>(null);
  const [viewTab, setViewTab] = useState<'summary' | 'history'>('summary');
  const [viewPrint, setViewPrint] = useState(false);
  const [checkRow, setCheckRow] = useState<FinanceDailySaleRow | null>(null);

  const records = useMemo(() => data?.records ?? [], [data]);
  const summary = data?.summary;
  const recon = data?.reconciliation;
  const unmatched = data?.unmatchedDeposits ?? [];

  /** Move the whole window by a day, keeping its length. Never past today. */
  function step(days: number) {
    const nextTo = addDays(to, days);
    if (nextTo > today) return;
    setFrom(addDays(from, days));
    setTo(nextTo);
  }

  const columns = useMemo<ColumnDef<FinanceDailySaleRow>[]>(() => {
    function openView(row: FinanceDailySaleRow, tab: 'summary' | 'history', print = false) {
      setViewTab(tab);
      setViewPrint(print);
      setViewDay({ branchId: row.branchId, businessDate: row.businessDate });
    }

    return [
      ...dailySaleRecordColumns<FinanceDailySaleRow>({ symbol, showBranch: !effectiveBranchId }),
      {
        id: 'received',
        accessorFn: (r) => r.reconciliation.received.total,
        header: 'Received',
        meta: { align: 'right', mobileLabel: 'Received' },
        cell: ({ row }) => {
          const r = row.original.reconciliation;
          return (
            <div className="tabular-nums">
              <p className="font-semibold">{paisaMoney(r.received.total, symbol)}</p>
              {/* The figure it is measured against, on the row, so the column can
                  be read without opening anything. */}
              <p className="text-xs text-muted-foreground">of {paisaMoney(r.expected.total, symbol)}</p>
              {r.pending.total > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {paisaMoney(r.pending.total, symbol)} awaiting approval
                </p>
              )}
            </div>
          );
        },
        footer: ({ table }) => (
          <span className="tabular-nums">
            {paisaMoney(
              Math.round(
                table
                  .getFilteredRowModel()
                  .rows.reduce((s, r) => s + r.original.reconciliation.received.total, 0) * 100,
              ) / 100,
              symbol,
            )}
          </span>
        ),
      },
      {
        id: 'depositDifference',
        accessorFn: (r) => r.reconciliation.difference.total,
        header: 'Deposit Difference',
        meta: { align: 'center', mobileLabel: 'Deposit Difference' },
        cell: ({ row }) => {
          const r = row.original.reconciliation;
          // Nothing due and nothing deposited is not a zero worth a badge.
          if (r.status === 'nothing_due') return <span className="text-muted-foreground">—</span>;
          return (
            <div className="flex flex-col items-center gap-0.5">
              <DepositDifferenceBadge difference={r.difference.total} symbol={symbol} />
              {r.totalMatches && <span className="text-xs text-muted-foreground">channels differ</span>}
            </div>
          );
        },
      },
      {
        id: 'depositStatus',
        // The label, so the search box finds "discrepancy" and "not received".
        accessorFn: (r) => DEPOSIT_RECON_STATUS_LABELS[r.reconciliation.status],
        header: 'Deposit Status',
        meta: { align: 'center', mobileLabel: 'Deposit Status' },
        cell: ({ row }) => {
          const r = row.original.reconciliation;
          return (
            <div className="flex flex-col items-center gap-0.5">
              <DepositStatusBadge status={r.status} />
              {/* An open record's figures still move with the day's sales, so a
                  comparison against them is not yet the final one. */}
              {r.provisional && r.status !== 'nothing_due' && (
                <span className="text-xs text-muted-foreground">day still open</span>
              )}
            </div>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        meta: { align: 'right' },
        cell: ({ row }) => (
          <RowActions
            row={row.original}
            onView={() => openView(row.original, 'summary')}
            onHistory={() => openView(row.original, 'history')}
            onPrint={() => openView(row.original, 'summary', true)}
            onCheck={() => setCheckRow(row.original)}
          />
        ),
      },
    ];
  }, [symbol, effectiveBranchId]);

  // Rows on screen that the server has just failed to refresh. They are the
  // right day's rows and may be minutes or a day old (the cache outlives a
  // session), so they are shown as what they are rather than as current.
  const stale = isError && !!data;
  const outstanding = recon?.difference.total ?? 0;

  return (
    <div className="space-y-6">
      {/* ── Heading, and when these figures were read ── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Branch Daily Sale Records</h3>
          <p className="text-sm text-muted-foreground">
            Each branch&apos;s recorded sales for the day, against the deposits Finance has approved.
            Nothing on this tab changes a sale or a record.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {dataUpdatedAt > 0 && (
            <span className={cn('text-xs text-muted-foreground', stale && 'text-amber-700 dark:text-amber-400')}>
              {isFetching ? 'Refreshing…' : `Updated ${readAt(dataUpdatedAt)}`}
            </span>
          )}
          <Button variant="outline" size="sm" className="h-9" disabled={isFetching} onClick={() => void refetch()}>
            <RotateCcw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {stale && (
        <Card className="border-amber-300 dark:border-amber-900">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
            <span className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <span>
                These figures could not be refreshed and are not current — they were last read{' '}
                <strong>{readAt(dataUpdatedAt)}</strong>.{' '}
                {error instanceof Error ? error.message : ''}
              </span>
            </span>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {isError && !data ? (
        <EmptyState
          title="Could not load the branch sales"
          description={error instanceof Error ? error.message : 'Please try again.'}
          action={
            <Button variant="outline" onClick={() => void refetch()}>
              Retry
            </Button>
          }
        />
      ) : (
        <div className={cn('space-y-6', stale && 'opacity-70')}>
          {/* ── The branch page's own summary cards (§18) ── */}
          <DailySaleSummaryCards summary={summary} isLoading={isLoading} symbol={symbol} />

          {/* ── Recorded against received ── */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard title="To Hand Over" value={isLoading ? '…' : money(recon?.expected.total ?? 0, symbol)} icon={ShoppingCart} color="brown" loading={isLoading} />
            <StatCard title="Received" value={isLoading ? '…' : money(recon?.received.total ?? 0, symbol)} icon={Wallet} color="green" loading={isLoading} />
            <StatCard title="Awaiting Approval" value={isLoading ? '…' : money(recon?.pending.total ?? 0, symbol)} icon={Clock} color="orange" loading={isLoading} />
            <StatCard
              title={outstanding < 0 ? 'Received Over' : 'Not Yet Received'}
              value={isLoading ? '…' : money(Math.abs(outstanding), symbol)}
              icon={outstanding === 0 ? Banknote : Scale}
              color={outstanding === 0 ? 'green' : 'red'}
              loading={isLoading}
            />
          </div>

          <DailySaleNotices
            summary={summary}
            isLoading={isLoading}
            symbol={symbol}
            windowTooWide={windowTooWide}
          />

          {/* One card for everything about the deposits that wants a look, so
              three separate banners do not push the table off the screen. */}
          {!isLoading && recon && (recon.counts.discrepancy > 0 || recon.counts.pending > 0 || unmatched.length > 0) && (
            <Card className="border-amber-300 dark:border-amber-900">
              <CardContent className="space-y-2 p-4 text-sm">
                {recon.counts.discrepancy > 0 && (
                  <p className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <span>
                      {recon.counts.discrepancy}{' '}
                      {recon.counts.discrepancy === 1 ? 'branch day does' : 'branch days do'} not match the
                      money received. Open its deposit check and review it — nothing is corrected
                      automatically.
                    </span>
                  </p>
                )}

                {recon.counts.pending > 0 && (
                  <p className="flex items-start gap-2 text-muted-foreground">
                    <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <span>
                      {recon.counts.pending}{' '}
                      {recon.counts.pending === 1 ? 'branch day has' : 'branch days have'} a deposit awaiting
                      approval ({money(recon.pending.total, symbol)}). It is not counted as received until
                      it is approved on{' '}
                      <a
                        href={`${ROUTES.FINANCE_CASH_TRANSFERS}/`}
                        className="font-medium text-foreground underline underline-offset-2"
                      >
                        Cash Transfers
                      </a>
                      .
                    </span>
                  </p>
                )}

                {unmatched.length > 0 && (
                  <div className="flex items-start gap-2 text-muted-foreground">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <div className="space-y-1">
                      <p>
                        {unmatched.length === 1 ? 'A deposit is' : `${unmatched.length} deposits are`} dated on a
                        day with no recorded sales, so {unmatched.length === 1 ? 'it is' : 'they are'} not set
                        against any row below. A wrong date is corrected through the Help Desk.
                      </p>
                      <ul className="space-y-0.5">
                        {unmatched.map((d) => (
                          <li key={d.id} className="tabular-nums">
                            <a
                              href={depositsHref(d.branchId, d.businessDate)}
                              className="font-medium text-foreground underline underline-offset-2"
                            >
                              {d.transferNo}
                            </a>{' '}
                            · {d.branchName} · {displayDate(d.businessDate)} · {paisaMoney(d.amount, symbol)}
                            {d.status === 'pending' ? ' · awaiting approval' : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── The board ── */}
          <DataTable
            columns={columns}
            data={records}
            loading={isLoading}
            searchPlaceholder="Search by date, branch or status…"
            sortable
            pageSize={50}
            empty={
              <EmptyState
                icon={ShoppingCart}
                title="No sales recorded"
                description={
                  from === to
                    ? `No branch recorded a sale or an expense on ${displayDate(from)}.`
                    : `No branch recorded a sale or an expense between ${displayDate(from)} and ${displayDate(to)}.`
                }
                className="border-0"
              />
            }
            leading={
              <DailySaleFilters
                from={from}
                to={to}
                today={today}
                onFromChange={setFrom}
                onToChange={setTo}
                branch={{ value: branchId, onChange: setBranchId, branches: branches.data ?? [] }}
              >
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    aria-label="Previous day"
                    onClick={() => step(-1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    aria-label="Next day"
                    disabled={to >= today}
                    onClick={() => step(1)}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9"
                    disabled={from === today && to === today}
                    onClick={() => {
                      setFrom(today);
                      setTo(today);
                    }}
                  >
                    Today
                  </Button>
                </div>
              </DailySaleFilters>
            }
          />
        </div>
      )}

      <FinanceDailySaleViewDialog
        day={viewDay}
        onClose={() => {
          setViewDay(null);
          setViewPrint(false);
        }}
        settings={settings}
        initialTab={viewTab}
        autoPrint={viewPrint}
      />

      <DepositCheckDialog row={checkRow} onClose={() => setCheckRow(null)} symbol={symbol} />
    </div>
  );
}

/**
 * What Finance may do with a row: read it.
 *
 * View, History and Print are the branch's own popup, opened read-only. Every row
 * has them, including a day with sales and no stored record — the branch page
 * offers Generate there, which is a write and not Finance's to make.
 */
function RowActions({
  row,
  onView,
  onHistory,
  onPrint,
  onCheck,
}: {
  row: FinanceDailySaleRow;
  onView: () => void;
  onHistory: () => void;
  onPrint: () => void;
  onCheck: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Actions">
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={onView}>
          <Eye className="mr-2 h-4 w-4" /> View
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onPrint}>
          <Printer className="mr-2 h-4 w-4" /> Print
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onHistory}>
          <History className="mr-2 h-4 w-4" /> History
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onCheck}>
          <Scale className="mr-2 h-4 w-4" /> Deposit check
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => {
            window.location.assign(depositsHref(row.branchId, row.businessDate));
          }}
        >
          <ArrowUpRight className="mr-2 h-4 w-4" /> Open deposits
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** When a set of figures was read: the time today, the date as well on any other day. */
function readAt(timestamp: number): string {
  const d = new Date(timestamp);
  const time = karachiTimeStr(d);
  return karachiDateStr(d) === karachiDateStr() ? `at ${time}` : `on ${displayDate(karachiDateStr(d))} at ${time}`;
}
