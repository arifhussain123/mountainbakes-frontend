'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { businessDateStr, businessDaysAgoStr } from '@mb/shared';
import { useFinanceDashboard } from '@/lib/finance';
import { useAuth } from '@/hooks/useAuth';
import { useBranches } from '@/lib/queries';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { ROUTES } from '@/utils/routes';
import { cn } from '@/lib/utils';
import { FinancePageHeader, Money, ReadOnlyNotice, StatusBadge, useFinanceAbilities, useMoney } from './finance-ui';
import { DateFilter, FilterBar, FilterField, FilterSelect, type SelectOption } from './finance-actions';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  Building2,
  ClipboardCheck,
  Landmark,
  Scale,
  Store,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { LoginHistoryCard } from '@/components/dashboard/LoginHistoryCard';

/** The dashboard's own date-range presets — every card's period, not the fixed
 *  trailing-week trend chart underneath, which always shows the last 7 days. */
const RANGE_PRESETS: SelectOption[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7', label: 'Last 7 Days' },
  { value: 'last30', label: 'Last 30 Days' },
  { value: 'thisMonth', label: 'This Month' },
  { value: 'prevMonth', label: 'Previous Month' },
  { value: 'custom', label: 'Custom Range' },
];

/**
 * Resolve a preset to a business-date `[from, to]` pair.
 *
 * Plain calendar stepping on already-resolved 'YYYY-MM-DD' business-date
 * strings — the 2 AM rollover itself lives only in `businessDateStr()` /
 * `businessDaysAgoStr()`; this never recomputes it.
 */
