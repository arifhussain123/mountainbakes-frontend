'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  businessDateStr,
  FINANCE_PAYMENT_METHOD_LABELS,
  FINANCE_PAYMENT_METHODS,
  LOAN_ENTRY_TYPE_LABELS,
  LOAN_ENTRY_TYPES,
  type FilterConfig,
  type LoanEntry,
} from '@mb/shared';
import { ArrowDownRight, ArrowUpRight, BookOpen, Eye, FileSpreadsheet, FileText, Plus, RotateCcw, Scale, UserRound, X } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useBranches } from '@/lib/queries';
import { downloadFinanceReport, useLedgerHeads, useLoanClients, useLoanLedger, type LoanLedgerFilters } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyState } from '@/components/shared/EmptyState';
import { Pagination } from '@/components/data-engine/Pagination';
import { FilterBar, ActiveFilters } from '@/components/data-engine';
import { useListQueryState } from '@/lib/data-engine/useListQueryState';
import { AttachmentGallery } from '@/components/shared/AttachmentGallery';
import { cn } from '@/lib/utils';
import { FinancePageHeader, Money, ReadOnlyNotice, StatusBadge, useFinanceAbilities } from '../finance-ui';
import { SummaryStat } from '../LedgerSummaryCards';
import { LoanClientPicker } from './LoanClientPicker';
import { LoanEntryDialog } from './LoanEntryDialog';
import { LoanEntryDetailsDialog } from './LoanEntryDetailsDialog';

/**
 * The Refundable & Receivable Loans Ledger — the loan register laid out as the
 * Daily Ledger lays out the cash book: brought-forward balance on top, debit
 * and credit in facing columns, a running balance down the page and the
 * carried-forward balance in the footer.
 *
 * Like the Daily Ledger it is NOT a DataTable: a running balance only means
 * anything in posting order, so rows are never re-sorted by a header; and the
 * opening balance and totals come from the server over the whole filtered set
 * (finance_loan_ledger), never summed from one page.
 *
 * Loans debit (green), payments credit (red). Nothing here is in the General
 * Ledger.
 */
