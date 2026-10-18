'use client';

/**
 * The Production Dashboard sections' charts. Recharts, like the rest of the
 * dashboard, and loaded lazily by the sections so the page's first paint does
 * not wait for it.
 *
 * House rules, applied to every chart here: colours from chartColors only;
 * rounded data ends; soft horizontal grid, no axis lines; a value drawn on the
 * chart only at the peak and the latest point; a tooltip on every mark.
 * Mount animations stay off — see DemandProductionTrend for why.
 */

import type { ReactNode } from 'react';
import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  DEMAND_STATUS_LABELS,
  type BranchSummaryRow,
  type CurrentStockRow,
  type DashboardBucket,
  type DemandStatus,
  type ReceivedDemandPoint,
  type RepairedStockPoint,
  type ReturnStockPoint,
} from '@mb/shared';
import { chartColors, DEMAND_STACK_ORDER, DEMAND_STATUS_COLORS } from './chartColors';
import { bucketLabel, compact, fmt, labelledIndexes, shortBranch } from './format';

const AXIS_TICK = { fontSize: 10.5, fill: chartColors.axis } as const;
const R = 4; // data-end radius

// ─── Tooltip ────────────────────────────────────────────────────────────────

interface TipRow { label: string; value: string; color?: string; strong?: boolean }

