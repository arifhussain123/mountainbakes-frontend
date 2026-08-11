'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from 'recharts';

const TOOLTIP_STYLE = {
  backgroundColor: 'hsl(var(--card))',
  border: '1px solid hsl(var(--border))',
  borderRadius: '8px',
  fontSize: '12px',
} as const;

const PALETTE = ['#F97316', '#6B3B1E', '#0EA5E9', '#22C55E', '#A855F7', '#EAB308', '#EF4444', '#14B8A6', '#F472B6', '#64748B'];

function ChartShell({ title, loading, empty, height = 260, children }: { title: string; loading?: boolean; empty?: boolean; height?: number; children: React.ReactElement }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
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

/** Demand-over-time bar chart (used for Daily / Weekly / Monthly demand). */
export function DemandBarChart({ title, data, loading }: { title: string; data: { label: string; qty: number }[]; loading?: boolean }) {
  return (
    <ChartShell title={title} loading={loading} empty={data.length === 0}>
      <BarChart data={data} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v, 'Qty']} />
        <Bar dataKey="qty" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ChartShell>
  );
}

/** Demand-over-time line chart (smoother daily trend). */
export function DemandLineChart({ title, data, loading }: { title: string; data: { label: string; qty: number }[]; loading?: boolean }) {
  return (
    <ChartShell title={title} loading={loading} empty={data.length === 0}>
      <LineChart data={data} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v, 'Qty']} />
        <Line type="monotone" dataKey="qty" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
      </LineChart>
    </ChartShell>
  );
}

/** Branch demand comparison. */
export function BranchDemandChart({ data, loading }: { data: { branchName: string; qty: number }[]; loading?: boolean }) {
  const chartData = data.map((b) => ({ name: b.branchName.replace('Mountain Bakes ', ''), qty: b.qty }));
  return (
    <ChartShell title="Branch Demand Comparison" loading={loading} empty={chartData.length === 0}>
      <BarChart data={chartData} margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="name" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v, 'Demand']} />
        <Bar dataKey="qty" radius={[4, 4, 0, 0]}>
          {chartData.map((_, i) => (
            <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </Bar>
      </BarChart>
    </ChartShell>
  );
}

/** Top 10 requested products (horizontal bars). */
export function TopRequestedChart({ data, loading }: { data: { productName: string; qty: number }[]; loading?: boolean }) {
  const chartData = data.slice(0, 10).map((p) => ({ name: p.productName.length > 18 ? p.productName.slice(0, 18) + '…' : p.productName, qty: p.qty }));
  return (
    <ChartShell title="Top 10 Requested Products" loading={loading} empty={chartData.length === 0} height={300}>
      <BarChart layout="vertical" data={chartData} margin={{ top: 5, right: 16, left: 10, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [v, 'Requested']} />
        <Bar dataKey="qty" radius={[0, 4, 4, 0]}>
          {chartData.map((_, i) => (
            <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
          ))}
        </Bar>
      </BarChart>
    </ChartShell>
  );
}
