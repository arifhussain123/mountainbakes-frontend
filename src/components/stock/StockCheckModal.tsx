'use client';

import { useCallback, useMemo, useState } from 'react';
import { type StockRow, businessDateStr } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { ClipboardCheck, Eraser, Pencil, Search, TrendingDown, TrendingUp } from 'lucide-react';

/**
 * Physical stock check — a calculator, not a transaction.
 *
 * The counter types what is actually on the shelf next to what the day's ledger
 * says should be there, and Verify diffs the two. **Nothing here is written
 * anywhere**: no API call, no movement, no adjustment. Correcting a real
 * discrepancy is still a Return (for stock going back to production) or an admin
 * adjustment from the Support Center — this screen only tells you which products
 * to look at.
 *
 * That is why the counts live in component state and die with the dialog.
 */

/** One product's discrepancy, once counted and verified. */
interface CheckResultRow {
  productId: string;
  productName: string;
  balance: number;
  counted: number;
  /** counted − balance: positive = surplus, negative = deficit. */
  diff: number;
}

interface CheckResult {
  surplus: CheckResultRow[];
  deficit: CheckResultRow[];
  /** Counted products that matched the balance exactly. */
  matched: number;
}

/**
 * Keep only digits, strip leading zeros — physical counts are whole and never
 * negative. `'0'` survives, because counting zero is a real answer (and the one
 * that most often reveals a deficit); only an empty string means "not counted".
 */
function sanitizeCount(raw: string): string {
  return raw.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
}

