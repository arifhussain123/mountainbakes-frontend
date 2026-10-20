'use client';

import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import {
  PURCHASE_BUCKETS,
  PURCHASE_BUCKET_LABEL,
  PURCHASE_DEMAND_STATUSES,
  PURCHASE_DEMAND_STATUS_LABEL,
  type FilterConfig,
  type PurchaseBucket,
  type PurchaseDemand,
  type PurchaseDemandDetail,
  type PurchaseDemandListRow,
} from '@mb/shared';
import { AlertTriangle, ClipboardList, Eye, HandCoins, Inbox, Plus, RefreshCw, Wallet } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable } from '@/components/shared/DataTable';
import { EmptyState } from '@/components/shared/EmptyState';
import { Pagination } from '@/components/data-engine/Pagination';
import { ActiveFilters, FilterBar } from '@/components/data-engine';
import { sortStateToTanstack, tanstackToSortState } from '@/lib/data-engine/sortConversion';
import { useListQueryState } from '@/lib/data-engine/useListQueryState';
import {
  usePurchaseDemands,
  usePurchaseSuppliers,
  usePurchasingStatus,
  usePurchasingSummary,
  type DemandSortKey,
} from '@/lib/purchasing';
import { formatDate, formatDateTime } from '@/utils/date';
import { cn } from '@/lib/utils';
import { ConnectionPanel } from './ConnectionPanel';
import { DemandBadges } from './badges';
import { money } from './parts';
import { DemandFormDialog } from './DemandFormDialog';
import { DemandDetailDialog } from './DemandDetailDialog';
import { ConversationsPanel } from './ConversationsPanel';
import { MessageQueue } from './MessageQueues';

/**
 * Production → WhatsApp Purchasing.
 *
 * Production buys ingredients from outside suppliers over the one authorized
 * Production WhatsApp number: a demand goes out as a WhatsApp message with a
 * private link, the supplier quotes and bills through it (or by plain message,
 * keyed in here), Production approves, receives the goods into ingredient
 * stock and records payment — which Finance then approves on its own page.
 *
 * THE PAGE IS A WORK QUEUE. The bucket strip across the top is the server's
 * own definition of each queue (services/purchasing/buckets.ts), counted by
 * GET /summary and filtered by GET /demands?bucket= — so "Awaiting production
 * approval: 3" is three rows when clicked, never a client recount that drifts.
 *
 * Nothing on this page decides what a demand may do next. The detail reads the
 * server's `actions`; the list only shows state.
 */

const SORTABLE: Record<string, DemandSortKey> = {
  demand_no: 'demand_no',
  supplier_name: 'supplier_name',
  required_date: 'required_date',
  created_at: 'created_at',
};

const col = createColumnHelper<PurchaseDemandListRow>();

