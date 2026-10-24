'use client';

import { useMemo, useState } from 'react';
import { createColumnHelper, type SortingState } from '@tanstack/react-table';
import { toast } from 'sonner';
import { format, parseISO } from 'date-fns';
import { balanceStanding, businessDateStr, type DemandRecordRow, type PageSize } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranches } from '@/lib/queries';
import {
  fetchAllDemandRecordRows,
  useDemandRecord,
  useDemandRecordSettings,
  useFinanceMutation,
  type DemandRecordFilters,
} from '@/lib/finance';
import { DataTable } from '@/components/shared/DataTable';
import { Pagination } from '@/components/data-engine/Pagination';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatDate } from '@/utils/date';
import { saveBlob } from '@/utils/saveBlob';
import { cn } from '@/lib/utils';
import { Download, Eye, NotebookPen, RotateCcw, ScrollText } from 'lucide-react';
import { FinancePageHeader, Money, ReadOnlyNotice, useFinanceAbilities, useMoney } from './finance-ui';
import { DateFilter, FilterBar, FilterField } from './finance-actions';
import { DemandRecordDetailDialog } from './DemandRecordDetailDialog';
import { DemandRecordEntriesDialog } from './DemandRecordEntriesDialog';

/**
 * Finance → Demand Record: what each branch owes the company, demand by demand,
 * with the balance carried from one demand to the next.
 *
 *   G. Total      = Delivered − Returns − Discount
 *   Company Share = G. Total × the demand's frozen share %
 *   Closing       = Previous + Company Share + Adjustments − Share Received
 *
 * Every figure is computed by the API from the records themselves (see
 * shared/utils/branch-account.ts); nothing here is typed in or summed on the
 * client except the export. Share Received is approved cash transfers. Actual
 * Sales and the share on them are shown for comparison only.
 *
 * A branch's last row stays open until its next demand: returns and deposits
 * made after it still land there. That is what makes one month's closing equal
 * the next month's opening.
 */

const col = createColumnHelper<DemandRecordRow>();

/** A header over two lines — the table has eleven figures to fit on a laptop. */
const twoLine = (a: string, b: string) => function TwoLineHeader() {
  return <span className="inline-block leading-tight">{a}<br />{b}</span>;
};
const ALL = 'all';

function shortBranch(name: string) {
  return name.replace(/\s+branch$/i, '');
}

/** Closing balance with what it means: owed, settled, or paid ahead (a credit). */
function BalanceCell({ value, strong, align = 'end', noSymbol }: { value: number; strong?: boolean; align?: 'start' | 'end'; noSymbol?: boolean }) {
  const standing = balanceStanding(value);
  return (
    <span className={cn('inline-flex flex-col leading-tight', align === 'end' ? 'items-end' : 'items-start', strong && 'font-semibold')}>
      <Money value={standing === 'credit' ? -value : value} noSymbol={noSymbol} className={cn(standing === 'credit' && 'text-emerald-700 dark:text-emerald-400')} />
      {standing !== 'owed' && (
        <span className="text-[11px] font-normal text-muted-foreground">{standing === 'credit' ? 'credit' : 'settled'}</span>
      )}
    </span>
  );
}

