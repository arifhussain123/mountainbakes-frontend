'use client';

/**
 * Data Engine — the filter controls.
 *
 * Each control edits ONE `FilterConfig` against the list state: it reads its
 * current value(s) with `getFilter` and writes with `setFilter(key, op, value)`.
 * The controls never know what a field means or which table it lives in; the
 * server's resource config decides whether the operator is allowed.
 *
 * `FilterControl` dispatches on `config.type` so a filter bar or drawer can
 * render a page's whole filter list from configuration alone.
 */
import { useEffect, useState } from 'react';
import { Search, X, ChevronDown } from 'lucide-react';
import type { FilterConfig, FilterOption, FilterOperator, FilterValue } from '@mb/shared';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/lib/utils';

/** Base UI's Select cannot hold an empty-string item value; "all" travels as this. */
const ALL = '__all__';

export interface FilterControlProps {
  config: FilterConfig;
  getFilter: (key: string, op?: FilterOperator) => FilterValue | undefined;
  setFilter: (key: string, op: FilterOperator, value: string | string[] | null) => void;
  /** Runtime options for select filters (branches, users) when not static in the config. */
  options?: FilterOption[];
  className?: string;
}

const FIELD_CLASS = 'min-w-[9rem] flex-1 space-y-1 sm:flex-none';
const INPUT_CLASS = 'h-11 md:h-9';

function scalar(f: FilterValue | undefined): string {
  if (!f || f.value === null) return '';
  return Array.isArray(f.value) ? (f.value[0] ?? '') : f.value;
}

/**
 * Local text that follows `current` when it changes from outside and reports
 * its own edits after a pause. Shared by the text and number filters.
 */
