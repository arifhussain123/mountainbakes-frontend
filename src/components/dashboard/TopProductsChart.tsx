'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip, Legend } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import type { TopProduct } from '@mb/shared';

const COLORS = ['#F97316', '#6B3B1E', '#EA580C', '#92400E', '#D97706', '#B45309'];

export function TopProductsChart({ data, loading }: { data: TopProduct[]; loading?: boolean }) {
  const chartData = data.slice(0, 6).map((p) => ({
    name: p.productName.length > 20 ? p.productName.slice(0, 20) + '…' : p.productName,
    value: p.totalRevenue,
  }));

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Top Products</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-64 w-full" />
        ) : chartData.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-muted-foreground text-sm">No data yet</div>
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="45%"
                innerRadius={55}
                outerRadius={90}
                paddingAngle={3}
                dataKey="value"
              >
                {chartData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px' }}
                formatter={(v: number) => [`Rs.${v.toLocaleString()}`, 'Revenue']}
              />
              <Legend
                wrapperStyle={{ fontSize: '11px', marginTop: '8px' }}
                iconType="circle"
                iconSize={8}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
