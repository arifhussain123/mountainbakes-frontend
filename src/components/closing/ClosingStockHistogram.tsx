'use client';

import { useMemo, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { StockRow } from '@mb/shared';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Closing Stock, drawn — the horizontal bar graph under the Closing Stock table.
 *
 * Loaded through `next/dynamic({ ssr: false })` by the page, so recharts stays out
 * of the closing sheet's initial bundle (the sheet is also what a shift prints).
 *
 * ─── One dataset ─────────────────────────────────────────────────────────────
 * `rows` are the SAME array the table renders — the product rows `/api/stock`
 * returned with `activityOnly=1`, already reduced server-side to products where
 * at least one of Opening / Received / Sold / Returned / Balance is non-zero.
 * Nothing is recomputed, re-filtered or re-sorted here, which is what stops the
 * graph and the table ever disagreeing: a product is a bar exactly when it is a
 * row, in the same order, with the same numbers. `totals` is the page's own
 * column total for the same reason.
 *
 * ─── Why horizontal ──────────────────────────────────────────────────────────
 * The categories are product names, and a shop can have dozens on the sheet.
 * Vertical columns would have to shrink or rotate the names to fit; rows keep
 * every name readable and simply make the graph taller, and a tall graph is
 * scrollable where a narrow one is not.
 */

type Head = 'opening' | 'newQty' | 'sold' | 'returned' | 'balance';
type View = 'all' | Head;

/**
 * The five stock heads in the order the table prints them, each bound to its own
 * colour token. The colour follows the head, never the position: switching the
 * view to "Sold" draws the same green the "All" view used for Sold.
 */
const HEADS: { key: Head; label: string; color: string }[] = [
  { key: 'opening', label: 'Opening', color: 'var(--stock-opening)' },
  { key: 'newQty', label: 'Received', color: 'var(--stock-received)' },
  { key: 'sold', label: 'Sold', color: 'var(--stock-sold)' },
  { key: 'returned', label: 'Returned', color: 'var(--stock-returned)' },
  { key: 'balance', label: 'Balance', color: 'var(--stock-balance)' },
];

const AXIS = 'var(--muted-foreground)';
const GRID = 'var(--border)';

/** Bar thickness and the space a product row takes, per view. */
const BAR = { all: 8, single: 14 };
const ROW_HEIGHT = { all: 5 * BAR.all + 4 * 2 + 16, single: BAR.single + 14 };
/** The x-axis band under the plot; the container must include it or the axis clips. */
const AXIS_BAND = 28;
/** Beyond this the card scrolls rather than growing without limit. */
const MAX_PLOT_HEIGHT = 480;
/** Below this width the graph scrolls sideways rather than squeezing the bars. */
const MIN_PLOT_WIDTH = 520;

/** ~1000 → "1k" on the axis; the tooltip and the table carry the exact figure. */
function compact(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(Math.round(v));
}

/**
 * Long product names are cut on the axis, never squeezed: a smaller font is the
 * one thing the axis must not do. The full name is in the tooltip and the table.
 */
const NAME_CHARS = 26;
function shortName(name: string): string {
  return name.length > NAME_CHARS ? `${name.slice(0, NAME_CHARS - 1)}…` : name;
}

function StockTooltip({ active, payload }: { active?: boolean; payload?: { payload: StockRow }[] }) {
  const row = active ? payload?.[0]?.payload : undefined;
  if (!row) return null;
  // Every head, whichever view is on — the reader hovering a Sold bar wants the
  // whole row, not the one number they can already see.
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-card-foreground shadow-md">
      <p className="text-xs font-medium">{row.productName}</p>
      <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-xs">
        {HEADS.map((h) => (
          <div key={h.key} className="contents">
            <dt className="flex items-center gap-1.5 text-muted-foreground">
              <span aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ background: h.color }} />
              {h.label}
            </dt>
            <dd className="text-right font-semibold tabular-nums">{row[h.key].toLocaleString()}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export interface ClosingStockHistogramProps {
  rows: StockRow[];
  totals: Record<Head, number>;
  loading: boolean;
}

export function ClosingStockHistogram({ rows, totals, loading }: ClosingStockHistogramProps) {
  const [view, setView] = useState<View>('all');
  const shown = view === 'all' ? HEADS : HEADS.filter((h) => h.key === view);

  // Sized from the row count so every product gets a readable band; capped so a
  // long catalogue scrolls inside the card instead of pushing the page down.
  const plotHeight = rows.length * (view === 'all' ? ROW_HEIGHT.all : ROW_HEIGHT.single) + AXIS_BAND;
  const barSize = view === 'all' ? BAR.all : BAR.single;

  // Wide enough for the longest name on the sheet, and no wider — the plot gets
  // whatever is left.
  const nameWidth = useMemo(() => {
    const longest = rows.reduce((n, r) => Math.max(n, shortName(r.productName).length), 0);
    return Math.min(190, Math.max(96, longest * 7 + 12));
  }, [rows]);

  return (
    <div className="space-y-3">
      {/* Totals double as the legend: each head keeps its swatch beside its
          figure, so identity is never carried by colour alone. Read from the
          page's `totals`, which is the table footer's own sum. */}
      <div className="flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
        {HEADS.map((h) => (
          <div key={h.key} className="flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: h.color }} />
            <span className="text-muted-foreground">{h.label}</span>
            <span className="font-semibold tabular-nums">{loading ? '…' : totals[h.key].toLocaleString()}</span>
          </div>
        ))}
      </div>

      <Tabs value={view} onValueChange={(v) => setView(v as View)}>
        <TabsList aria-label="Stock head shown on the graph">
          <TabsTrigger value="all">All</TabsTrigger>
          {HEADS.map((h) => (
            <TabsTrigger key={h.key} value={h.key}>{h.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {loading ? (
        <Skeleton className="h-48 w-full" />
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No stock activity available for this business day.
        </p>
      ) : (
        // Vertical scroll once the catalogue outgrows the cap; horizontal scroll
        // on a narrow screen. Both keep the bars and the names at full size.
        <div className="overflow-auto" style={{ maxHeight: MAX_PLOT_HEIGHT }}>
          <div style={{ minWidth: MIN_PLOT_WIDTH, height: plotHeight }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={rows}
                layout="vertical"
                margin={{ top: 4, right: 40, left: 0, bottom: 0 }}
                barGap={2}
                barCategoryGap={view === 'all' ? 8 : 7}
              >
                <CartesianGrid stroke={GRID} horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fontSize: 11, fill: AXIS }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={compact}
                  // Anchored at zero: a bar's length must be its quantity. The
                  // negative side only appears if a balance has gone negative.
                  domain={[(min: number) => Math.min(0, min), 'auto']}
                />
                <YAxis
                  type="category"
                  dataKey="productName"
                  width={nameWidth}
                  interval={0}
                  tick={{ fontSize: 11, fill: AXIS }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={shortName}
                />
                <Tooltip
                  content={<StockTooltip />}
                  cursor={{ fill: 'var(--muted)', fillOpacity: 0.5 }}
                  isAnimationActive={false}
                />
                {shown.map((h) => (
                  <Bar
                    key={h.key}
                    dataKey={h.key}
                    name={h.label}
                    fill={h.color}
                    barSize={barSize}
                    radius={[0, 4, 4, 0]}
                    activeBar={{ fillOpacity: 0.75 }}
                    isAnimationActive={false}
                  >
                    {/* One series has room for its figure at the bar tip; five
                        side by side do not, and the tooltip carries them. */}
                    {view !== 'all' && (
                      <LabelList
                        dataKey={h.key}
                        position="right"
                        offset={6}
                        formatter={(v: number) => v.toLocaleString()}
                        style={{ fontSize: 11, fill: AXIS }}
                      />
                    )}
                  </Bar>
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
