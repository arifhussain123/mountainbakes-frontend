'use client';

import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  useAdminStockRows,
  useBranches,
  useDeleteAdminStock,
  useSaveAdminStock,
  type AdminStockRowEdit,
} from '@/lib/queries';
import { useStockRealtime } from '@/hooks/useStockRealtime';
import { type StockRow, businessDateStr } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils';
import { ApiError } from '@/utils/api';
import { toast } from 'sonner';
import { Plus, RotateCcw, Save, Search, Trash2 } from 'lucide-react';
import { AddBranchStockModal } from './AddBranchStockModal';
import { DeleteBranchStockDialog } from './DeleteBranchStockDialog';
import { AllBranchesStockSummary } from './AllBranchesStockSummary';
import { BranchStockHistoryCard } from '@/components/dashboard/BranchStockHistoryCard';

/**
 * Admin → Branch Stock. Direct control over any branch's stock ledger.
 *
 * ─── Why this screen exists ──────────────────────────────────────────────────
 * A branch's own Stock page is read-only by design: stock moves by selling, by
 * Production approving a demand, or by returning. The only way to set a figure
 * outright used to be through a Help Desk query — someone at the branch had to
 * raise a ticket before an admin could touch a number. That is the right shape
 * for "the branch disputes a figure" and the wrong shape for "seed the opening
 * balances for a new shop" or "the count is plainly wrong and there is no ticket".
 *
 * ─── The editing model ───────────────────────────────────────────────────────
 * Every input is an ABSOLUTE figure, never a delta: type the numbers as they
 * should read and save. The server sizes the compensating movements against the
 * LIVE ledger under a row lock (`apply_stock_correction`), so a tab left open
 * for an hour cannot clobber a sale that landed in the meantime, and pressing
 * Save twice writes nothing the second time.
 *
 * Balance and Adjustment are ONE degree of freedom seen from two ends —
 * `opening + new − sold − returned + adjustment = balance`. Both are editable
 * here and each drives the other, spreadsheet-style: edit Sold and Balance
 * follows; type a Balance and Adjustment absorbs the difference. Only the five
 * non-Balance figures are ever sent, so the request can never be the
 * "overdetermined" one the API refuses.
 *
 * ─── What is NOT hidden from you ─────────────────────────────────────────────
 * Saving many rows is not atomic (the correction RPC is per-product), so a row
 * the server refuses is reported by name while the rest stay saved. And Delete
 * offers two genuinely different things — see DeleteBranchStockDialog.
 */

/** The figures held in a row draft. Balance is derived but editable — see above. */
type FigureKey = 'opening' | 'newQty' | 'sold' | 'returned' | 'adjustment' | 'balance';

/** The five ABSOLUTE targets actually sent. Balance is omitted on purpose. */
const SENT_KEYS = ['opening', 'newQty', 'sold', 'returned', 'adjustment'] as const;

/** Figures that are tallies and cannot go below zero. Adjustment is signed. */
const COUNT_KEYS = ['opening', 'newQty', 'sold', 'returned', 'balance'] as const;

type Draft = Record<FigureKey, string>;

/**
 * The branch-picker value meaning "every branch at once".
 *
 * A sentinel in the same Select rather than a separate tab, because the question
 * it answers is the same one the page already asks — what is the stock — only
 * widened. It is deliberately not a uuid, so it can never collide with a branch
 * id.
 *
 * Editing is per-branch by nature (a correction targets one branch's ledger), so
 * selecting it swaps the editable table for the branch-wise summary rather than
 * leaving inputs on screen with nowhere to write.
 */
const ALL_BRANCHES = 'all';

const COLUMNS: { key: FigureKey; label: string; signed: boolean }[] = [
  { key: 'opening', label: 'Opening', signed: false },
  { key: 'newQty', label: 'New', signed: false },
  { key: 'sold', label: 'Sold', signed: false },
  { key: 'returned', label: 'Returned', signed: false },
  { key: 'adjustment', label: 'Adjustment', signed: true },
  { key: 'balance', label: 'Balance', signed: false },
];

