'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { businessDateStr, FINANCE_ACCOUNT_LABELS, type FilterConfig, type LedgerEntry } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranches } from '@/lib/queries';
import { downloadFinanceReport, useFinanceMutation, useLedger, useLedgerHeads, type LedgerFilters } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/shared/EmptyState';
import { Pagination } from '@/components/data-engine/Pagination';
import { FilterBar, ActiveFilters } from '@/components/data-engine';
import { useListQueryState } from '@/lib/data-engine/useListQueryState';
import { AttachmentGallery } from '@/components/shared/AttachmentGallery';
import { cn } from '@/lib/utils';
import { FinancePageHeader, Money, ReadOnlyNotice, StatusBadge, useFinanceAbilities } from './finance-ui';
import { LedgerSummaryCards } from './LedgerSummaryCards';
import { BookOpen, FileSpreadsheet, FileText, RotateCcw, Undo2 } from 'lucide-react';

/**
 * The Daily Ledger — the cash book.
 *
 * NOT a DataTable, which every other list in this module is. Three requirements
 * pull it out of that component, and each is load-bearing for a ledger:
 *
 *   1. A running balance only means anything in posting order, so the rows may
 *      not be re-sorted by clicking a header. DataTable sorts by default.
 *   2. The footer totals and the opening balance come from the SERVER, computed
 *      over the whole filtered set (finance_ledger_totals). DataTable's footer
 *      could only ever sum the page — a total that silently under-reports is
 *      worse than none, and this is exactly the case the SQL function exists to
 *      prevent.
 *   3. Filtering and paging happen server-side for the same reason; DataTable
 *      filters the rows it was handed, which here is one page of many.
 *
 * The layout is deliberately a paper cash book: brought-forward balance on top,
 * debit and credit in facing columns, carried-forward balance in the footer.
 */

/** A row as rendered — either a real ledger entry, or two of them merged into one. */
type DisplayEntry = LedgerEntry & { merged?: boolean };

const BRANCH_INCOME_SOURCE_TYPES = new Set(['branch_income', 'company_share', 'branch_share']);

/**
 * If someone manually re-keys money as an Income & Expense entry that was
 * ALREADY posted from a branch's daily closing — same ledger head, same
 * amount, same date — the business gets counted twice. Fixing that at the
 * source (blocking the duplicate at entry time) is the real fix and isn't
 * done here; this only hides the manual duplicate from the cash book so it
 * isn't double-visible. It does NOT remove the double-count from the
 * totals/closing balance in the footer — both entries are still real, posted
 * rows, so the footer's totalDebit/closingBalance still include the hidden
 * one. This is purely "don't show it twice on screen", not an accounting fix.
 */
function hideDuplicateManualEntries(entries: LedgerEntry[]): LedgerEntry[] {
  const key = (e: LedgerEntry) => `${e.ledgerHeadId}|${e.entryDate}|${e.debit || e.credit}`;
  const branchIncomeKeys = new Set(
    entries.filter((e) => BRANCH_INCOME_SOURCE_TYPES.has(e.sourceType)).map(key),
  );
  if (branchIncomeKeys.size === 0) return entries;

  return entries.filter((e) => e.sourceType !== 'manual' || !branchIncomeKeys.has(key(e)));
}

/**
 * Branch income approval posts a company-share entry and a branch-share
 * entry as two SEPARATE, real ledger rows (same sourceId, sourceType
 * 'company_share' / 'branch_share' — see finance-income.service.ts). This
 * merges an adjacent pair into one display row carrying the whole amount
 * collected, so the cash book reads as one economic event rather than a
 * 75/25 split. Purely cosmetic: nothing about the stored entries changes,
 * which is why a merged row cannot be adjusted (see LedgerRow/LedgerCard).
 *
 * Pairs are matched within THIS page's entries only — the two postings share
 * consecutive `seq` values, so a pair split across a page boundary is not
 * merged and simply shows as two rows, same as before this existed.
 */
