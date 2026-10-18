'use client';

import { Skeleton } from '@/components/ui/skeleton';
import {
  ResponsiveContainer,
  LabelList,
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { Panel } from './ProductionPanel';
import { chartColors } from './dashboard/chartColors';

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  fontSize: '12px',
} as const;

const AXIS_TICK = { fontSize: 10.5, fill: chartColors.axis } as const;

const fmt = (n: number) => n.toLocaleString('en-US');
/** 12,345 → 12.3k, for labels drawn on the chart itself. */
const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));

/** `line` draws the key as a short stroke, for line series; otherwise a block, for bars. */
export interface LegendItem { label: string; color: string; line?: boolean }

/** Colour key shown in a chart's header, top right. */
export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-xs font-semibold text-muted-foreground">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className={it.line ? 'h-[3px] w-3.5 rounded-sm' : 'size-[9px] rounded-[3px]'} style={{ backgroundColor: it.color }} aria-hidden />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function ChartShell({
  title, subtitle, legend, loading, empty, height = 260, children,
}: {
  title: string;
  subtitle?: string;
  legend?: LegendItem[];
  loading?: boolean;
  empty?: boolean;
  height?: number;
  children: React.ReactElement;
}) {
  return (
    <Panel title={title} subtitle={subtitle} action={legend && <ChartLegend items={legend} />}>
      {loading ? (
        <Skeleton className="w-full" style={{ height }} />
      ) : empty ? (
        <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ height }}>
          No data yet
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={height}>
          {children}
        </ResponsiveContainer>
      )}
    </Panel>
  );
}

/** Demand beside output, one point per month, each point labelled with its value. */
export function MonthlyDemandProduction({
  data, subtitle, loading,
}: {
  data: { label: string; demand: number; produced: number }[];
  subtitle: string;
  loading?: boolean;
}) {
  const total = (k: 'demand' | 'produced') => fmt(Math.round(data.reduce((s, d) => s + d[k], 0)));
  // Each label sits on the outer side of its own line, so the two never land
  // on top of each other where the lines run close.
  const label = (key: 'demand' | 'produced', color: string) => function PointLabel(props: { x?: number | string; y?: number | string; index?: number }) {
    const d = data[props.index ?? 0];
    // A month with nothing in it is the flat line itself. A "0" there sat on
    // the month names below it (Nov to Jul, before the first order in Aug).
    if (!d || !d[key]) return null;
    const above = key === 'demand' ? d.demand >= d.produced : d.produced > d.demand;
    return (
      <text
        x={Number(props.x)}
        y={Number(props.y) + (above ? -12 : 20)}
        textAnchor="middle"
        fontSize={key === 'demand' ? 11.5 : 11}
        fontWeight={key === 'demand' ? 700 : 600}
        fill={color}
      >
        {compact(d[key])}
      </text>
    );
  };
  const dot = { r: 4.5, fill: 'var(--card)', strokeWidth: 2.5 };
  return (
    <ChartShell
      title="Monthly demand vs production"
      subtitle={subtitle}
      legend={[
        { label: `Demand ${total('demand')}`, color: chartColors.demand, line: true },
        { label: `Produced ${total('produced')}`, color: chartColors.produced, line: true },
      ]}
      loading={loading}
      empty={data.length === 0}
      height={300}
    >
      <ComposedChart data={data} margin={{ top: 26, right: 24, left: 0, bottom: 5 }}>
        <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 12, fontWeight: 600, fill: chartColors.axis }} tickLine={false} axisLine={false} padding={{ left: 24, right: 24 }} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} tickFormatter={compact} width={44} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, name: string) => [fmt(v), name]} />
        <Line type="monotone" dataKey="produced" name="Produced" stroke={chartColors.produced} strokeWidth={2.5} strokeLinecap="round" dot={dot} isAnimationActive={false}>
          {/* Values in text ink, never the series colour: the line beside them says which is which. */}
          <LabelList content={label('produced', 'var(--muted-foreground)')} />
        </Line>
        <Area type="monotone" dataKey="demand" name="Demand" stroke={chartColors.demand} strokeWidth={2.5} strokeLinecap="round" fill={chartColors.demand} fillOpacity={0.08} dot={dot} isAnimationActive={false}>
          <LabelList content={label('demand', 'var(--foreground)')} />
        </Area>
      </ComposedChart>
    </ChartShell>
  );
}

/** Units demanded against units prepared, one point per hour or per day of the period. */
export function DemandProductionTrend({
  data, subtitle, loading,
}: {
  data: { label: string; demand: number; produced: number }[];
  subtitle: string;
  loading?: boolean;
}) {
  return (
    <ChartShell
      title="Demand vs production"
      subtitle={subtitle}
      legend={[{ label: 'Demand', color: chartColors.demand, line: true }, { label: 'Produced', color: chartColors.produced, line: true }]}
      loading={loading}
      empty={data.length === 0}
      height={240}
    >
      <ComposedChart data={data} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
        <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, name: string) => [fmt(v), name]} />
        {/* See SalesChart: the mount animation bakes a stroke-dasharray from the
            width ResponsiveContainer reports before layout, and never recomputes it. */}
        <Area type="linear" dataKey="demand" name="Demand" stroke={chartColors.demand} strokeWidth={2.5} strokeLinejoin="round" fill={chartColors.demand} fillOpacity={0.1} dot={false} isAnimationActive={false} />
        <Line type="linear" dataKey="produced" name="Produced" stroke={chartColors.produced} strokeWidth={2.5} strokeLinejoin="round" strokeDasharray="6 4" dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ChartShell>
  );
}
