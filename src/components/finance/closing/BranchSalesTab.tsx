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
  Info,
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
  businessDaysAgoStr,
  karachiDateStr,
  karachiTimeStr,
  type FinanceDailySaleRow,
} from '@mb/shared';
import { toast } from 'sonner';
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
import {
  DepositCheckDialog,
  FinanceDailySaleViewDialog,
  depositWindowHref,
  depositsHref,
} from './BranchSalesDialogs';

/** The window the tab opens on, in business days. The branch board's own default. */
const DEFAULT_WINDOW_DAYS = 30;

/**
 * The first business date this tab shows.
 *
 * Branches began handing their money over as cash deposits on this date. Every
 * day before it would read "Not received" — true, and meaningless, because there
 * was no deposit to receive — so those days are not listed at all, and the tab
 * says so where the list stops.
 */
const DEPOSITS_START_DATE = '2026-09-30';

/** The later of two 'YYYY-MM-DD' dates. */
const laterOf = (a: string, b: string) => (a > b ? a : b);

/**
 * The branch board's columns this tab leaves off: the branch's count of its own
 * drawer and its sign-off of that count; Cash Expense, which Cash on Table, still
 * shown, already has taken out of it; and Time, which is when the record was
 * generated and says nothing about the money.
 */
const BRANCH_ONLY_COLUMNS = new Set(['time', 'cashExpense', 'difference', 'status', 'source']);

/** How the Deposit Difference column says a row's deposit was found. */
const MATCH_LABELS = { amount: 'same amount', nearest: 'nearest amount', same_day: 'same day' } as const;

/** How many unmatched deposits the notice lists before it says "and N more". */
const UNMATCHED_SHOWN = 8;

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
 * ─── What Finance sees of it ─────────────────────────────────────────────────
 * The sales columns, Date to Discount, without Time and Cash Expense. The
 * branch's own Difference, Status and Source are left off too: they are about the
 * branch counting its drawer, which is the branch's sign-off and not what Finance
 * is checking. All of them are still in the View popup.
 *
 * The same figures are set out more tightly than on the branch board: no "Rs."
 * in front of the sales figures, every column right-aligned, and less space between
 * columns (`dense`), so the three finance columns at the end are on screen
 * without scrolling.
 *
 * ─── What Finance adds ───────────────────────────────────────────────────────
 * Three columns after them. What a branch owes the company for a day is that
 * day's Company Share, and it hands it over as a cash deposit — usually the day
 * after, so the deposit carries a later date than the sales it pays for. The API
 * finds each day's deposit by AMOUNT, among the branch's deposits dated that day
 * or the two days after it — the same amount, else the nearest within 999, else
 * the one dated that day — and each deposit is used once. Received is what was
 * found and approved; Deposit Difference is Company Share less Received.
 *
  * ─── What Finance cannot do here ─────────────────────────────────────────────
 * Generate, feed, verify, lock or amend. Those are the branch's and the admin's,
 * and the API refuses them to a finance role whatever a screen offers. The one
 * decision that is Finance's — whether a deposit arrived — is taken on Cash
 * Transfers, beside the slip's photo; every row links there.
 *
 * ─── It starts on 30 September 2026 ──────────────────────────────────────────
 * Cash deposits were not in use before then (DEPOSITS_START_DATE). Days before
 * it are not listed, the date fields and the step-back button stop there, and a
 * note under the table says why.
 *
 * ─── The same window as the branch page ──────────────────────────────────────
 * Thirty business days ending today, every branch, newest day first — one row
 * per branch per day, exactly as the branch board lists them. It opened on today
 * alone at first, and a business day that began at 02:00 has no sales for most of
 * the morning: the page a finance user met was an empty table. The step buttons
 * move the window by its own length, and Today narrows it to the one day.
 */
