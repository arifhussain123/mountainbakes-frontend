'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from 'recharts';
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

// Both plots must share one left gutter or their x positions drift apart and the
// pair stops reading as a single time axis.
const Y_WIDTH = 48;
const MARGIN = { top: 8, right: 16, left: 0, bottom: 0 };

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
          /* Revenue and Orders differ by three orders of magnitude — plotted on one
             scale the Orders line sits flat on the baseline. Two stacked plots
             sharing a date axis, rather than a second y-scale, which would make the
             crossing point of the two lines mean nothing. */
          <div className="space-y-1">
            <div className="flex items-baseline justify-between px-1 text-xs">
              <span className="font-medium text-muted-foreground">Revenue</span>
              {latest && <span className="tabular-nums text-foreground">Rs.{latest.Revenue.toLocaleString()}</span>}
            </div>
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={chartData} margin={MARGIN} syncId="daily-sales">
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis dataKey="date" hide />
                <YAxis
                  width={Y_WIDTH}
                  tick={{ fontSize: 11, fill: AXIS }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={compact}
                />
                <Tooltip
                  contentStyle={TOOLTIP}
                  formatter={(value: number) => [`Rs.${value.toLocaleString()}`, 'Revenue']}
                />
                <Line
                  type="monotone"
                  dataKey="Revenue"
                  stroke={REVENUE}
                  strokeWidth={2}
                  dot={dot}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>

            <div className="flex items-baseline justify-between px-1 pt-2 text-xs">
              <span className="font-medium text-muted-foreground">Orders</span>
              {latest && <span className="tabular-nums text-foreground">{latest.Orders.toLocaleString()}</span>}
            </div>
            <ResponsiveContainer width="100%" height={110}>
              <LineChart data={chartData} margin={MARGIN} syncId="daily-sales">
                <CartesianGrid strokeDasharray="3 3" stroke={GRID} vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: AXIS }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  width={Y_WIDTH}
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: AXIS }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={compact}
                />
                <Tooltip contentStyle={TOOLTIP} formatter={(value: number) => [value, 'Orders']} />
                <Line
                  type="monotone"
                  dataKey="Orders"
                  stroke={ORDERS}
                  strokeWidth={2}
                  dot={dot}
                  activeDot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