function TipBox({ title, rows }: { title: string; rows: TipRow[] }) {
  return (
    <div className="min-w-[150px] rounded-lg border bg-card px-3 py-2 text-xs shadow-md">
      <p className="mb-1.5 font-bold text-foreground">{title}</p>
      <ul className="flex flex-col gap-1">
        {rows.map((r) => (
          <li key={r.label} className={`flex items-center gap-2 ${r.strong ? 'mt-0.5 border-t pt-1.5 font-bold text-foreground' : 'text-muted-foreground'}`}>
            {r.color && <span className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: r.color }} aria-hidden />}
            <span className="flex-1">{r.label}</span>
            <span className="font-semibold tabular-nums text-foreground">{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Recharts hands the hovered row to `content`; this pulls our own row back out of it. */
function tip<T>(render: (row: T) => ReactNode) {
  return function Content({ active, payload }: { active?: boolean; payload?: { payload?: T }[] }) {
    const row = payload?.[0]?.payload;
    return active && row ? <>{render(row)}</> : null;
  };
}

// ─── Shapes ─────────────────────────────────────────────────────────────────

/** A rect rounded on one end only: the top of a column, the right of a bar. */
function endRoundedPath(x: number, y: number, w: number, h: number, end: 'top' | 'right'): string {
  const r = Math.max(0, Math.min(R, end === 'top' ? w / 2 : h / 2, end === 'top' ? h : w));
  if (end === 'top') {
    return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
  }
  return `M${x},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} L${x},${y + h} Z`;
}

interface ShapeProps { x?: number; y?: number; width?: number; height?: number; fill?: string; fillOpacity?: number; payload?: Record<string, unknown> }

/**
 * A stacked segment. Only the topmost segment that has anything in it gets the
 * rounded end, and every segment is ringed in the card colour, which leaves the
 * 2px gap between stacked fills.
 */
function stackSegment(key: string, isEnd: (row: Record<string, unknown>) => string | null, end: 'top' | 'right') {
  // Recharts types a shape's props as unknown; they are a rect's geometry plus the row.
  return function Segment(raw: unknown) {
    const { x = 0, y = 0, width = 0, height = 0, fill, fillOpacity, payload } = raw as ShapeProps;
    if (width <= 0 || height <= 0) return <g />;
    const rounded = payload ? isEnd(payload) === key : false;
    const d = rounded ? endRoundedPath(x, y, width, height, end) : `M${x},${y} h${width} v${height} h${-width} Z`;
    return <path d={d} fill={fill} fillOpacity={fillOpacity} stroke={chartColors.surface} strokeWidth={1} />;
  };
}

/** A label above a column or after a bar, only where `show` says so. */
function pointLabel(show: Set<number>, valueAt: (i: number) => number, placement: 'above' | 'right' = 'above') {
  return function PointLabel(props: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; index?: number }) {
    const i = props.index ?? -1;
    if (!show.has(i)) return null;
    const x = Number(props.x), y = Number(props.y), w = Number(props.width ?? 0), h = Number(props.height ?? 0);
    return placement === 'above'
      ? <text x={x + w / 2} y={y - 7} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--foreground)">{compact(valueAt(i))}</text>
      : <text x={x + w + 6} y={y + h / 2} dominantBaseline="central" fontSize={11} fontWeight={700} fill="var(--foreground)">{compact(valueAt(i))}</text>;
  };
}

/** A label on a line's point, only where `show` says so. */
function lineLabel(show: Set<number>, valueAt: (i: number) => number) {
  return function LineLabel(props: { x?: number | string; y?: number | string; index?: number }) {
    const i = props.index ?? -1;
    if (!show.has(i)) return null;
    return <text x={Number(props.x)} y={Number(props.y) - 10} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--foreground)">{compact(valueAt(i))}</text>;
  };
}

// ─── 1. Received demand: stacked columns by status ──────────────────────────

export function DemandStatusColumns({ data, bucket, height = 260 }: { data: ReceivedDemandPoint[]; bucket: DashboardBucket; height?: number }) {
  const rows = data.map((p) => ({
    label: bucketLabel(p.bucket, bucket),
    point: p,
    ...Object.fromEntries(DEMAND_STACK_ORDER.map((s) => [s, p.byStatus[s].units])),
  }));
  const topOf = (row: Record<string, unknown>) => [...DEMAND_STACK_ORDER].reverse().find((s) => Number(row[s]) > 0) ?? null;
  const show = labelledIndexes(data.map((p) => p.units));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 22, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={8} interval="preserveStartEnd" />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} tickFormatter={compact} width={40} />
        <Tooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.5 }}
          content={tip<(typeof rows)[number]>((row) => (
            <TipBox
              title={row.label}
              rows={[
                ...[...DEMAND_STACK_ORDER].reverse().map((s: DemandStatus) => ({
                  label: DEMAND_STATUS_LABELS[s],
                  value: `${fmt(row.point.byStatus[s].units)} units · ${row.point.byStatus[s].orders} ${row.point.byStatus[s].orders === 1 ? 'order' : 'orders'}`,
                  color: DEMAND_STATUS_COLORS[s],
                })),
                { label: 'Total', value: `${fmt(row.point.units)} units · ${row.point.orders} ${row.point.orders === 1 ? 'order' : 'orders'}`, strong: true },
              ]}
            />
          ))}
        />
        {DEMAND_STACK_ORDER.map((s, i) => (
          <Bar key={s} dataKey={s} name={DEMAND_STATUS_LABELS[s]} stackId="demand" fill={DEMAND_STATUS_COLORS[s]} maxBarSize={40} isAnimationActive={false} shape={stackSegment(s, topOf, 'top')}>
            {/* The stack's total, drawn once, above whichever segment is on top. */}
            {i === DEMAND_STACK_ORDER.length - 1 && <LabelList content={pointLabel(show, (j) => data[j]?.units ?? 0)} />}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── 2. Branch-wise: grouped horizontal bars ────────────────────────────────

export function BranchGroupedBars({
  rows, selectedId, onSelect,
}: {
  rows: BranchSummaryRow[];
  selectedId: string | null;
  onSelect: (branchId: string) => void;
}) {
  const data = rows.map((b) => ({ ...b, name: shortBranch(b.branchName) }));
  const dim = (id: string) => (selectedId && selectedId !== id ? 0.3 : 1);
  const series = [
    { key: 'demanded', name: 'Demanded', color: chartColors.demand },
    { key: 'delivered', name: 'Delivered', color: chartColors.delivered },
    { key: 'returned', name: 'Returned', color: chartColors.returned },
  ] as const;
  return (
    <ResponsiveContainer width="100%" height={Math.max(data.length * 50 + 24, 160)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }} barGap={2} barCategoryGap="20%">
        <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={compact} allowDecimals={false} />
        <YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fontSize: 11.5, fill: 'var(--foreground)' }} tickLine={false} axisLine={false} width={112} interval={0} />
        <Tooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.5 }}
          content={tip<(typeof data)[number]>((b) => (
            <TipBox
              title={b.name}
              rows={[
                ...series.map((s) => ({ label: s.name, value: fmt(b[s.key]), color: s.color })),
                { label: 'Fulfilment', value: b.fulfilment === null ? '—' : `${b.fulfilment.toFixed(1)}%`, strong: true },
              ]}
            />
          ))}
        />
        {series.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.name}
            fill={s.color}
            barSize={9}
            radius={[0, R, R, 0]}
            isAnimationActive={false}
            cursor="pointer"
            onClick={(d: { branchId?: string }) => d.branchId && onSelect(d.branchId)}
          >
            {data.map((b) => <Cell key={b.branchId} fillOpacity={dim(b.branchId)} />)}
            {/* Demand is the figure each row is sorted by, so it is the one written out. */}
            {s.key === 'demanded' && (
              <LabelList content={pointLabel(new Set(data.flatMap((b, i) => (b.demanded > 0 ? [i] : []))), (i) => data[i]?.demanded ?? 0, 'right')} />
            )}
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── 3. Repaired stock: area of repaired against a line of returned ─────────

