'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import {
  ResponsiveContainer,
  LabelList,
  ComposedChart,
  Area,
  Line,
  PieChart,
  Pie,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';
import { Panel } from './ProductionPanel';

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  fontSize: '12px',
} as const;

const AXIS_TICK = { fontSize: 10.5, fill: 'var(--muted-foreground)' } as const;

/** Output on the monthly chart. Not a --chart-N step: those sit too close to
 *  the demand orange for two lines that cross each other all year. */
const AMBER = '#D99A1E';

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
    if (!d) return null;
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
        { label: `Demand ${total('demand')}`, color: 'var(--chart-1)', line: true },
        { label: `Produced ${total('produced')}`, color: AMBER, line: true },
      ]}
      loading={loading}
      empty={data.length === 0}
      height={300}
    >
      <ComposedChart data={data} margin={{ top: 26, right: 24, left: 0, bottom: 5 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 12, fontWeight: 600, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} padding={{ left: 24, right: 24 }} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} tickFormatter={compact} width={44} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, name: string) => [fmt(v), name]} />
        <Line type="monotone" dataKey="produced" name="Produced" stroke={AMBER} strokeWidth={3} strokeLinecap="round" dot={dot} isAnimationActive={false}>
          {/* Darkened toward the text colour: amber on its own is too faint to read as a number. */}
          <LabelList content={label('produced', `color-mix(in oklab, ${AMBER} 60%, var(--foreground))`)} />
        </Line>
        <Area type="monotone" dataKey="demand" name="Demand" stroke="var(--chart-1)" strokeWidth={3} strokeLinecap="round" fill="var(--chart-1)" fillOpacity={0.08} dot={dot} isAnimationActive={false}>
          <LabelList content={label('demand', 'var(--chart-3)')} />
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
      legend={[{ label: 'Demand', color: 'var(--chart-1)', line: true }, { label: 'Produced', color: 'var(--chart-2)', line: true }]}
      loading={loading}
      empty={data.length === 0}
      height={240}
    >
      <ComposedChart data={data} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
        <CartesianGrid stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: 'var(--border)' }} minTickGap={16} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, name: string) => [fmt(v), name]} />
        {/* See SalesChart: the mount animation bakes a stroke-dasharray from the
            width ResponsiveContainer reports before layout, and never recomputes it. */}
        <Area type="linear" dataKey="demand" name="Demand" stroke="var(--chart-1)" strokeWidth={2.5} strokeLinejoin="round" fill="var(--chart-1)" fillOpacity={0.1} dot={false} isAnimationActive={false} />
        <Line type="linear" dataKey="produced" name="Produced" stroke="var(--chart-2)" strokeWidth={2.5} strokeLinejoin="round" strokeDasharray="6 4" dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ChartShell>
  );
}

