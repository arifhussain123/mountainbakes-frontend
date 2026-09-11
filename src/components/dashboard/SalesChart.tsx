'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import type { DailySalesData } from '@mb/shared';
import { format, parseISO } from 'date-fns';

// The theme tokens hold complete `oklch(...)` colors, not the bare HSL channel
// triplets that `hsl(var(--x))` expects — wrapping them produced `hsl(oklch(...))`,
// which is not a colour, so every stroke fell back to `none` and the chart drew
// itself invisible. Reference the tokens directly; they resolve in both modes and
// follow the accent theme.
const AXIS = 'var(--muted-foreground)';
const GRID = 'var(--border)';
const REVENUE = 'var(--chart-1)';
const ORDERS = 'var(--chart-2)';

const TOOLTIP = {
  backgroundColor: 'var(--card)',
  color: 'var(--card-foreground)',
  border: '1px solid var(--border)',
  borderRadius: '8px',
  fontSize: '12px',
} as const;

// One gutter each side, equal, so the plot area sits centred under the card and
// the two scales look like peers rather than one being an afterthought.
const Y_WIDTH = 48;
const MARGIN = { top: 8, right: 0, left: 0, bottom: 0 };

const compact = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v));

export function SalesChart({ data, loading }: { data: DailySalesData[]; loading?: boolean }) {
  const chartData = data.map((d) => ({
    date: (() => { try { return format(parseISO(d.date), 'MMM d'); } catch { return d.date; } })(),
    Revenue: d.totalRevenue,
    Orders: d.totalOrders,
  }));

  // A line between fewer than two points has no length to draw, and "Today" —
  // the dashboard's default period — is exactly one day. Below a couple of weeks
  // the points are also far enough apart to mark individually without clutter.
  const dot = chartData.length <= 14 ? { r: 3 } : false;

  const latest = chartData[chartData.length - 1];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Daily Sales</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-64 w-full" />
        ) : chartData.length === 0 ? (
          <div className="flex h-64 items-center justify-center text-sm text-muted-foreground">
            No sales in this period
          </div>
        ) : (
          <div className="space-y-1">
            {/* Latest day, spelled out. The two lines share an x axis but not a
                scale, so their heights are not comparable by eye — the figures
                are what answer "how did today go", and the graph is the shape
                around them. */}
            {latest && (
              <div className="flex flex-wrap items-baseline justify-end gap-x-4 px-1 text-xs">
                <span className="text-muted-foreground">{latest.date}</span>
                <span className="tabular-nums" style={{ color: REVENUE }}>Rs.{latest.Revenue.toLocaleString()}</span>
                <span className="tabular-nums" style={{ color: ORDERS }}>{latest.Orders.toLocaleString()} orders</span>
              </div>
            )}
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData} margin={MARGIN}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: AXIS }}
                  tickLine={false}
                  axisLine={false}
                />
                {/* Revenue and Orders differ by three orders of magnitude — on one
                    scale the Orders line lies flat on the baseline. Two y axes keep
                    both readable in a single plot; each axis is tinted with its
                    series colour, because with independent scales the only thing
                    saying which line belongs to which numbers is that pairing. The
                    crossing point of the lines means nothing — do not read it. */}
                <YAxis
                  yAxisId="revenue"
                  width={Y_WIDTH}
                  tick={{ fontSize: 11, fill: REVENUE }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={compact}
                />
                <YAxis
                  yAxisId="orders"
                  orientation="right"
                  width={Y_WIDTH}
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: ORDERS }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={compact}
                />
                <Tooltip
                  contentStyle={TOOLTIP}
                  formatter={(value: number, name: string) =>
                    name === 'Revenue' ? [`Rs.${value.toLocaleString()}`, name] : [value.toLocaleString(), name]
                  }
                />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                {/* Animation off, and not for taste. Recharts derives the mount
                    "draw-on" stroke-dasharray from the path length measured on the
                    FIRST render, when ResponsiveContainer still reports a near-zero
                    width. The path `d` is recomputed once the container is laid out;
                    the dasharray is not — leaving a ~65px dash on an ~1130px line, so
                    the series renders as a stub and reads as "the chart is broken". */}
                <Line
                  yAxisId="revenue"
                  type="monotone"
                  dataKey="Revenue"
                  stroke={REVENUE}
                  strokeWidth={2}
                  dot={dot}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
                {/* Dashed, and it is doing real work. Orders drive Revenue, so the
                    two series are strongly correlated — and two auto-ranged axes
                    each stretch their series across the same vertical band, so the
                    lines land almost exactly on top of each other and read as one
                    line with a shadow. Colour alone does not separate them (in
                    light mode --chart-2 is a dark brown a hair from --chart-1's
                    orange; in dark mode it inverts to near-white). The dash pattern
                    survives both themes, the accent-colour overrides, and a
                    colour-blind reader. Recharts draws it in the legend swatch too. */}
                <Line
                  yAxisId="orders"
                  type="monotone"
                  dataKey="Orders"
                  stroke={ORDERS}
                  strokeWidth={2}
                  strokeDasharray="5 4"
                  dot={dot}
                  activeDot={{ r: 4 }}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