function mergeBranchIncomePairs(entries: LedgerEntry[]): DisplayEntry[] {
  const consumed = new Set<string>();
  const merged: DisplayEntry[] = [];

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (consumed.has(e.id)) continue;

    const isShareLeg = e.sourceType === 'company_share' || e.sourceType === 'branch_share';
    const pair = isShareLeg
      ? entries.find(
          (o) =>
            o.id !== e.id &&
            !consumed.has(o.id) &&
            o.sourceId === e.sourceId &&
            (o.sourceType === 'company_share' || o.sourceType === 'branch_share') &&
            o.sourceType !== e.sourceType,
        )
      : undefined;

    if (pair) {
      consumed.add(e.id);
      consumed.add(pair.id);
      // The later-posted leg (branch share, always second) carries the
      // running balance that already reflects both movements.
      const [first, second] = e.seq < pair.seq ? [e, pair] : [pair, e];
      merged.push({
        ...second,
        id: `${first.id}+${second.id}`,
        voucherNo: `${first.voucherNo} / ${second.voucherNo}`,
        ledgerHeadName: 'Branch Income',
        description: `Branch income collected — ${first.branchName ?? 'branch'}`,
        debit: Math.round((first.debit + second.debit) * 100) / 100,
        credit: 0,
        merged: true,
      });
    } else {
      merged.push(e);
    }
  }

  return merged;
}