/**
 * Keep a figure input to something parseable while it is being typed.
 *
 * A lone '-' survives so a signed field can be typed left to right; it parses as
 * 0 until a digit follows it.
 */
function sanitize(raw: string, signed: boolean): string {
  const cleaned = raw.replace(signed ? /[^\d-]/g : /\D/g, '');
  if (!signed) return cleaned.replace(/^0+(?=\d)/, '');
  const negative = cleaned.startsWith('-');
  const digits = cleaned.replace(/-/g, '').replace(/^0+(?=\d)/, '');
  return `${negative ? '-' : ''}${digits}`;
}

/** Blank reads as 0 — clearing a figure means setting it to nothing, i.e. zero. */
function num(raw: string): number {
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 0;
}

const draftFromRow = (r: StockRow): Draft => ({
  opening: String(r.opening),
  newQty: String(r.newQty),
  sold: String(r.sold),
  returned: String(r.returned),
  adjustment: String(r.adjustment),
  balance: String(r.balance),
});

/**
 * Re-derive the other half of the Balance/Adjustment pair after an edit.
 *
 * Typing a Balance moves Adjustment (it is the residual). Typing anything else
 * moves Balance (it is the total). Without this the row on screen stops adding
 * up, and the admin is reading one number while saving another.
 */
function reflow(draft: Draft, changed: FigureKey): Draft {
  const base = num(draft.opening) + num(draft.newQty) - num(draft.sold) - num(draft.returned);
  if (changed === 'balance') {
    return { ...draft, adjustment: String(num(draft.balance) - base) };
  }
  return { ...draft, balance: String(base + num(draft.adjustment)) };
}

/** True when the draft targets differ from what the server last reported. */
function isDirty(draft: Draft, row: StockRow): boolean {
  return SENT_KEYS.some((k) => num(draft[k]) !== row[k]);
}

/** The row-level complaint that blocks a save, or null. */
function rowError(draft: Draft): string | null {
  for (const key of COUNT_KEYS) {
    if (num(draft[key]) < 0) {
      const label = COLUMNS.find((c) => c.key === key)!.label;
      return `${label} cannot be negative`;
    }
  }
  return null;
}