export function BranchSalesTab() {
  const { token } = useAuth();
  const { settings } = useSettings();
  const symbol = settings?.currencySymbol || 'Rs.';

  const today = businessDateStr();
  const defaultFrom = laterOf(businessDaysAgoStr(DEFAULT_WINDOW_DAYS - 1), DEPOSITS_START_DATE);
  const [from, setFromState] = useState(defaultFrom);
  const [to, setToState] = useState(today);

  /**
   * Both ends of the window stop at the start date. A date before it — typed, or
   * reached by stepping back — is moved up to it and the reason is said, rather
   * than the field silently refusing to change.
   */
  function clampToStart(value: string): string {
    if (value >= DEPOSITS_START_DATE) return value;
    toast.info(
      `Cash deposits started on ${displayDate(DEPOSITS_START_DATE)}. Earlier days are not shown here.`,
    );
    return DEPOSITS_START_DATE;
  }
  const setFrom = (value: string) => setFromState(clampToStart(value));
  const setTo = (value: string) => setToState(clampToStart(value));
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

  const windowDays = Math.max(1, daysBetween(from, to));
  const isDefaultWindow = to === today && from === defaultFrom;
  /** The list stops at the start date, so the note under the table is shown. */
  const atStart = from <= DEPOSITS_START_DATE;

  /**
   * Move the window back or forward by its own length — a day at a time when one
   * day is on show, a month at a time when thirty are. Never past today: the last
   * step forward stops with the window ending there.
   */
  function step(direction: -1 | 1) {
    const nextTo = addDays(to, direction * windowDays);
    const end = nextTo > today ? today : laterOf(nextTo, DEPOSITS_START_DATE);
    setFromState(laterOf(addDays(end, -(windowDays - 1)), DEPOSITS_START_DATE));
    setToState(end);
  }

  const columns = useMemo<ColumnDef<FinanceDailySaleRow>[]>(() => {
    function openView(row: FinanceDailySaleRow, tab: 'summary' | 'history', print = false) {
      setViewTab(tab);
      setViewPrint(print);
      setViewDay({ branchId: row.branchId, businessDate: row.businessDate });
    }

    const columns: ColumnDef<FinanceDailySaleRow>[] = [
      ...dailySaleRecordColumns<FinanceDailySaleRow>({
        symbol,
        showBranch: !effectiveBranchId,
        showSymbol: false,
      }).filter((column) => !BRANCH_ONLY_COLUMNS.has(column.id ?? '')),
      {
        id: 'received',
        accessorFn: (r) => r.reconciliation.received,
        header: 'Received',
        meta: { align: 'right', mobileLabel: 'Received' },
        cell: ({ row }) => {
          const r = row.original.reconciliation;
          return (
            <div className="tabular-nums">
              {/* Green, as Company Share beside it is red: what is owed, and what
                  has come in. */}
              <p className="font-bold text-emerald-600 dark:text-emerald-400">{paisaMoney(r.received, symbol)}</p>
              {/* The figure it is measured against, on the row, so the column can
                  be read without opening anything. */}
              <p className="text-xs text-muted-foreground">of {paisaMoney(r.expected, symbol)} share</p>
              {r.pending > 0 && (
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  {paisaMoney(r.pending, symbol)} awaiting approval
                </p>
              )}
            </div>
          );
        },
        footer: ({ table }) => (
          <span className="tabular-nums text-emerald-600 dark:text-emerald-400">
            {paisaMoney(
              Math.round(
                table.getFilteredRowModel().rows.reduce((s, r) => s + r.original.reconciliation.received, 0) * 100,
              ) / 100,
              symbol,
            )}
          </span>
        ),
      },
      {
        id: 'depositDifference',
        accessorFn: (r) => r.reconciliation.difference,
        header: 'Deposit Difference',
        meta: { mobileLabel: 'Deposit Difference' },
        cell: ({ row }) => {
          const r = row.original.reconciliation;
          // Nothing due and nothing deposited is not a zero worth a badge.
          if (r.status === 'nothing_due') return <span className="text-muted-foreground">—</span>;
          const dates = [...new Set(r.deposits.map((d) => displayDate(d.businessDate)))].join(', ');
          return (
            <div className="flex flex-col items-end gap-0.5">
              <DepositDifferenceBadge difference={r.difference} symbol={symbol} />
              {/* Which deposit, and how sure the pairing is: one of the same
                  amount, one within 999 of it, or only the one dated that day;
                  plus any that paid no day and were handed over this day. */}
              {r.match !== 'none' && (
                <span className="text-xs text-muted-foreground">
                  {MATCH_LABELS[r.match]}
                  {r.extraCount > 0 && r.match !== 'same_day' ? ` + ${r.extraCount} more that day` : ''} · {dates}
                </span>
              )}
            </div>
          );
        },
      },
      {
        id: 'depositStatus',
        // The label, so the search box finds "discrepancy" and "not received".
        accessorFn: (r) => DEPOSIT_RECON_STATUS_LABELS[r.reconciliation.status],
        header: 'Deposit Status',
        meta: { mobile: 'badge' },
        cell: ({ row }) => {
          const r = row.original.reconciliation;
          return (
            <div className="flex flex-col items-end gap-0.5">
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

    // Every column right-aligned, heading and cells together — set on the
    // column's meta, which is the one place that moves both (see table-meta.ts).
    // The shared figure columns arrive that way; this brings Date and the three
    // finance columns into line with them.
    return columns.map((column) => ({ ...column, meta: { ...column.meta, align: 'right' as const } }));
  }, [symbol, effectiveBranchId]);

  // Rows on screen that the server has just failed to refresh. They are the
  // right day's rows and may be minutes or a day old (the cache outlives a
  // session), so they are shown as what they are rather than as current.
  const stale = isError && !!data;
  const outstanding = recon?.difference ?? 0;

  return (
    <div className="space-y-6">
      {/* ── Heading, and when these figures were read ── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">Branch Daily Sale Records</h3>
          <p className="text-sm text-muted-foreground">
            Every branch&apos;s recorded sales, day by day, and its Company Share against the deposit
            received for it.
            This tab is for checking only: it changes no sale or record and posts nothing to the ledger.
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

          {/* ── Company Share against received ── */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard title="Company Share" value={isLoading ? '…' : money(recon?.expected ?? 0, symbol)} icon={ShoppingCart} color="brown" loading={isLoading} />
            <StatCard title="Received" value={isLoading ? '…' : money(recon?.received ?? 0, symbol)} icon={Wallet} color="green" loading={isLoading} />
            <StatCard title="Awaiting Approval" value={isLoading ? '…' : money(recon?.pending ?? 0, symbol)} icon={Clock} color="orange" loading={isLoading} />
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
                      {recon.counts.discrepancy === 1 ? 'branch day has' : 'branch days have'} no deposit of
                      the same amount as the Company Share; the nearest one within {symbol} 999 is shown
                      instead, or else the one deposited that day. Open
                      the deposit check and review it — nothing is corrected automatically.
                    </span>
                  </p>
                )}

                {recon.counts.pending > 0 && (
                  <p className="flex items-start gap-2 text-muted-foreground">
                    <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                    <span>
                      {recon.counts.pending}{' '}
                      {recon.counts.pending === 1 ? 'branch day has' : 'branch days have'} a deposit awaiting
                      approval ({money(recon.pending, symbol)}). It is not counted as received until
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
                        {unmatched.length === 1 ? 'A deposit in this window is' : `${unmatched.length} deposits in this window are`}{' '}
                        not set against any day: {unmatched.length === 1 ? 'it pays' : 'they pay'} no day by amount, and
                        there is no row for the day {unmatched.length === 1 ? 'it was' : 'they were'} handed over.
                      </p>
                      <ul className="space-y-0.5">
                        {unmatched.slice(0, UNMATCHED_SHOWN).map((d) => (
                          <li key={d.id} className="tabular-nums">
                            <a
                              href={depositsHref(d.branchId, d.businessDate, d.businessDate)}
                              className="font-medium text-foreground underline underline-offset-2"
                            >
                              {d.transferNo}
                            </a>{' '}
                            · {d.branchName} · {displayDate(d.businessDate)} · {paisaMoney(d.amount, symbol)}
                            {d.status === 'pending' ? ' · awaiting approval' : ''}
                          </li>
                        ))}
                        {unmatched.length > UNMATCHED_SHOWN && (
                          <li>and {unmatched.length - UNMATCHED_SHOWN} more — see Cash Transfers.</li>
                        )}
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
            dense
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
                earliest={DEPOSITS_START_DATE}
                onFromChange={setFrom}
                onToChange={setTo}
                branch={{ value: branchId, onChange: setBranchId, branches: branches.data ?? [] }}
              >
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    aria-label={windowDays === 1 ? 'Previous day' : `Previous ${windowDays} days`}
                    title={windowDays === 1 ? 'Previous day' : `Previous ${windowDays} days`}
                    disabled={atStart}
                    onClick={() => step(-1)}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-9 w-9"
                    aria-label={windowDays === 1 ? 'Next day' : `Next ${windowDays} days`}
                    title={windowDays === 1 ? 'Next day' : `Next ${windowDays} days`}
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
                      setFromState(today);
                      setToState(today);
                    }}
                  >
                    Today
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9"
                    disabled={isDefaultWindow}
                    onClick={() => {
                      setFromState(defaultFrom);
                      setToState(today);
                    }}
                  >
                    Last {DEFAULT_WINDOW_DAYS} days
                  </Button>
                </div>
              </DailySaleFilters>
            }
          />

          {/* Where the list stops, and why — placed under the table because the
              table runs newest first, so this is where the day before the start
              date would have been. */}
          {atStart && (
            <Card className="border-dashed">
              <CardContent className="flex items-start gap-2 p-4 text-sm text-muted-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <strong className="font-medium text-foreground">
                    {displayDate(addDays(DEPOSITS_START_DATE, -1))} and earlier are not shown.
                  </strong>{' '}
                  Cash deposits were not in use before {displayDate(DEPOSITS_START_DATE)}, so there is
                  no deposit to check those days against. Their sales are still on the Daily Sale
                  Records page.
                </span>
              </CardContent>
            </Card>
          )}
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
            window.location.assign(depositWindowHref(row));
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
