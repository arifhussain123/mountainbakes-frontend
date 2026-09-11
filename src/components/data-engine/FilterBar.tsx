'use client';

/**
 * Data Engine — the toolbar above a generic list.
 *
 * Desktop:   [Search]  [bar filters…]  [Filters ⓝ]  [Clear]  ……  [actions]
 * Phone:     [Search]
 *            [Filters ⓝ] [Clear]                      [actions]
 *
 * Filters with `placement: 'bar'` (the default for the first two) sit inline
 * on desktop; the rest live in the drawer. On a phone every filter is in the
 * drawer — a phone has no room for three selects and two date inputs above a
 * table, and the drawer is where a thumb expects them.
 */
import { useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import type { FilterConfig, FilterOption } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ListQueryStateApi } from '@/lib/data-engine/useListQueryState';
import { FilterControl, GenericSearch } from './filters';
import { FilterDrawer } from './FilterDrawer';
import { ClearFilters } from './ActiveFilters';

export interface FilterBarProps {
  list: ListQueryStateApi;
  filters?: FilterConfig[];
  /** Runtime option lists keyed by filter key (branches, users…). */
  options?: Record<string, FilterOption[]>;
  searchable?: boolean;
  searchPlaceholder?: string;
  /** Latest selectable day for date filters. */
  maxDate?: string;
  /** Right-hand slot — "things to do" (New, Export…). */
  actions?: React.ReactNode;
  /** Left of the search field — a scope control that precedes it (StockPage's date). */
  leading?: React.ReactNode;
  className?: string;
}

const BAR_LIMIT = 2;

export function FilterBar({
  list,
  filters = [],
  options,
  searchable = true,
  searchPlaceholder,
  maxDate,
  actions,
  leading,
  className,
}: FilterBarProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const explicitBar = filters.filter((f) => f.placement === 'bar');
  const barFilters =
    explicitBar.length > 0 ? explicitBar : filters.filter((f) => f.placement !== 'drawer').slice(0, BAR_LIMIT);
  const barKeys = new Set(barFilters.map((f) => f.key));
  const drawerFilters = filters.filter((f) => !barKeys.has(f.key));

  // Count what the drawer button hides: active filters whose control is not on the bar.
  const hiddenActive = list.activeFilters.filter((f) => !barKeys.has(f.key)).length;
  const allActive = list.activeFilters.length;

  const drawerButton = (count: number, extraClass?: string) => (
    <Button
      variant="outline"
      className={cn('h-11 md:h-9', extraClass)}
      onClick={() => setDrawerOpen(true)}
      aria-label="Open filters"
    >
      <SlidersHorizontal className="h-4 w-4 md:mr-1.5" />
      <span className="ml-1.5 md:ml-0">Filters</span>
      {count > 0 && (
        <Badge variant="secondary" className="ml-1.5 h-5 min-w-5 justify-center px-1 tabular-nums">
          {count}
        </Badge>
      )}
    </Button>
  );

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-end">
          {leading}
          {searchable && (
            <GenericSearch value={list.state.search} onChange={list.setSearch} placeholder={searchPlaceholder} />
          )}

          {/* Desktop: the bar filters inline, the rest behind the drawer. */}
          <div className="hidden items-end gap-3 md:flex md:flex-wrap">
            {barFilters.map((config) => (
              <FilterControl
                key={config.key}
                config={config}
                getFilter={list.getFilter}
                setFilter={list.setFilter}
                options={options?.[config.key]}
                max={maxDate}
              />
            ))}
            {drawerFilters.length > 0 && drawerButton(hiddenActive)}
            {list.hasActiveFilters && <ClearFilters onClear={list.clearAll} />}
          </div>

          {/* Phone: everything in the drawer. */}
          <div className="flex items-center gap-2 md:hidden">
            {filters.length > 0 && drawerButton(allActive, 'flex-1')}
            {list.hasActiveFilters && <ClearFilters onClear={list.clearAll} className="flex-1" />}
          </div>
        </div>

        {actions && <div className="flex w-full items-center gap-2 sm:w-auto">{actions}</div>}
      </div>

      <FilterDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        list={list}
        // On a phone the drawer holds every filter; on desktop only the ones
        // not already on the bar. Both lists are passed and CSS picks.
        filters={drawerFilters}
        allFilters={filters}
        options={options}
        maxDate={maxDate}
      />
    </div>
  );
}
