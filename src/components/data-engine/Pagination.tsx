'use client';

/**
 * Data Engine — the pager.
 *
 * Desktop:  Showing 21–40 of 1,245        [20 ▾]   ‹ Previous  1  2  3 … 63  Next ›
 * Phone:    ‹ Previous        2 / 63        Next ›
 *
 * Numbered pages are a window around the current one with the first and last
 * always present, so a 63-page list is reachable end to end in two clicks.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PAGE_SIZES, type PageSize } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: PageSize) => void;
  /** Grey the controls while a page is in flight. */
  loading?: boolean;
  className?: string;
}

/** Page numbers to show, with `null` for an ellipsis. */
export function pageWindow(page: number, totalPages: number, width = 2): Array<number | null> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages = new Set<number>([1, totalPages]);
  for (let p = page - width; p <= page + width; p++) if (p >= 1 && p <= totalPages) pages.add(p);
  const sorted = [...pages].sort((a, b) => a - b);
  const out: Array<number | null> = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i]! - sorted[i - 1]! > 1) out.push(null);
    out.push(sorted[i]!);
  }
  return out;
}

export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, loading, className }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const first = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const last = Math.min(current * pageSize, total);
  const canPrevious = current > 1;
  const canNext = current < totalPages;

  return (
    <nav
      aria-label="Pagination"
      className={cn('flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between', className)}
    >
      <div className="flex items-center justify-between gap-3 sm:justify-start">
        <span className="tabular-nums">
          {total === 0 ? 'No results' : `Showing ${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()}`}
        </span>
        {onPageSizeChange && (
          <Select value={String(pageSize)} onValueChange={(v) => v && onPageSizeChange(Number(v) as PageSize)}>
            <SelectTrigger className="h-9 w-[5.5rem]" aria-label="Rows per page">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((n) => (
                <SelectItem key={n} value={String(n)}>
                  {n} / page
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className={cn('flex items-center justify-between gap-1 sm:justify-end', loading && 'opacity-60')}>
        <Button
          variant="outline"
          size="sm"
          className="h-11 md:h-8"
          onClick={() => onPageChange(current - 1)}
          disabled={!canPrevious}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-3.5 w-3.5 sm:mr-1" />
          <span className="hidden sm:inline">Previous</span>
        </Button>

        {/* Phone: a plain "2 / 63". */}
        <span className="px-2 tabular-nums sm:hidden">
          {current} / {totalPages}
        </span>

        {/* Desktop: numbered pages. */}
        <div className="hidden items-center gap-1 sm:flex">
          {pageWindow(current, totalPages).map((p, i) =>
            p === null ? (
              <span key={`gap-${i}`} className="px-1">
                …
              </span>
            ) : (
              <Button
                key={p}
                variant={p === current ? 'default' : 'ghost'}
                size="sm"
                className="h-8 min-w-8 px-2 tabular-nums"
                onClick={() => onPageChange(p)}
                aria-current={p === current ? 'page' : undefined}
                aria-label={`Page ${p}`}
              >
                {p}
              </Button>
            ),
          )}
        </div>

        <Button
          variant="outline"
          size="sm"
          className="h-11 md:h-8"
          onClick={() => onPageChange(current + 1)}
          disabled={!canNext}
          aria-label="Next page"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-3.5 w-3.5 sm:ml-1" />
        </Button>
      </div>
    </nav>
  );
}