export function DemandRecordPage() {
  const { token } = useAuth();
  const abilities = useFinanceAbilities();
  const settingsQ = useDemandRecordSettings();
  const startDate = settingsQ.data?.startDate ?? null;
  const branchesQ = useBranches(token);
  const today = businessDateStr();

  const [branchId, setBranchId] = useState(ALL);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [sorting, setSorting] = useState<SortingState>([{ id: 'date', desc: true }]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<PageSize>(50 as PageSize);
  const [detail, setDetail] = useState<DemandRecordRow | null>(null);
  const [entriesOpen, setEntriesOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const filters: DemandRecordFilters = {
    branchId: branchId === ALL ? undefined : branchId,
    from: from || undefined,
    to: to || undefined,
    search: search.trim() || undefined,
    sortDir: sorting[0]?.desc === false ? 'asc' : 'desc',
    page,
    pageSize,
  };
  const recordQ = useDemandRecord(filters, { enabled: Boolean(startDate) });
  const data = recordQ.data;
  const rows = data?.rows ?? [];

  const branchItems = useMemo(
    () => [
      { value: ALL, label: 'All branches' },
      ...(branchesQ.data ?? []).map((b) => ({ value: b.id, label: shortBranch(b.name) })),
    ],
    [branchesQ.data],
  );
  const resetPage = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };

  const columns = [
    col.display({
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => (
        <Button variant="ghost" size="icon-sm" aria-label="View details" title="View details" onClick={() => setDetail(row.original)}>
          <Eye className="h-4 w-4" />
        </Button>
      ),
    }),
    col.accessor('at', {
      id: 'date',
      header: 'Date',
      // Day and month over the year: a narrower column leaves room for the balances.
      cell: ({ row }) => {
        const d = parseISO(row.original.businessDate);
        return (
          <span className="inline-flex flex-col leading-tight">
            <span className="whitespace-nowrap">{format(d, 'dd MMM')}</span>
            <span className="text-[11px] text-muted-foreground">{format(d, 'yyyy')}</span>
          </span>
        );
      },
    }),
    col.accessor((r) => r.demandNumber ?? 'Opening', {
      id: 'demand',
      header: twoLine('Demand', 'Number'),
      enableSorting: false,
      meta: { mobile: 'title' },
      cell: ({ row }) =>
        row.original.orderId ? (
          <span className="font-mono font-medium">{row.original.demandNumber}</span>
        ) : (
          <span className="font-medium text-muted-foreground">Opening</span>
        ),
    }),
    col.accessor('branchName', {
      header: 'Branch',
      enableSorting: false,
      meta: { mobile: 'subtitle' },
      cell: (i) => <span className="font-medium">{shortBranch(i.getValue())}</span>,
    }),
    col.accessor('delivered', {
      header: 'Delivered',
      enableSorting: false,
      meta: { align: 'right' },
      cell: (i) => <Money value={i.getValue()} blankZero noSymbol />,
    }),
    col.accessor('returns', {
      header: 'Return',
      enableSorting: false,
      meta: { align: 'right' },
      cell: (i) => <Money value={i.getValue()} blankZero noSymbol />,
    }),
    col.accessor('discount', {
      header: 'Discount',
      enableSorting: false,
      meta: { align: 'right' },
      cell: (i) => <Money value={i.getValue()} blankZero noSymbol />,
    }),
    col.accessor('gTotal', {
      header: 'G. Total',
      enableSorting: false,
      meta: { align: 'right' },
      cell: (i) => <Money value={i.getValue()} className="font-medium" noSymbol />,
    }),
    col.accessor('companyShare', {
      header: twoLine('Company', 'Share'),
      enableSorting: false,
      meta: { align: 'right', mobileLabel: 'Company Share' },
      cell: ({ row }) => (
        <span className="inline-flex flex-col items-end leading-tight">
          <Money value={row.original.companyShare} className="font-medium" noSymbol />
          <span
            className="text-[11px] text-muted-foreground"
            title={row.original.pctFrozen ? 'Frozen when delivered' : "Today's % — nothing was frozen for this row"}
          >
            at {row.original.sharePct}%{!row.original.pctFrozen && <span className="text-amber-600">*</span>}
          </span>
        </span>
      ),
    }),
    col.accessor('received', {
      header: twoLine('Share', 'Received'),
      enableSorting: false,
      meta: { align: 'right', mobileLabel: 'Received' },
      cell: (i) => <Money value={i.getValue()} blankZero noSymbol className="text-emerald-700 dark:text-emerald-400" />,
    }),
    col.accessor('adjustments', {
      header: twoLine('Adjust-', 'ments'),
      enableSorting: false,
      meta: { align: 'right', mobileLabel: 'Adjustments' },
      cell: (i) => <Money value={i.getValue()} blankZero noSymbol />,
    }),
    col.accessor('previousBalance', {
      header: twoLine('Previous', 'Balance'),
      enableSorting: false,
      meta: { align: 'right', mobileLabel: 'Previous' },
      cell: (i) => <BalanceCell value={i.getValue()} noSymbol />,
    }),
    col.accessor('closingBalance', {
      header: twoLine('Closing', 'Balance'),
      enableSorting: false,
      meta: { align: 'right', mobile: 'badge' },
      cell: ({ row }) => (
        <span className="inline-flex flex-col items-end gap-0.5">
          <BalanceCell value={row.original.closingBalance} strong noSymbol />
          {row.original.open && (
            <Badge variant="secondary" className="h-4 bg-amber-100 px-1.5 text-[10px] text-amber-800 dark:bg-amber-950 dark:text-amber-300" title="No later demand yet: returns and deposits can still land here">
              Open
            </Badge>
          )}
        </span>
      ),
    }),
  ].filter((c) => {
    // A column of dashes only costs width: Branch when one branch is chosen,
    // Adjustments when nothing on the page has one.
    const key = c.id ?? ('accessorKey' in c ? String(c.accessorKey) : '');
    if (key === 'branchName') return branchId === ALL;
    if (key === 'adjustments') return rows.some((r) => r.adjustments !== 0);
    return true;
  });

  async function exportCsv() {
    if (!data) return;
    setExporting(true);
    try {
      const { page: _p, pageSize: _s, ...rest } = filters;
      const all = await fetchAllDemandRecordRows(rest, token);
      const header = [
        'Date', 'Demand Number', 'Branch', 'Delivered', 'Actual Sales', 'Return', 'Discount', 'G. Total',
        'Share %', 'Share % Frozen', 'Company Share', 'Share on Sales', 'Share Received', 'Adjustments',
        'Previous Balance', 'Closing Balance', 'Status',
      ];
      const lines = all.rows.map((r) => [
        r.businessDate, r.demandNumber ?? 'Opening', r.branchName, r.delivered, r.sales, r.returns, r.discount,
        r.gTotal, r.sharePct, r.pctFrozen ? 'yes' : 'no', r.companyShare, r.shareOnSales, r.received,
        r.adjustments, r.previousBalance, r.closingBalance, r.status ?? '',
      ]);
      const t = all.totals;
      lines.push([]);
      lines.push(['TOTAL', '', '', t.delivered, t.sales, t.returns, t.discount, t.gTotal, '', '', t.companyShare,
        t.shareOnSales, t.received, t.adjustments, t.openingBalance, t.closingBalance, '']);
      lines.push([`Opening and closing balances are per branch at the start and end of ${all.from} to ${all.to}, not sums of the rows.`]);
      const csv = [header, ...lines]
        .map((row) => row.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\n');
      const who = branchId === ALL ? 'all-branches' : shortBranch(branchItems.find((b) => b.value === branchId)?.label ?? 'branch').toLowerCase().replace(/[^a-z0-9]+/g, '-');
      saveBlob(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }), `demand-record-${who}-${all.from}_to_${all.to}.csv`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Export failed');
    } finally {
      setExporting(false);
    }
  }

  if (settingsQ.isLoading) {
    return <div className="h-40 animate-pulse rounded-lg bg-muted" />;
  }
  if (settingsQ.isError) {
    return (
      <EmptyState
        title="Could not load the Demand Record"
        description={settingsQ.error instanceof Error ? settingsQ.error.message : 'Please try again.'}
        action={<Button variant="outline" onClick={() => void settingsQ.refetch()}>Retry</Button>}
      />
    );
  }
  if (!startDate) return <GoLive canConfigure={abilities.configure} />;

  const t = data?.totals;
  return (
    <div className="space-y-6">
      <FinancePageHeader
        title="Demand Record"
        description={`What each branch owes the company, demand by demand, carried forward. Counting from ${formatDate(startDate)}; everything before is in each branch's opening balance.`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setEntriesOpen(true)}>
              <NotebookPen className="h-3.5 w-3.5" /> Opening & adjustments
            </Button>
            <Button variant="outline" size="sm" disabled={!data || exporting} onClick={() => void exportCsv()}>
              <Download className="h-3.5 w-3.5" /> {exporting ? 'Exporting…' : 'Export'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void recordQ.refetch()}>
              <RotateCcw className="h-3.5 w-3.5" /> Refresh
            </Button>
          </>
        }
      />

      <ReadOnlyNotice abilities={abilities} />

      <FilterBar>
        <FilterField label="Branch" className="min-w-[12rem] flex-1 space-y-1 sm:flex-none">
          <Select items={branchItems} value={branchId} onValueChange={(v) => v && resetPage(setBranchId)(v as string)}>
            <SelectTrigger className="h-11 w-full md:h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {branchItems.map((b) => <SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </FilterField>
        <FilterField label="From">
          <DateFilter value={from} max={to || today} onChange={resetPage(setFrom)} />
        </FilterField>
        <FilterField label="To">
          <DateFilter value={to} max={today} onChange={resetPage(setTo)} />
        </FilterField>
        <FilterField label="Search" className="min-w-[12rem] flex-1 space-y-1">
          <Input
            value={search}
            onChange={(e) => resetPage(setSearch)(e.target.value)}
            placeholder="Demand number or branch…"
            className="h-11 md:h-9"
          />
        </FilterField>
        {(from || to || search || branchId !== ALL) && (
          <Button variant="ghost" size="sm" className="h-11 md:h-9" onClick={() => { setFrom(''); setTo(''); setSearch(''); setBranchId(ALL); setPage(1); }}>
            Clear
          </Button>
        )}
      </FilterBar>

      {recordQ.isError ? (
        <EmptyState
          title="Could not load the Demand Record"
          description={recordQ.error instanceof Error ? recordQ.error.message : 'Please try again.'}
          action={<Button variant="outline" onClick={() => void recordQ.refetch()}>Retry</Button>}
        />
      ) : (
        <>
          <section className="space-y-3">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Figure label="Opening Balance" hint={data ? `on ${formatDate(data.from)}` : undefined} loading={!t} value={t && <BalanceCell value={t.openingBalance} align="start" />} />
              <Figure label="Company Share" hint="this period" loading={!t} value={t && <Money value={t.companyShare} />} />
              <Figure label="Share Received" hint="approved cash transfers" loading={!t} value={t && <Money value={t.received} className="text-emerald-700 dark:text-emerald-400" />} />
              <Figure label="Closing Balance" hint={data ? `after ${formatDate(data.to)}` : undefined} loading={!t} value={t && <BalanceCell value={t.closingBalance} strong align="start" />} emphasis />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
              <Figure small label="Delivered" loading={!t} value={t && <Money value={t.delivered} />} />
              <Figure small label="Returns" loading={!t} value={t && <Money value={t.returns} />} />
              <Figure small label="Discounts" loading={!t} value={t && <Money value={t.discount} />} />
              <Figure small label="G. Total" loading={!t} value={t && <Money value={t.gTotal} />} />
              <Figure small label="Adjustments" loading={!t} value={t && <Money value={t.adjustments} />} />
              <Figure small label="Actual Sales" loading={!t} value={t && <Money value={t.sales} />} />
              <Figure small label="Share on Sales" hint="for comparison" loading={!t} value={t && <Money value={t.shareOnSales} />} />
            </div>
            {t && (
              <p className="text-xs text-muted-foreground">
                Opening <Money value={t.openingBalance} /> + Company Share <Money value={t.companyShare} /> + Adjustments{' '}
                <Money value={t.adjustments} /> − Received <Money value={t.received} /> = Closing <Money value={t.closingBalance} />.
                Balances are taken once per branch, never added down the rows.
              </p>
            )}
          </section>

          <div className="space-y-1.5">
          <p className="text-right text-xs text-muted-foreground">All amounts in Rs.</p>
          <DataTable
            columns={columns}
            data={rows}
            loading={recordQ.isLoading}
            toolbar={false}
            pager={false}
            sortable
            manual={{
              page,
              pageSize,
              total: data?.pagination.total ?? 0,
              search,
              onSearchChange: setSearch,
              onPageChange: setPage,
              sorting,
              // Only the date sorts: a running balance read in any other order says nothing.
              onSortingChange: (next) => { setSorting(next.length ? next : [{ id: 'date', desc: true }]); setPage(1); },
            }}
            empty={
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <ScrollText className="h-8 w-8 text-muted-foreground/50" />
                <p className="text-sm font-medium">No demands in this period.</p>
                <p className="text-sm text-muted-foreground">Delivered demands appear here once Production has reviewed them.</p>
              </div>
            }
          />
          </div>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={data?.pagination.total ?? 0}
            onPageChange={setPage}
            onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
            loading={recordQ.isFetching}
          />

          {data && data.branches.length > 1 && <BranchBalances branches={data.branches} />}

          <p className="text-xs text-muted-foreground">
            <span className="text-amber-600">*</span> today&apos;s share % — nothing was frozen for that row (an opening row, or a
            demand delivered before the record was switched on and not caught by it). A demand&apos;s row runs until the
            branch&apos;s next demand; <span className="font-medium">Open</span> rows can still change.
          </p>
        </>
      )}

      <DemandRecordDetailDialog row={detail} onClose={() => setDetail(null)} />
      <DemandRecordEntriesDialog
        open={entriesOpen}
        onOpenChange={setEntriesOpen}
        branchItems={branchItems.filter((b) => b.value !== ALL)}
        startDate={startDate}
        abilities={abilities}
      />
    </div>
  );
}

