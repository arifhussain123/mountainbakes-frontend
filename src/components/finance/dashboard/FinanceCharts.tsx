'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '@/lib/utils';
import { useMoney } from '../finance-ui';
import type { BranchTotals } from './dashboard-model';

/**
 * Charts for the monthly Finance Dashboard.
 *
 * Colours are the `--fin-*` series tokens (globals.css), fixed to the figure a
 * series draws — Company Share is violet and Received orange on every chart —
 * and validated per chart set in both themes. Demand and Balance are neutral
 * context (grey, dashed ink), never a third competing hue. One y-axis per chart.
 */

export const SERIES = {
  demand: 'var(--fin-neutral)',
  share: 'var(--fin-share)',
  received: 'var(--fin-received)',
  balance: 'var(--fin-balance)',
  ledger: 'var(--fin-ledger)',
  returns: 'var(--fin-return)',
  discount: 'var(--fin-discount)',
} as const;

/** Axis ticks: 1.2M / 350k / 900 — the tooltip carries the exact figure. */
export function compact(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 1_000) return `${sign}${Math.round(a / 1_000)}k`;
  return `${sign}${Math.round(a)}`;
}

const AXIS = { fontSize: 11, fill: 'var(--muted-foreground)' };
const TOOLTIP_STYLE = {
  backgroundColor: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--card-foreground)',
};

/** A dashboard panel: soft lavender title band over a white card. */
export function Panel({
  title,
  aside,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  aside?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn('min-w-0 overflow-hidden rounded-xl border bg-card shadow-xs', className)}>
      <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-fin-soft px-4 py-2.5">
        <h2 className="text-xs font-extrabold tracking-[0.1em] text-foreground uppercase">{title}</h2>
        {aside}
      </header>
      <div className={cn('p-4', bodyClassName)}>{children}</div>
    </section>
  );
}