export function DailyLedgerPage() {
  const { token } = useAuth();
  const abilities = useFinanceAbilities();
  const today = businessDateStr();

  const list = useListQueryState({
    syncUrl: true,
    filterKeys: ['businessDate', 'branchId', 'ledgerHeadId', 'type', 'account', 'status', 'amount'],
    defaults: {
      filters: [
        { key: 'businessDate', op: 'gte', value: today },
        { key: 'businessDate', op: 'lte', value: today },
      ],
    },
  });
  const [adjusting, setAdjusting] = useState<LedgerEntry | null>(null);
  const [downloading, setDownloading] = useState<'pdf' | 'excel' | null>(null);

  const branchesQ = useBranches(token ?? '');
  const headsQ = useLedgerHeads(true);

  const filters = useMemo<FilterConfig[]>(
    () => [
      { key: 'businessDate', label: 'Date', type: 'date-range', placement: 'bar' },
      { key: 'branchId', label: 'Branch', type: 'select', placement: 'bar' },
      { key: 'ledgerHeadId', label: 'Ledger Head', type: 'select' },
      {
        key: 'type', label: 'Type', type: 'select',
        options: [
          { value: 'income', label: 'Income' },
          { value: 'expense', label: 'Expense' },
        ],
      },
      {
        key: 'account', label: 'Account', type: 'select',
        options: [
          { value: 'cash', label: FINANCE_ACCOUNT_LABELS.cash },
          { value: 'bank', label: FINANCE_ACCOUNT_LABELS.bank },
        ],
      },
      {
        key: 'status', label: 'Status', type: 'select',
        options: [
          { value: 'posted', label: 'Posted' },
          { value: 'locked', label: 'Locked' },
          { value: 'reversed', label: 'Reversed' },
        ],
      },
      { key: 'amount', label: 'Amount', type: 'number-range' },
    ],
    [],
  );
  const filterOptions = useMemo(
    () => ({
      branchId: (branchesQ.data ?? []).map((b) => ({ value: b.id, label: b.name })),
      ledgerHeadId: (headsQ.data ?? []).map((h) => ({ value: h.id, label: h.name })),
    }),
    [branchesQ.data, headsQ.data],
  );

  // Amounts are text in the filter controls so the fields can be cleared;
  // convert here, and drop anything that is not a finite number rather than
  // sending NaN.
  const query: LedgerFilters = useMemo(() => {
    const num = (v: unknown) => {
      const s = typeof v === 'string' ? v.trim() : '';
      return s === '' || !Number.isFinite(Number(s)) ? undefined : Number(s);
    };
    const from = list.getFilter('businessDate', 'gte')?.value as string | null | undefined;
    const to = list.getFilter('businessDate', 'lte')?.value as string | null | undefined;
    return {
      from: from || undefined,
      to: to || from || undefined,
      branchId: (list.getFilter('branchId')?.value as string | undefined) || undefined,
      ledgerHeadId: (list.getFilter('ledgerHeadId')?.value as string | undefined) || undefined,
      type: (list.getFilter('type')?.value as string | undefined) || undefined,
      account: (list.getFilter('account')?.value as string | undefined) || undefined,
      status: (list.getFilter('status')?.value as string | undefined) || undefined,
      search: list.state.search.trim() || undefined,
      minAmount: num(list.getFilter('amount', 'gte')?.value),
      maxAmount: num(list.getFilter('amount', 'lte')?.value),
      limit: list.state.pageSize,
      offset: (list.state.page - 1) * list.state.pageSize,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.state.filters, list.state.search, list.state.page, list.state.pageSize]);

  const { data, isLoading, isError, error, refetch } = useLedger(query);

  // Branch income posts as two real ledger entries (company share + branch
  // share — see finance-income.service.ts), each under its own head so the
  // split is reportable. Merged here into one row showing the whole amount
  // collected: to anyone reading the cash book "what did the branch bring in
  // today" is one number, not a 75/25 split. Display-only — the two postings
  // underneath are untouched, which is why Adjust is disabled on a merged row
  // (see the `merged` flag on DisplayEntry).
  const entries = useMemo(
    () => mergeBranchIncomePairs(hideDuplicateManualEntries(data?.entries ?? [])),
    [data?.entries],
  );
  const total = data?.total ?? 0;

  async function download(format: 'pdf' | 'excel') {
    if (!token) return;
    setDownloading(format);
    try {
      await downloadFinanceReport(
        { type: 'daily_cash_book', from: query.from, to: query.to, branchId: query.branchId },
        format,
        token,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not export the ledger');
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="space-y-6">
      <FinancePageHeader
        title="Daily Ledger"
        description="Every posted voucher, in posting order. Balances run down the page as a cash book does."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RotateCcw className="h-3.5 w-3.5" />
              Refresh
            </Button>
            <Button variant="outline" size="sm" disabled={downloading !== null} onClick={() => void download('pdf')}>
              <FileText className="h-3.5 w-3.5" />
              {downloading === 'pdf' ? 'Preparing…' : 'PDF'}
            </Button>
            <Button variant="outline" size="sm" disabled={downloading !== null} onClick={() => void download('excel')}>
              <FileSpreadsheet className="h-3.5 w-3.5" />
              {downloading === 'excel' ? 'Preparing…' : 'Excel'}
            </Button>
          </div>
        }
      />

      <ReadOnlyNotice abilities={abilities} />

      <LedgerSummaryCards date={query.to ?? today} branchId={query.branchId} />

      <FilterBar
        list={list}
        filters={filters}
        options={filterOptions}
        searchable
        searchPlaceholder="Voucher no, description, head or branch…"
        maxDate={today}
      />
      <ActiveFilters
        filters={list.activeFilters}
        configs={filters}
        options={filterOptions}
        search={list.state.search}
        onRemove={list.clearFilter}
        onClearSearch={() => list.setSearch('')}
        onClearAll={list.clearAll}
      />

      {isError ? (
        <EmptyState
          title="Could not load the ledger"
          description={error instanceof Error ? error.message : 'Please try again.'}
          action={
            <Button variant="outline" onClick={() => void refetch()}>
              Retry
            </Button>
          }
        />
      ) : (
        <>
          {/* Desktop: the cash book proper. */}
          <div className="hidden overflow-x-auto rounded-lg border bg-card md:block print-table-wrap">
            <Table>
              <TableHeader>
                <TableRow data-table-head>
                  {[
                    'Date', 'Voucher No', 'Ledger Head', 'Description', 'Photo', 'Branch',
                    'Debit', 'Credit', 'Balance', 'Status',
                  ].map((h) => (
                    <TableHead
                      key={h}
                      className={cn(
                        'text-xs font-semibold uppercase tracking-wide text-muted-foreground',
                        ['Debit', 'Credit', 'Balance'].includes(h) && 'text-right',
                      )}
                    >
                      {h}
                    </TableHead>
                  ))}
                  {abilities.adjust && <TableHead className="w-px" />}
                </TableRow>
              </TableHeader>

              <TableBody>
                {/* Brought forward — what the book held before this page's first
                    voucher. Without it the Balance column starts at a number the
                    reader cannot account for. */}
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  {/* Spans Date → Credit, so the figure below lands under Balance. */}
                  <TableCell colSpan={8} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Opening balance brought forward
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    <Money value={data?.openingBalance} />
                  </TableCell>
                  <TableCell colSpan={abilities.adjust ? 2 : 1} />
                </TableRow>

                {isLoading ? (
                  Array.from({ length: 8 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: abilities.adjust ? 11 : 10 }).map((__, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={abilities.adjust ? 11 : 10} className="p-0">
                      <EmptyState
                        icon={BookOpen}
                        title="No vouchers for this selection"
                        description="Approved income and expenses post here automatically."
                        className="border-0"
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  entries.map((e) => <LedgerRow key={e.id} entry={e} canAdjust={abilities.adjust} onAdjust={setAdjusting} />)
                )}
              </TableBody>

              {/* Totals over the WHOLE filtered set, not this page — see the
                  header note. Rendered as a body row rather than <tfoot> so it
                  sits directly under the last voucher at any page length. */}
              <TableBody>
                <TableRow className="border-t-2 bg-muted/40 font-semibold hover:bg-muted/40">
                  {/* Spans Date → Branch, so the three money cells below line up
                      with Debit / Credit / Balance. */}
                  <TableCell colSpan={6} className="text-xs uppercase tracking-wide text-muted-foreground">
                    Totals · {total} {total === 1 ? 'voucher' : 'vouchers'} matching the filters
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={data?.totalDebit} className="text-emerald-600 dark:text-emerald-400" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={data?.totalCredit} className="text-red-600 dark:text-red-400" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Money value={data?.closingBalance} />
                  </TableCell>
                  <TableCell colSpan={abilities.adjust ? 2 : 1} className="text-xs font-normal text-muted-foreground">
                    Carried forward
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          {/* Phone: one card per voucher. A ten-column ledger cannot be read at
              360px, and horizontal scrolling hides the balance — the one figure
              a person checks on their phone. */}
          <div className="space-y-3 md:hidden">
            <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Opening balance</span>
                <Money value={data?.openingBalance} className="font-semibold" />
              </div>
            </div>

            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-lg" />)
            ) : entries.length === 0 ? (
              <EmptyState icon={BookOpen} title="No vouchers for this selection" />
            ) : (
              entries.map((e) => <LedgerCard key={e.id} entry={e} canAdjust={abilities.adjust} onAdjust={setAdjusting} />)
            )}

            <div className="space-y-1 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm font-medium">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total debit</span>
                <Money value={data?.totalDebit} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total credit</span>
                <Money value={data?.totalCredit} className="text-red-600 dark:text-red-400" />
              </div>
              <div className="flex items-center justify-between border-t pt-1.5 font-semibold">
                <span>Closing balance</span>
                <Money value={data?.closingBalance} />
              </div>
            </div>
          </div>

          <Pagination
            page={list.state.page}
            pageSize={list.state.pageSize}
            total={total}
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
            loading={isLoading}
          />
        </>
      )}

      <AdjustDialog entry={adjusting} onClose={() => setAdjusting(null)} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function LedgerRow({
  entry,
  canAdjust,
  onAdjust,
}: {
  entry: DisplayEntry;
  canAdjust: boolean;
  onAdjust: (entry: LedgerEntry) => void;
}) {
  const reversed = entry.status === 'reversed';

  return (
    <TableRow className={cn('hover:bg-muted/30', reversed && 'text-muted-foreground line-through decoration-1')}>
      <TableCell className="whitespace-nowrap text-sm">{entry.entryDate}</TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs">{entry.voucherNo}</TableCell>
      <TableCell className="text-sm font-medium">{entry.ledgerHeadName}</TableCell>
      <TableCell className="max-w-[22rem] text-sm">{entry.description}</TableCell>
      {/* The receipt behind the voucher, resolved server-side from
          (sourceType, sourceId) — see LedgerEntry.attachments. Empty for
          opening balances, reversals and anything not keyed in by hand. */}
      <TableCell>
        <AttachmentGallery
          attachments={entry.attachments}
          size="xs"
          title={`${entry.voucherNo} photo`}
        />
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">{entry.branchName ?? '—'}</TableCell>
      <TableCell className="text-right">
        <Money value={entry.debit} blankZero className="text-emerald-600 dark:text-emerald-400" />
      </TableCell>
      <TableCell className="text-right">
        <Money value={entry.credit} blankZero className="text-red-600 dark:text-red-400" />
      </TableCell>
      <TableCell className="text-right font-medium">
        <Money value={entry.balance} />
      </TableCell>
      <TableCell>
        <StatusBadge status={entry.status} />
      </TableCell>
      {canAdjust && (
        <TableCell>
          {/* A reversing entry cannot itself be reversed, and neither can one
              already reversed — the SQL refuses both, so the button is not
              offered. A merged branch-income row is two real entries at once,
              so it has no single id to adjust — see mergeBranchIncomePairs. */}
          {!reversed && entry.reversesEntryId === null && !entry.merged && (
            <Button variant="ghost" size="icon-sm" aria-label="Adjust or reverse" onClick={() => onAdjust(entry)}>
              <Undo2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </TableCell>
      )}
    </TableRow>
  );
}

function LedgerCard({
  entry,
  canAdjust,
  onAdjust,
}: {
  entry: DisplayEntry;
  canAdjust: boolean;
  onAdjust: (entry: LedgerEntry) => void;
}) {
  const reversed = entry.status === 'reversed';
  const isDebit = entry.debit > 0;

  return (
    <div className={cn('rounded-lg border bg-card p-3', reversed && 'opacity-60')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{entry.ledgerHeadName}</p>
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-mono">{entry.voucherNo}</span> · {entry.entryDate}
          </p>
        </div>
        <StatusBadge status={entry.status} />
      </div>

      <p className="mt-2 text-sm">{entry.description}</p>

      <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-muted-foreground">{isDebit ? 'Debit' : 'Credit'}</dt>
          <dd className="font-medium">
            <Money
              value={isDebit ? entry.debit : entry.credit}
              className={isDebit ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}
            />
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-muted-foreground">Balance</dt>
          <dd className="font-medium">
            <Money value={entry.balance} />
          </dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-muted-foreground">Branch</dt>
          <dd className="truncate font-medium">{entry.branchName ?? '—'}</dd>
        </div>
      </dl>

      <AttachmentGallery
        attachments={entry.attachments}
        size="xs"
        title={`${entry.voucherNo} photo`}
        className="mt-2.5"
      />

      {canAdjust && !reversed && entry.reversesEntryId === null && !entry.merged && (
        <div className="mt-3 border-t pt-2.5">
          <Button variant="outline" size="sm" className="min-h-11 w-full" onClick={() => onAdjust(entry)}>
            <Undo2 className="h-3.5 w-3.5" />
            Adjust or reverse
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Reverse a posted voucher, optionally re-posting it at a corrected figure.
 *
 * There is no "edit" here and there never will be. The dialog says so in as many
 * words, because a Finance Admin arriving with a typo to fix needs to understand
 * that BOTH entries will remain visible before they press the button — not
 * afterwards, when the extra row appears in the book.
 */
function AdjustDialog({ entry, onClose }: { entry: LedgerEntry | null; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [correct, setCorrect] = useState(false);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const mut = useFinanceMutation();

  function close() {
    setReason('');
    setCorrect(false);
    setAmount('');
    setDescription('');
    onClose();
  }

  async function submit() {
    if (!entry) return;
    if (reason.trim().length < 5) {
      toast.error('Explain why this entry is being adjusted (at least 5 characters)');
      return;
    }

    const correctedAmount = Number(amount);
    if (correct && (!Number.isFinite(correctedAmount) || correctedAmount <= 0)) {
      toast.error('Enter the corrected amount');
      return;
    }

    try {
      await mut.mutateAsync({
        path: `/api/finance/ledger/${entry.id}/adjust`,
        body: {
          reason: reason.trim(),
          ...(correct ? { correctedAmount } : {}),
          ...(correct && description.trim() ? { correctedDescription: description.trim() } : {}),
        },
      });
      toast.success(correct ? 'Reversed and re-posted at the corrected amount' : 'Reversing entry posted');
      close();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not adjust this entry');
    }
  }

  const original = entry ? (entry.debit > 0 ? entry.debit : entry.credit) : 0;

  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>Adjust {entry?.voucherNo}</DialogTitle>
          <DialogDescription>
            A posted entry is never edited. This posts a reversing voucher that cancels it, and — if you give a
            corrected amount — a second voucher at the right figure. Both stay in the book.
          </DialogDescription>
        </DialogHeader>

        {entry && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="font-medium">{entry.ledgerHeadName}</p>
              <p className="text-muted-foreground">{entry.description}</p>
              <p className="mt-1.5">
                <span className="text-muted-foreground">Original amount: </span>
                <Money value={original} className="font-semibold" />
                <span className="ml-2 text-xs text-muted-foreground">
                  ({entry.debit > 0 ? 'debit' : 'credit'} · {entry.entryDate})
                </span>
              </p>
            </div>

            <div className="space-y-1">
              <Label>Reason</Label>
              <Textarea
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Amount was keyed as 5,000 instead of 500"
              />
            </div>

            <label className="flex items-start gap-2.5 rounded-lg border p-3 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={correct}
                onChange={(e) => setCorrect(e.target.checked)}
              />
              <span>
                <span className="font-medium">Re-post at a corrected amount</span>
                <span className="block text-xs text-muted-foreground">
                  Leave unticked for a straight reversal that cancels the voucher entirely.
                </span>
              </span>
            </label>

            {correct && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Corrected amount</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Corrected description (optional)</Label>
                  <Input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={entry.description}
                  />
                </div>
              </div>
            )}

            {/* The correction posts on TODAY's business date, not the original's.
                Saying so here prevents the "why is my fix on the wrong day"
                question — a closed day cannot be posted into by design. */}
            <p className="text-xs text-muted-foreground">
              The new vouchers post to the current open business date, not {entry.entryDate}. A closed day keeps the
              closing balance that was signed off.
            </p>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button disabled={mut.isPending} onClick={() => void submit()}>
            {mut.isPending ? 'Posting…' : correct ? 'Reverse and re-post' : 'Post reversal'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
