'use client';

/**
 * Data Engine — the row of chips naming what is currently filtering the list,
 * each with its own ×, plus the Clear button.
 *
 * Chips are rendered from the filter CONFIG so they read as a person wrote
 * them ("Status: Delivered", "Date: 01 Sep – 07 Sep"), not as wire values.
 */
import { X } from 'lucide-react';
import type { FilterConfig, FilterOperator, FilterOption, FilterValue } from '@mb/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const OP_WORDS: Partial<Record<FilterOperator, string>> = {
  neq: 'not',
  gt: '>',
  gte: 'from',
  lt: '<',
  lte: 'to',
  nin: 'not',
  null: 'is empty',
  notnull: 'is set',
};

function label(f: FilterValue, config: FilterConfig | undefined, options: FilterOption[] | undefined): string {
  const name = config?.label ?? f.key;
  const choices = options ?? config?.options ?? [];
  const pretty = (v: string) => choices.find((o) => o.value === v)?.label ?? v;
  if (f.value === null) return `${name} ${OP_WORDS[f.op] ?? ''}`.trim();
  const values = Array.isArray(f.value) ? f.value.map(pretty) : [pretty(f.value)];
  const word = OP_WORDS[f.op];
  if (f.op === 'between') return `${name}: ${values[0]} – ${values[1]}`;
  if (f.op === 'in') return `${name}: ${values.join(', ')}`;
  return word ? `${name} ${word} ${values.join(', ')}` : `${name}: ${values.join(', ')}`;
}

export interface ActiveFiltersProps {
  filters: FilterValue[];
  configs?: FilterConfig[];
  options?: Record<string, FilterOption[]>;
  search?: string;
  onRemove: (key: string, op: FilterOperator) => void;
  onClearSearch?: () => void;
  onClearAll?: () => void;
  className?: string;
}

export function ActiveFilters({ filters, configs = [], options, search, onRemove, onClearSearch, onClearAll, className }: ActiveFiltersProps) {
  const byKey = new Map(configs.map((c) => [c.key, c] as const));
  const hasSearch = Boolean(search && search.trim());
  if (filters.length === 0 && !hasSearch) return null;

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)} aria-label="Active filters">
      {hasSearch && (
        <Badge variant="secondary" className="h-7 gap-1 pr-1 font-normal">
          <span>Search: &ldquo;{search!.trim()}&rdquo;</span>
          {onClearSearch && (
            <button type="button" onClick={onClearSearch} aria-label="Clear search" className="rounded p-0.5 hover:bg-foreground/10">
              <X className="h-3 w-3" />
            </button>
          )}
        </Badge>
      )}
      {filters.map((f) => (
        <Badge key={`${f.key}.${f.op}`} variant="secondary" className="h-7 gap-1 pr-1 font-normal">
          <span>{label(f, byKey.get(f.key), options?.[f.key])}</span>
          <button
            type="button"
            onClick={() => onRemove(f.key, f.op)}
            aria-label={`Remove filter ${byKey.get(f.key)?.label ?? f.key}`}
            className="rounded p-0.5 hover:bg-foreground/10"
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}
      {onClearAll && (filters.length > 1 || (filters.length > 0 && hasSearch)) && (
        <ClearFilters onClear={onClearAll} size="sm" />
      )}
    </div>
  );
}

export function ClearFilters({
  onClear,
  className,
  size = 'default',
}: {
  onClear: () => void;
  className?: string;
  size?: 'default' | 'sm';
}) {
  return (
    <Button
      variant="ghost"
      className={cn(size === 'sm' ? 'h-7 px-2 text-xs' : 'h-11 md:h-9', className)}
      onClick={onClear}
    >
      <X className="mr-1 h-3.5 w-3.5" />
      Clear
    </Button>
  );
}