export function AdminBranchStockPage() {
  const { token } = useAuth();
  const { data: branches = [], isPending: branchesPending } = useBranches(token ?? '');

  const [branchId, setBranchId] = useState('');
  const [date, setDate] = useState(businessDateStr());
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StockRow | null>(null);
  // Shared by both history views, so switching between one branch and all of them
  // keeps the window the admin chose rather than snapping back to a week.
  const [historyDays, setHistoryDays] = useState(7);

  // First branch as the default, once the list arrives. React's documented
  // render-time adjustment rather than an effect — an effect would render the
  // empty-state screen for a frame before switching to the real one.
  const [seededBranches, setSeededBranches] = useState(false);
  if (!seededBranches && branches.length > 0) {
    setSeededBranches(true);
    setBranchId(branches[0].id);
  }

  // Every editing affordance below keys off this: with "All branches" selected
  // there is no single ledger to write to.
  const editing = !!branchId && branchId !== ALL_BRANCHES;

  const { data: rows = [], isPending, isFetching, refetch } = useAdminStockRows(token ?? '', {
    branchId,
    date,
    // ALL_BRANCHES is truthy, so the hook's own `!!branchId` guard would let it
    // fire and ask the API for a branch called "all".
    enabled: editing,
  });
  // The same bridge the branch's own Stock page uses: a Production approval or a
  // sale landing while this page is open invalidates the whole ['stock'] prefix,
  // which this page's key sits under.
  useStockRealtime();

  const save = useSaveAdminStock(token ?? '');
  const remove = useDeleteAdminStock(token ?? '');

  const branchName = branches.find((b) => b.id === branchId)?.name ?? '';

  /** Drop every pending edit — used after a save and by Discard. */
  const resetDrafts = useCallback(() => setDrafts({}), []);

  const draftFor = useCallback(
    (row: StockRow): Draft => drafts[row.productId] ?? draftFromRow(row),
    [drafts],
  );

  const setField = useCallback(
    (row: StockRow, key: FigureKey, raw: string) => {
      const signed = COLUMNS.find((c) => c.key === key)!.signed;
      setDrafts((prev) => {
        const current = prev[row.productId] ?? draftFromRow(row);
        return {
          ...prev,
          [row.productId]: reflow({ ...current, [key]: sanitize(raw, signed) }, key),
        };
      });
    },
    [],
  );

  const revertRow = useCallback((productId: string) => {
    setDrafts((prev) => {
      const next = { ...prev };
      delete next[productId];
      return next;
    });
  }, []);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.productName.toLowerCase().includes(q) || r.stockCode.toLowerCase().includes(q),
    );
  }, [rows, search]);

  // Dirty rows are computed across ALL rows, not just the visible ones: a search
  // typed after editing must not silently drop those edits from the save.
  const dirtyRows = useMemo(
    () => rows.filter((r) => drafts[r.productId] && isDirty(drafts[r.productId]!, r)),
    [rows, drafts],
  );

  const blocked = useMemo(
    () => dirtyRows.filter((r) => rowError(drafts[r.productId]!) !== null),
    [dirtyRows, drafts],
  );

  async function onSave() {
    if (!branchId || dirtyRows.length === 0) return;
    if (blocked.length > 0) {
      toast.error(`${blocked[0]!.productName}: ${rowError(drafts[blocked[0]!.productId]!)}`);
      return;
    }

    const payload: AdminStockRowEdit[] = dirtyRows.map((r) => {
      const draft = drafts[r.productId]!;
      return {
        productId: r.productId,
        opening: num(draft.opening),
        newQty: num(draft.newQty),
        sold: num(draft.sold),
        returned: num(draft.returned),
        adjustment: num(draft.adjustment),
      };
    });

    try {
      const result = await save.mutateAsync({ branchId, date, reason: reason.trim(), rows: payload });
      // A partial save is reported as one, not smoothed over: the rows that went
      // through are real stock movements and stay committed.
      if (result.failed.length > 0) {
        toast.error(
          `${result.failed.length} product${result.failed.length === 1 ? '' : 's'} not saved — ${result.failed[0]!.productName}: ${result.failed[0]!.error}`,
        );
      }
      if (result.changedCount > 0) {
        toast.success(`Saved ${result.changedCount} product${result.changedCount === 1 ? '' : 's'}`);
      } else if (result.failed.length === 0) {
        toast.info('Nothing to change — those figures already match');
      }
      // Only the rows the server accepted lose their draft; a refused row keeps
      // what was typed so it can be corrected rather than retyped.
      const accepted = new Set(result.saved.map((s) => s.productId));
      setDrafts((prev) => {
        const next: Record<string, Draft> = {};
        for (const [productId, draft] of Object.entries(prev)) {
          if (!accepted.has(productId)) next[productId] = draft;
        }
        return next;
      });
      setReason('');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to save stock');
    }
  }

  async function onDelete(mode: 'zero' | 'purge') {
    if (!deleteTarget || !branchId) return;
    const target = deleteTarget;
    try {
      await remove.mutateAsync({ branchId, productId: target.productId, mode, date, reason: reason.trim() });
      toast.success(
        mode === 'purge'
          ? `${target.productName} removed from ${branchName}`
          : `${target.productName} set to 0`,
      );
      setDeleteTarget(null);
      revertRow(target.productId);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to delete stock');
    }
  }

  const busy = save.isPending || remove.isPending;

  return (
    <div className="space-y-4">
      {/* ── Controls ───────────────────────────────────────────────────────── */}
      <div className="grid gap-3 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor="stock-branch">Branch</Label>
          <Select value={branchId} onValueChange={(v) => { if (v) { setBranchId(v); resetDrafts(); } }}>
            <SelectTrigger id="stock-branch" className="w-full">
              <SelectValue placeholder={branchesPending ? 'Loading…' : 'Choose a branch'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_BRANCHES}>All branches</SelectItem>
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Date, search and reason all describe an edit to ONE branch's ledger.
            Under "All branches" they have nothing to act on, so they go rather
            than sit there inviting input that cannot be saved. */}
        {editing && (
        <div className="space-y-1">
          <Label htmlFor="stock-date">Business date</Label>
          {/* Past dates are editable too — a correction is filed against the day it
              belongs to. An Opening edit lands on the day BEFORE this one, and the
              API refuses it if that day has been formally closed. */}
          <Input
            id="stock-date"
            type="date"
            value={date}
            max={businessDateStr()}
            onChange={(e) => { setDate(e.target.value || businessDateStr()); resetDrafts(); }}
          />
        </div>
        )}

        {editing && (
        <div className="space-y-1">
          <Label htmlFor="stock-search">Search</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="stock-search"
              placeholder="Product or ID…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
        </div>
        )}

        {editing && (
        <div className="space-y-1">
          <Label htmlFor="stock-reason">Reason (optional)</Label>
          {/* Rides along on the notification the branch receives, so a figure that
              changes under them arrives with a why attached. */}
          <Input
            id="stock-reason"
            placeholder="Why is this changing?"
            value={reason}
            maxLength={300}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        )}
      </div>

      {/* ── Actions ────────────────────────────────────────────────────────── */}
      {/* Hidden rather than disabled under "All branches": a row of greyed-out
          buttons reads as "you lack permission", when the truth is that the view
          simply has no single branch to write to. */}
      {editing && (
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={() => setAddOpen(true)} disabled={!branchId || busy}>
          <Plus className="mr-1.5 h-4 w-4" /> Add Stock
        </Button>
        <Button onClick={onSave} disabled={dirtyRows.length === 0 || busy}>
          <Save className="mr-1.5 h-4 w-4" />
          {save.isPending ? 'Saving…' : `Save${dirtyRows.length ? ` (${dirtyRows.length})` : ''}`}
        </Button>
        <Button variant="outline" onClick={resetDrafts} disabled={dirtyRows.length === 0 || busy}>
          Discard
        </Button>
        <Button variant="ghost" onClick={() => refetch()} disabled={!branchId || isFetching}>
          <RotateCcw className={cn('mr-1.5 h-4 w-4', isFetching && 'animate-spin')} /> Refresh
        </Button>
        <p className="ml-auto text-sm text-muted-foreground">
          {branchName ? `${branchName} · ${date}` : 'Choose a branch'}
          {dirtyRows.length > 0 && ` · ${dirtyRows.length} unsaved`}
        </p>
      </div>
      )}

      {/* ── The ledger ─────────────────────────────────────────────────────── */}
      {branchId === ALL_BRANCHES ? (
        // Branch-wise: one row per branch over the window, with a company total.
        // The per-product editor is not shown, because a correction targets one
        // branch's ledger and there is no way to say which from here.
        <AllBranchesStockSummary days={historyDays} onDaysChange={setHistoryDays} />
      ) : !branchId ? (
        <EmptyState title="Choose a branch" description="Pick a branch to load and edit its stock." />
      ) : isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : visible.length === 0 ? (
        <EmptyState
          title="No products found"
          description={search ? 'Try a different search term.' : 'This branch has no active products.'}
        />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left">
                  <th className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">Product</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="px-2 py-2 text-center text-xs uppercase tracking-wide text-muted-foreground">
                      {c.label}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-center text-xs uppercase tracking-wide text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const draft = draftFor(row);
                  const dirty = isDirty(draft, row);
                  const error = dirty ? rowError(draft) : null;
                  return (
                    <tr
                      key={row.productId}
                      className={cn('border-t', dirty && 'bg-amber-50/60 dark:bg-amber-500/5', error && 'bg-destructive/10')}
                    >
                      <td className="px-3 py-1.5">
                        <div className="font-medium">{row.productName}</div>
                        <div className="font-mono text-xs text-muted-foreground">{row.stockCode}</div>
                        {error && <div className="text-xs text-destructive">{error}</div>}
                      </td>
                      {COLUMNS.map((c) => (
                        <td key={c.key} className="px-2 py-1.5">
                          <Input
                            aria-label={`${row.productName} ${c.label}`}
                            type="text"
                            inputMode={c.signed ? 'text' : 'numeric'}
                            value={draft[c.key]}
                            onChange={(e) => setField(row, c.key, e.target.value)}
                            disabled={busy}
                            className={cn(
                              'h-8 w-20 text-center tabular-nums',
                              c.key === 'balance' && 'font-semibold',
                              num(draft[c.key]) !== row[c.key] && 'border-primary',
                            )}
                          />
                        </td>
                      ))}
                      <td className="px-2 py-1.5">
                        <div className="flex items-center justify-center gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => revertRow(row.productId)}
                            disabled={!dirty || busy}
                            title="Undo edits to this row"
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteTarget(row)}
                            disabled={busy}
                            title="Delete this product's stock"
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards — the same six inputs as a label:value grid, which is the
              shape the branch's own Stock page collapses to. */}
          <div className="space-y-3 md:hidden">
            {visible.map((row) => {
              const draft = draftFor(row);
              const dirty = isDirty(draft, row);
              const error = dirty ? rowError(draft) : null;
              return (
                <div
                  key={row.productId}
                  className={cn('rounded-lg border bg-card p-3', dirty && 'ring-2 ring-primary/30', error && 'ring-destructive/50')}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{row.productName}</p>
                      <p className="font-mono text-xs text-muted-foreground">{row.stockCode}</p>
                    </div>
                    <div className="flex shrink-0 gap-1">
                      <Button variant="ghost" size="sm" onClick={() => revertRow(row.productId)} disabled={!dirty || busy}>
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteTarget(row)} disabled={busy}>
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>

                  {error && <p className="mt-1 text-xs text-destructive">{error}</p>}

                  <div className="mt-2 grid grid-cols-2 gap-2">
                    {COLUMNS.map((c) => (
                      <div key={c.key} className="space-y-1">
                        <span className="text-xs text-muted-foreground">{c.label}</span>
                        <Input
                          aria-label={`${row.productName} ${c.label}`}
                          type="text"
                          inputMode={c.signed ? 'text' : 'numeric'}
                          value={draft[c.key]}
                          onChange={(e) => setField(row, c.key, e.target.value)}
                          disabled={busy}
                          // 16px, or the browser zooms the page on focus.
                          className="h-10 text-base tabular-nums"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* Day-by-day ledger for the selected branch — the activity behind the
          figures in the table above. The SAME component the Branch Dashboard
          renders, pointed at the branch chosen here: one implementation, so the
          admin and the branch manager cannot be shown different histories of the
          same days. */}
      {editing && (
        <BranchStockHistoryCard days={historyDays} onDaysChange={setHistoryDays} branchId={branchId} />
      )}

      <AddBranchStockModal
        open={addOpen}
        onOpenChange={setAddOpen}
        rows={rows}
        branchId={branchId}
        branchName={branchName}
        date={date}
        reason={reason}
      />

      <DeleteBranchStockDialog
        row={deleteTarget}
        branchName={branchName}
        pending={remove.isPending}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        onConfirm={onDelete}
      />
    </div>
  );
}