export function StockCheckModal({
  open,
  onOpenChange,
  rows,
  branchName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: StockRow[];
  branchName: string;
}) {
  // productId → raw input. A key that is absent or '' is simply uncounted, and is
  // left out of the verification entirely rather than being read as zero.
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [result, setResult] = useState<CheckResult | null>(null);
  const [search, setSearch] = useState('');

  /**
   * Only stock actually held gets counted. A product sitting at zero has nothing
   * on the shelf to walk up to, and listing every one of them buries the handful
   * that matter under a wall of empty boxes.
   *
   * A *negative* balance is kept: it is not "held", but it is a ledger that has
   * already gone wrong, and a physical count is exactly how it gets caught.
   */
  const held = useMemo(
    () => rows.filter((r) => r.balance !== 0).sort((a, b) => a.productName.localeCompare(b.productName)),
    [rows],
  );
  const hiddenAtZero = rows.length - held.length;

  /**
   * Once verified the list stops being a form and becomes the worklist: only the
   * products that disagreed with the balance stay on it. A product that matched
   * is settled and drops off, and so does one that was never counted.
   *
   * "Edit counts" in the result panel clears the verdict and brings the full list
   * back — otherwise a typo on a row that happened to match would be unreachable.
   */
  const discrepancyIds = useMemo(() => {
    if (!result) return null;
    return new Set([...result.surplus, ...result.deficit].map((r) => r.productId));
  }, [result]);

  const visible = useMemo(() => {
    const base = discrepancyIds ? held.filter((r) => discrepancyIds.has(r.productId)) : held;
    const q = search.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (r) => r.productName.toLowerCase().includes(q) || r.stockCode.toLowerCase().includes(q),
    );
  }, [held, search, discrepancyIds]);

  // Reset on open, the same render-time adjustment ReturnItemsModal uses — an
  // effect would flash the previous count for a frame before clearing it.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setCounts({});
      setResult(null);
      setSearch('');
    }
  }

  const setCount = useCallback((productId: string, raw: string) => {
    setCounts((c) => ({ ...c, [productId]: sanitizeCount(raw) }));
    // Any edit invalidates the verdict on screen — showing a surplus computed
    // from a number the user has since changed is worse than showing nothing.
    setResult(null);
  }, []);

  const countedIds = useMemo(
    () => held.filter((r) => (counts[r.productId] ?? '') !== '').map((r) => r.productId),
    [held, counts],
  );
  const hasCounts = countedIds.length > 0;

  function onVerify() {
    const surplus: CheckResultRow[] = [];
    const deficit: CheckResultRow[] = [];
    let matched = 0;

    for (const row of held) {
      const raw = counts[row.productId] ?? '';
      if (raw === '') continue; // never counted — not a discrepancy, just unchecked
      const counted = parseInt(raw, 10);
      if (!Number.isFinite(counted)) continue;

      const diff = counted - row.balance;
      const entry: CheckResultRow = {
        productId: row.productId,
        productName: row.productName,
        balance: row.balance,
        counted,
        diff,
      };
      if (diff > 0) surplus.push(entry);
      else if (diff < 0) deficit.push(entry);
      else matched++;
    }

    // Biggest gaps first — those are the ones worth walking back to the shelf for.
    surplus.sort((a, b) => b.diff - a.diff);
    deficit.sort((a, b) => a.diff - b.diff);

    // Drop any search term with the verdict: the search box is hidden while the
    // result is up, so a leftover term would silently hide a discrepancy row.
    setSearch('');
    setResult({ surplus, deficit, matched });
  }

  function onClear() {
    setCounts({});
    setResult(null);
  }

  const totalCounted = countedIds.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col md:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Stock Check</DialogTitle>
          <DialogDescription>
            {branchName ? `${branchName} · ` : ''}
            {businessDateStr()} · count what is on the shelf, then Verify. Only stock held today is
            listed. Nothing on this screen is saved — it only compares your count against the balance.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
          {/* The verdict sits above the rows so it is the first thing on screen
              after Verify, without having to scroll back up a long product list. */}
          {result && (
            <ResultPanel result={result} counted={totalCounted} onEdit={() => setResult(null)} />
          )}

          {held.length > 8 && !result && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search products…"
                className="pl-9"
              />
            </div>
          )}

          {/* Column headers, desktop only — on mobile each row labels itself. */}
          <div
            className={cn(
              'hidden px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:flex sm:items-center sm:gap-3',
              visible.length === 0 && 'sm:hidden',
            )}
          >
            <span className="min-w-0 flex-1">Product</span>
            <span className="w-24 text-center">Balance</span>
            <span className="w-28 text-center">Stock Check</span>
          </div>

          <div className="space-y-2">
            {visible.map((row) => {
              const raw = counts[row.productId] ?? '';
              const counted = raw === '' ? null : parseInt(raw, 10);
              const diff = counted === null ? null : counted - row.balance;

              return (
                // Name, balance and count box all on one line — same shape as the
                // demand entry list, and for the same reason: a counter walking the
                // shelf wants the whole product list in as few screens as possible.
                // The name truncates (full text in `title`) rather than wrapping,
                // which is what holds the row to one line. The stock code is not
                // shown at all — nobody counts by code — though search still
                // matches it.
                <div
                  key={row.productId}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border bg-card p-2 sm:gap-3 sm:border-0 sm:bg-transparent sm:p-1',
                    // A ring rather than a background tint: it reads on the mobile
                    // card and the desktop row alike, and does not fight `bg-card`.
                    diff !== null && diff > 0 && 'ring-2 ring-emerald-500/40',
                    diff !== null && diff < 0 && 'ring-2 ring-red-500/40',
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium leading-tight sm:text-base" title={row.productName}>
                      {row.productName}
                    </p>
                  </div>

                  {/* Balance reads as inline text on mobile and as the bordered box
                      on desktop, where it has a column header to line up under. */}
                  <span className="shrink-0 text-[11px] text-muted-foreground sm:hidden">
                    Bal{' '}
                    <span
                      className={cn(
                        'font-semibold tabular-nums text-foreground',
                        row.balance < 0 && 'text-destructive',
                      )}
                    >
                      {row.balance}
                    </span>
                  </span>
                  <div
                    className={cn(
                      'hidden h-9 w-24 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-sm font-semibold tabular-nums sm:flex',
                      row.balance < 0 && 'text-destructive',
                    )}
                  >
                    {row.balance}
                  </div>

                  {/* inputMode="numeric" + pattern="[0-9]*" opens the digits-only
                      keypad; text-base (16px) stops iOS zooming the page on focus. */}
                  <Input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="off"
                    placeholder="—"
                    aria-label={`Counted quantity for ${row.productName}`}
                    value={raw}
                    onChange={(e) => setCount(row.productId, e.target.value)}
                    onFocus={(e) => e.currentTarget.select()}
                    className="h-10 w-20 shrink-0 text-center text-base tabular-nums sm:h-9 sm:w-28 sm:text-sm"
                  />
                </div>
              );
            })}

            {visible.length === 0 && (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {held.length === 0
                  ? 'No stock held today — every product is at zero balance.'
                  : result
                    ? 'Nothing to review — every product you counted matched its balance.'
                    : 'No products match that search.'}
              </p>
            )}
          </div>
        </div>

        <div className="shrink-0 space-y-3 border-t pt-3">
          <p className="text-sm text-muted-foreground">
            Counted <span className="font-bold tabular-nums text-primary">{totalCounted}</span> of{' '}
            <span className="tabular-nums">{held.length}</span> held
            {hiddenAtZero > 0 && ` · ${hiddenAtZero} at zero not listed`}
            {!hasCounts && ' · enter a count to enable Verify'}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Button type="button" variant="outline" onClick={onClear} disabled={!hasCounts && !result}>
              <Eraser className="mr-1.5 h-4 w-4" /> Clear
            </Button>
            <Button type="button" onClick={onVerify} disabled={!hasCounts}>
              <ClipboardCheck className="mr-1.5 h-4 w-4" /> Verify
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The verdict: surplus first, then deficit. What matched is a count, not a list. */
function ResultPanel({
  result,
  counted,
  onEdit,
}: {
  result: CheckResult;
  counted: number;
  onEdit: () => void;
}) {
  const { surplus, deficit, matched } = result;
  const clean = surplus.length === 0 && deficit.length === 0;

  if (clean) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3">
        <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
          ✅ All {counted} counted {counted === 1 ? 'product matches' : 'products match'} the balance — no
          surplus, no deficit.
        </p>
        <Button type="button" variant="ghost" size="sm" onClick={onEdit}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit counts
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
        <span className="font-semibold">Check result</span>
        <span className="text-muted-foreground">
          Surplus <span className="font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{surplus.length}</span>
        </span>
        <span className="text-muted-foreground">
          Deficit <span className="font-bold tabular-nums text-red-600 dark:text-red-400">{deficit.length}</span>
        </span>
        <span className="text-muted-foreground">
          Matched <span className="font-bold tabular-nums">{matched}</span>
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={onEdit} className="ml-auto">
          <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit counts
        </Button>
      </div>

      {surplus.length > 0 && (
        <DiffList
          title="Surplus — more on the shelf than the balance"
          rows={surplus}
          tone="surplus"
        />
      )}

      {surplus.length > 0 && deficit.length > 0 && <Separator />}

      {deficit.length > 0 && (
        <DiffList title="Deficit — less on the shelf than the balance" rows={deficit} tone="deficit" />
      )}

      <p className="text-xs text-muted-foreground">
        Not saved. To correct a real difference, use Return Items on the New Orders page or ask an
        admin for a stock adjustment.
      </p>
    </div>
  );
}

function DiffList({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: CheckResultRow[];
  tone: 'surplus' | 'deficit';
}) {
  const Icon = tone === 'surplus' ? TrendingUp : TrendingDown;
  const toneText = tone === 'surplus' ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400';

  return (
    <div className="space-y-1.5">
      <p className={cn('flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide', toneText)}>
        <Icon className="h-3.5 w-3.5" /> {title}
      </p>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.productId} className="flex items-center gap-3 rounded-md bg-background px-2.5 py-1.5 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium">{r.productName}</span>
            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
              balance {r.balance} · counted {r.counted}
            </span>
            {/* Fixed width, so the variance forms a column down the list — centred
                in it like every other stock figure. */}
            <span className={cn('w-14 shrink-0 text-center font-bold tabular-nums', toneText)}>
              {r.diff > 0 ? `+${r.diff}` : r.diff}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
