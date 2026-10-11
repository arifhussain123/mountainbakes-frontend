'use client';

import {
  AlertTriangle,
  BadgePercent,
  Banknote,
  Bike,
  CheckCircle2,
  Landmark,
  Receipt,
  Scale,
  ShoppingCart,
  Smartphone,
} from 'lucide-react';
import {
  DAILY_SALE_MAX_WINDOW_DAYS,
  differenceStatus,
  type Branch,
  type DailySaleSummary,
} from '@mb/shared';
import { StatCard } from '@/components/shared/StatCard';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { money } from './parts';

/**
 * The parts of the Daily Sale Record board that sit around its table — the
 * summary cards, the notices under them and the window filters.
 *
 * Shared for the same reason the columns are (see columns.tsx): the branch's
 * board and Finance's Daily Closing are the same board asked of different
 * scopes, and a card that read "Cash" on one and "Cash Sales" on the other would
 * be a difference somebody has to explain.
 */

/** Sentinel for the branch picker. Matches ALL_BRANCHES in AdminBranchStockPage. */
export const ALL_BRANCHES = 'all';

/** The summary cards (§18). Every value is the server's, over the window on show. */
export function DailySaleSummaryCards({
  summary,
  isLoading,
  symbol,
}: {
  summary: DailySaleSummary | undefined;
  isLoading: boolean;
  symbol: string;
}) {
  return (
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
  );
}

/** What the cards cannot say on their own: days nobody counted, and a window that is out. */
export function DailySaleNotices({
  summary,
  isLoading,
  symbol,
  windowTooWide,
}: {
  summary: DailySaleSummary | undefined;
  isLoading: boolean;
  symbol: string;
  windowTooWide: boolean;
}) {
  return (
    <>
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
    </>
  );
}

/**
 * The window the board shows: From, To and — where the viewer may choose one —
 * the branch. `children` are extra controls a screen adds after them.
 */
export function DailySaleFilters({
  from,
  to,
  today,
  earliest,
  onFromChange,
  onToChange,
  branch,
  children,
}: {
  from: string;
  to: string;
  today: string;
  /** The first date the pickers offer. Omitted where the board has no start. */
  earliest?: string;
  onFromChange: (value: string) => void;
  onToChange: (value: string) => void;
  /** Omitted for a viewer pinned to one branch. */
  branch?: {
    value: string;
    onChange: (value: string) => void;
    branches: Pick<Branch, 'id' | 'name'>[];
  };
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <Label className="text-xs">From</Label>
        <Input
          type="date"
          value={from}
          min={earliest}
          max={to}
          onChange={(e) => e.target.value && onFromChange(e.target.value)}
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
          onChange={(e) => e.target.value && onToChange(e.target.value)}
          className="h-9 w-36"
        />
      </div>
      {branch && (
        <div className="space-y-1">
          <Label className="text-xs">Branch</Label>
          <Select value={branch.value} onValueChange={(v) => branch.onChange((v as string) ?? ALL_BRANCHES)}>
            <SelectTrigger className="h-9 w-48">
              {/* The label is resolved here because the trigger otherwise shows
                  the raw value — the word "all", or a branch's id — until the
                  list has been opened once. */}
              <SelectValue placeholder="All branches">
                {(value: string) =>
                  value === ALL_BRANCHES
                    ? 'All branches'
                    : (branch.branches.find((b) => b.id === value)?.name ?? 'All branches')
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {/* A sentinel rather than an empty string, matching
                  AdminBranchStockPage: Base UI treats an absent value as
                  "show the placeholder", so '' as a real option is a value
                  that renders as no value. Under this option the board
                  lists every branch's rows side by side and never sums
                  them — these figures reconcile against one drawer. */}
              <SelectItem value={ALL_BRANCHES}>All branches</SelectItem>
              {branch.branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {children}
    </div>
  );
}