export function RepairedArea({ data, bucket, height = 240 }: { data: RepairedStockPoint[]; bucket: DashboardBucket; height?: number }) {
  const rows = data.map((p) => ({ ...p, label: bucketLabel(p.bucket, bucket) }));
  const showRepaired = labelledIndexes(data.map((p) => p.repaired));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 22, right: 14, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={8} interval="preserveStartEnd" />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} tickFormatter={compact} width={40} />
        <Tooltip
          cursor={{ stroke: chartColors.axis, strokeDasharray: '3 3' }}
          content={tip<(typeof rows)[number]>((p) => (
            <TipBox
              title={p.label}
              rows={[
                { label: 'Repaired', value: fmt(p.repaired), color: chartColors.repaired },
                { label: 'Returned', value: fmt(p.returned), color: chartColors.returned },
                { label: 'Not repaired', value: fmt(Math.max(p.returned - p.repaired, 0)), strong: true },
              ]}
            />
          ))}
        />
        <Area type="monotone" dataKey="repaired" name="Repaired" stroke={chartColors.repaired} strokeWidth={2} fill={chartColors.repaired} fillOpacity={0.16} dot={false} activeDot={{ r: 4, stroke: chartColors.surface, strokeWidth: 2 }} isAnimationActive={false}>
          <LabelList content={lineLabel(showRepaired, (i) => data[i]?.repaired ?? 0)} />
        </Area>
        <Line type="monotone" dataKey="returned" name="Returned" stroke={chartColors.returned} strokeWidth={2} strokeDasharray="5 4" dot={false} activeDot={{ r: 4, stroke: chartColors.surface, strokeWidth: 2 }} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

// ─── 4. Return stock: donut by reason, line of daily returns ────────────────

export function ReasonDonut({ slices, size = 150 }: { slices: { label: string; value: number; color: string }[]; size?: number }) {
  const total = slices.reduce((s, d) => s + d.value, 0);
  const shown = slices.filter((s) => s.value > 0);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={total > 0 ? shown : [{ label: 'No returns', value: 1, color: 'var(--muted)' }]}
            dataKey="value"
            nameKey="label"
            innerRadius={size * 0.35}
            outerRadius={size * 0.5}
            startAngle={90}
            endAngle={-270}
            stroke={chartColors.surface}
            strokeWidth={2}
            isAnimationActive={false}
          >
            {(total > 0 ? shown : [{ color: 'var(--muted)' }]).map((d, i) => <Cell key={i} fill={d.color} />)}
          </Pie>
          {total > 0 && (
            <Tooltip
              content={tip<{ label: string; value: number; color: string }>((d) => (
                <TipBox title={d.label} rows={[{ label: 'Units', value: fmt(d.value), color: d.color }, { label: 'Share', value: `${((d.value / total) * 100).toFixed(1)}%` }]} />
              ))}
            />
          )}
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[22px] font-extrabold leading-none tabular-nums">{compact(total)}</span>
        <span className="mt-1 text-[11px] text-muted-foreground">units</span>
      </div>
    </div>
  );
}

