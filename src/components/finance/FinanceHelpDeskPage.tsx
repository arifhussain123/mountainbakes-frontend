'use client';

import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useAuth } from '@/hooks/useAuth';
import { useDebounce } from '@/hooks/useDebounce';
import { DataTable } from '@/components/shared/DataTable';
import { Pagination } from '@/components/data-engine/Pagination';
import { ActiveFilters, FilterBar } from '@/components/data-engine';
import { useListQueryState } from '@/lib/data-engine/useListQueryState';
import { StatCard } from '@/components/shared/StatCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  ArchiveRestore,
  Ban,
  Bell,
  CheckCircle2,
  CircleDot,
  Clock,
  Copy,
  Eye,
  FileEdit,
  FileQuestion,
  Headset,
  History,
  Inbox,
  MoreHorizontal,
  Pencil,
  Plus,
  RotateCcw,
  Send,
  ShieldAlert,
  Timer,
  Trash2,
  Wand2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  CreateFinanceTicketSchema,
  FINANCE_QUERY_PRIORITIES,
  FINANCE_QUERY_PRIORITY_LABELS,
  FINANCE_QUERY_TYPES,
  FINANCE_QUERY_TYPE_LABELS,
  FINANCE_TICKET_REFERENCE_LABELS,
  FINANCE_TICKET_REOPENABLE_STATUSES,
  FINANCE_TICKET_STATUSES,
  FINANCE_TICKET_STATUS_LABELS,
  FINANCE_TICKET_TRANSITIONS,
  isFinanceTicketTerminal,
  type Attachment,
  type FilterConfig,
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
import {
  DeleteQueryDialog,
  FinanceQueryDetailDialog,
  HistoryDialog,
  QuickFeedDialog,
  ReasonDialog,
  ReopenDialog,
  StatusDialog,
  type QuickFeedMode,
} from './FinanceQueryDetail';
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

/** A row action opened straight from the queue — the branch queue's shape. */
type RowAction =
  | { kind: QuickFeedMode; ticket: FinanceTicket }
  | { kind: 'status'; ticket: FinanceTicket; target: FinanceTicketStatus }
  | { kind: 'delete' | 'restore' | 'reopen' | 'history'; ticket: FinanceTicket };

