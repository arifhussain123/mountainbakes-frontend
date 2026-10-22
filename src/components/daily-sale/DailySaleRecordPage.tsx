'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  CheckCircle2,
  Eye,
  History,
  Info,
  Lock,
  LockOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  DAILY_SALE_MAX_WINDOW_DAYS,
  businessDateStr,
  isDailySaleRecordOpen,
  verifyDailySale,
  type DailySaleRecord,
} from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import {
  useBranches,
  useDailySaleRecords,
  useDecideDailySale,
  useGenerateDailySaleRecord,
} from '@/lib/queries';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { formatDate } from '@/utils/date';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AmendDialog } from './AmendDialog';
import { ALL_BRANCHES, DailySaleFilters, DailySaleNotices, DailySaleSummaryCards } from './board';
import { dailySaleRecordColumns, daysBetween } from './columns';
import { DailySaleViewDialog } from './DailySaleViewDialog';
import { ManualFeedDialog } from './ManualFeedDialog';
import { MethodDiffBadge, VerificationBadge, money } from './parts';
import { PaymentLockPanel } from './PaymentLockPanel';
import { UnlockDialog } from './UnlockDialog';

/**
 * The first business date this board lists. The record was not kept before it,
 * so earlier days are never asked of the API — not listed and not in the
 * summary cards, even where sales exist for them — and a window that reaches
 * back past it says so. The date fields still accept an earlier day: the
 * message is the answer to picking one.
 */
const DAILY_SALE_START_DATE = '2026-09-01';
/** The last day NOT shown — the one the message names. */
const DAILY_SALE_LAST_UNSHOWN_DATE = '2026-08-31';

/**
 * DAILY SALE RECORD — the branch's daily financial reconciliation.
 *
 * ─── One component, two routes ───────────────────────────────────────────────
 * `/branch-daily-sale` (branch roles) and `/daily-sale-records` (admin) render
 * this same file, because they are the same board asked of different scopes. Two
 * routes rather than one because RouteGuard maps every `/branch-` prefix to the
 * branch roles and would bounce a super admin off its own screen — the trap
 * ROUTES.BRANCH_LOCATIONS documents. `admin` switches on the branch picker, the
 * lock panel and the closing actions; it does NOT decide what is permitted. The
 * API re-decides every request against the JWT.
 *
 * ─── What this screen is, next to Branch Closing ─────────────────────────────
 * Branch Closing is a read of the day that writes nothing. This writes a record
 * with a status machine, an audit trail and a lock behind it: the day's takings
 * per payment method, what a person physically counted against each, the
 * difference, and who signed it off.
 *
 * ─── Nothing here adds up money ──────────────────────────────────────────────
 * Every figure — totals, per-method takings, cash expense, discount, difference,
 * and the summary cards — arrives computed from `/api/daily-sale-records`, which
 * aggregates in Postgres (migration 101). The only arithmetic in this file is
 * `Math.round` for display.
 */