function Figure({
  label,
  value,
  hint,
  loading,
  small,
  emphasis,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  loading?: boolean;
  small?: boolean;
  emphasis?: boolean;
}) {
  return (
    <div className={cn('rounded-lg border bg-card', small ? 'px-3 py-2' : 'px-4 py-3', emphasis && 'border-primary/40')}>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {loading ? (
        <div className={cn('mt-1 animate-pulse rounded bg-muted', small ? 'h-5 w-20' : 'h-7 w-28')} />
      ) : (
        <div className={cn('mt-0.5 tabular-nums', small ? 'text-sm font-medium' : 'text-lg font-semibold')}>{value}</div>
      )}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function BranchBalances({ branches }: { branches: { branchId: string; branchName: string; openingBalance: number; closingBalance: number }[] }) {
  const { format } = useMoney();
  return (
    <section className="rounded-lg border bg-card">
      <h3 className="border-b px-4 py-2.5 text-sm font-semibold">Balance by branch</h3>
      <div className="divide-y">
        {branches.map((b) => (
          <div key={b.branchId} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
            <span className="font-medium">{shortBranch(b.branchName)}</span>
            <span className="flex items-center gap-4 tabular-nums">
              <span className="text-muted-foreground" title="Opening balance">{format(b.openingBalance)}</span>
              <span aria-hidden>→</span>
              <BalanceCell value={b.closingBalance} strong />
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Before Finance switches the record on: what it is, and the one control that starts it. */
function GoLive({ canConfigure }: { canConfigure: boolean }) {
  const today = businessDateStr();
  const [date, setDate] = useState(`${today.slice(0, 8)}01`);
  const mut = useFinanceMutation<{ startDate: string; frozen: number }>();

  async function switchOn() {
    try {
      const r = await mut.mutateAsync({ path: '/api/finance/branch-account/settings', method: 'PUT', body: { startDate: date } });
      toast.success(`Demand Record switched on from ${formatDate(r.startDate)}${r.frozen ? ` — share % frozen for ${r.frozen} demand(s)` : ''}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not switch it on');
    }
  }

  return (
    <div className="space-y-6">
      <FinancePageHeader title="Demand Record" description="What each branch owes the company, demand by demand, carried forward." />
      <div className="max-w-2xl space-y-4 rounded-lg border bg-card p-5">
        <h3 className="font-semibold">Not switched on yet</h3>
        <p className="text-sm text-muted-foreground">
          The record counts from a go-live day. From that day on, each delivered demand&apos;s company share
          (G. Total × the branch&apos;s share %) is added to the branch&apos;s balance and approved cash transfers come off
          it. Everything before the go-live day goes into each branch&apos;s opening balance, which Finance enters next.
        </p>
        <p className="text-sm text-muted-foreground">
          Switching on freezes today&apos;s share % on any demand from that day that does not have one yet. Frozen
          figures never change afterwards.
        </p>
        {canConfigure ? (
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Go-live day</label>
              <DateFilter value={date} max={today} onChange={setDate} />
            </div>
            <Button disabled={!date || mut.isPending} onClick={() => void switchOn()}>
              {mut.isPending ? 'Switching on…' : 'Switch on'}
            </Button>
          </div>
        ) : (
          <p className="text-sm">A Finance Admin switches it on.</p>
        )}
      </div>
    </div>
  );
}
