'use client';

import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce } from '@/hooks/useDebounce';
import { DataTable } from '@/components/shared/DataTable';
import { StatCard } from '@/components/shared/StatCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PhotoCapture } from '@/components/shared/PhotoCapture';
import { toast } from 'sonner';
import {
  AlertOctagon,
  Archive,
  Bell,
  CheckCircle2,
  CircleDot,
  Clock,
  Eye,
  FileEdit,
  FileQuestion,
  Headset,
  Inbox,
  Plus,
  RotateCcw,
  ShieldAlert,
  Timer,
  Trash2,
  Wand2,
} from 'lucide-react';
import {
  CreateFinanceTicketSchema,
  FINANCE_QUERY_PRIORITIES,
  FINANCE_QUERY_PRIORITY_LABELS,
  FINANCE_QUERY_TYPES,
  FINANCE_QUERY_TYPE_LABELS,
  FINANCE_TICKET_STATUSES,
  FINANCE_TICKET_STATUS_LABELS,
  type Attachment,
  type FinanceQueryPriority,
  type FinanceQueryType,
  type FinanceTicket,
  type FinanceTicketStatus,
} from '@mb/shared';
import { useBranches } from '@/lib/queries';
import {
  useFinanceHelpDeskUsers,
  useFinanceMutation,
  useFinanceTicketStats,
  useFinanceTickets,
} from '@/lib/finance';
import { FinancePageHeader, useMoney } from './finance-ui';
import { FinanceQueryDetailDialog } from './FinanceQueryDetail';
import { EMPTY_FEED, QueryFeedForm, feedToPayload, type FeedState } from './QueryFeedForm';
import {
  QueryPriorityBadge,
  QueryStatusBadge,
  formatQueryDate,
  useHelpDeskAbilities,
} from './help-desk-ui';

/**
 * Finance Help Desk.
 *
 *     Finance User  →  Finance Help Desk  →  ADMIN
 *
 * One page for both sides of the queue, because they are the same list seen from
 * two angles: a Finance user raises a query and watches it; an Admin works
 * through everything outstanding. Splitting them into two screens would
 * duplicate the cards, the filters, the table and the empty states in order to
 * change which buttons the detail screen offers.
 *
 * Every control here is decided by `useHelpDeskAbilities()`, and every one of
 * them calls an endpoint that decides the same thing again from the JWT. Hiding
 * a button is courtesy; the API is the boundary — which is §13 stated as code.
 *
 * The list is ONE PAGE of the queue (§19): the API paginates, searches and
 * filters, and the cards are counted in SQL over the whole queue rather than
 * over the rows on screen. The search box is debounced so a person typing a
 * Query ID does not fire a request per keystroke.
 *
 * The same component backs the Admin Support Center's Finance Queries tab, so an
 * admin never has to go looking in the finance module for work addressed to them
 * (§3). `embedded` drops the page heading there; nothing else differs.
 */

const col = createColumnHelper<FinanceTicket>();

type View = 'queue' | 'drafts' | 'deleted';

// ---------------------------------------------------------------------------
// New Query (§2)
// ---------------------------------------------------------------------------

function NewQueryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { token } = useAuth();
  const mutation = useFinanceMutation<{ ticket: FinanceTicket }>();
  const { data: branches = [] } = useBranches(token ?? '', { enabled: Boolean(token) && open });

  const [feed, setFeed] = useState<FeedState>(EMPTY_FEED);
  const [photos, setPhotos] = useState<Attachment[]>([]);
  const [saving, setSaving] = useState<'submit' | 'draft' | null>(null);
  // Remounted via `key` each time it opens, so state starts fresh with no reset effect.

  async function save(draft: boolean) {
    const parsed = CreateFinanceTicketSchema.safeParse({
      ...feedToPayload(feed),
      attachmentIds: photos.map((p) => p.id),
      draft,
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Please complete the form');
      return;
    }
    setSaving(draft ? 'draft' : 'submit');
    try {
      const { ticket } = await mutation.mutateAsync({ path: '/api/finance/tickets', body: parsed.data });
      toast.success(draft ? `Draft ${ticket.queryNo} saved` : `${ticket.queryNo} sent to the Admin`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save the query');
    } finally {
      setSaving(null);
    }
  }

  const incomplete = feed.subject.trim().length < 3 || feed.description.trim().length < 3;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Query</DialogTitle>
          <DialogDescription>
            Report a financial issue, an incorrect transaction, a calculation problem or a data
            discrepancy. It goes straight to the Admin — the Query ID is assigned when you save.
          </DialogDescription>
        </DialogHeader>

        <QueryFeedForm value={feed} onChange={setFeed} branches={branches} idPrefix="nq" />

        <PhotoCapture
          entity="finance_ticket"
          value={photos}
          onChange={setPhotos}
          label="Attachments"
          hint="Optional — a photo of the slip, statement or screen"
        />

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving !== null}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            onClick={() => void save(true)}
            disabled={saving !== null || incomplete}
            title="Keep it with you. Nothing is sent until you submit."
          >
            <FileEdit className="mr-1 h-4 w-4" />
            {saving === 'draft' ? 'Saving…' : 'Save Draft'}
          </Button>
          <Button onClick={() => void save(false)} disabled={saving !== null || incomplete}>
            {saving === 'submit' ? 'Sending…' : 'Submit Query'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Dashboard cards (§1)
// ---------------------------------------------------------------------------

function DashboardCards({ isAdmin }: { isAdmin: boolean }) {
  const { data: s, isLoading } = useFinanceTicketStats();
  const v = (n: number | undefined) => n ?? 0;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <StatCard title="Pending" value={v(s?.open)} icon={CircleDot} color="blue" loading={isLoading} />
      <StatCard title="In Review" value={v(s?.underReview)} icon={Timer} color="orange" loading={isLoading} />
      <StatCard title="High Priority" value={v(s?.highPriority)} icon={ShieldAlert} color="red" loading={isLoading} />
      <StatCard title="Waiting for Finance" value={v(s?.waiting)} icon={Clock} color="brown" loading={isLoading} />
      <StatCard title="Resolved" value={v(s?.resolved)} icon={CheckCircle2} color="green" loading={isLoading} />
      <StatCard title="Amended" value={v(s?.amended)} icon={Wand2} color="brown" loading={isLoading} />

      {isAdmin && (
        <>
          <StatCard title="Reopened" value={v(s?.reopened)} icon={RotateCcw} color="red" loading={isLoading} />
          <StatCard title="All Queries" value={v(s?.total)} icon={Inbox} color="blue" loading={isLoading} />
          <StatCard title="Unassigned" value={v(s?.unassigned)} icon={FileQuestion} color="orange" loading={isLoading} />
          <StatCard title="Urgent" value={v(s?.urgent)} icon={AlertOctagon} color="red" loading={isLoading} />
          <StatCard title="Recently Updated" value={v(s?.recent)} icon={Bell} color="green" loading={isLoading} />
          <StatCard title="Deleted" value={v(s?.deleted)} icon={Archive} color="brown" loading={isLoading} />
        </>
      )}
      {!isAdmin && (
        <StatCard title="My Drafts" value={v(s?.draft)} icon={FileEdit} color="brown" loading={isLoading} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;

export function FinanceHelpDeskPage({
  embedded = false,
  sourceTag = false,
}: {
  embedded?: boolean;
  /**
   * Renders the FINANCE badge beside every Query ID — on inside the Admin
   * Support Center, where this table sits beside the branch and production
   * queue and the tag is how a row says which desk it came from.
   */
  sourceTag?: boolean;
}) {
  const abilities = useHelpDeskAbilities();
  const { token, user } = useAuth();
  const { format: money } = useMoney();

  const [view, setView] = useState<View>('queue');
  const [status, setStatus] = useState<FinanceTicketStatus | 'all'>('all');
  const [queryType, setQueryType] = useState<FinanceQueryType | 'all'>('all');
  const [priority, setPriority] = useState<FinanceQueryPriority | 'all'>('all');
  const [branchId, setBranchId] = useState('');
  const [raisedBy, setRaisedBy] = useState('');
  const [queryNo, setQueryNo] = useState('');
  const [amountMin, setAmountMin] = useState('');
  const [amountMax, setAmountMax] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  // The page is stored WITH the filter identity it belongs to, so a filter
  // change lands on page 1 by derivation rather than by an effect that
  // resets state after a render has already asked for a page that no longer
  // exists.
  const [pageState, setPageState] = useState<{ key: string; page: number }>({ key: '', page: 1 });
  const [showNew, setShowNew] = useState(false);
  const [newKey, setNewKey] = useState(0);
  const [viewing, setViewing] = useState<string | null>(null);
  const [moreFilters, setMoreFilters] = useState(false);

  const debouncedSearch = useDebounce(search.trim(), 350);
  const debouncedQueryNo = useDebounce(queryNo.trim(), 350);
  const debouncedAmountMin = useDebounce(amountMin.trim(), 350);
  const debouncedAmountMax = useDebounce(amountMax.trim(), 350);

  const { data: branches = [] } = useBranches(token ?? '', { enabled: Boolean(token) });
  const { data: users = [] } = useFinanceHelpDeskUsers(abilities.admin);

  const scope = useMemo(
    () => ({
      ...(view === 'drafts'
        ? { status: 'draft', mine: true }
        : view === 'deleted'
          ? { deletedOnly: true, ...(status !== 'all' ? { status } : {}) }
          : status !== 'all'
            ? { status }
            : {}),
      ...(queryType !== 'all' ? { queryType } : {}),
      ...(priority !== 'all' ? { priority } : {}),
      ...(branchId ? { branchId } : {}),
      ...(raisedBy ? { raisedBy } : {}),
      ...(debouncedQueryNo ? { queryNo: debouncedQueryNo } : {}),
      ...(debouncedAmountMin ? { amountMin: debouncedAmountMin } : {}),
      ...(debouncedAmountMax ? { amountMax: debouncedAmountMax } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    }),
    [
      view, status, queryType, priority, branchId, raisedBy, debouncedQueryNo,
      debouncedAmountMin, debouncedAmountMax, from, to, debouncedSearch,
    ],
  );

  const scopeKey = JSON.stringify(scope);
  const page = pageState.key === scopeKey ? pageState.page : 1;
  const setPage = (next: number) => setPageState({ key: scopeKey, page: next });

  const filters = useMemo(() => ({ ...scope, page, pageSize: PAGE_SIZE }), [scope, page]);

  const { data, isLoading, isFetching } = useFinanceTickets(filters);
  const tickets = data?.tickets ?? [];
  const total = data?.total ?? 0;

  const isOwnDraft = (t: FinanceTicket) => t.status === 'draft' && t.raisedBy === user?.uid;

  /**
   * §1's columns: Query ID · Subject · Type · Amount · Status · Created By ·
   * Created · Last Updated · Admin · Action.
   *
   * `meta.mobile` is what makes the same definition render as a full table above
   * md and as one card per query below it — DataTable reads these annotations
   * and needs no second implementation.
   */
  const columns = useMemo(
    () => [
      col.accessor('queryNo', {
        header: 'Query ID',
        meta: { mobile: 'title' },
        cell: ({ row }) => {
          const t = row.original;
          return (
            <div className="flex flex-col items-start gap-0.5">
              {sourceTag && (
                <Badge
                  variant="secondary"
                  className="text-[10px] uppercase tracking-wide bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300"
                >
                  Finance
                </Badge>
              )}
              <span className="font-mono text-xs">{t.queryNo}</span>
              {t.reopenCount > 0 && (
                <span className="text-[10px] text-fuchsia-700 dark:text-fuchsia-400">
                  Reopened {t.reopenCount}×
                </span>
              )}
              {t.amendCount > 0 && (
                <span className="text-[10px] text-teal-700 dark:text-teal-400">
                  Amended {t.amendCount}× · v{t.version}
                </span>
              )}
              {t.recreatedFromQueryNo && (
                <span className="text-[10px] text-muted-foreground">From {t.recreatedFromQueryNo}</span>
              )}
              {t.recreatedAsQueryNo && (
                <span className="text-[10px] text-muted-foreground">Recreated as {t.recreatedAsQueryNo}</span>
              )}
              {t.deletedAt && (
                <Badge variant="destructive" className="text-[10px]">
                  Deleted
                </Badge>
              )}
            </div>
          );
        },
      }),
      col.accessor('subject', {
        header: 'Subject',
        meta: { mobile: 'subtitle', mobileFull: true },
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{row.original.subject}</p>
            <p className="truncate text-xs text-muted-foreground">
              {row.original.referenceNo ?? row.original.transactionRef ?? row.original.expenseRef ?? row.original.incomeRef ?? ''}
            </p>
          </div>
        ),
      }),
      col.accessor((t) => FINANCE_QUERY_TYPE_LABELS[t.queryType], {
        id: 'type',
        header: 'Type',
        meta: { mobile: 'hidden' },
        cell: ({ row }) => <span className="text-sm">{FINANCE_QUERY_TYPE_LABELS[row.original.queryType]}</span>,
      }),
      col.accessor('amount', {
        header: 'Amount',
        meta: { align: 'right', mobileLabel: 'Amount' },
        cell: ({ row }) => (
          <span className="tabular-nums text-sm">
            {row.original.amount === null ? <span className="text-muted-foreground">—</span> : money(row.original.amount)}
          </span>
        ),
      }),
      col.accessor('priority', {
        header: 'Priority',
        meta: { mobile: 'badge', align: 'center' },
        cell: (info) => <QueryPriorityBadge priority={info.getValue()} />,
      }),
      col.accessor('status', {
        header: 'Status',
        meta: { mobile: 'badge', align: 'center' },
        cell: ({ row }) =>
          row.original.deletedAt ? (
            <Badge variant="destructive" className="whitespace-nowrap">Deleted</Badge>
          ) : (
            <QueryStatusBadge status={row.original.status} />
          ),
      }),
      col.accessor('raisedByName', {
        header: 'Created By',
        meta: { mobileLabel: 'Created by' },
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate text-sm">{row.original.raisedByName || '—'}</p>
            {row.original.branchName && (
              <p className="truncate text-xs text-muted-foreground">{row.original.branchName}</p>
            )}
          </div>
        ),
      }),
      col.accessor('createdAt', {
        header: 'Created',
        meta: { mobileLabel: 'Created' },
        cell: (info) => <span className="whitespace-nowrap text-sm">{formatQueryDate(info.getValue())}</span>,
      }),
      col.accessor('updatedAt', {
        id: 'lastUpdate',
        header: 'Last Updated',
        meta: { mobileFull: true, mobileLabel: 'Last update' },
        cell: ({ row }) => {
          const t = row.original;
          const answer = t.adminResponse ?? t.resolutionNote;
          return (
            <div className="min-w-0">
              <p className="whitespace-nowrap text-sm">{formatQueryDate(t.updatedAt)}</p>
              <p className="line-clamp-2 max-w-[16rem] text-xs text-muted-foreground">
                {t.status === 'draft' ? 'Draft — not sent' : (answer ?? 'Awaiting Admin')}
              </p>
            </div>
          );
        },
      }),
      col.accessor((t) => t.assignedToName ?? t.respondedByName ?? t.resolvedByName ?? '', {
        id: 'admin',
        header: 'Admin',
        meta: { mobile: 'hidden' },
        cell: ({ row }) => {
          const t = row.original;
          const who = t.assignedToName ?? t.resolvedByName ?? t.respondedByName;
          return who ? (
            <span className="text-sm">{who}</span>
          ) : (
            <span className="text-xs text-muted-foreground">Unassigned</span>
          );
        },
      }),
      col.display({
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setViewing(row.original.id)}
              aria-label={`Open query ${row.original.queryNo}`}
            >
              {isOwnDraft(row.original) ? (
                <>
                  <FileEdit className="mr-1 h-4 w-4" /> Edit draft
                </>
              ) : (
                <>
                  <Eye className="mr-1 h-4 w-4" /> Open
                </>
              )}
            </Button>
          </div>
        ),
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourceTag, money, user?.uid],
  );

  const select = 'h-9 rounded-md border bg-background px-2 text-sm';

  const filterControls = (
    <div className="flex flex-wrap items-center gap-2">
      {(abilities.report || abilities.admin) && (
        <div className="flex rounded-md border p-0.5" role="tablist" aria-label="Which queries">
          <Button
            size="sm"
            variant={view === 'queue' ? 'default' : 'ghost'}
            className="h-8"
            onClick={() => setView('queue')}
            role="tab"
            aria-selected={view === 'queue'}
          >
            <Inbox className="mr-1 h-3.5 w-3.5" /> Queue
          </Button>
          {abilities.report && (
            <Button
              size="sm"
              variant={view === 'drafts' ? 'default' : 'ghost'}
              className="h-8"
              onClick={() => setView('drafts')}
              role="tab"
              aria-selected={view === 'drafts'}
            >
              <FileEdit className="mr-1 h-3.5 w-3.5" /> My Drafts
            </Button>
          )}
          {abilities.admin && (
            <Button
              size="sm"
              variant={view === 'deleted' ? 'default' : 'ghost'}
              className="h-8"
              onClick={() => setView('deleted')}
              role="tab"
              aria-selected={view === 'deleted'}
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" /> Deleted
            </Button>
          )}
        </div>
      )}
      {view !== 'drafts' && (
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as typeof status)}
          className={select}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          {FINANCE_TICKET_STATUSES.filter((s) => s !== 'draft').map((s) => (
            <option key={s} value={s}>
              {FINANCE_TICKET_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      )}
      <select
        value={queryType}
        onChange={(e) => setQueryType(e.target.value as typeof queryType)}
        className={select}
        aria-label="Filter by query type"
      >
        <option value="all">All types</option>
        {FINANCE_QUERY_TYPES.map((t) => (
          <option key={t} value={t}>
            {FINANCE_QUERY_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <Button size="sm" variant={moreFilters ? 'secondary' : 'outline'} className="h-9" onClick={() => setMoreFilters((v) => !v)}>
        {moreFilters ? 'Fewer filters' : 'More filters'}
      </Button>
    </div>
  );

  const extraFilters = moreFilters && (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-3">
      <select
        value={priority}
        onChange={(e) => setPriority(e.target.value as typeof priority)}
        className={select}
        aria-label="Filter by priority"
      >
        <option value="all">All priorities</option>
        {FINANCE_QUERY_PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {FINANCE_QUERY_PRIORITY_LABELS[p]}
          </option>
        ))}
      </select>
      <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={select} aria-label="Filter by branch">
        <option value="">All branches</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </select>
      {abilities.admin && (
        <select value={raisedBy} onChange={(e) => setRaisedBy(e.target.value)} className={select} aria-label="Filter by user">
          <option value="">All users</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name || u.email}
            </option>
          ))}
        </select>
      )}
      <Input
        value={queryNo}
        onChange={(e) => setQueryNo(e.target.value)}
        placeholder="Exact Query ID"
        className="h-9 w-44 font-mono"
        aria-label="Exact Query ID"
      />
      <Input
        value={amountMin}
        onChange={(e) => setAmountMin(e.target.value.replace(/[^\d.]/g, ''))}
        placeholder="Amount from"
        inputMode="decimal"
        className="h-9 w-32 tabular-nums"
        aria-label="Amount from"
      />
      <Input
        value={amountMax}
        onChange={(e) => setAmountMax(e.target.value.replace(/[^\d.]/g, ''))}
        placeholder="Amount to"
        inputMode="decimal"
        className="h-9 w-32 tabular-nums"
        aria-label="Amount to"
      />
      <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-auto" aria-label="From date" />
      <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-auto" aria-label="To date" />
      <Button
        size="sm"
        variant="ghost"
        className="h-9"
        onClick={() => {
          setPriority('all');
          setBranchId('');
          setRaisedBy('');
          setQueryNo('');
          setAmountMin('');
          setAmountMax('');
          setFrom('');
          setTo('');
        }}
      >
        Clear
      </Button>
    </div>
  );

  const newButton = abilities.report ? (
    <Button
      size={embedded ? 'sm' : 'default'}
      onClick={() => {
        setNewKey((k) => k + 1);
        setShowNew(true);
      }}
    >
      <Plus className="mr-1 h-4 w-4" /> New Query
    </Button>
  ) : undefined;

  return (
    <div className="space-y-6">
      {!embedded && (
        <FinancePageHeader
          title="Finance Help Desk"
          description={
            abilities.admin
              ? 'Queries raised by Finance. Open one to feed, amend, resolve, delete, restore or recreate it — every change is versioned and written to the audit trail, and none of it touches the books until you correct the record itself.'
              : 'Report an incorrect transaction, a calculation problem or a data discrepancy directly to the Admin. Save a draft, submit when ready, follow the response here.'
          }
          actions={newButton}
        />
      )}

      <DashboardCards isAdmin={abilities.admin} />

      {extraFilters}

      <DataTable
        columns={columns}
        data={tickets}
        loading={isLoading || (isFetching && tickets.length === 0)}
        searchPlaceholder="Search Query ID, reference, subject, user or branch…"
        leading={filterControls}
        actions={embedded ? newButton : undefined}
        manual={{
          page,
          pageSize: PAGE_SIZE,
          total,
          onPageChange: setPage,
          search,
          onSearchChange: setSearch,
        }}
        empty={
          <div className="p-10 text-center text-muted-foreground">
            <Headset className="mx-auto mb-2 h-8 w-8 opacity-50" />
            <p className="text-sm">
              {view === 'deleted'
                ? 'No deleted queries.'
                : view === 'drafts'
                  ? 'No drafts. Save one from “New Query”.'
                  : abilities.admin
                    ? 'No queries here. Finance has nothing outstanding with you.'
                    : abilities.report
                      ? 'No queries here. Raise one with “New Query”.'
                      : 'No queries have been raised.'}
            </p>
          </div>
        }
      />

      <NewQueryDialog key={newKey} open={showNew} onOpenChange={setShowNew} />
      {viewing && (
        <FinanceQueryDetailDialog
          ticketId={viewing}
          onClose={() => setViewing(null)}
          onOpenOther={(id) => setViewing(id)}
        />
      )}
    </div>
  );
}