export function DailySaleRecordPage({ admin = false }: { admin?: boolean }) {
  const { token, user } = useAuth();
  const { settings } = useSettings();
  const symbol = settings?.currencySymbol || 'Rs.';

  // The current month so far: its 1st to today, by business date. A window
  // rather than a single date because the question is nearly always "which days
  // are still not signed off", and a one-day view cannot answer it.
  const [from, setFrom] = useState(() => `${businessDateStr().slice(0, 7)}-01`);
  const [to, setTo] = useState(() => businessDateStr());
  const [branchId, setBranchId] = useState<string>(ALL_BRANCHES);

  const branches = useBranches(token, { enabled: admin });
  // A branch role's scope comes off its JWT, so it never sends one; an admin
  // sends the picked branch, or nothing for the consolidated view.
  const effectiveBranchId = admin && branchId !== ALL_BRANCHES ? branchId : null;

  // The API caps the window, so a range wider than the cap is not requested at
  // all — the card below says so, which is more use than a failed request.
  /** The window reaches back before the board's start, so the notice above the table is shown. */
  const beforeStart = from < DAILY_SALE_START_DATE;
  /** The whole window is before the start: nothing is requested and the table says why. */
  const allBeforeStart = to < DAILY_SALE_START_DATE;
  // What is actually asked for never starts before the start date.
  const queryFrom = beforeStart ? DAILY_SALE_START_DATE : from;

  const windowTooWide = !allBeforeStart && daysBetween(queryFrom, to) > DAILY_SALE_MAX_WINDOW_DAYS;

  const { data, isLoading } = useDailySaleRecords(token, {
    from: queryFrom,
    to,
    branchId: effectiveBranchId,
    enabled: !windowTooWide && !allBeforeStart,
  });

  const generate = useGenerateDailySaleRecord(token);
  const decide = useDecideDailySale(token);

  const [feedRow, setFeedRow] = useState<DailySaleRecord | null>(null);
  const [viewId, setViewId] = useState<string | null>(null);
  const [viewTab, setViewTab] = useState<'summary' | 'history'>('summary');
  const [viewPrint, setViewPrint] = useState(false);
  const [amendRow, setAmendRow] = useState<DailySaleRecord | null>(null);
  const [unlockRow, setUnlockRow] = useState<DailySaleRecord | null>(null);
  const [locksOpen, setLocksOpen] = useState(false);

  // Memoised, not `data?.records ?? []`: that literal is a fresh array on every
  // render, and it feeds the `todayRow` memo below — which would then recompute
  // on every keystroke in the search box.
  const records = useMemo(() => data?.records ?? [], [data]);
  const summary = data?.summary;
  const locks = data?.locks ?? [];

  const today = businessDateStr();

  /** The record for today, if the window on show includes it. Drives the top-right button. */
  const todayRow = useMemo(
    () =>
      records.find(
        (r) => r.businessDate === today && (!effectiveBranchId || r.branchId === effectiveBranchId),
      ) ?? null,
    [records, today, effectiveBranchId],
  );

  function openView(row: DailySaleRecord, tab: 'summary' | 'history', print = false) {
    if (!row.id) {
      // A row with no id has sales but no stored record. Generating it is the
      // action, not an error — but it is a WRITE, so it is never done silently on
      // the way to a read.
      toast.info('Generate this day’s record first');
      return;
    }
    setViewTab(tab);
    setViewPrint(print);
    setViewId(row.id);
  }

  async function runGenerate(businessDate: string, forBranch: string | null) {
    try {
      await generate.mutateAsync({
        businessDate,
        ...(forBranch ? { branchId: forBranch } : {}),
      });
      toast.success('Record generated from the day’s sales');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not generate the record');
    }
  }

  async function runDecide(row: DailySaleRecord, action: 'verify' | 'lock') {
    if (!row.id) return;
    try {
      await decide.mutateAsync({ id: row.id, action });
      toast.success(action === 'verify' ? 'Record verified' : 'Record locked');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the record');
    }
  }

  const columns = useMemo<ColumnDef<DailySaleRecord>[]>(
    () => [
      ...dailySaleRecordColumns({ symbol, showBranch: !effectiveBranchId }),
      // Counted money against the table: Cash on Table vs counted cash, and
      // Easypaisa on table vs received, each with its signed difference (the
      // database's own), then the day — VERIFIED only when every required figure
      // matches exactly. The Difference column above adds all methods together.
      ...(['cash', 'easypaisa'] as const).map<ColumnDef<DailySaleRecord>>((method) => ({
        id: `${method}Check`,
        accessorFn: (r) => verifyDailySale(r)[method].difference,
        header: method === 'cash' ? 'Counted Cash' : 'Received Easypaisa',
        enableSorting: false,
        meta: { align: 'center' },
        cell: ({ row }) => {
          const m = verifyDailySale(row.original, symbol)[method];
          return (
            <div className="flex flex-col items-center gap-0.5">
              <MethodDiffBadge recon={m} symbol={symbol} />
              <span className="whitespace-nowrap text-[11px] text-muted-foreground tabular-nums">
                {m.counted === null ? '—' : money(m.counted, symbol)} of {m.tableAmount === null ? '—' : money(m.tableAmount, symbol)}
              </span>
            </div>
          );
        },
      })),
      {
        id: 'verification',
        accessorFn: (r) => verifyDailySale(r).verified,
        header: 'Check',
        enableSorting: false,
        meta: { align: 'center', mobile: 'badge' },
        cell: ({ row }) => {
          const v = verifyDailySale(row.original, symbol);
          return (
            <span title={v.verified ? 'Every counted figure matches the table' : v.problems.join(' · ')}>
              <VerificationBadge verified={v.verified} />
            </span>
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
            admin={admin}
            canVerify={admin || user?.role === 'branch_manager'}
            busy={generate.isPending || decide.isPending}
            onGenerate={() => runGenerate(row.original.businessDate, admin ? row.original.branchId : null)}
            onFeed={() => setFeedRow(row.original)}
            onView={() => openView(row.original, 'summary')}
            onHistory={() => openView(row.original, 'history')}
            onPrint={() => openView(row.original, 'summary', true)}
            onVerify={() => runDecide(row.original, 'verify')}
            onLock={() => runDecide(row.original, 'lock')}
            onUnlock={() => setUnlockRow(row.original)}
            onAmend={() => setAmendRow(row.original)}
          />
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [symbol, effectiveBranchId, admin, user?.role, generate.isPending, decide.isPending],
  );

  return (
    <div className="space-y-6">
      {/* ── Heading + the one action that starts the day ── */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">
            {admin ? 'Daily Sale Records' : `${user?.branchName || 'Branch'} — Daily Sale Record`}
          </h2>
          <p className="text-sm text-muted-foreground">
            The day&apos;s takings against what was physically counted. Sales and expenses are
            never changed by this screen.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {admin && (
            <Button variant="outline" size="sm" className="h-9" onClick={() => setLocksOpen(true)}>
              <Lock className="mr-1.5 h-4 w-4" /> Manual Entry Locks
            </Button>
          )}
          {/* Generating is offered only when today has no record yet, because
              afterwards the useful action is Manual Feed and two buttons that both
              look like "start" is one too many. Refresh below re-reads the sales
              figures for a record already open. */}
          {!todayRow?.id && (!admin || !!effectiveBranchId) && to >= today && (
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              disabled={generate.isPending}
              onClick={() => runGenerate(today, effectiveBranchId)}
            >
              <RefreshCw className="mr-1.5 h-4 w-4" />
              {generate.isPending ? 'Generating…' : 'Generate Today'}
            </Button>
          )}
          <Button
            size="sm"
            className="h-9"
            disabled={!todayRow && (admin ? !effectiveBranchId : false)}
            onClick={() => {
              if (todayRow) { setFeedRow(todayRow); return; }
              // No row for today means no sales and no record yet. Say so rather
              // than opening a form with nothing to reconcile against.
              toast.info('There are no sales recorded for today yet');
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Manual Feed
          </Button>
        </div>
      </div>

      {/* ── Summary cards (§18) ── */}
      <DailySaleSummaryCards summary={summary} isLoading={isLoading} symbol={symbol} />

      <DailySaleNotices
        summary={summary}
        isLoading={isLoading}
        symbol={symbol}
        windowTooWide={windowTooWide}
      />

      {beforeStart && (
        <Card className="border-dashed">
          <CardContent className="flex items-start gap-2 p-4 text-sm text-muted-foreground">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <span>
              <strong className="font-medium text-foreground">
                {formatDate(DAILY_SALE_LAST_UNSHOWN_DATE)} and earlier are not shown.
              </strong>{' '}
              This record is maintained from {formatDate(DAILY_SALE_START_DATE)}, so there is no
              data for those days.
            </span>
          </CardContent>
        </Card>
      )}

      {/* ── The board ──
          `mobileLayout` stays on the default 'cards': §26 asks for a card per day
          on a phone, and the column meta above routes each cell into its slot. */}
      <DataTable
        columns={columns}
        data={records}
        loading={isLoading}
        searchPlaceholder="Search by date, branch or status…"
        sortable
        // A full calendar month used to be the fixed, unchangeable default
        // (31) before the pager exposed a rows-per-page control here — 50 is
        // the nearest of the global standard sizes ([20, 50, 100]) that still
        // comfortably covers a month without splitting it across pages.
        pageSize={50}
        empty={
          allBeforeStart ? (
            <EmptyState
              title={`No record before ${formatDate(DAILY_SALE_START_DATE)}`}
              description={`This record is maintained from ${formatDate(DAILY_SALE_START_DATE)}. Pick a later date to see data.`}
              className="border-0"
            />
          ) : undefined
        }
        leading={
          <DailySaleFilters
            from={from}
            to={to}
            today={today}
            onFromChange={setFrom}
            onToChange={setTo}
            branch={
              admin
                ? { value: branchId, onChange: setBranchId, branches: branches.data ?? [] }
                : undefined
            }
          />
        }
      />

      {/* The dialog fetches its own branch's locks — the consolidated admin view
          has no single configuration to hand it. See ManualFeedDialog. */}
      <ManualFeedDialog
        open={!!feedRow}
        onOpenChange={(o) => !o && setFeedRow(null)}
        record={feedRow}
        token={token}
        isAdmin={admin}
        currencySymbol={symbol}
      />

      <DailySaleViewDialog
        open={!!viewId}
        onOpenChange={(o) => {
          if (!o) { setViewId(null); setViewPrint(false); }
        }}
        recordId={viewId}
        token={token}
        settings={settings}
        initialTab={viewTab}
        autoPrint={viewPrint}
      />

      {admin && (
        <>
          <AmendDialog
            open={!!amendRow}
            onOpenChange={(o) => !o && setAmendRow(null)}
            record={amendRow}
            token={token}
            currencySymbol={symbol}
          />
          <UnlockDialog
            open={!!unlockRow}
            onOpenChange={(o) => !o && setUnlockRow(null)}
            record={unlockRow}
            token={token}
          />
          <PaymentLockPanel
            open={locksOpen}
            onOpenChange={setLocksOpen}
            branchId={effectiveBranchId}
            branchName={(branches.data ?? []).find((b) => b.id === effectiveBranchId)?.name ?? null}
            locks={locks}
            token={token}
          />
        </>
      )}
    </div>
  );
}

/**
 * The actions for one row (§20).
 *
 * Only what the caller may actually do is rendered — §20's "do not display
 * unauthorized actions" — and each item is additionally gated on the record's
 * state, so Verify does not appear on a locked day and Lock does not appear on
 * one nobody has verified. Both gates are courtesy: the API re-decides every one
 * of these against the JWT and the status machine.
 */
function RowActions({
  row,
  admin,
  canVerify,
  busy,
  onGenerate,
  onFeed,
  onView,
  onHistory,
  onPrint,
  onVerify,
  onLock,
  onUnlock,
  onAmend,
}: {
  row: DailySaleRecord;
  admin: boolean;
  canVerify: boolean;
  busy: boolean;
  onGenerate: () => void;
  onFeed: () => void;
  onView: () => void;
  onHistory: () => void;
  onPrint: () => void;
  onVerify: () => void;
  onLock: () => void;
  onUnlock: () => void;
  onAmend: () => void;
}) {
  // A day with sales but no stored record has exactly one action. Offering View,
  // Print and History on a record that does not exist would be four dead items.
  if (!row.id) {
    return (
      <Button variant="outline" size="sm" className="h-8" disabled={busy} onClick={onGenerate}>
        <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Generate
      </Button>
    );
  }

  const open = isDailySaleRecordOpen(row.status);
  const counted = row.fedAt !== null;

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
        {open && (
          <DropdownMenuItem onClick={onFeed}>
            <Plus className="mr-2 h-4 w-4" /> Manual Feed
          </DropdownMenuItem>
        )}
        {open && canVerify && (
          <DropdownMenuItem disabled={busy} onClick={onVerify}>
            <CheckCircle2 className="mr-2 h-4 w-4" /> Verify
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={onPrint}>
          <Printer className="mr-2 h-4 w-4" /> Print
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onHistory}>
          <History className="mr-2 h-4 w-4" /> History
        </DropdownMenuItem>

        {admin && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs">Admin</DropdownMenuLabel>
            {/* Amend only where there is a counted figure to correct. An amendment
                of a figure nobody entered is a first entry, and that is Manual
                Feed — which is what the SQL says too. */}
            {!open && counted && (
              <DropdownMenuItem onClick={onAmend}>
                <Pencil className="mr-2 h-4 w-4" /> Amend
              </DropdownMenuItem>
            )}
            {(row.status === 'verified' || row.status === 'amended') && (
              <DropdownMenuItem disabled={busy} onClick={onLock}>
                <Lock className="mr-2 h-4 w-4" /> Lock
              </DropdownMenuItem>
            )}
            {!open && (
              <DropdownMenuItem onClick={onUnlock}>
                <LockOpen className="mr-2 h-4 w-4" /> Unlock
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
