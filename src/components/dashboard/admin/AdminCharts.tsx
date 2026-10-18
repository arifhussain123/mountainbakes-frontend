'use client';

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useMoney } from '@/components/finance/finance-ui';
import { ChartEmpty, SERIES, compact } from '@/components/finance/dashboard/FinanceCharts';
import type { BranchSummaryRow } from './admin-model';

/**
 * Charts for the Admin Dashboard. Loaded lazily (recharts is heavy).
 *
 * Series colours are the `--fin-*` tokens, which `.admin-dash-theme` re-points
 * to the brand palette — so Company Share is the same orange here as on the
 * Company Share vs Received chart beside it. The single-series demand line
 * needs no identity colour and takes the accent (`--chart-1`).
 */

const AXIS = { fontSize: 11, fill: 'var(--muted-foreground)' };
const TOOLTIP_STYLE = {
  backgroundColor: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 12,
  color: 'var(--card-foreground)',
};

function useMoneyTooltip() {
  const { format } = useMoney();
  return (value: number | string, name: string) => [format(Number(value)), name] as [string, string];
}

/** Company Share, Received and Ledger Expense, one group of bars per branch. */
export function BranchPerformanceChart({
  rows,
  onBranch,
}: {
  rows: BranchSummaryRow[];
  onBranch: (row: BranchSummaryRow) => void;
}) {
  const fmt = useMoneyTooltip();
  const data = rows.filter((r) => r.companyShare || r.received || r.ledger);
  if (!data.length) return <ChartEmpty message="No company share, receipts or ledger expense in this date range." />;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart
        data={data}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        barGap={2}
        barCategoryGap="22%"
        onClick={(s) => {
          const p = (s as { activePayload?: { payload?: BranchSummaryRow }[] } | null)?.activePayload?.[0]?.payload;
          if (p) onBranch(p);
        }}
      >
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="branch" tick={AXIS} tickLine={false} axisLine={false} interval={0} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={compact} width={44} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--fin-soft)' }} formatter={fmt} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="square" iconSize={10} />
        <Bar
          isAnimationActive={false}
          dataKey="companyShare"
          name="Company Share"
          fill={SERIES.share}
          radius={[4, 4, 0, 0]}
          maxBarSize={56}
          cursor="pointer"
        />
        <Bar
          isAnimationActive={false}
          dataKey="received"
          name="Received"
          fill={SERIES.received}
          radius={[4, 4, 0, 0]}
          maxBarSize={56}
          cursor="pointer"
        />
        <Bar
          isAnimationActive={false}
          dataKey="ledger"
          name="Ledger Expense"
          fill={SERIES.ledger}
          radius={[4, 4, 0, 0]}
          maxBarSize={56}
          cursor="pointer"
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Approved demand per business date. Tap a day for its demands. */
export function DailyDemandChart({
  data,
  onDay,
}: {
  data: { date: string; label: string; demand: number; orders: number }[];
  onDay: (date: string) => void;
}) {
  const fmt = useMoneyTooltip();
  if (!data.some((d) => d.demand)) return <ChartEmpty message="No approved demand in this date range." />;
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart
        data={data}
        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        onClick={(s) => {
          const p = (s as { activePayload?: { payload?: { date?: string } }[] } | null)?.activePayload?.[0]?.payload;
          if (p?.date) onDay(p.date);
        }}
      >
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={8} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={compact} width={44} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          cursor={{ stroke: 'var(--muted-foreground)', strokeDasharray: '3 3' }}
          formatter={fmt}
          labelFormatter={(_, p) => {
            const row = p?.[0]?.payload as { date?: string; orders?: number } | undefined;
            return row?.date ? `${row.date} · ${row.orders ?? 0} demand${row.orders === 1 ? '' : 's'}` : '';
          }}
        />
        <Area
          isAnimationActive={false}
          type="monotone"
          dataKey="demand"
          name="Approved demand"
          stroke="var(--chart-1)"
          strokeWidth={2}
          fill="var(--chart-1)"
          fillOpacity={0.1}
          dot={false}
          activeDot={{ r: 4, cursor: 'pointer' }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Return and Discount per week of the month, labelled directly. */
export function WeeklyReturnDiscountChart({
  data,
}: {
  data: { key: string; label: string; returns: number; discount: number }[];
}) {
  const fmt = useMoneyTooltip();
  if (!data.some((d) => d.returns || d.discount)) {
    return <ChartEmpty message="No returns or discounts in this date range." />;
  }
  const label = (v: unknown) => (Number(v) ? compact(Number(v)) : '');
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 18, right: 8, left: 0, bottom: 0 }} barGap={2}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} interval={0} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} tickFormatter={compact} width={44} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--fin-soft)' }} formatter={fmt} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="square" iconSize={10} />
        <Bar isAnimationActive={false} dataKey="returns" name="Return" fill={SERIES.returns} radius={[4, 4, 0, 0]} maxBarSize={36}>
          <LabelList dataKey="returns" position="top" formatter={label} style={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
        </Bar>
        <Bar
          isAnimationActive={false}
          dataKey="discount"
          name="Discount"
          fill={SERIES.discount}
          radius={[4, 4, 0, 0]}
          maxBarSize={36}
        >
          <LabelList dataKey="discount" position="top" formatter={label} style={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
