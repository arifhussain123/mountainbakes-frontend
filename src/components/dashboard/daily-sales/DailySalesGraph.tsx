'use client';

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import type { SalesAnalyticsDay } from '@mb/shared';

/**
 * The Daily Sales graph.
 *
 * Loaded through `next/dynamic({ ssr: false })` by its parent, so recharts stays
 * out of the dashboard's initial bundle.
 *
 * The theme tokens hold complete `oklch(...)` colours, not the bare channel
 * triplets `hsl(var(--x))` expects — wrapping them yields `hsl(oklch(...))`,
 * which is not a colour, so the stroke falls back to `none` and the chart draws
 * itself invisible. Reference the tokens directly, as SalesChart does; they
 * resolve in both themes and follow the accent setting.
 */
const AXIS = 'var(--muted-foreground)';
const GRID = 'var(--border)';
const SALES = 'var(--chart-1)';

/** ~1000 → "1k". The axis is a sense of scale; the tooltip carries the figure. */
function compact(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(Math.round(v));
}

interface Point extends SalesAnalyticsDay {
  label: string;
}

function toPoints(data: SalesAnalyticsDay[]): Point[] {
  // A week reads better by weekday name — it is how a shop thinks about trade,
  // and "Sat" says more than "16 Aug" when comparing one week's shape. Beyond
  // that the names repeat and stop identifying anything.
  const weekdayLabels = data.length <= 8;
  return data.map((d) => ({
    ...d,
    label: (() => {
      try {
        return format(parseISO(d.date), weekdayLabels ? 'EEE' : 'd MMM');
      } catch {
        return d.date;
      }
    })(),
  }));
}

function SalesTooltip({
  active,
  payload,
  currency,
}: {
  active?: boolean;
  payload?: { payload: Point }[];
  currency: string;
}) {
  const point = active ? payload?.[0]?.payload : undefined;
  if (!point) return null;

  let heading = point.date;
  try {
    heading = format(parseISO(point.date), 'd MMM yyyy');
  } catch {
    /* keep the raw business date — it is still the right day */
  }

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-card-foreground shadow-md">
      <p className="text-xs font-medium text-muted-foreground">{heading}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums" style={{ color: SALES }}>
        {currency}
        {Math.round(point.sales).toLocaleString()}
      </p>
      <p className="text-xs tabular-nums text-muted-foreground">
        {point.transactions.toLocaleString()}{' '}
        {point.transactions === 1 ? 'transaction' : 'transactions'}
      </p>
    </div>
  );
}

export function DailySalesGraph({
  data,
  currency,
  height = 300,
}: {
  data: SalesAnalyticsDay[];
  currency: string;
  height?: number;
}) {
  const points = toPoints(data);

  // A single day has no line to draw — an area between one point and nothing is
  // an empty plot. Mark it, so "Today" shows the day's takings as a point rather
  // than as a blank chart. Above a fortnight the dots merge into the stroke and
  // only add noise.
  const dot = points.length <= 14 ? { r: 3, strokeWidth: 0, fill: SALES } : false;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={points} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          {/* One soft wash under the line, not a decorative gradient: it gives
              the series a body so a flat stretch still reads as a quantity. */}
          <linearGradient id="dailySalesFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SALES} stopOpacity={0.28} />
            <stop offset="100%" stopColor={SALES} stopOpacity={0.02} />
          </linearGradient>
        </defs>

        <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />

        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: AXIS }}
          tickLine={false}
          axisLine={false}
          // Recharts drops overlapping labels rather than letting a month of
          // dates collide into a grey smear.
          minTickGap={24}
        />
        <YAxis
          width={52}
          tick={{ fontSize: 11, fill: AXIS }}
          tickLine={false}
          axisLine={false}
          tickFormatter={compact}
          // A sales axis that does not start at zero exaggerates every wobble
          // into a cliff — the one thing the brief asks this graph not to do.
          domain={[0, 'auto']}
        />
        <Tooltip
          content={<SalesTooltip currency={currency} />}
          cursor={{ stroke: GRID, strokeWidth: 1 }}
        />

        {/* Animation off, and not for taste. Recharts derives the mount
            "draw-on" stroke-dasharray from the path length measured on the
            FIRST render, when ResponsiveContainer still reports a near-zero
            width; the path `d` is recomputed once laid out, the dasharray is
            not, and the series renders as a stub. See SalesChart, where the
            same bug was diagnosed. */}
        <Area
          type="monotone"
          dataKey="sales"
          stroke={SALES}
          strokeWidth={2}
          fill="url(#dailySalesFill)"
          dot={dot}
          activeDot={{ r: 4 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