function useDebouncedText(current: string, commit: (v: string) => void) {
  const [text, setText] = useState(current);
  const [seen, setSeen] = useState(current);
  const debounced = useDebounce(text, 350);
  if (current !== seen) {
    setSeen(current);
    setText(current);
  }
  useEffect(() => {
    if (debounced !== current) commit(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);
  return [text, setText] as const;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export interface GenericSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Debounce before `onChange` fires. 350ms — a person pausing, not a keystroke. */
  delay?: number;
  className?: string;
  autoFocus?: boolean;
}

/**
 * Debounced search box. The typed text is local state; the list only hears
 * about it after `delay` ms of quiet, so a search of "chocolate" is one request
 * and not nine. Clearing fires immediately — there is nothing to wait for.
 */
export function GenericSearch({ value, onChange, placeholder = 'Search…', delay = 350, className, autoFocus }: GenericSearchProps) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  const debounced = useDebounce(text, delay);

  // Outside changes (Clear, back button) win over what is being typed. Done
  // during render, the documented way to derive state from a changed prop.
  if (value !== seen) {
    setSeen(value);
    setText(value);
  }

  useEffect(() => {
    if (debounced !== value) onChange(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  return (
    <div className={cn('relative w-full sm:max-w-sm', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className={cn('pl-9 pr-9', INPUT_CLASS)}
      />
      {text && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setText('');
            onChange('');
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** A single-field contains filter (ILIKE), debounced like the search box. */
export function GenericTextFilter({ config, getFilter, setFilter, className }: FilterControlProps) {
  const current = scalar(getFilter(config.key, 'ilike'));
  const [text, setText] = useDebouncedText(current, (v) => setFilter(config.key, 'ilike', v.trim() || null));
  return (
    <div className={cn(FIELD_CLASS, className)}>
      <Label className="text-xs text-muted-foreground">{config.label}</Label>
      <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={config.placeholder} className={INPUT_CLASS} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Select / multi-select
// ---------------------------------------------------------------------------

export function GenericSelectFilter({ config, getFilter, setFilter, options, className }: FilterControlProps) {
  const choices = options ?? config.options ?? [];
  const current = scalar(getFilter(config.key, 'eq'));
  return (
    <div className={cn(FIELD_CLASS, className)}>
      <Label className="text-xs text-muted-foreground">{config.label}</Label>
      <Select
        value={current === '' ? ALL : current}
        onValueChange={(v) => setFilter(config.key, 'eq', v === ALL || v == null ? null : String(v))}
      >
        <SelectTrigger className={cn('w-full', INPUT_CLASS)}>
          <SelectValue placeholder={config.placeholder ?? `All`} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{config.placeholder ?? 'All'}</SelectItem>
          {choices.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Any-of filter: a checklist in a dropdown, sent as `key.in=a&key.in=b`. */
export function GenericMultiSelectFilter({ config, getFilter, setFilter, options, className }: FilterControlProps) {
  const choices = options ?? config.options ?? [];
  const f = getFilter(config.key, 'in');
  const selected = new Set(Array.isArray(f?.value) ? f.value : []);
  const label =
    selected.size === 0
      ? config.placeholder ?? 'All'
      : selected.size === 1
        ? choices.find((c) => selected.has(c.value))?.label ?? '1 selected'
        : `${selected.size} selected`;

  return (
    <div className={cn(FIELD_CLASS, className)}>
      <Label className="text-xs text-muted-foreground">{config.label}</Label>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="outline" className={cn('w-full justify-between font-normal', INPUT_CLASS)} />}
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
          {choices.map((o) => (
            <DropdownMenuCheckboxItem
              key={o.value}
              checked={selected.has(o.value)}
              closeOnClick={false}
              onCheckedChange={(checked) => {
                const next = new Set(selected);
                if (checked) next.add(o.value);
                else next.delete(o.value);
                setFilter(config.key, 'in', [...next]);
              }}
            >
              {o.label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Boolean
// ---------------------------------------------------------------------------

export function GenericBooleanFilter({ config, getFilter, setFilter, className }: FilterControlProps) {
  const current = scalar(getFilter(config.key, 'eq'));
  const [yes, no] = config.options && config.options.length >= 2 ? [config.options[0]!, config.options[1]!] : [
    { value: 'true', label: 'Yes' },
    { value: 'false', label: 'No' },
  ];
  return (
    <div className={cn(FIELD_CLASS, className)}>
      <Label className="text-xs text-muted-foreground">{config.label}</Label>
      <Select value={current === '' ? ALL : current} onValueChange={(v) => setFilter(config.key, 'eq', v === ALL || v == null ? null : String(v))}>
        <SelectTrigger className={cn('w-full', INPUT_CLASS)}>
          <SelectValue placeholder="All" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All</SelectItem>
          <SelectItem value="true">{yes.label}</SelectItem>
          <SelectItem value="false">{no.label}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

export interface DateRangeExtras {
  /** Latest selectable day, e.g. today's business date. */
  max?: string;
}

/** One day — `key=YYYY-MM-DD`. On a timestamp field the server widens it to the whole (business) day. */
export function GenericDateFilter({ config, getFilter, setFilter, className, max }: FilterControlProps & DateRangeExtras) {
  const current = scalar(getFilter(config.key, 'eq'));
  return (
    <div className={cn(FIELD_CLASS, className)}>
      <Label className="text-xs text-muted-foreground">{config.label}</Label>
      <Input
        type="date"
        value={current}
        max={max}
        onChange={(e) => setFilter(config.key, 'eq', e.target.value || null)}
        className={INPUT_CLASS}
        aria-label={config.label}
      />
    </div>
  );
}

/** From / To — sent as `key.gte` and `key.lte`, each independently optional. */
export function GenericDateRangeFilter({ config, getFilter, setFilter, className, max }: FilterControlProps & DateRangeExtras) {
  const from = scalar(getFilter(config.key, 'gte'));
  const to = scalar(getFilter(config.key, 'lte'));
  return (
    <div className={cn('flex min-w-[9rem] flex-1 flex-col gap-1 sm:flex-none', className)}>
      <Label className="text-xs text-muted-foreground">{config.label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type="date"
          value={from}
          max={to || max}
          onChange={(e) => setFilter(config.key, 'gte', e.target.value || null)}
          className={cn('w-full sm:w-auto', INPUT_CLASS)}
          aria-label={`${config.label} from`}
        />
        <span className="text-xs text-muted-foreground">to</span>
        <Input
          type="date"
          value={to}
          min={from || undefined}
          max={max}
          onChange={(e) => setFilter(config.key, 'lte', e.target.value || null)}
          className={cn('w-full sm:w-auto', INPUT_CLASS)}
          aria-label={`${config.label} to`}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------


/** Exact number — `key=value`. */
export function GenericNumberFilter({ config, getFilter, setFilter, className }: FilterControlProps) {
  const current = scalar(getFilter(config.key, 'eq'));
  const [text, setText] = useDebouncedText(current, (v) => setFilter(config.key, 'eq', v.trim() || null));
  return (
    <div className={cn(FIELD_CLASS, className)}>
      <Label className="text-xs text-muted-foreground">{config.label}</Label>
      <Input type="number" inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} placeholder={config.placeholder} className={INPUT_CLASS} />
    </div>
  );
}

/** Min / Max — `key.gte` and `key.lte`. */
export function GenericNumberRangeFilter({ config, getFilter, setFilter, className }: FilterControlProps) {
  const min = scalar(getFilter(config.key, 'gte'));
  const max = scalar(getFilter(config.key, 'lte'));
  const [minText, setMinText] = useDebouncedText(min, (v) => setFilter(config.key, 'gte', v.trim() || null));
  const [maxText, setMaxText] = useDebouncedText(max, (v) => setFilter(config.key, 'lte', v.trim() || null));
  return (
    <div className={cn('flex min-w-[9rem] flex-1 flex-col gap-1 sm:flex-none', className)}>
      <Label className="text-xs text-muted-foreground">{config.label}</Label>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="decimal"
          value={minText}
          onChange={(e) => setMinText(e.target.value)}
          placeholder="Min"
          className={cn('w-28', INPUT_CLASS)}
          aria-label={`${config.label} minimum`}
        />
        <span className="text-xs text-muted-foreground">to</span>
        <Input
          type="number"
          inputMode="decimal"
          value={maxText}
          onChange={(e) => setMaxText(e.target.value)}
          placeholder="Max"
          className={cn('w-28', INPUT_CLASS)}
          aria-label={`${config.label} maximum`}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dispatcher
// ---------------------------------------------------------------------------

export function FilterControl(props: FilterControlProps & DateRangeExtras) {
  switch (props.config.type) {
    case 'text':
    case 'search':
      return <GenericTextFilter {...props} />;
    case 'select':
      return <GenericSelectFilter {...props} />;
    case 'multi-select':
      return <GenericMultiSelectFilter {...props} />;
    case 'boolean':
      return <GenericBooleanFilter {...props} />;
    case 'date':
      return <GenericDateFilter {...props} />;
    case 'date-range':
      return <GenericDateRangeFilter {...props} />;
    case 'number':
      return <GenericNumberFilter {...props} />;
    case 'number-range':
      return <GenericNumberRangeFilter {...props} />;
  }
}