export function LoanLedgerTab() {
  const { token } = useAuth();
  const abilities = useFinanceAbilities();
  const today = businessDateStr();
  const monthStart = `${today.slice(0, 7)}-01`;

  const list = useListQueryState({
    syncUrl: true,
    filterKeys: ['businessDate', 'clientId', 'branchId', 'entryType', 'ledgerHeadId', 'paymentMethod', 'status'],
    defaults: {
      filters: [
        { key: 'businessDate', op: 'gte', value: monthStart },
        { key: 'businessDate', op: 'lte', value: today },
      ],
    },
  });
  const [creating, setCreating] = useState(false);
  const [viewing, setViewing] = useState<LoanEntry | null>(null);
  const [downloading, setDownloading] = useState<'pdf' | 'excel' | null>(null);

  const branchesQ = useBranches(token ?? '');
  const headsQ = useLedgerHeads(true);
  const clientsQ = useLoanClients();

  const filters = useMemo<FilterConfig[]>(
    () => [
      { key: 'businessDate', label: 'Date', type: 'date-range', placement: 'bar' },
      { key: 'clientId', label: 'Client', type: 'select' },
      { key: 'branchId', label: 'Branch', type: 'select' },
      {
        key: 'entryType', label: 'Entry Type', type: 'select',
        options: LOAN_ENTRY_TYPES.map((t) => ({ value: t, label: LOAN_ENTRY_TYPE_LABELS[t] })),
      },
      { key: 'ledgerHeadId', label: 'Ledger Head', type: 'select' },
      {
        key: 'paymentMethod', label: 'Payment Method', type: 'select',
        options: FINANCE_PAYMENT_METHODS.map((m) => ({ value: m, label: FINANCE_PAYMENT_METHOD_LABELS[m] ?? m })),
      },
      {
        key: 'status', label: 'Status', type: 'select',
        options: [
          { value: 'posted', label: 'Posted' },
          { value: 'cancelled', label: 'Cancelled' },
        ],
      },
    ],
    [],
  );
  const filterOptions = useMemo(
    () => ({
      clientId: (clientsQ.data ?? []).map((c) => ({ value: c.id, label: `${c.clientName} (${c.clientCode})` })),
      branchId: (branchesQ.data ?? []).map((b) => ({ value: b.id, label: b.name })),
      ledgerHeadId: (headsQ.data ?? []).map((h) => ({ value: h.id, label: h.name })),
    }),
    [clientsQ.data, branchesQ.data, headsQ.data],
  );

  const query: LoanLedgerFilters = useMemo(() => {
    const pick = (key: string) => (list.getFilter(key)?.value as string | undefined) || undefined;
    const from = (list.getFilter('businessDate', 'gte')?.value as string | null | undefined) || monthStart;
    const to = (list.getFilter('businessDate', 'lte')?.value as string | null | undefined) || today;
    return {
      from: from > to ? to : from,
      to,
      clientId: pick('clientId'),
      branchId: pick('branchId'),
      entryType: pick('entryType'),
      ledgerHeadId: pick('ledgerHeadId'),
      paymentMethod: pick('paymentMethod'),
      status: pick('status'),
      search: list.state.search.trim() || undefined,
      limit: list.state.pageSize,
      offset: (list.state.page - 1) * list.state.pageSize,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.state.filters, list.state.search, list.state.page, list.state.pageSize]);

  const { data, isLoading, isError, error, refetch, isFetching } = useLoanLedger(query);
  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;
  const selectedClient = (clientsQ.data ?? []).find((c) => c.id === query.clientId) ?? null;
  // With one client chosen every row is theirs, so the column is left out (Box 1 names them).
  const showClient = !query.clientId;
  const columnCount = showClient ? 12 : 11;

  function setClient(id: string | null) {
    if (id) list.setFilter('clientId', 'eq', id);
    else list.clearFilter('clientId');
  }

  async function download(format: 'pdf' | 'excel') {
    if (!token) return;
    setDownloading(format);
    try {
      await downloadFinanceReport(
        {
          type: 'loan_ledger',
          from: query.from,
          to: query.to,
          clientId: query.clientId,
          branchId: query.branchId,
          loanEntryType: query.entryType,
          ledgerHeadId: query.ledgerHeadId,
          paymentMethod: query.paymentMethod,
          loanStatus: query.status,
          search: query.search,
        },
        format,
        token,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not export the loan ledger');
    } finally {
      setDownloading(null);
    }
  }

  return (
    <div className="space-y-6">
      <FinancePageHeader
        title="Refundable & Receivable Loans Ledger"
        description="Loans and payments per client, in posting order. A separate register — never part of General Ledger income or expense."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={isFetching} onClick={() => void refetch()}>
              <RotateCcw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} />
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
            {abilities.create && (
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus className="h-3.5 w-3.5" />
                New Entry
              </Button>
            )}
          </div>
        }
      />

      <ReadOnlyNotice abilities={abilities} />

      {/* Client summary — the four boxes. All four follow the client, date and
          other filters, and come from the same server totals as the table. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
        <Card>
          <CardContent className="space-y-2 p-5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-muted-foreground">Name of Client</p>
              <div className="rounded-xl bg-primary/10 p-2 text-primary">
                <UserRound className="h-4 w-4" />
              </div>
            </div>
            <LoanClientPicker
              value={query.clientId ?? null}
              onChange={(c) => setClient(c?.id ?? null)}
              placeholder="All clients"
            />
            {selectedClient ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setClient(null)}
              >
                <X className="h-3 w-3" /> Show all clients
              </button>
            ) : (
              <p className="text-xs text-muted-foreground">All clients</p>
            )}
          </CardContent>
        </Card>
        <SummaryStat label="Total Loan Payment" value={data?.totalDebit} icon={ArrowUpRight} tone="emerald" loading={isLoading} />
        <SummaryStat label="Loan Paid" value={data?.totalCredit} icon={ArrowDownRight} tone="red" loading={isLoading} />
        <div className="space-y-1">
          <SummaryStat label="Balance" value={data?.closingBalance} icon={Scale} tone="primary" loading={isLoading} />
          {!!data?.openingBalance && (
            <p className="px-1 text-xs text-muted-foreground">
              Includes <Money value={data.openingBalance} /> brought forward from before {query.from}.
            </p>
          )}
        </div>
      </div>

      <FilterBar
        list={list}
        filters={filters}
        options={filterOptions}
        searchable
        searchPlaceholder="Voucher no, client, description, head or branch…"
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
          title="Could not load the loan ledger"
          description={error instanceof Error ? error.message : 'Please try again.'}
          action={
            <Button variant="outline" onClick={() => void refetch()}>
              Retry
            </Button>
          }
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow data-table-head>
                  {['Date', 'Voucher No', 'Ledger Head', 'Description', 'Photo', ...(showClient ? ['Client'] : []), 'Branch', 'Debit', 'Credit', 'Balance', 'Status'].map((h) => (
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
                  <TableHead className="w-px text-xs font-semibold uppercase tracking-wide text-muted-foreground">Action</TableHead>
                </TableRow>
              </TableHeader>

              <TableBody>
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  {/* Spans Date → Credit, so the figure lands under Balance. */}
                  <TableCell colSpan={showClient ? 9 : 8} className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Opening balance brought forward
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    <Money value={data?.openingBalance} />
                  </TableCell>
                  <TableCell colSpan={2} />
                </TableRow>

                {isLoading ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: columnCount }).map((__, j) => (
                        <TableCell key={j}>
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : entries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={columnCount} className="p-0">
                      <EmptyState
                        icon={BookOpen}
                        title="No loan entries for this selection"
                        description="Use + New Entry to record a loan or a payment."
                        className="border-0"
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  entries.map((e) => <LoanRow key={e.id} entry={e} showClient={showClient} onView={() => setViewing(e)} />)
                )}
              </TableBody>

              <TableBody>
                <TableRow className="border-t-2 bg-muted/40 font-semibold hover:bg-muted/40">
                  <TableCell colSpan={showClient ? 7 : 6} className="text-xs uppercase tracking-wide text-muted-foreground">
                    Totals · {total} {total === 1 ? 'entry' : 'entries'} matching the filters
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
                  <TableCell colSpan={2} className="text-xs font-normal text-muted-foreground">
                    Carried forward
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          {/* Phone: one card per entry — the balance is the figure a person checks. */}
          <div className="space-y-3 md:hidden">
            <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Opening balance</span>
              <Money value={data?.openingBalance} className="font-semibold" />
            </div>

            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-lg" />)
            ) : entries.length === 0 ? (
              <EmptyState icon={BookOpen} title="No loan entries for this selection" />
            ) : (
              entries.map((e) => <LoanCard key={e.id} entry={e} onView={() => setViewing(e)} />)
            )}

            <div className="space-y-1 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm font-medium">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Total loan payment</span>
                <Money value={data?.totalDebit} className="text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Loan paid</span>
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

      <LoanEntryDialog open={creating} onOpenChange={setCreating} defaultClientId={query.clientId ?? null} />
      <LoanEntryDetailsDialog entry={viewing} onClose={() => setViewing(null)} canCancel={abilities.adjust} />
    </div>
  );
}

