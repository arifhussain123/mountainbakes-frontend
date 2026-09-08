'use client';

/**
 * Data Engine — the filter drawer.
 *
 * A Sheet holding every filter control that does not fit on the bar (desktop)
 * or every filter at all (phone). Edits apply live — the list behind the
 * sheet updates as each control changes — so "Done" only closes it and
 * "Clear" resets the list. Nothing is staged, because a staged filter that is
 * never applied is the one bug a drawer reliably grows.
 */
import type { FilterConfig, FilterOption } from '@mb/shared';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import type { ListQueryStateApi } from '@/lib/data-engine/useListQueryState';
import { FilterControl } from './filters';

export interface FilterDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  list: ListQueryStateApi;
  /** Filters shown on desktop (the ones not already on the bar). */
  filters: FilterConfig[];
  /** Filters shown on a phone (all of them). Defaults to `filters`. */
  allFilters?: FilterConfig[];
  options?: Record<string, FilterOption[]>;
  maxDate?: string;
}

export function FilterDrawer({ open, onOpenChange, list, filters, allFilters, options, maxDate }: FilterDrawerProps) {
  const phone = allFilters ?? filters;
  const render = (configs: FilterConfig[]) =>
    configs.map((config) => (
      <FilterControl
        key={config.key}
        config={config}
        getFilter={list.getFilter}
        setFilter={list.setFilter}
        options={options?.[config.key]}
        max={maxDate}
        className="w-full sm:flex-none"
      />
    ));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>Changes apply as you make them.</SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-4">
          <div className="hidden space-y-4 md:block">{render(filters)}</div>
          <div className="space-y-4 md:hidden">{render(phone)}</div>
          {filters.length === 0 && phone.length === 0 && (
            <p className="text-sm text-muted-foreground">This list has no filters.</p>
          )}
        </div>

        <SheetFooter className="flex-row gap-2">
          <Button
            variant="outline"
            className="h-11 flex-1 md:h-9"
            onClick={list.clearAll}
            disabled={!list.hasActiveFilters}
          >
            Clear all
          </Button>
          <Button className="h-11 flex-1 md:h-9" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