/** Orders by status. The ring is sized by `slices`; `extra` is listed beside it without a share. */
export function OrderStatusDonut({
  slices, extra, subtitle, loading,
}: {
  slices: { label: string; value: number; color: string }[];
  extra?: { label: string; value: number };
  subtitle: string;
  loading?: boolean;
}) {
  const total = slices.reduce((s, d) => s + d.value, 0);
  return (
    <Panel title="Order status" subtitle={subtitle}>
      {loading ? (
        <Skeleton className="h-[180px] w-full" />
      ) : (
        <div className="flex flex-wrap items-center gap-x-[22px] gap-y-3">
          <div className="relative size-[150px] shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  // An empty week still draws a ring, in the track colour, so the
                  // card does not collapse to a number floating in white space.
                  data={total > 0 ? slices : [{ label: 'No orders', value: 1, color: 'var(--muted)' }]}
                  dataKey="value"
                  nameKey="label"
                  innerRadius={52}
                  outerRadius={75}
                  startAngle={90}
                  endAngle={-270}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {(total > 0 ? slices : [{ color: 'var(--muted)' }]).map((d, i) => (
                    <Cell key={i} fill={d.color} />
                  ))}
                </Pie>
                {total > 0 && <Tooltip contentStyle={TOOLTIP_STYLE} />}
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[26px] font-extrabold leading-none tabular-nums">{fmt(total)}</span>
              <span className="mt-1 text-[11px] text-muted-foreground">orders</span>
            </div>
          </div>
          <ul className="grid min-w-[190px] flex-1 grid-cols-[minmax(0,1fr)] gap-[9px] text-[12.5px]">
            {slices.map((d) => (
              <li key={d.label} className="flex items-center gap-2">
                <span className="size-[9px] shrink-0 rounded-[3px]" style={{ backgroundColor: d.color }} aria-hidden />
                <span className="min-w-0 flex-1 truncate font-medium text-muted-foreground">{d.label}</span>
                <b className="tabular-nums">{fmt(d.value)}</b>
              </li>
            ))}
            {extra && (
              <li className="mt-0.5 flex items-center justify-between gap-3 border-t pt-2 font-medium text-muted-foreground">
                <span>{extra.label}</span>
                <b className="tabular-nums text-foreground">{fmt(extra.value)}</b>
              </li>
            )}
          </ul>
        </div>
      )}
    </Panel>
  );
}

/** Demand beside delivered, per branch. Clicking a branch's bars filters the dashboard to it. */
export function BranchCompareBars({
  data, selectedId, onSelect, loading,
}: {
  data: { branchId: string; branchName: string; demand: number; delivered: number }[];
  selectedId: string | null;
  onSelect: (branchId: string) => void;
  loading?: boolean;
}) {
  const rows = data.map((b) => ({ ...b, name: b.branchName.replace('Mountain Bakes ', '') }));
  const max = Math.max(...rows.flatMap((b) => [b.demand, b.delivered]), 1);
  return (
    <Panel
      title="Branch demand comparison"
      subtitle="Click a branch to filter the dashboard"
      action={<ChartLegend items={[{ label: 'Demand', color: 'var(--chart-1)' }, { label: 'Delivered', color: 'var(--chart-4)' }]} />}
    >
      {loading ? (
        <Skeleton className="h-[270px] w-full" />
      ) : rows.length === 0 ? (
        <div className="flex h-[270px] items-center justify-center text-sm text-muted-foreground">No data yet</div>
      ) : (
        <div>
          <div className="flex h-[230px] items-end gap-2.5 border-b pt-4">
            {rows.map((b) => {
              // The pair shares one box as tall as its larger bar, so the
              // value label always rides on top of whichever that is.
              const top = Math.max(b.demand, b.delivered);
              return (
                <button
                  key={b.branchId}
                  type="button"
                  onClick={() => onSelect(b.branchId)}
                  aria-pressed={selectedId === b.branchId}
                  title={`${b.name}: ${fmt(b.demand)} demanded, ${fmt(b.delivered)} delivered`}
                  className={cn(
                    'flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1 transition-opacity',
                    selectedId && selectedId !== b.branchId && 'opacity-35',
                  )}
                >
                  <span className="text-[10.5px] font-bold tabular-nums text-muted-foreground">{compact(b.demand)}</span>
                  <span className="flex w-full items-end gap-[3px]" style={{ height: `${(top / max) * 92}%` }}>
                    <span className="flex-1 rounded-t-[5px]" style={{ height: `${top ? (b.demand / top) * 100 : 0}%`, backgroundColor: 'var(--chart-1)' }} />
                    <span className="flex-1 rounded-t-[5px]" style={{ height: `${top ? (b.delivered / top) * 100 : 0}%`, backgroundColor: 'var(--chart-4)' }} />
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex gap-2.5">
            {rows.map((b) => (
              <span key={b.branchId} className="min-w-0 flex-1 break-words text-center text-[10.5px] leading-[1.3] text-muted-foreground [text-wrap:balance]">
                {b.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
