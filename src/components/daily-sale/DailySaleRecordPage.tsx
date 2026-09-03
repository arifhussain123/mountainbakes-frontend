'use client';

import { useMemo, useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import {
  AlertTriangle,
  Banknote,
  BadgePercent,
  CheckCircle2,
  Eye,
  History,
  Lock,
  LockOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Printer,
  Receipt,
  RefreshCw,
  Scale,
  ShoppingCart,
  Smartphone,
  Landmark,
  Bike,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  DAILY_SALE_MAX_WINDOW_DAYS,
  businessDateStr,
  businessDaysAgoStr,
  differenceStatus,
  isDailySaleRecordOpen,
  karachiTimeStr,
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
import { StatCard } from '@/components/shared/StatCard';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AmendDialog } from './AmendDialog';
import { DailySaleViewDialog } from './DailySaleViewDialog';
import { ManualFeedDialog } from './ManualFeedDialog';
import { PaymentLockPanel } from './PaymentLockPanel';
import { UnlockDialog } from './UnlockDialog';
import { DifferenceBadge, StatusBadge, money } from './parts';

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
/** Sentinel for the admin branch picker. Matches ALL_BRANCHES in AdminBranchStockPage. */
const ALL_BRANCHES = 'all';

export function DailySaleRecordPage({ admin = false }: { admin?: boolean }) {
  const { token, user } = useAuth();
  const { settings } = useSettings();
  const symbol = settings?.currencySymbol || 'Rs.';

  // Last 30 business days, ending today. A window rather than a single date
  // because the question is nearly always "which days are still not signed off",
  // and a one-day view cannot answer it.
  const [from, setFrom] = useState(() => businessDaysAgoStr(29));
  const [to, setTo] = useState(() => businessDateStr());
  const [branchId, setBranchId] = useState<string>(ALL_BRANCHES);

  const branches = useBranches(token, { enabled: admin });
  // A branch role's scope comes off its JWT, so it never sends one; an admin
  // sends the picked branch, or nothing for the consolidated view.
  const effectiveBranchId = admin && branchId !== ALL_BRANCHES ? branchId : null;

  // The API caps the window, so a range wider than the cap is not requested at
  // all — the card below says so, which is more use than a failed request.
  const windowTooWide = daysBetween(from, to) > DAILY_SALE_MAX_WINDOW_DAYS;

  const { data, isLoading } = useDailySaleRecords(token, {
    from,
    to,
    branchId: effectiveBranchId,
    enabled: !windowTooWide,
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
      {
        id: 'date',
        accessorFn: (r) => r.businessDate,
        header: 'Date',
        meta: { mobile: 'title' },
        cell: ({ row }) => (
          <div>
            <p className="font-medium tabular-nums">{displayDate(row.original.businessDate)}</p>
            {/* The branch belongs under the date in the consolidated view, where a
                date alone does not identify a row. Hidden when one branch is on
                show, so the column does not repeat the same name forty times. */}
            {!effectiveBranchId && (
              <p className="text-xs text-muted-foreground">{row.original.branchName}</p>
            )}
          </div>
        ),
      },
      {
        id: 'time',
        accessorFn: (r) => r.generatedAt,
        header: 'Time',
        meta: { mobile: 'hidden', mobileLabel: 'Generated' },
        cell: ({ row }) => (
          <span className="text-xs tabular-nums text-muted-foreground">
            {row.original.generatedAt ? karachiTimeStr(new Date(row.original.generatedAt)) : '—'}
          </span>
        ),
      },
      moneyColumn('totalSale', 'Total Sale', (r) => r.autoTotalSale, symbol, true),
      moneyColumn('cash', 'Cash', (r) => r.autoCash, symbol),
      moneyColumn('easypaisa', 'Easypaisa', (r) => r.autoEasypaisa, symbol),
      moneyColumn('foodpanda', 'Foodpanda', (r) => r.autoFoodpanda, symbol),
      moneyColumn('bank', 'Bank', (r) => r.autoBank, symbol),
      moneyColumn('cashExpense', 'Cash Expense', (r) => r.cashExpense, symbol),
      moneyColumn('discount', 'Discount', (r) => r.discount, symbol),
      {
        id: 'difference',
        accessorFn: (r) => r.overallDifference,
        header: 'Difference',
        meta: { align: 'center', mobile: 'badge' },
        cell: ({ row }) => {
          const r = row.original;
          // Nothing counted at all reads as "not counted", never as a matched
          // zero: `overallDifference` is 0 when no method has been fed, and a
          // green tick there would say the day balances when nobody has looked.
          const nothingCounted =
            r.cashDifference === null && r.easypaisaDifference === null && r.bankDifference === null;
          return (
            <DifferenceBadge
              difference={nothingCounted ? null : r.overallDifference}
              symbol={symbol}
            />
          );
        },
      },
      {
        id: 'status',
        accessorFn: (r) => r.status,
        header: 'Status',
        meta: { align: 'center', mobile: 'badge' },
        cell: ({ row }) => <StatusBadge status={row.original.status} />,
      },
      {
        id: 'source',
        accessorFn: (r) => (r.fedAt ? 'System + Counted' : 'System'),
        header: 'Source',
        meta: { align: 'center', mobileLabel: 'Source' },
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground">
            {row.original.fedAt ? 'System + Counted' : 'System'}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
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
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-8">
        <StatCard title="Total Sale" value={isLoading ? '…' : money(summary?.totalSale ?? 0, symbol)} icon={ShoppingCart} color="green" loading={isLoading} />
        <StatCard title="Cash" value={isLoading ? '…' : money(summary?.cash ?? 0, symbol)} icon={Banknote} color="brown" loading={isLoading} />
        <StatCard title="Easypaisa" value={isLoading ? '…' : money(summary?.easypaisa ?? 0, symbol)} icon={Smartphone} color="blue" loading={isLoading} />
        <StatCard title="Foodpanda" value={isLoading ? '…' : money(summary?.foodpanda ?? 0, symbol)} icon={Bike} color="orange" loading={isLoading} />
        <StatCard title="Bank" value={isLoading ? '…' : money(summary?.bank ?? 0, symbol)} icon={Landmark} color="blue" loading={isLoading} />
        <StatCard title="Cash Expense" value={isLoading ? '…' : money(summary?.cashExpense ?? 0, symbol)} icon={Receipt} color="red" loading={isLoading} />
        <StatCard title="Discount" value={isLoading ? '…' : money(summary?.discount ?? 0, symbol)} icon={BadgePercent} color="orange" loading={isLoading} />
        <StatCard
          title="Difference"
          value={isLoading ? '…' : money(summary?.difference ?? 0, symbol)}
          icon={summary && summary.difference === 0 ? CheckCircle2 : Scale}
          color={summary && summary.difference === 0 ? 'green' : 'red'}
          loading={isLoading}
        />
      </div>

      {/* A difference card reading Rs. 0 over a window where nothing has been
          counted is the one number on this screen that could mislead, so it is
          qualified rather than left to be misread (§19 — nothing is hidden). */}
      {!isLoading && summary && summary.uncounted > 0 && (
        <Card className="border-dashed">
          <CardContent className="flex items-start gap-2 p-4 text-sm text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              {summary.uncounted} {summary.uncounted === 1 ? 'day has' : 'days have'} nothing counted
              yet, so the Difference card covers only the days that do.
            </span>
          </CardContent>
        </Card>
      )}

      {!isLoading && summary && summary.difference !== 0 && (
        <Card className="border-amber-300 dark:border-amber-900">
          <CardContent className="flex items-start gap-2 p-4 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <span>
              This window is out by <strong>{money(summary.difference, symbol)}</strong>{' '}
              ({differenceStatus(summary.difference) === 'short' ? 'short' : 'over'}). Open each
              day with a difference and check the figure against the counted amount.
            </span>
          </CardContent>
        </Card>
      )}

      {windowTooWide && (
        <Card className="border-dashed">
          <CardContent className="p-4 text-sm text-muted-foreground">
            That range is longer than {DAILY_SALE_MAX_WINDOW_DAYS} days. Narrow it to load the
            records.
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
        pageSize={31}
        leading={
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input
                type="date"
                value={from}
                max={to}
                onChange={(e) => e.target.value && setFrom(e.target.value)}
                className="h-9 w-36"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input
                type="date"
                value={to}
                min={from}
                max={today}
                onChange={(e) => e.target.value && setTo(e.target.value)}
                className="h-9 w-36"
              />
            </div>
            {admin && (
              <div className="space-y-1">
                <Label className="text-xs">Branch</Label>
                <Select value={branchId} onValueChange={(v) => setBranchId((v as string) ?? ALL_BRANCHES)}>
                  <SelectTrigger className="h-9 w-48">
                    <SelectValue placeholder="All branches" />
                  </SelectTrigger>
                  <SelectContent>
                    {/* A sentinel rather than an empty string, matching
                        AdminBranchStockPage: Base UI treats an absent value as
                        "show the placeholder", so '' as a real option is a value
                        that renders as no value. Under this option the board
                        lists every branch's rows side by side and never sums
                        them — these figures reconcile against one drawer. */}
                    <SelectItem value={ALL_BRANCHES}>All branches</SelectItem>
                    {(branches.data ?? []).map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
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

/**
 * One right-aligned money column.
 *
 * A factory rather than nine near-identical literals, because the alignment,
 * `tabular-nums` and the rounding have to match across all of them — a centred
 * or proportional figures column jitters as the digit count changes row to row,
 * which is the exact failure `table-meta.ts` documents.
 */
function moneyColumn(
  id: string,
  header: string,
  pick: (r: DailySaleRecord) => number,
  symbol: string,
  strong = false,
): ColumnDef<DailySaleRecord> {
  return {
    id,
    accessorFn: pick,
    header,
    meta: { align: 'right', mobileLabel: header },
    cell: ({ row }) => (
      <span className={`tabular-nums ${strong ? 'font-semibold' : ''}`}>
        {money(pick(row.original), symbol)}
      </span>
    ),
    footer: ({ table }) => (
      <span className="tabular-nums">
        {money(
          table.getFilteredRowModel().rows.reduce((s, r) => s + pick(r.original), 0),
          symbol,
        )}
      </span>
    ),
  };
}

/** 'DD-MM-YYYY'. String work — these are already Karachi business dates. */
function displayDate(iso: string): string {
  const [y, m, d] = (iso || '').split('-');
  return y && m && d ? `${d}-${m}-${y}` : iso || '—';
}

function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}