export function WhatsAppPurchasingPage() {
  const { token } = useAuth();
  const statusQ = usePurchasingStatus(token);
  const summaryQ = usePurchasingSummary(token);
  const suppliersQ = usePurchaseSuppliers(token);

  const [tab, setTab] = useState('demands');
  const [bucket, setBucket] = useState<PurchaseBucket>('pending');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PurchaseDemandDetail | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);

  const list = useListQueryState({
    syncUrl: true,
    filterKeys: ['status', 'priority', 'supplierId', 'createdAt'],
    defaults: { sort: { key: 'created_at', direction: 'desc' } },
  });
  const filters = useMemo<FilterConfig[]>(
    () => [
      {
        key: 'priority', label: 'Priority', type: 'select', placement: 'bar',
        options: [{ value: 'urgent', label: 'Urgent' }, { value: 'normal', label: 'Normal' }],
      },
      {
        key: 'supplierId', label: 'Supplier', type: 'select', placement: 'bar',
        options: (suppliersQ.data?.suppliers ?? []).map((s) => ({ value: s.id, label: s.name })),
      },
      {
        key: 'status', label: 'Status', type: 'select',
        options: PURCHASE_DEMAND_STATUSES.map((s) => ({ value: s, label: PURCHASE_DEMAND_STATUS_LABEL[s] })),
      },
      { key: 'createdAt', label: 'Created', type: 'date-range' },
    ],
    [suppliersQ.data],
  );

  const sortKey = list.state.sort?.key ? SORTABLE[list.state.sort.key] : undefined;
  const demandsQ = usePurchaseDemands(token, {
    bucket,
    status: list.getFilter('status')?.value as string | undefined,
    priority: list.getFilter('priority')?.value as string | undefined,
    supplierId: list.getFilter('supplierId')?.value as string | undefined,
    from: list.getFilter('createdAt', 'gte')?.value as string | undefined,
    to: list.getFilter('createdAt', 'lte')?.value as string | undefined,
    search: list.state.search || undefined,
    sortBy: sortKey ?? 'created_at',
    sortDir: list.state.sort?.direction ?? 'desc',
    page: list.state.page,
    limit: list.state.pageSize,
  });
  const rows = demandsQ.data?.demands ?? [];
  const total = demandsQ.data?.total ?? 0;
  const summary = summaryQ.data;

  function refreshAll() {
    void statusQ.refetch();
    void summaryQ.refetch();
    void demandsQ.refetch();
  }

  const columns = [
    col.accessor('demandNo', {
      id: 'demand_no',
      header: 'Demand',
      meta: { mobile: 'title' },
      cell: ({ row }) => (
        <div className="min-w-0">
          <span className="font-mono text-xs font-semibold">{row.original.demandNo}</span>
          <span className="block text-xs text-muted-foreground">{row.original.itemCount} item{row.original.itemCount === 1 ? '' : 's'}</span>
        </div>
      ),
    }),
    col.accessor('supplierName', {
      id: 'supplier_name',
      header: 'Supplier',
      meta: { mobile: 'subtitle' },
      cell: (i) => <span className="font-medium">{i.getValue()}</span>,
    }),
    col.accessor('requiredDate', {
      id: 'required_date',
      header: 'Required',
      cell: (i) => <span className="whitespace-nowrap text-sm">{formatDate(i.getValue())}</span>,
    }),
    col.display({
      id: 'state',
      header: 'Status',
      meta: { mobile: 'badge', mobileFull: true },
      cell: ({ row }) => <DemandBadges demand={row.original} lastMessageStatus={row.original.lastMessageStatus} />,
    }),
    col.display({
      id: 'total',
      header: 'Total',
      meta: { align: 'right' },
      cell: ({ row }) => {
        const r = row.original;
        const figure = r.billTotal ?? r.quotedTotal;
        return (
          <div className="text-right tabular-nums">
            <span className="font-medium">{money(figure)}</span>
            {figure !== null && <span className="block text-xs text-muted-foreground">{r.billTotal !== null ? 'billed' : 'quoted'}</span>}
          </div>
        );
      },
    }),
    col.accessor('paidTotal', {
      header: 'Paid',
      enableSorting: false,
      meta: { align: 'right' },
      cell: (i) => <span className="tabular-nums">{i.row.original.approvedBillId ? money(i.getValue()) : '—'}</span>,
    }),
    col.accessor('createdAt', {
      id: 'created_at',
      header: 'Created',
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-xs text-muted-foreground">
          {formatDateTime(row.original.createdAt)}
          {row.original.createdByName ? <span className="block">{row.original.createdByName}</span> : null}
        </span>
      ),
    }),
    col.display({
      id: 'actions',
      header: '',
      enableSorting: false,
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => setDetailId(row.original.id)}>
          <Eye className="mr-1.5 h-4 w-4" /> View
        </Button>
      ),
    }),
  ];

  const unmatched = summary?.unmatchedMessages ?? 0;
  const failed = summary?.failedMessages ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold">WhatsApp Purchasing</h2>
          <p className="text-sm text-muted-foreground">
            Demands to suppliers over the Production WhatsApp number — quotations, bills, delivery, goods receipt and payment
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="h-11 sm:h-9" onClick={refreshAll} aria-label="Refresh" disabled={demandsQ.isFetching}>
            <RefreshCw className={cn('h-4 w-4', demandsQ.isFetching && 'animate-spin')} />
          </Button>
          <Button
            className="h-11 flex-1 sm:h-9 sm:flex-none"
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="mr-1.5 h-4 w-4" /> New Demand
          </Button>
        </div>
      </div>

      <ConnectionPanel status={statusQ.data} isLoading={statusQ.isLoading} isError={statusQ.isError} onRetry={() => void statusQ.refetch()} />

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Counter icon={AlertTriangle} label="Failed messages" value={summary ? String(failed) : '—'} tone={failed > 0 ? 'bad' : undefined} onClick={() => setTab('failed')} />
        <Counter icon={Inbox} label="Unmatched messages" value={summary ? String(unmatched) : '—'} tone={unmatched > 0 ? 'waiting' : undefined} onClick={() => setTab('unmatched')} />
        <Counter icon={HandCoins} label="Supplier credit outstanding" value={summary ? money(summary.outstandingSupplierCredit) : '—'} />
        <Counter icon={Wallet} label="Payments waiting for Finance" value={summary ? String(summary.pendingSupplierPayments) : '—'} />
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(String(v))}>
        <TabsList>
          <TabsTrigger value="demands">Demands</TabsTrigger>
          <TabsTrigger value="conversations">Conversations</TabsTrigger>
          <TabsTrigger value="unmatched">Unmatched{unmatched ? ` (${unmatched})` : ''}</TabsTrigger>
          <TabsTrigger value="failed">Failed{failed ? ` (${failed})` : ''}</TabsTrigger>
        </TabsList>

        <TabsContent value="demands" className="space-y-4 pt-2">
          {/* The work queues. A strip that scrolls sideways on a phone rather
              than wrapping into four rows of chips above the table. */}
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" role="tablist" aria-label="Demand queues">
            {PURCHASE_BUCKETS.map((b) => (
              <button
                key={b}
                type="button"
                role="tab"
                aria-selected={bucket === b}
                onClick={() => {
                  setBucket(b);
                  list.setPage(1);
                }}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                  bucket === b ? 'border-foreground bg-foreground text-background' : 'bg-card hover:bg-muted',
                )}
              >
                {PURCHASE_BUCKET_LABEL[b]}
                <span className={cn('rounded-full px-1.5 tabular-nums', bucket === b ? 'bg-background/20' : 'bg-muted')}>
                  {summary ? summary.buckets[b] ?? 0 : '…'}
                </span>
              </button>
            ))}
          </div>

          <FilterBar list={list} filters={filters} searchable={false} />
          <ActiveFilters filters={list.activeFilters} configs={filters} onRemove={list.clearFilter} onClearAll={list.clearAll} />

          {demandsQ.isError ? (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 p-3 text-sm">
              <span className="text-destructive">Could not load demands.</span>
              <Button size="sm" variant="outline" onClick={() => void demandsQ.refetch()}>Try again</Button>
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={rows}
              loading={demandsQ.isLoading}
              searchPlaceholder="Search demand no., supplier or notes…"
              pager={false}
              sortable
              empty={
                <EmptyState
                  icon={ClipboardList}
                  title={bucket === 'all' && !list.hasActiveFilters && !list.state.search ? 'No demands yet' : 'Nothing in this queue'}
                  description={
                    bucket === 'all' && !list.hasActiveFilters && !list.state.search
                      ? 'Raise a demand to ask a supplier for a quotation on WhatsApp.'
                      : 'Try another queue, or clear the filters.'
                  }
                  action={
                    <Button size="sm" onClick={() => { setEditing(null); setFormOpen(true); }}>
                      <Plus className="mr-1.5 h-4 w-4" /> New Demand
                    </Button>
                  }
                />
              }
              manual={{
                page: list.state.page,
                pageSize: list.state.pageSize,
                total,
                onPageChange: list.setPage,
                search: list.state.search,
                onSearchChange: list.setSearch,
                sorting: sortStateToTanstack(list.state.sort),
                onSortingChange: (next) => list.setSort(tanstackToSortState(next)),
              }}
            />
          )}
          <Pagination
            page={list.state.page}
            pageSize={list.state.pageSize}
            total={total}
            onPageChange={list.setPage}
            onPageSizeChange={list.setPageSize}
            loading={demandsQ.isFetching}
          />
        </TabsContent>

        <TabsContent value="conversations" className="pt-2">
          <ConversationsPanel token={token} onOpenDemand={setDetailId} />
        </TabsContent>
        <TabsContent value="unmatched" className="pt-2">
          <MessageQueue token={token} filter="unmatched" onOpenDemand={setDetailId} />
        </TabsContent>
        <TabsContent value="failed" className="pt-2">
          <MessageQueue token={token} filter="failed" onOpenDemand={setDetailId} />
        </TabsContent>
      </Tabs>

      <DemandFormDialog
        open={formOpen}
        onOpenChange={(o) => {
          setFormOpen(o);
          if (!o) setEditing(null);
        }}
        token={token}
        existing={editing}
        connection={statusQ.data}
        onSent={(d: PurchaseDemand) => setDetailId(d.id)}
      />
      <DemandDetailDialog
        token={token}
        demandId={formOpen ? null : detailId}
        onClose={() => setDetailId(null)}
        onEdit={(d) => {
          setEditing(d);
          setFormOpen(true);
        }}
      />
    </div>
  );
}

function Counter({
  icon: Icon,
  label,
  value,
  tone,
  onClick,
}: {
  icon: typeof Inbox;
  label: string;
  value: string;
  tone?: 'bad' | 'waiting';
  onClick?: () => void;
}) {
  const body = (
    <>
      <Icon className={cn('h-4 w-4 shrink-0', tone === 'bad' ? 'text-red-600' : tone === 'waiting' ? 'text-amber-600' : 'text-muted-foreground')} aria-hidden />
      <span className="min-w-0">
        <span className="block truncate text-xs text-muted-foreground">{label}</span>
        <span className={cn('block text-base font-semibold tabular-nums', tone === 'bad' && 'text-red-600')}>{value}</span>
      </span>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="flex items-center gap-2.5 rounded-xl border bg-card p-3 text-left hover:bg-muted/50">
      {body}
    </button>
  ) : (
    <div className="flex items-center gap-2.5 rounded-xl border bg-card p-3">{body}</div>
  );
}
