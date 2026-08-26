'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ProductionLedgerType } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranches, useCategories, useProductionLedger, useProducts } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LEDGER_TYPE_OPTIONS, LEDGER_TYPE_META, LedgerQty, LedgerTypeChip } from './StockLedgerTypes';

/**
 * Stock Movement History (§13) — every posted movement, filtered and paged.
 *
 * ── NOTHING IS FILTERED IN THE BROWSER ───────────────────────────────────────
 * Every control here becomes a query parameter. The ledger grows without bound —
 * one row per movement, forever — so a page that downloaded it and filtered
 * client-side would work for a month and then stop working, gradually, in a way
 * nobody could point at. The one exception is the quick date ranges, which only
 * compute the from/to they then send.
 *
 * ── THE SEARCH IS DEBOUNCED ──────────────────────────────────────────────────
 * 350ms. Without it every keystroke is a round trip and the results flicker
 * between two answers as they race; with it the request fires once when the
 * typing stops. `placeholderData` in the query keeps the previous page on screen
 * meanwhile, so the table never blanks to "no results" while it is still asking.
 */

const PAGE_SIZE = 25;

/** 'YYYY-MM-DD' n days before the given business date. */
function daysBefore(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

type QuickRange = 'today' | 'yesterday' | 'week' | 'month' | 'custom';

export interface StockLedgerPanelProps {
  /** The business date the page is showing — the anchor every quick range is relative to. */
  date: string;
}

export function StockLedgerPanel({ date }: StockLedgerPanelProps) {
  const { token } = useAuth();

  const [range, setRange] = useState<QuickRange>('today');
  /** Only consulted while `range === 'custom'`. See `window` below. */
  const [customFrom, setCustomFrom] = useState(date);
  const [customTo, setCustomTo] = useState(date);
  const [productId, setProductId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [movementType, setMovementType] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [offset, setOffset] = useState(0);

  // The typed value and the SENT value are separate pieces of state. Binding the
  // input straight to the query key would fire a request per keystroke.
  //
  // This is the ONE effect here, and it is the kind an effect is for: driving a
  // timer, an external thing React does not own. The date window and the page
  // offset below are plain derivations and assignments instead — syncing those
  // through effects means rendering once with the stale value and again with the
  // fresh one, which is exactly the cascade the lint rule is about.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  /**
   * The date window, DERIVED rather than stored.
   *
   * Quick ranges are relative to the business date on screen, not to the wall
   * clock — winding the page back to a closed day and asking for "this week"
   * should mean that day's week. Deriving it also means changing the page's date
   * moves the window with no effect to fire and no intermediate render showing
   * the previous day's range.
   */
  const { from, to } = useMemo((): { from: string; to: string } => {
    switch (range) {
      case 'today': return { from: date, to: date };
      case 'yesterday': { const y = daysBefore(date, 1); return { from: y, to: y }; }
      case 'week': return { from: daysBefore(date, 6), to: date };
      case 'month': return { from: daysBefore(date, 29), to: date };
      default: return { from: customFrom, to: customTo };
    }
  }, [range, date, customFrom, customTo]);

  /**
   * Change a filter and go back to page 1.
   *
   * Every filter setter goes through here rather than an effect watching them
   * all. Narrowing a filter while on page 4 would otherwise ask for rows 76-100
   * of a 12-row result and show an empty table that reads as "no matches".
   */
  function withReset<T>(set: (v: T) => void) {
    return (v: T) => { set(v); setOffset(0); };
  }
  const changeRange = withReset(setRange);
  const changeProduct = withReset(setProductId);
  const changeCategory = withReset(setCategoryId);
  const changeBranch = withReset(setBranchId);
  const changeMovement = withReset(setMovementType);
  const changeSearch = withReset(setSearch);
  const changeCustomFrom = withReset(setCustomFrom);
  const changeCustomTo = withReset(setCustomTo);

  const params = useMemo(
    () => ({
      from,
      to,
      ...(productId ? { productId } : {}),
      ...(categoryId ? { categoryId } : {}),
      ...(branchId ? { branchId } : {}),
      ...(movementType ? { movementType } : {}),
      ...(debounced ? { search: debounced } : {}),
      limit: PAGE_SIZE,
      offset,
    }),
    [from, to, productId, categoryId, branchId, movementType, debounced, offset],
  );

  const q = useProductionLedger(token, params);
  const productsQ = useProducts(token, { isActive: true });
  const categoriesQ = useCategories(token);
  const branchesQ = useBranches(token);

  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;
  const showingFrom = total === 0 ? 0 : offset + 1;
  const showingTo = Math.min(offset + PAGE_SIZE, total);

  const hasFilters =
    !!productId || !!categoryId || !!branchId || !!movementType || !!debounced || range !== 'today';

  function clearFilters() {
    setRange('today');
    setProductId('');
    setCategoryId('');
    setBranchId('');
    setMovementType('');
    setSearch('');
    setOffset(0);
  }

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">Stock Movement History</h3>
          <p className="text-xs text-muted-foreground">
            Every posted movement, with its transaction number and who booked it.
          </p>
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="mr-1 h-3.5 w-3.5" /> Clear filters
          </Button>
        )}
      </div>

      {/* Quick ranges. Custom is not a button — it is what selecting a date does,
          so the two date boxes below never disagree with a highlighted chip. */}
      <div className="flex flex-wrap gap-1.5">
        {([
          ['today', 'Today'], ['yesterday', 'Yesterday'],
          ['week', 'This week'], ['month', 'This month'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => changeRange(key)}
            className={cn(
              'rounded-full border px-3 py-1 text-xs font-medium transition-colors',
              range === key ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-6">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">From</Label>
          <Input type="date" value={from} max={to} className="h-9"
            onChange={(e) => { setRange('custom'); changeCustomFrom(e.target.value); }} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">To</Label>
          <Input type="date" value={to} min={from} className="h-9"
            onChange={(e) => { setRange('custom'); changeCustomTo(e.target.value); }} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Product</Label>
          <Select value={productId || 'all'} onValueChange={(v) => changeProduct(!v || v === 'all' ? '' : v)}>
            <SelectTrigger className="h-9"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All products</SelectItem>
              {(productsQ.data ?? []).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Category</Label>
          <Select value={categoryId || 'all'} onValueChange={(v) => changeCategory(!v || v === 'all' ? '' : v)}>
            <SelectTrigger className="h-9"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {(categoriesQ.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Branch</Label>
          <Select value={branchId || 'all'} onValueChange={(v) => changeBranch(!v || v === 'all' ? '' : v)}>
            <SelectTrigger className="h-9"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All branches</SelectItem>
              {(branchesQ.data ?? []).map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Movement</Label>
          <Select value={movementType || 'all'} onValueChange={(v) => changeMovement(!v || v === 'all' ? '' : v)}>
            <SelectTrigger className="h-9"><SelectValue placeholder="All" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All movements</SelectItem>
              {LEDGER_TYPE_OPTIONS.map((t) => (
                <SelectItem key={t} value={t}>{LEDGER_TYPE_META[t as ProductionLedgerType].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-9 pl-8"
          placeholder="Search product, code, branch, demand number or transaction ID…"
          value={search}
          onChange={(e) => changeSearch(e.target.value)}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="bg-muted text-left text-xs">
            <tr>
              <th className="px-3 py-2 font-medium">Date / Time</th>
              <th className="px-3 py-2 font-medium">Product</th>
              <th className="px-3 py-2 font-medium">Movement</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 font-medium">Branch</th>
              <th className="px-3 py-2 font-medium">Reference</th>
              <th className="px-3 py-2 font-medium">User</th>
              <th className="px-3 py-2 text-right font-medium">Balance after</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && rows.length === 0 && (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-t"><td colSpan={8} className="px-3 py-2"><Skeleton className="h-5 w-full" /></td></tr>
              ))
            )}
            {!q.isLoading && rows.length === 0 && (
              <tr className="border-t">
                <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground">
                  No movements match these filters.
                </td>
              </tr>
            )}
            {rows.map((m) => (
              <tr key={m.id} className="border-t hover:bg-muted/40">
                <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums text-muted-foreground">
                  <div>{m.businessDate}</div>
                  <div>
                    {new Date(m.createdAt).toLocaleTimeString('en-PK', {
                      hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi',
                    })}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">{m.productName}</div>
                  <div className="font-mono text-xs text-muted-foreground">{m.stockCode}</div>
                </td>
                <td className="px-3 py-2"><LedgerTypeChip type={m.transactionType} /></td>
                <td className="px-3 py-2 text-right"><LedgerQty qty={m.qty} /></td>
                <td className="px-3 py-2 text-muted-foreground">{m.branchName ?? '—'}</td>
                <td className="px-3 py-2">
                  <span className="font-mono text-xs">{m.transactionNo ?? '—'}</span>
                  {m.referenceId && <p className="text-xs text-muted-foreground">{m.referenceId}</p>}
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {m.createdByName ?? '—'}
                  {m.remarks && <p className="italic">{m.remarks}</p>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                  {m.balanceAfter ?? '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 text-sm">
        <p className="text-muted-foreground">
          {total === 0 ? 'No movements' : `${showingFrom}–${showingTo} of ${total}`}
        </p>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" disabled={showingTo >= total}
            onClick={() => setOffset((o) => o + PAGE_SIZE)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