export function ChartEmpty({ message }: { message: string }) {
  return (
    <div className="flex h-56 items-center justify-center rounded-lg border border-dashed px-6 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function useMoneyTooltip() {
  const { format } = useMoney();
  return (value: number | string, name: string) => [format(Number(value)), name] as [string, string];
}

/** Company Share vs Received, one pair of bars per business date. */
export function DailyShareReceivedChart({
  data,
  onDay,
}: {
  data: {
    date: string;
    label: string;
    companyShare: number;
    received: number;
  }[];
  onDay: (date: string) => void;
}) {
  const fmt = useMoneyTooltip();
  if (!data.some((d) => d.companyShare || d.received)) {
    return <ChartEmpty message="No company share or receipts in this date range." />;
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart
        data={data}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        barGap={2}
        onClick={(s) => {
          const p = (s as { activePayload?: { payload?: { date?: string } }[] } | null)?.activePayload?.[0]?.payload;
          if (p?.date) onDay(p.date);
        }}
      >
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={8}
        />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={compact} width={44} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ fill: 'var(--fin-soft)' }}
          formatter={fmt}
          labelFormatter={(_, p) => (p?.[0]?.payload as { date?: string } | undefined)?.date ?? ''}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="square" iconSize={10} />
        <Bar
          isAnimationActive={false}
          dataKey="companyShare"
          name="Company Share"
          fill={SERIES.share}
          radius={[4, 4, 0, 0]}
          cursor="pointer"
        />
        <Bar
          isAnimationActive={false}
          dataKey="received"
          name="Received"
          fill={SERIES.received}
          radius={[4, 4, 0, 0]}
          cursor="pointer"
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Six whole business months: demand (context), share, received, balance. */
export function MonthlyTrendChart({
  data,
  current,
}: {
  data: {
    label: string;
    month: string;
    demand: number;
    companyShare: number;
    received: number;
    balance: number;
  }[];
  current: string;
}) {
  const fmt = useMoneyTooltip();
  if (!data.some((d) => d.demand || d.companyShare || d.received)) {
    return <ChartEmpty message="No production income or receipts in the last six months." />;
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={({ x, y, payload, index }: { x: number; y: number; payload: { value: string }; index: number }) => (
            <text
              x={x}
              y={y + 12}
              textAnchor="middle"
              fontSize={11}
              fill="var(--muted-foreground)"
              fontWeight={data[index]?.month === current ? 800 : 400}
            >
              {payload.value}
            </text>
          )}
        />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={compact} width={44} />
        <ReferenceLine y={0} stroke="var(--border)" />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={fmt} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
        <Line
          isAnimationActive={false}
          dataKey="demand"
          name="Demand"
          stroke={SERIES.demand}
          strokeWidth={2}
          dot={{ r: 3 }}
        />
        <Line
          isAnimationActive={false}
          dataKey="companyShare"
          name="Company Share"
          stroke={SERIES.share}
          strokeWidth={2}
          dot={{ r: 4 }}
        />
        <Line
          isAnimationActive={false}
          dataKey="received"
          name="Received"
          stroke={SERIES.received}
          strokeWidth={2}
          dot={{ r: 4 }}
        />
        <Line
          isAnimationActive={false}
          dataKey="balance"
          name="Balance"
          stroke={SERIES.balance}
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={{ r: 3 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Ledger expense, return and discount per business date — never summed into one line. */
export function ExpenseTrendChart({
  data,
}: {
  data: {
    date: string;
    label: string;
    ledger: number;
    returns: number;
    discount: number;
  }[];
}) {
  const fmt = useMoneyTooltip();
  if (!data.some((d) => d.ledger || d.returns || d.discount)) {
    return <ChartEmpty message="No ledger expense, return or discount in this date range." />;
  }
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
          minTickGap={8}
        />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={compact} width={44} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={fmt}
          labelFormatter={(_, p) => (p?.[0]?.payload as { date?: string } | undefined)?.date ?? ''}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="plainline" />
        <Line
          isAnimationActive={false}
          dataKey="ledger"
          name="Ledger expense"
          stroke={SERIES.ledger}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          isAnimationActive={false}
          dataKey="returns"
          name="Return"
          stroke={SERIES.returns}
          strokeWidth={2}
          strokeDasharray="6 3"
          dot={false}
          activeDot={{ r: 4 }}
        />
        <Line
          isAnimationActive={false}
          dataKey="discount"
          name="Discount"
          stroke={SERIES.discount}
          strokeWidth={2}
          strokeDasharray="2 3"
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Branch comparison — income. One row per branch, share / received / balance. */
export function BranchIncomeChart({ rows, onBranch }: { rows: BranchTotals[]; onBranch: (b: BranchTotals) => void }) {
  const fmt = useMoneyTooltip();
  const data = rows.filter((r) => r.companyShare || r.received);
  if (!data.length) return <ChartEmpty message="No branch income in this date range." />;
  return (
    <ResponsiveContainer width="100%" height={Math.max(200, data.length * 64)}>
      <BarChart
        data={data}
        layout="vertical"
        margin={{ top: 0, right: 12, left: 0, bottom: 0 }}
        barGap={2}
        onClick={(s) => {
          const p = (s as { activePayload?: { payload?: BranchTotals }[] } | null)?.activePayload?.[0]?.payload;
          if (p) onBranch(p);
        }}
      >
        <CartesianGrid stroke="var(--border)" horizontal={false} />
        <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={compact} />
        <YAxis type="category" dataKey="branch" tick={AXIS} tickLine={false} axisLine={false} width={120} />
        <ReferenceLine x={0} stroke="var(--border)" />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--fin-soft)' }} formatter={fmt} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="square" iconSize={10} />
        <Bar
          isAnimationActive={false}
          dataKey="companyShare"
          name="Company Share"
          fill={SERIES.share}
          radius={[0, 4, 4, 0]}
          cursor="pointer"
        />
        <Bar
          isAnimationActive={false}
          dataKey="received"
          name="Received"
          fill={SERIES.received}
          radius={[0, 4, 4, 0]}
          cursor="pointer"
        />
        <Bar
          isAnimationActive={false}
          dataKey="balance"
          name="Balance"
          fill={SERIES.balance}
          radius={[0, 4, 4, 0]}
          cursor="pointer"
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Branch comparison — expense, stacked so each bar's length is that branch's total. */
export function BranchExpenseChart({ rows }: { rows: BranchTotals[] }) {
  const fmt = useMoneyTooltip();
  const data = rows.filter((r) => r.ledger || r.returns || r.discount);
  if (!data.length) return <ChartEmpty message="No expenses in this date range." />;
  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 44)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--border)" horizontal={false} />
        <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} tickFormatter={compact} />
        <YAxis type="category" dataKey="branch" tick={AXIS} tickLine={false} axisLine={false} width={120} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--fin-soft)' }} formatter={fmt} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="square" iconSize={10} />
        <Bar
          isAnimationActive={false}
          dataKey="ledger"
          name="Ledger expense"
          stackId="e"
          fill={SERIES.ledger}
          stroke="var(--card)"
          strokeWidth={2}
        />
        <Bar
          isAnimationActive={false}
          dataKey="returns"
          name="Return"
          stackId="e"
          fill={SERIES.returns}
          stroke="var(--card)"
          strokeWidth={2}
        />
        <Bar
          isAnimationActive={false}
          dataKey="discount"
          name="Discount"
          stackId="e"
          fill={SERIES.discount}
          stroke="var(--card)"
          strokeWidth={2}
          radius={[0, 4, 4, 0]}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * A labelled horizontal bar list — one single-series comparison, each row named
 * and valued in text, so identity never rests on colour. Used for Income vs
 * Expense and for the ledger-head breakdown.
 */
export function BarList({
  rows,
  emptyMessage,
}: {
  rows: {
    key: string;
    label: string;
    sub?: string;
    value: number;
    color: string;
    onClick?: () => void;
  }[];
  emptyMessage: string;
}) {
  const { format } = useMoney();
  const max = Math.max(0, ...rows.map((r) => Math.abs(r.value)));
  if (!rows.length || max === 0) return <ChartEmpty message={emptyMessage} />;
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.key}>
          <button
            type="button"
            onClick={r.onClick}
            disabled={!r.onClick}
            className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-md px-1 py-0.5 text-left enabled:cursor-pointer enabled:hover:bg-fin-row-hover sm:grid-cols-[minmax(0,11rem)_1fr_auto]"
          >
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-bold">{r.label}</span>
              {r.sub && (
                <span className="block text-[10.5px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
                  {r.sub}
                </span>
              )}
            </span>
            <span className="col-span-2 row-start-2 h-3.5 overflow-hidden rounded-[3px] bg-muted sm:col-span-1 sm:col-start-2 sm:row-start-1">
              <span
                className="block h-full rounded-[3px]"
                style={{
                  width: `${(Math.abs(r.value) / max) * 100}%`,
                  background: r.color,
                }}
              />
            </span>
            <span className="col-start-2 row-start-1 text-right text-[13px] font-bold whitespace-nowrap tabular-nums sm:col-start-3">
              {format(r.value)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
