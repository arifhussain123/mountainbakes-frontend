'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
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

const TOOLTIP_STYLE = {
  backgroundColor: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  fontSize: '12px',
} as const;

const AXIS_TICK = { fontSize: 11, fill: 'var(--muted-foreground)' } as const;

const fmt = (n: number) => n.toLocaleString('en-US');

export interface LegendItem { label: string; color: string }

/** Colour key shown in a chart's header, top right. */
export function ChartLegend({ items }: { items: LegendItem[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span className="size-2 rounded-[2px]" style={{ backgroundColor: it.color }} aria-hidden />
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
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-base">{title}</CardTitle>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {legend && <ChartLegend items={legend} />}
        </div>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}

/** Demand-over-time bar chart (Monthly demand). */
export function DemandBarChart({ title, data, loading }: { title: string; data: { label: string; qty: number }[]; loading?: boolean }) {
  return (
    <ChartShell title={title} loading={loading} empty={data.length === 0}>
      <BarChart data={data} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [fmt(v), 'Qty']} />
        <Bar dataKey="qty" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartShell>
  );
}

/** Units demanded against units prepared, one point per day of the week so far. */
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
      legend={[{ label: 'Demand', color: 'var(--chart-1)' }, { label: 'Produced', color: 'var(--chart-2)' }]}
      loading={loading}
      empty={data.length === 0}
      height={220}
    >
      <ComposedChart data={data} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, name: string) => [fmt(v), name]} />
        {/* See SalesChart: the mount animation bakes a stroke-dasharray from the
            width ResponsiveContainer reports before layout, and never recomputes it. */}
        <Area type="monotone" dataKey="demand" name="Demand" stroke="var(--chart-1)" strokeWidth={2} fill="var(--chart-1)" fillOpacity={0.15} dot={{ r: 2.5 }} isAnimationActive={false} />
        <Line type="monotone" dataKey="produced" name="Produced" stroke="var(--chart-2)" strokeWidth={1.75} strokeDasharray="4 3" dot={{ r: 2.5 }} isAnimationActive={false} />
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
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Order status</CardTitle>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-[180px] w-full" />
        ) : (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <div className="relative size-[150px] shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    // An empty week still draws a ring, in the track colour, so the
                    // card does not collapse to a number floating in white space.
                    data={total > 0 ? slices : [{ label: 'No orders', value: 1, color: 'var(--muted)' }]}
                    dataKey="value"
                    nameKey="label"
                    innerRadius={48}
                    outerRadius={70}
                    startAngle={90}
                    endAngle={-270}
                    stroke="var(--card)"
                    strokeWidth={total > 0 ? 2 : 0}
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
                <span className="text-2xl font-bold leading-none">{fmt(total)}</span>
                <span className="text-[11px] text-muted-foreground">orders</span>
              </div>
            </div>
            <ul className="grid min-w-[10rem] flex-1 gap-1.5 text-sm">
              {slices.map((d) => (
                <li key={d.label} className="flex items-center justify-between gap-3">
                  <span className="inline-flex min-w-0 items-center gap-2">
                    <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: d.color }} aria-hidden />
                    <span className="truncate">{d.label}</span>
                  </span>
                  <b className="tabular-nums">{fmt(d.value)}</b>
                </li>
              ))}
              {extra && (
                <li className="mt-1 flex items-center justify-between gap-3 border-t pt-1.5 text-muted-foreground">
                  <span>{extra.label}</span>
                  <b className="tabular-nums text-foreground">{fmt(extra.value)}</b>
                </li>
              )}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
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
  const chartData = data.map((b) => ({ ...b, name: b.branchName.replace('Mountain Bakes ', '') }));
  // recharts hands the clicked datum back either flat or under `payload`,
  // depending on which element caught the click.
  const pick = (d: { branchId?: string; payload?: { branchId?: string } }) => {
    const id = d?.payload?.branchId ?? d?.branchId;
    if (id) onSelect(id);
  };
  const dim = (id: string) => (selectedId && selectedId !== id ? 0.35 : 1);
  return (
    <ChartShell
      title="Branch demand comparison"
      subtitle="Click a branch to filter the dashboard"
      legend={[{ label: 'Demand', color: 'var(--chart-1)' }, { label: 'Delivered', color: 'var(--chart-4)' }]}
      loading={loading}
      empty={chartData.length === 0}
      height={240}
    >
      <BarChart data={chartData} margin={{ top: 5, right: 8, left: 0, bottom: 5 }} barGap={2}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={0} angle={chartData.length > 5 ? -25 : 0} textAnchor={chartData.length > 5 ? 'end' : 'middle'} height={chartData.length > 5 ? 56 : 30} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'var(--muted)', opacity: 0.5 }} formatter={(v: number, name: string) => [fmt(v), name]} />
        <Bar dataKey="demand" name="Demand" radius={[3, 3, 0, 0]} cursor="pointer" onClick={pick} isAnimationActive={false}>
          {chartData.map((b) => <Cell key={b.branchId} fill="var(--chart-1)" fillOpacity={dim(b.branchId)} />)}
        </Bar>
        <Bar dataKey="delivered" name="Delivered" radius={[3, 3, 0, 0]} cursor="pointer" onClick={pick} isAnimationActive={false}>
          {chartData.map((b) => <Cell key={b.branchId} fill="var(--chart-4)" fillOpacity={dim(b.branchId)} />)}
        </Bar>
      </BarChart>
    </ChartShell>
  );
}
