'use client';

import { useMemo, useState } from 'react';
import type { FilterConfig, ProductionLedgerType } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranches, useCategories, useProductionLedger, useProducts } from '@/lib/queries';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Pagination } from '@/components/data-engine/Pagination';
import { ActiveFilters, FilterBar } from '@/components/data-engine';
import { useListQueryState } from '@/lib/data-engine/useListQueryState';
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

  const list = useListQueryState({ filterKeys: ['productId', 'categoryId', 'branchId', 'movementType'] });

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
   * Change the quick range / custom dates and go back to page 1.
   *
   * Narrowing a filter while on page 4 would otherwise ask for rows 76-100
   * of a 12-row result and show an empty table that reads as "no matches".
   * The dropdown/search filters reset the page themselves via `list`.
   */
  function changeRange(v: QuickRange) {
    setRange(v);
    list.setPage(1);
  }
  function changeCustomFrom(v: string) {
    setCustomFrom(v);
    list.setPage(1);
  }
  function changeCustomTo(v: string) {
    setCustomTo(v);
    list.setPage(1);
  }

  const productsQ = useProducts(token, { isActive: true });
  const categoriesQ = useCategories(token);
  const branchesQ = useBranches(token);

  const filters = useMemo<FilterConfig[]>(
    () => [
      { key: 'productId', label: 'Product', type: 'select', options: (productsQ.data ?? []).map((p) => ({ value: p.id, label: p.name })) },
      { key: 'branchId', label: 'Branch', type: 'select', options: (branchesQ.data ?? []).map((b) => ({ value: b.id, label: b.name })) },
      { key: 'categoryId', label: 'Category', type: 'select', options: (categoriesQ.data ?? []).map((c) => ({ value: c.id, label: c.name })) },
      {
        key: 'movementType', label: 'Movement', type: 'select',
        options: LEDGER_TYPE_OPTIONS.map((t) => ({ value: t, label: LEDGER_TYPE_META[t as ProductionLedgerType].label })),
      },
    ],
    [productsQ.data, branchesQ.data, categoriesQ.data],
  );

  const q = useProductionLedger(token, {
    from,
    to,
    productId: list.getFilter('productId')?.value as string | undefined,
    categoryId: list.getFilter('categoryId')?.value as string | undefined,
    branchId: list.getFilter('branchId')?.value as string | undefined,
    movementType: list.getFilter('movementType')?.value as string | undefined,
    search: list.state.search || undefined,
    limit: list.state.pageSize,
    offset: (list.state.page - 1) * list.state.pageSize,
  });

  const rows = q.data?.rows ?? [];
  const total = q.data?.total ?? 0;

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div>
        <h3 className="text-base font-semibold">Stock Movement History</h3>
        <p className="text-xs text-muted-foreground">
          Every posted movement, with its transaction number and who booked it.
        </p>
      </div>

      <FilterBar
        list={list}
        filters={filters}
        options={{}}
        searchPlaceholder="Search product, code, branch, demand number or transaction ID…"
        leading={
          <div className="space-y-2">
            {/* Quick ranges. Custom is not a button — it is what selecting a date
                does, so the two date boxes below never disagree with a
                highlighted chip. */}
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
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">From</Label>
                <Input type="date" value={from} max={to} className="h-11 md:h-9"
                  onChange={(e) => { setRange('custom'); changeCustomFrom(e.target.value); }} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">To</Label>
                <Input type="date" value={to} min={from} className="h-11 md:h-9"
                  onChange={(e) => { setRange('custom'); changeCustomTo(e.target.value); }} />
              </div>
            </div>
          </div>
        }
      />
      <ActiveFilters filters={list.activeFilters} configs={filters} search={list.state.search} onRemove={list.clearFilter} onClearSearch={() => list.setSearch('')} onClearAll={list.clearAll} />

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

      <Pagination
        page={list.state.page}
        pageSize={list.state.pageSize}
        total={total}
        onPageChange={list.setPage}
        onPageSizeChange={list.setPageSize}
        loading={q.isLoading}
      />
    </div>
  );
}
