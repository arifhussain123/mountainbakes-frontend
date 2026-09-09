'use client';

import { useState, useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce } from '@/hooks/useDebounce';
import { useProductionBranchStock } from '@/lib/queries';
import { EmptyState } from '@/components/shared/EmptyState';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Pagination } from '@/components/data-engine';
import { Search } from 'lucide-react';
import { DEFAULT_PAGE_SIZE, type PageSize } from '@mb/shared';

const short = (name: string) => name.replace('Mountain Bakes ', '');

export function BranchStockMatrix() {
  const { token } = useAuth();  const { data, isLoading } = useProductionBranchStock(token);
  const [filter, setFilter] = useState('');
  const debouncedFilter = useDebounce(filter, 350);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(DEFAULT_PAGE_SIZE);

  const branches = data?.branches ?? [];
  // This matrix is bounded by catalog × active-branch size, not by order/
  // history volume, so fetching it in full is fine (see production.routes.ts);
  // what wasn't fine was always RENDERING every product row regardless of how
  // large the catalog gets — paginated client-side since the data is already
  // in memory (a second network round-trip would buy nothing here).
  const filtered = useMemo(
    () => (data?.rows ?? []).filter((r) => r.productName.toLowerCase().includes(debouncedFilter.toLowerCase())),
    [data, debouncedFilter],
  );
  const rows = useMemo(
    () => filtered.slice((page - 1) * pageSize, page * pageSize),
    [filtered, page, pageSize],
  );

  function handleFilterChange(value: string) {
    setFilter(value);
    setPage(1);
  }

  if (isLoading) {
    return <Skeleton className="h-96 w-full" />;
  }

  return (
    <div className="space-y-4">
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Search products…" value={filter} onChange={(e) => handleFilterChange(e.target.value)} className="h-9 pl-9" />
      </div>

      {/* Desktop matrix */}
      <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
        <table className="w-full text-sm">
          <thead>
            <tr data-table-head className="text-left">
              <th className="sticky left-0 bg-muted/50 px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">Product</th>
              {branches.map((b) => (
                <th key={b.branchId} className="px-3 py-2 text-center text-xs uppercase tracking-wide text-muted-foreground">{short(b.branchName)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={branches.length + 1} className="px-3 py-12 text-center text-muted-foreground">No products found</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.productId} className="border-t hover:bg-muted/30">
                  <td className="sticky left-0 bg-card px-3 py-2 font-medium">{r.productName}</td>
                  {branches.map((b) => {
                    const v = r.byBranch[b.branchId] ?? 0;
                    return (
                      <td key={b.branchId} className={`px-3 py-2 text-center tabular-nums ${v <= 0 ? 'text-red-500' : v < 5 ? 'text-amber-600' : ''}`}>{v}</td>
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
        {filtered.length === 0 ? (
          <EmptyState title="No products found" description={filter ? 'Try a different search term.' : undefined} />
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

      {filtered.length > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={filtered.length}
          onPageChange={setPage}
          onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
        />
      )}
    </div>
  );
}
