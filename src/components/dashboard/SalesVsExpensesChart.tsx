'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import type { DailySalesData } from '@mb/shared';
import { format, parseISO } from 'date-fns';

export function SalesVsExpensesChart({ data, loading }: { data: DailySalesData[]; loading?: boolean }) {
  const chartData = data.map((d) => ({
    date: (() => { try { return format(parseISO(d.date), 'MMM d'); } catch { return d.date; } })(),
    Sales: d.totalRevenue,
    Expenses: d.expenses ?? 0,
  }));

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Sales vs Expenses</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-64 w-full" />
        ) : chartData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickLine={false} axisLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)}
              />
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px' }}
                formatter={(value: number, name: string) => [`Rs.${value.toLocaleString()}`, name]}
              />
              <Legend wrapperStyle={{ fontSize: '12px' }} />
              <Bar dataKey="Sales" fill="#F97316" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Expenses" fill="#6B3B1E" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