export function ReturnsLine({ data, bucket, height = 200 }: { data: ReturnStockPoint[]; bucket: DashboardBucket; height?: number }) {
  const rows = data.map((p) => ({ ...p, label: bucketLabel(p.bucket, bucket) }));
  const show = labelledIndexes(data.map((p) => p.returned));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={rows} margin={{ top: 22, right: 14, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} minTickGap={8} interval="preserveStartEnd" />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} tickFormatter={compact} width={36} />
        <Tooltip
          cursor={{ stroke: chartColors.axis, strokeDasharray: '3 3' }}
          content={tip<(typeof rows)[number]>((p) => <TipBox title={p.label} rows={[{ label: 'Returned', value: fmt(p.returned), color: chartColors.returned }]} />)}
        />
        <Line type="monotone" dataKey="returned" name="Returned" stroke={chartColors.returned} strokeWidth={2} dot={rows.length <= 14 ? { r: 3, fill: chartColors.returned, strokeWidth: 0 } : false} activeDot={{ r: 4.5, stroke: chartColors.surface, strokeWidth: 2 }} isAnimationActive={false}>
          <LabelList content={lineLabel(show, (i) => data[i]?.returned ?? 0)} />
        </Line>
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── 5. Current stock: production + branch stock per product ────────────────

const ROW_H = 26;

export function StockBars({ rows }: { rows: CurrentStockRow[] }) {
  const data = rows.map((r) => ({
    ...r,
    prod: Math.max(r.production, 0),
    shelf: Math.max(r.branch, 0),
  }));
  const endOf = (row: Record<string, unknown>) => (Number(row['shelf']) > 0 ? 'shelf' : Number(row['prod']) > 0 ? 'prod' : null);
  // Low stock repaints the whole bar amber — the split is still in the tooltip.
  const fillFor = (r: CurrentStockRow, base: string) => (r.state === 'low' ? chartColors.lowStock : base);
  const StatusLabel = (props: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; index?: number }) => {
    const r = data[props.index ?? -1];
    if (!r) return null;
    const x = Number(props.x) + Number(props.width ?? 0) + 6;
    const y = Number(props.y) + Number(props.height ?? 0) / 2;
    // Status never by colour alone: a mark and a word, the word in text ink.
    return (
      <text x={x} y={y} dominantBaseline="central" fontSize={11} fontWeight={700} fill="var(--foreground)">
        {r.state === 'out' ? (
          <><tspan fill={chartColors.outOfStock}>●</tspan><tspan dx={4} fill="var(--muted-foreground)">Out</tspan></>
        ) : (
          <>
            {fmt(r.total)}
            {r.state === 'low' && <><tspan dx={6} fill={chartColors.lowStock}>▲</tspan><tspan dx={3} fill="var(--muted-foreground)">Low</tspan></>}
          </>
        )}
      </text>
    );
  };
  return (
    <ResponsiveContainer width="100%" height={data.length * ROW_H + 28}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 64, left: 0, bottom: 0 }} barCategoryGap={6}>
        <CartesianGrid stroke={chartColors.grid} strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={compact} allowDecimals={false} orientation="top" />
        <YAxis type="category" dataKey="productName" tick={{ ...AXIS_TICK, fontSize: 11, fill: 'var(--foreground)' }} tickLine={false} axisLine={false} width={130} interval={0} />
        <Tooltip
          cursor={{ fill: 'var(--muted)', opacity: 0.5 }}
          content={tip<(typeof data)[number]>((r) => (
            <TipBox
              title={r.productName}
              rows={[
                { label: 'Production stock', value: fmt(r.production), color: chartColors.productionStock },
                { label: 'Branch stock', value: fmt(r.branch), color: chartColors.branchStock },
                { label: r.state === 'out' ? 'Out of stock' : r.state === 'low' ? 'Low stock · total' : 'Total', value: fmt(r.total), strong: true },
              ]}
            />
          ))}
        />
        <Bar dataKey="prod" name="Production stock" stackId="stock" fill={chartColors.productionStock} isAnimationActive={false} shape={stackSegment('prod', endOf, 'right')}>
          {data.map((r) => <Cell key={r.productId} fill={fillFor(r, chartColors.productionStock)} />)}
        </Bar>
        <Bar dataKey="shelf" name="Branch stock" stackId="stock" fill={chartColors.branchStock} isAnimationActive={false} shape={stackSegment('shelf', endOf, 'right')}>
          {data.map((r) => <Cell key={r.productId} fill={fillFor(r, chartColors.branchStock)} fillOpacity={r.state === 'low' ? 0.65 : 1} />)}
          <LabelList content={StatusLabel} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