function LoanRow({ entry, showClient, onView }: { entry: LoanEntry; showClient: boolean; onView: () => void }) {
  const cancelled = entry.status === 'cancelled';
  return (
    <TableRow className={cn('hover:bg-muted/30', cancelled && 'text-muted-foreground line-through decoration-1')}>
      <TableCell className="whitespace-nowrap text-sm">{entry.businessDate}</TableCell>
      <TableCell className="whitespace-nowrap font-mono text-xs">{entry.voucherNo}</TableCell>
      <TableCell className="text-sm">
        <span className="font-medium">{entry.ledgerHeadName}</span>
        <span className="block text-xs text-muted-foreground">{LOAN_ENTRY_TYPE_LABELS[entry.entryType]}</span>
      </TableCell>
      {/* Two lines at most; the full text is in View. */}
      <TableCell className="min-w-[10rem] max-w-[16rem] text-sm">
        <span className="line-clamp-2" title={entry.description}>
          {entry.description}
        </span>
      </TableCell>
      <TableCell>
        <AttachmentGallery attachments={entry.attachments} size="xs" title={`${entry.voucherNo} photo`} />
      </TableCell>
      {showClient && (
        <TableCell className="text-sm">
          <span className="font-medium">{entry.clientName}</span>
          <span className="block font-mono text-xs text-muted-foreground">{entry.clientCode}</span>
        </TableCell>
      )}
      <TableCell className="text-sm text-muted-foreground">{entry.branchName ?? '—'}</TableCell>
      <TableCell className="whitespace-nowrap text-right">
        <Money value={cancelled ? 0 : entry.debit} blankZero className="text-emerald-600 dark:text-emerald-400" />
      </TableCell>
      <TableCell className="whitespace-nowrap text-right">
        <Money value={cancelled ? 0 : entry.credit} blankZero className="text-red-600 dark:text-red-400" />
      </TableCell>
      <TableCell className="whitespace-nowrap text-right font-medium">
        <Money value={entry.balance} />
      </TableCell>
      <TableCell>
        <StatusBadge status={entry.status} />
      </TableCell>
      <TableCell>
        <Button variant="ghost" size="icon-sm" aria-label={`View ${entry.voucherNo}`} title="View" onClick={onView}>
          <Eye className="h-3.5 w-3.5" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function LoanCard({ entry, onView }: { entry: LoanEntry; onView: () => void }) {
  const cancelled = entry.status === 'cancelled';
  const isDebit = entry.debit > 0;
  return (
    <div className={cn('rounded-lg border bg-card p-3', cancelled && 'opacity-60')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{entry.clientName}</p>
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-mono">{entry.voucherNo}</span> · {entry.businessDate} · {LOAN_ENTRY_TYPE_LABELS[entry.entryType]}
          </p>
        </div>
        <StatusBadge status={entry.status} />
      </div>
      <p className={cn('mt-2 line-clamp-3 text-sm', cancelled && 'line-through')}>{entry.description}</p>
      <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-muted-foreground">{isDebit ? 'Debit' : 'Credit'}</dt>
          <dd className="font-medium">
            <Money
              value={cancelled ? 0 : isDebit ? entry.debit : entry.credit}
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
          <dt className="text-muted-foreground">Head</dt>
          <dd className="truncate font-medium">{entry.ledgerHeadName}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-2">
          <dt className="text-muted-foreground">Branch</dt>
          <dd className="truncate font-medium">{entry.branchName ?? '—'}</dd>
        </div>
      </dl>
      <div className="mt-3 border-t pt-2.5">
        <Button variant="outline" size="sm" className="min-h-11 w-full" onClick={onView}>
          <Eye className="h-3.5 w-3.5" />
          View
        </Button>
      </div>
    </div>
  );
}