function presetRange(preset: string, customFrom: string, customTo: string): { from: string; to: string } {
  const today = businessDateStr();
  switch (preset) {
    case 'yesterday': {
      const d = businessDaysAgoStr(1);
      return { from: d, to: d };
    }
    case 'last7':
      return { from: businessDaysAgoStr(6), to: today };
    case 'last30':
      return { from: businessDaysAgoStr(29), to: today };
    case 'thisMonth':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'prevMonth': {
      const [y, m] = today.split('-').map(Number) as [number, number];
      const prevM = m === 1 ? 12 : m - 1;
      const prevY = m === 1 ? y - 1 : y;
      const first = `${prevY}-${String(prevM).padStart(2, '0')}-01`;
      const lastDay = new Date(Date.UTC(prevY, prevM, 0)).getUTCDate();
      const last = `${prevY}-${String(prevM).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      return { from: first, to: last };
    }
    case 'custom':
      return { from: customFrom || today, to: customTo || today };
    default:
      return { from: today, to: today };
  }
}

/**
 * The Finance dashboard — the nine summary cards the brief specifies, plus the
 * two things a finance user actually does next: look at what is waiting for
 * approval, and glance at the last week's shape.
 *
 * The cards are ordered as three groups of three, and the grouping is the point:
 *   row 1  the selected period   — income, expenses, net position
 *   row 2  where the money is    — cash, bank, and the two share figures
 *   row 3  what needs a decision — the two approval queues
 * Someone opening this screen in the morning reads down it in that order.
 */
export function FinanceDashboardPage() {
  const abilities = useFinanceAbilities();
  const { token } = useAuth();
  const branchesQ = useBranches(token ?? '');

  const [preset, setPreset] = useState('today');
  const [customFrom, setCustomFrom] = useState(businessDateStr());
  const [customTo, setCustomTo] = useState(businessDateStr());
  const [branchId, setBranchId] = useState('');

  const { from, to } = useMemo(() => presetRange(preset, customFrom, customTo), [preset, customFrom, customTo]);
  const isRangeOfOne = from === to;

  const { data, isLoading, isError, error, refetch } = useFinanceDashboard({ from, to, branchId: branchId || undefined });

  const branchOptions: SelectOption[] = (branchesQ.data ?? []).map((b) => ({ value: b.id, label: b.name }));
  const branchLabel = branchId ? (branchOptions.find((b) => b.value === branchId)?.label ?? 'Selected branch') : 'All Branches';
  const periodLabel = RANGE_PRESETS.find((p) => p.value === preset)?.label ?? 'Today';

  if (isError) {
    return (
      <div className="space-y-6">
        <FinancePageHeader title="Finance Dashboard" />
        <EmptyState
          title="Could not load the finance dashboard"
          description={error instanceof Error ? error.message : 'Please try again.'}
        />
        <Button variant="outline" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <FinancePageHeader
        title="Finance Dashboard"
        description={`${periodLabel} (${from}${isRangeOfOne ? '' : ` – ${to}`}) · ${branchLabel} · balances carry forward automatically`}
        actions={
          /* nativeButton={false} on every Button that renders a Link: Base UI
             assumes a real <button> underneath and warns otherwise, because the
             native semantics it would normally rely on are not there. An anchor
             is the right element for navigation — this only tells Base UI that
             the substitution is deliberate. */
          <Button
            variant="outline"
            size="sm"
            nativeButton={false}
            render={<Link href={ROUTES.FINANCE_LEDGER} />}
          >
            Open Daily Ledger
          </Button>
        }
      />

      <ReadOnlyNotice abilities={abilities} />

      <FilterBar>
        <FilterField label="Period">
          <Select value={preset} onValueChange={(v) => setPreset((v as string) ?? 'today')}>
            <SelectTrigger className="h-11 w-full md:h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RANGE_PRESETS.map((p) => (
                <SelectItem key={p.value} value={p.value}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FilterField>
        {preset === 'custom' && (
          <>
            <FilterField label="From">
              <DateFilter value={customFrom} onChange={setCustomFrom} max={customTo} />
            </FilterField>
            <FilterField label="To">
              <DateFilter value={customTo} onChange={setCustomTo} max={businessDateStr()} />
            </FilterField>
          </>
        )}
        <FilterField label="Branch">
          <FilterSelect value={branchId} onChange={setBranchId} options={branchOptions} allLabel="All Branches" />
        </FilterField>
      </FilterBar>

      {/* The selected period's movement */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <FinanceStat
          label={isRangeOfOne ? "Total Income" : 'Total Income (period)'}
          value={data?.todayIncome}
          icon={ArrowUpRight}
          tone="emerald"
          loading={isLoading}
        />
        <FinanceStat
          label={isRangeOfOne ? 'Total Expenses' : 'Total Expenses (period)'}
          value={data?.todayExpenses}
          icon={ArrowDownRight}
          tone="red"
          loading={isLoading}
        />
        <FinanceStat
          label="Net Cash Balance"
          value={data?.netCashBalance}
          icon={Scale}
          tone="primary"
          loading={isLoading}
          hint={`As of ${to} · opening balance carried in · company-wide`}
        />
      </div>

      {/* Where the money is */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <FinanceStat
          label="Cash in Hand"
          value={data?.cashInHand}
          icon={Banknote}
          tone="amber"
          loading={isLoading}
          hint="Company-wide"
        />
        <FinanceStat
          label="Bank Balance"
          value={data?.bankBalance}
          icon={Landmark}
          tone="blue"
          loading={isLoading}
          hint="Company-wide"
        />
        <FinanceStat
          label="Company Share"
          value={data?.companyShare}
          icon={Building2}
          tone="primary"
          loading={isLoading}
          hint="Posted in period"
        />
        <FinanceStat
          label="Branch Share"
          value={data?.branchShare}
          icon={Store}
          tone="slate"
          loading={isLoading}
          hint="Posted in period"
        />
      </div>

      {/* Awaiting a decision */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ApprovalCard
          title="Pending Income Approvals"
          count={data?.pendingIncomeApprovals ?? 0}
          amount={data?.pendingIncomeAmount ?? 0}
          href={ROUTES.FINANCE_INCOME}
          loading={isLoading}
        />
        <ApprovalCard
          title="Pending Expense Approvals"
          count={data?.pendingExpenseApprovals ?? 0}
          amount={data?.pendingExpenseAmount ?? 0}
          href={ROUTES.FINANCE_ENTRIES}
          loading={isLoading}
          hint={branchId ? 'Manual entries for this branch' : 'Manual entries, salaries and partner expenses'}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="xl:col-span-2">
          <TrendCard trend={data?.trend ?? []} loading={isLoading} />
        </div>
        <div className="xl:col-span-3">
          <RecentEntriesCard entries={data?.recentEntries ?? []} loading={isLoading} />
        </div>
      </div>

      {/* Login History. On every dashboard, but not showing the same thing on
          each: the API gives a super admin every account's sessions and pins
          every other role to its own. Last, because it is a record to consult
          rather than something to act on. */}
      <LoginHistoryCard />
    </div>
  );
}

// ---------------------------------------------------------------------------

const TONES: Record<string, string> = {
  primary: 'bg-primary/10 text-primary',
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400',
  red: 'bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-400',
  blue: 'bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

function FinanceStat({
  label,
  value,
  icon: Icon,
  tone,
  loading,
  hint,
}: {
  label: string;
  value: number | undefined;
  icon: LucideIcon;
  tone: keyof typeof TONES;
  loading?: boolean;
  hint?: string;
}) {
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-muted-foreground">{label}</p>
            {loading ? (
              <Skeleton className="h-7 w-28" />
            ) : (
              <p className="text-2xl font-bold text-foreground">
                <Money value={value} />
              </p>
            )}
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
          </div>
          <div className={cn('flex-shrink-0 rounded-xl p-3', TONES[tone])}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ApprovalCard({
  title,
  count,
  amount,
  href,
  loading,
  hint,
}: {
  title: string;
  count: number;
  amount: number;
  href: string;
  loading?: boolean;
  hint?: string;
}) {
  const waiting = count > 0;

  return (
    <Card className={cn(waiting && 'border-amber-300 dark:border-amber-800')}>
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'flex-shrink-0 rounded-xl p-3',
              waiting ? TONES['amber'] : 'bg-muted text-muted-foreground',
            )}
          >
            {waiting ? <AlertCircle className="h-5 w-5" /> : <ClipboardCheck className="h-5 w-5" />}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
            {loading ? (
              <Skeleton className="mt-1 h-7 w-24" />
            ) : (
              <p className="text-2xl font-bold">
                {count}
                {count > 0 && (
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    <Money value={amount} />
                  </span>
                )}
              </p>
            )}
            {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
          </div>
        </div>
        <Button
          variant={waiting ? 'default' : 'outline'}
          size="sm"
          className="h-11 w-full sm:h-9 sm:w-auto"
          nativeButton={false}
          render={<Link href={href} />}
        >
          {waiting ? 'Review' : 'Open'}
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * A seven-day income/expense sparkline.
 *
 * Hand-drawn bars rather than Recharts: the library is loaded via
 * `next/dynamic({ ssr: false })` everywhere else in this app precisely because
 * it is heavy, and two stacked bars per day do not justify it on a screen whose
 * job is to load instantly.
 */
function TrendCard({
  trend,
  loading,
}: {
  trend: { businessDate: string; income: number; expenses: number; net: number }[];
  loading?: boolean;
}) {
  const { format } = useMoney();
  // Guard the divisor: a week with no activity would otherwise divide by zero
  // and render every bar as NaN% tall, which collapses the chart silently.
  const peak = Math.max(1, ...trend.flatMap((d) => [d.income, d.expenses]));

  return (
    <Card className="h-full">
      <CardContent className="p-5">
        <p className="text-sm font-semibold">Last 7 Days</p>
        <p className="mb-4 text-xs text-muted-foreground">Income against expenses</p>

        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="flex h-40 items-end gap-2">
            {trend.map((d) => (
              <div key={d.businessDate} className="flex flex-1 flex-col items-center gap-1">
                <div className="flex h-32 w-full items-end justify-center gap-0.5">
                  <div
                    className="w-1/2 rounded-t bg-emerald-500/80"
                    style={{ height: `${(d.income / peak) * 100}%` }}
                    title={`Income ${format(d.income)}`}
                  />
                  <div
                    className="w-1/2 rounded-t bg-red-400/80"
                    style={{ height: `${(d.expenses / peak) * 100}%` }}
                    title={`Expenses ${format(d.expenses)}`}
                  />
                </div>
                {/* Just the day-of-month: eight characters of date under a 30px
                    bar is unreadable at any width. */}
                <span className="text-[10px] text-muted-foreground">{d.businessDate.slice(8)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RecentEntriesCard({
  entries,
  loading,
}: {
  entries: { id: string; voucherNo: string; ledgerHeadName: string; description: string; debit: number; credit: number; status: string }[];
  loading?: boolean;
}) {
  return (
    <Card className="h-full">
      <CardContent className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">Latest Vouchers</p>
            <p className="text-xs text-muted-foreground">Most recent postings</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link href={ROUTES.FINANCE_LEDGER} />}
          >
            View all
          </Button>
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <EmptyState
            title="Nothing posted yet"
            description="Approved income and expenses appear here as vouchers."
            className="border-0"
          />
        ) : (
          <ul className="divide-y">
            {entries.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{e.ledgerHeadName}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    <span className="font-mono">{e.voucherNo}</span> · {e.description}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <Money
                    value={e.debit > 0 ? e.debit : e.credit}
                    className={cn(
                      'text-sm font-semibold',
                      e.debit > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400',
                    )}
                  />
                  <StatusBadge status={e.status} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
