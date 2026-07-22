'use client';

import { useState, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useProductionBranchStock } from '@/lib/queries';import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Search } from 'lucide-react';

const short = (name: string) => name.replace('Mountain Bakes ', '');

export function BranchStockMatrix() {
  const { token } = useAuth();  const { data, isLoading } = useProductionBranchStock(token);
  const [filter, setFilter] = useState('');

  const branches = data?.branches ?? [];
  const rows = useMemo(
    () => (data?.rows ?? []).filter((r) => r.productName.toLowerCase().includes(filter.toLowerCase())),
    [data, filter],
  );

  if (isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search products…" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-9 pl-9" />
      </div>

      {/* Desktop matrix */}
      <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left">
              <th className="sticky left-0 bg-muted/50 px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">Product</th>
              {branches.map((b) => (
                <th key={b.branchId} className="px-3 py-2 text-right text-xs uppercase tracking-wide text-muted-foreground">{short(b.branchName)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={branches.length + 1} className="px-3 py-12 text-center text-muted-foreground">No products found</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.productId} className="border-t hover:bg-muted/30">
                  <td className="sticky left-0 bg-card px-3 py-2 font-medium">{r.productName}</td>
                  {branches.map((b) => {
                    const v = r.byBranch[b.branchId] ?? 0;
                    return (
                      <td key={b.branchId} className={`px-3 py-2 text-right tabular-nums ${v <= 0 ? 'text-red-500' : v < 5 ? 'text-amber-600' : ''}`}>{v}</td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-3 md:hidden">
        {rows.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No products found</CardContent></Card>
        ) : (
          rows.map((r) => (
            <div key={r.productId} className="rounded-lg border bg-card p-3">
              <p className="font-medium">{r.productName}</p>
              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                {branches.map((b) => {
                  const v = r.byBranch[b.branchId] ?? 0;
                  return (
                    <div key={b.branchId} className="flex justify-between">
                      <span className="text-muted-foreground">{short(b.branchName)}</span>
                      <span className={`font-medium tabular-nums ${v <= 0 ? 'text-red-500' : v < 5 ? 'text-amber-600' : ''}`}>{v}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