function IconBtn({
  children,
  title,
  onClick,
  className,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <Button variant="ghost" size="icon" className={`h-8 w-8 ${className ?? ''}`} title={title} onClick={onClick} disabled={disabled}>
      {children}
    </Button>
  );
}

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
  const [showNew, setShowNew] = useState(false);
  const [newKey, setNewKey] = useState(0);
  const [viewing, setViewing] = useState<string | null>(null);
  const [rowAction, setRowAction] = useState<RowAction | null>(null);
  const rowMutation = useFinanceMutation();

  const list = useListQueryState({
    syncUrl: true,
    filterKeys: ['status', 'queryType', 'priority', 'branchId', 'raisedBy', 'queryNo', 'amount', 'businessDate'],
  });

  const { data: branches = [] } = useBranches(token ?? '', { enabled: Boolean(token) });
  const { data: users = [] } = useFinanceHelpDeskUsers(abilities.admin);

  function switchView(next: View) {
    setView(next);
    list.setPage(1);
  }

  const filterConfigs = useMemo<FilterConfig[]>(() => {
    const cfgs: FilterConfig[] = [];
    if (view !== 'drafts') {
      cfgs.push({
        key: 'status', label: 'Status', type: 'select', placement: 'bar',
        options: FINANCE_TICKET_STATUSES.filter((s) => s !== 'draft').map((s) => ({ value: s, label: FINANCE_TICKET_STATUS_LABELS[s] })),
      });
    }
    cfgs.push({
      key: 'queryType', label: 'Query type', type: 'select', placement: 'bar',
      options: FINANCE_QUERY_TYPES.map((t) => ({ value: t, label: FINANCE_QUERY_TYPE_LABELS[t] })),
    });
    cfgs.push({
      key: 'priority', label: 'Priority', type: 'select',
      options: FINANCE_QUERY_PRIORITIES.map((p) => ({ value: p, label: FINANCE_QUERY_PRIORITY_LABELS[p] })),
    });
    cfgs.push({ key: 'branchId', label: 'Branch', type: 'select' });
    if (abilities.admin) cfgs.push({ key: 'raisedBy', label: 'Raised by', type: 'select' });
    cfgs.push({ key: 'queryNo', label: 'Exact Query ID', type: 'text', placeholder: 'Exact Query ID' });
    cfgs.push({ key: 'amount', label: 'Amount', type: 'number-range' });
    cfgs.push({ key: 'businessDate', label: 'Date', type: 'date-range' });
    return cfgs;
  }, [view, abilities.admin]);

  const filterOptions = useMemo(
    () => ({
      branchId: branches.map((b) => ({ value: b.id, label: b.name })),
      raisedBy: users.map((u) => ({ value: u.id, label: u.name || u.email })),
    }),
    [branches, users],
  );

  const statusFilter = list.getFilter('status')?.value as FinanceTicketStatus | undefined;
  const queryTypeFilter = list.getFilter('queryType')?.value as FinanceQueryType | undefined;
  const priorityFilter = list.getFilter('priority')?.value as FinanceQueryPriority | undefined;
  const branchIdFilter = list.getFilter('branchId')?.value as string | undefined;
  const raisedByFilter = list.getFilter('raisedBy')?.value as string | undefined;
  const queryNoFilter = list.getFilter('queryNo', 'ilike')?.value as string | undefined;
  const amountMinFilter = list.getFilter('amount', 'gte')?.value as string | undefined;
  const amountMaxFilter = list.getFilter('amount', 'lte')?.value as string | undefined;
  const fromFilter = list.getFilter('businessDate', 'gte')?.value as string | undefined;
  const toFilter = list.getFilter('businessDate', 'lte')?.value as string | undefined;

  // The search box is a raw DataTable input with no built-in debounce (unlike
  // the Data Engine's own GenericSearch), so it is debounced here exactly as
  // it was before this page moved onto the shared filter state.
  const debouncedSearch = useDebounce(list.state.search.trim(), 350);

  const scope = useMemo(
    () => ({
      ...(view === 'drafts'
        ? { status: 'draft', mine: true }
        : view === 'deleted'
          ? { deletedOnly: true, ...(statusFilter ? { status: statusFilter } : {}) }
          : statusFilter
            ? { status: statusFilter }
            : {}),
      ...(queryTypeFilter ? { queryType: queryTypeFilter } : {}),
      ...(priorityFilter ? { priority: priorityFilter } : {}),
      ...(branchIdFilter ? { branchId: branchIdFilter } : {}),
      ...(raisedByFilter ? { raisedBy: raisedByFilter } : {}),
      ...(queryNoFilter ? { queryNo: queryNoFilter } : {}),
      ...(amountMinFilter ? { amountMin: amountMinFilter } : {}),
      ...(amountMaxFilter ? { amountMax: amountMaxFilter } : {}),
      ...(fromFilter ? { from: fromFilter } : {}),
      ...(toFilter ? { to: toFilter } : {}),
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
    }),
    [
      view, statusFilter, queryTypeFilter, priorityFilter, branchIdFilter, raisedByFilter,
      queryNoFilter, amountMinFilter, amountMaxFilter, fromFilter, toFilter, debouncedSearch,
    ],
  );

  const apiFilters = useMemo(
    () => ({ ...scope, page: list.state.page, pageSize: list.state.pageSize }),
    [scope, list.state.page, list.state.pageSize],
  );

  const { data, isLoading, isFetching } = useFinanceTickets(apiFilters);
  const tickets = data?.tickets ?? [];
  const total = data?.total ?? 0;

  const isOwnDraft = (t: FinanceTicket) => t.status === 'draft' && t.raisedBy === user?.uid;

  /**
   * The same shape as the branch queue in the Support Center: Query ID ·
   * Reference · From · Issue · Amount · Status · a dense row of action icons
   * on desktop that collapses to one menu on a phone. Edit, Amend, Resolve,
   * Reject, Delete, Restore, Recreate and History all open straight from the
   * row; View opens the full feeding form.
   */
  const columns = useMemo(
    () => [
      col.accessor('queryNo', {
        header: 'Query ID',
        meta: { mobile: 'subtitle' },
        cell: ({ row }) => {
          const t = row.original;
          return (
            <div className="flex flex-col items-start gap-0.5">
              <span className="font-mono text-xs">{t.queryNo}</span>
              <span className="whitespace-nowrap text-[11px] text-muted-foreground">{formatQueryDate(t.createdAt, false)}</span>
              {t.amendCount > 0 && (
                <span className="text-[10px] text-teal-700 dark:text-teal-400">Amended {t.amendCount}× · v{t.version}</span>
              )}
              {t.reopenCount > 0 && (
                <span className="text-[10px] text-fuchsia-700 dark:text-fuchsia-400">Reopened {t.reopenCount}×</span>
              )}
              {t.recreatedFromQueryNo && <span className="text-[10px] text-muted-foreground">From {t.recreatedFromQueryNo}</span>}
              {t.recreatedAsQueryNo && <span className="text-[10px] text-muted-foreground">→ {t.recreatedAsQueryNo}</span>}
            </div>
          );
        },
      }),
      col.accessor((t) => t.referenceNo ?? t.transactionRef ?? t.expenseRef ?? t.incomeRef ?? '', {
        id: 'reference',
        header: 'Reference',
        meta: { mobile: 'title' },
        cell: ({ row }) => {
          const t = row.original;
          const ref = t.referenceNo ?? t.transactionRef ?? t.expenseRef ?? t.incomeRef ?? t.voucherRef;
          return (
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{FINANCE_QUERY_TYPE_LABELS[t.queryType]}</Badge>
              <span className="font-medium">{ref ?? t.subject}</span>
              {t.referenceType && ref === t.referenceNo && (
                <span className="text-xs text-muted-foreground">{FINANCE_TICKET_REFERENCE_LABELS[t.referenceType]}</span>
              )}
            </div>
          );
        },
      }),
      col.accessor('raisedByName', {
        header: 'From',
        meta: { mobileLabel: 'From' },
        cell: ({ row }) => {
          const t = row.original;
          return (
            <div className="space-y-1 text-sm">
              <div className="flex items-center gap-2">
                {sourceTag && (
                  <Badge
                    variant="secondary"
                    className="text-[10px] uppercase tracking-wide bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300"
                  >
                    Finance
                  </Badge>
                )}
                <span>{t.branchName || '—'}</span>
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {t.raisedByName || '—'}
                {t.raisedByRole ? ` · ${t.raisedByRole.replace(/_/g, ' ')}` : ''}
              </p>
            </div>
          );
        },
      }),
      col.accessor('subject', {
        header: 'Issue',
        meta: { mobileFull: true },
        cell: ({ row }) => {
          const t = row.original;
          const answer = t.adminResponse ?? t.resolutionNote;
          return (
            <div className="max-w-[26rem] min-w-0">
              <p className="truncate text-sm font-medium">{t.subject}</p>
              <p className="line-clamp-2 text-xs text-muted-foreground">{t.message}</p>
              {answer && (
                <p className="mt-1 line-clamp-1 text-xs">
                  <span className="text-muted-foreground">Admin: </span>
                  {answer}
                </p>
              )}
            </div>
          );
        },
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
        cell: ({ row }) => {
          const t = row.original;
          return (
            <div className="flex flex-col items-center gap-0.5">
              {t.deletedAt ? <Badge variant="destructive" className="whitespace-nowrap">Deleted</Badge> : <QueryStatusBadge status={t.status} />}
              <span className="whitespace-nowrap text-[10px] text-muted-foreground">{formatQueryDate(t.updatedAt, false)}</span>
              {(t.assignedToName ?? t.resolvedByName) && (
                <span className="max-w-[8rem] truncate text-[10px] text-muted-foreground">{t.assignedToName ?? t.resolvedByName}</span>
              )}
            </div>
          );
        },
      }),
      col.display({
        id: 'actions',
        header: '',
        cell: ({ row }) => {
          const t = row.original;
          const deleted = Boolean(t.deletedAt);
          const draft = t.status === 'draft';
          const own = t.raisedBy === user?.uid;
          const terminal = isFinanceTicketTerminal(t.status);
          const nexts = deleted || draft ? [] : FINANCE_TICKET_TRANSITIONS[t.status];
          const canResolve = nexts.includes('resolved');
          const canReject = nexts.includes('rejected');
          const canReopen = !deleted && (FINANCE_TICKET_REOPENABLE_STATUSES as readonly FinanceTicketStatus[]).includes(t.status);
          const canFeed = abilities.admin && !deleted && !draft;

          if (!abilities.admin) {
            // A Finance user: open the query, or — on their own draft — edit and submit it.
            return (
              <div className="flex items-center justify-end gap-0.5">
                <IconBtn title={draft && own ? 'Edit draft' : 'View'} onClick={() => setViewing(t.id)}>
                  {draft && own ? <Pencil className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </IconBtn>
                {draft && own && (
                  <IconBtn title="Submit to Admin" className="text-primary" onClick={() => void submitDraft(t)}>
                    <Send className="h-3.5 w-3.5" />
                  </IconBtn>
                )}
                {!draft && (
                  <IconBtn title="History" onClick={() => setRowAction({ kind: 'history', ticket: t })}>
                    <History className="h-3.5 w-3.5" />
                  </IconBtn>
                )}
                {canReopen && own && (
                  <IconBtn title="Request reopen" onClick={() => setRowAction({ kind: 'reopen', ticket: t })}>
                    <RotateCcw className="h-3.5 w-3.5" />
                  </IconBtn>
                )}
              </div>
            );
          }

          return (
            <>
              {/* Desktop keeps the dense icon row — the branch queue's shape. */}
              <div className="hidden items-center justify-end gap-0.5 md:flex">
                <IconBtn title="View" onClick={() => setViewing(t.id)}><Eye className="h-3.5 w-3.5" /></IconBtn>
                {deleted ? (
                  <IconBtn title="Restore" className="text-emerald-600" onClick={() => setRowAction({ kind: 'restore', ticket: t })}>
                    <ArchiveRestore className="h-3.5 w-3.5" />
                  </IconBtn>
                ) : (
                  <>
                    <IconBtn title="Edit" disabled={!canFeed} onClick={() => setRowAction({ kind: 'edit', ticket: t })}>
                      <Pencil className="h-3.5 w-3.5" />
                    </IconBtn>
                    <IconBtn title={terminal ? 'Reopen to amend' : 'Amend'} disabled={!canFeed || terminal} onClick={() => setRowAction({ kind: 'amend', ticket: t })}>
                      <Wand2 className="h-3.5 w-3.5" />
                    </IconBtn>
                    {canReopen ? (
                      <IconBtn title="Reopen" onClick={() => setRowAction({ kind: 'reopen', ticket: t })}>
                        <RotateCcw className="h-3.5 w-3.5" />
                      </IconBtn>
                    ) : (
                      <IconBtn title="Resolve" className="text-emerald-600" disabled={!canResolve} onClick={() => setRowAction({ kind: 'status', ticket: t, target: 'resolved' })}>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </IconBtn>
                    )}
                    <IconBtn title="Reject" className="text-amber-600" disabled={!canReject} onClick={() => setRowAction({ kind: 'status', ticket: t, target: 'rejected' })}>
                      <Ban className="h-3.5 w-3.5" />
                    </IconBtn>
                    <IconBtn title={t.recreatedAsId ? `Recreated as ${t.recreatedAsQueryNo}` : 'Recreate'} disabled={Boolean(t.recreatedAsId) || draft} onClick={() => setRowAction({ kind: 'recreate', ticket: t })}>
                      <Copy className="h-3.5 w-3.5" />
                    </IconBtn>
                    <IconBtn title="History" onClick={() => setRowAction({ kind: 'history', ticket: t })}>
                      <History className="h-3.5 w-3.5" />
                    </IconBtn>
                    <IconBtn title="Delete" className="text-destructive" disabled={draft} onClick={() => setRowAction({ kind: 'delete', ticket: t })}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </IconBtn>
                  </>
                )}
              </div>

              {/* On a phone the icons collapse into one menu. */}
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`Actions for ${t.queryNo}`}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:hidden"
                >
                  <MoreHorizontal className="h-5 w-5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setViewing(t.id)}><Eye className="h-4 w-4" /> View</DropdownMenuItem>
                  {deleted ? (
                    <DropdownMenuItem onClick={() => setRowAction({ kind: 'restore', ticket: t })}><ArchiveRestore className="h-4 w-4" /> Restore</DropdownMenuItem>
                  ) : (
                    <>
                      <DropdownMenuItem disabled={!canFeed} onClick={() => setRowAction({ kind: 'edit', ticket: t })}><Pencil className="h-4 w-4" /> Edit</DropdownMenuItem>
                      <DropdownMenuItem disabled={!canFeed || terminal} onClick={() => setRowAction({ kind: 'amend', ticket: t })}><Wand2 className="h-4 w-4" /> Amend</DropdownMenuItem>
                      {nexts.map((s) => (
                        <DropdownMenuItem key={s} onClick={() => setRowAction({ kind: 'status', ticket: t, target: s })}>
                          {s === 'resolved' ? <CheckCircle2 className="h-4 w-4" /> : s === 'rejected' ? <Ban className="h-4 w-4" /> : <Timer className="h-4 w-4" />}
                          {s === 'resolved' ? 'Resolve' : s === 'rejected' ? 'Reject' : s === 'closed' ? 'Close query' : FINANCE_TICKET_STATUS_LABELS[s]}
                        </DropdownMenuItem>
                      ))}
                      {canReopen && (
                        <DropdownMenuItem onClick={() => setRowAction({ kind: 'reopen', ticket: t })}><RotateCcw className="h-4 w-4" /> Reopen</DropdownMenuItem>
                      )}
                      <DropdownMenuItem disabled={Boolean(t.recreatedAsId) || draft} onClick={() => setRowAction({ kind: 'recreate', ticket: t })}><Copy className="h-4 w-4" /> Recreate</DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setRowAction({ kind: 'history', ticket: t })}><History className="h-4 w-4" /> History</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" disabled={draft} onClick={() => setRowAction({ kind: 'delete', ticket: t })}>
                        <Trash2 className="h-4 w-4" /> Delete
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          );
        },
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourceTag, money, user?.uid, abilities.admin],
  );

  async function submitDraft(t: FinanceTicket) {
    try {
      await rowMutation.mutateAsync({ path: `/api/finance/tickets/${t.id}/submit`, method: 'POST' });
      toast.success(`${t.queryNo} sent to the Admin`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The draft could not be submitted');
    }
  }

  async function restore(t: FinanceTicket, reason: string) {
    try {
      await rowMutation.mutateAsync({ path: `/api/finance/tickets/${t.id}/restore`, method: 'POST', body: { reason } });
      toast.success(`${t.queryNo} restored`);
      setRowAction(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The query could not be restored');
    }
  }

  const viewSwitch = (abilities.report || abilities.admin) && (
    <div className="flex rounded-md border p-0.5" role="tablist" aria-label="Which queries">
      <Button
        size="sm"
        variant={view === 'queue' ? 'default' : 'ghost'}
        className="h-8"
        onClick={() => switchView('queue')}
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
          onClick={() => switchView('drafts')}
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
          onClick={() => switchView('deleted')}
          role="tab"
          aria-selected={view === 'deleted'}
        >
          <Trash2 className="mr-1 h-3.5 w-3.5" /> Deleted
        </Button>
      )}
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

      <FilterBar
        list={list}
        filters={filterConfigs}
        options={filterOptions}
        searchable={false}
        leading={viewSwitch}
      />
      <ActiveFilters
        filters={list.activeFilters}
        configs={filterConfigs}
        options={filterOptions}
        onRemove={list.clearFilter}
        onClearAll={list.clearAll}
      />

      <DataTable
        columns={columns}
        data={tickets}
        loading={isLoading || (isFetching && tickets.length === 0)}
        searchPlaceholder="Search Query ID, reference, subject, user or branch…"
        actions={embedded ? newButton : undefined}
        pager={false}
        manual={{
          page: list.state.page,
          pageSize: list.state.pageSize,
          total,
          onPageChange: list.setPage,
          search: list.state.search,
          onSearchChange: list.setSearch,
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
      <Pagination
        page={list.state.page}
        pageSize={list.state.pageSize}
        total={total}
        onPageChange={list.setPage}
        onPageSizeChange={list.setPageSize}
        loading={isLoading || isFetching}
      />

      <NewQueryDialog key={newKey} open={showNew} onOpenChange={setShowNew} />
      {viewing && (
        <FinanceQueryDetailDialog
          ticketId={viewing}
          onClose={() => setViewing(null)}
          onOpenOther={(id) => setViewing(id)}
        />
      )}

      {/* Row actions — the same dialogs the detail screen uses, opened from the row. */}
      {rowAction && (rowAction.kind === 'edit' || rowAction.kind === 'amend' || rowAction.kind === 'recreate') && (
        <QuickFeedDialog
          ticket={rowAction.ticket}
          mode={rowAction.kind}
          onClose={() => setRowAction(null)}
          onDone={(result) => {
            const wasRecreate = rowAction.kind === 'recreate';
            setRowAction(null);
            if (wasRecreate && result) setViewing(result.id);
          }}
        />
      )}
      {rowAction?.kind === 'status' && (
        <StatusDialog ticket={rowAction.ticket} target={rowAction.target} onClose={() => setRowAction(null)} onDone={() => setRowAction(null)} />
      )}
      {rowAction?.kind === 'delete' && (
        <DeleteQueryDialog ticket={rowAction.ticket} onClose={() => setRowAction(null)} onDone={() => setRowAction(null)} />
      )}
      {rowAction?.kind === 'reopen' && (
        <ReopenDialog ticket={rowAction.ticket} isAdmin={abilities.admin} onClose={() => setRowAction(null)} onDone={() => setRowAction(null)} />
      )}
      {rowAction?.kind === 'history' && <HistoryDialog ticket={rowAction.ticket} onClose={() => setRowAction(null)} />}
      {rowAction?.kind === 'restore' && (
        <ReasonDialog
          title={`Restore — ${rowAction.ticket.queryNo}`}
          description="Brings the query back to the desk exactly as it was when it was deleted, with its status and history."
          confirmLabel="Restore query"
          pending={rowMutation.isPending}
          onConfirm={(r) => void restore(rowAction.ticket, r)}
          onClose={() => setRowAction(null)}
        />
      )}
    </div>
  );
}
