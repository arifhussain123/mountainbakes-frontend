'use client';

import { useMemo, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useAuth } from '@/hooks/useAuth';
import { DataTable } from '@/components/shared/DataTable';
import { StatCard } from '@/components/shared/StatCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
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
  CircleDot,
  Clock,
  Eye,
  FileQuestion,
  Headset,
  Inbox,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  ShieldAlert,
  Timer,
  CheckCircle2,
  Archive,
} from 'lucide-react';
import {
  CreateFinanceTicketSchema,
  FINANCE_QUERY_PRIORITIES,
  FINANCE_QUERY_PRIORITY_LABELS,
  FINANCE_QUERY_PRIORITY_RANK,
  FINANCE_QUERY_TYPES,
  FINANCE_QUERY_TYPE_LABELS,
  FINANCE_TICKET_PREFIXES,
  FINANCE_TICKET_STATUSES,
  FINANCE_TICKET_STATUS_LABELS,
  isFinanceTicketLive,
  type Attachment,
  type FinanceQueryPriority,
  type FinanceQueryType,
  type FinanceTicket,
  type FinanceTicketReferenceLookup,
  type FinanceTicketStatus,
} from '@mb/shared';
import { lookupFinanceReference, useFinanceMutation, useFinanceTickets } from '@/lib/finance';
import { FinancePageHeader } from './finance-ui';
import { FinanceQueryDetailDialog } from './FinanceQueryDetail';
import {
  QueryPriorityBadge,
  QueryReference,
  QueryStatusBadge,
  RecordFigures,
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
 * change which buttons the View popup offers.
 *
 * Every control here is decided by `useHelpDeskAbilities()`, and every one of
 * them calls an endpoint that decides the same thing again from the JWT. Hiding
 * a button is courtesy; the API is the boundary — which is §14 stated as code.
 *
 * The same component backs the Admin Support Center's Finance Queries tab, so an
 * admin never has to go looking in the finance module for work addressed to them
 * (§3). `embedded` drops the page heading there; nothing else differs.
 */

const col = createColumnHelper<FinanceTicket>();

const PREFIX_HINT = FINANCE_TICKET_PREFIXES.map((p) => `${p}-…`).join(', ');

// ---------------------------------------------------------------------------
// New Query (§2)
// ---------------------------------------------------------------------------

function NewQueryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { token } = useAuth();
  const mutation = useFinanceMutation();

  const [queryType, setQueryType] = useState<FinanceQueryType>('other');
  const [priority, setPriority] = useState<FinanceQueryPriority>('normal');
  const [referenceNo, setReferenceNo] = useState('');
  const [voucherRef, setVoucherRef] = useState('');
  const [reference, setReference] = useState<FinanceTicketReferenceLookup | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState('');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState<Attachment[]>([]);
  // Remounted via `key` each time it opens, so state starts fresh with no reset effect.

  async function handleLookup() {
    const ref = referenceNo.trim();
    if (!ref) return;
    setLooking(true);
    setLookupError('');
    setReference(null);
    try {
      setReference(await lookupFinanceReference(ref, token));
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Could not find that reference');
    } finally {
      setLooking(false);
    }
  }

  async function handleSubmit() {
    const parsed = CreateFinanceTicketSchema.safeParse({
      queryType,
      priority,
      referenceNo: reference?.referenceNo ?? referenceNo,
      voucherRef,
      subject,
      description,
      attachmentIds: photos.map((p) => p.id),
    });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? 'Please complete the form');
      return;
    }
    try {
      await mutation.mutateAsync({ path: '/api/finance/tickets', body: parsed.data });
      toast.success('Query sent to the Admin');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send query');
    }
  }

  // A reference is optional, but one that has been TYPED must have resolved —
  // submitting an unresolved reference means the Admin gets a query pointing at
  // a record that may not exist.
  const referencePending = referenceNo.trim().length > 0 && !reference;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto md:max-w-lg">
        <DialogHeader>
          <DialogTitle>New Query</DialogTitle>
          <DialogDescription>
            Report a financial issue, an incorrect transaction, a calculation problem or a data
            discrepancy. It goes straight to the Admin — the Query ID is assigned when you submit.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="nq-type">Query type</Label>
              <select
                id="nq-type"
                value={queryType}
                onChange={(e) => setQueryType(e.target.value as FinanceQueryType)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {FINANCE_QUERY_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {FINANCE_QUERY_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="nq-priority">Priority</Label>
              <select
                id="nq-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as FinanceQueryPriority)}
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
              >
                {FINANCE_QUERY_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {FINANCE_QUERY_PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1">
            <Label htmlFor="nq-ref">Reference ID</Label>
            <div className="flex gap-2">
              <Input
                id="nq-ref"
                value={referenceNo}
                onChange={(e) => {
                  setReferenceNo(e.target.value);
                  setReference(null);
                  setLookupError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleLookup();
                  }
                }}
                placeholder={`e.g. RV-000001 — optional`}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => void handleLookup()}
                disabled={looking || !referenceNo.trim()}
              >
                {looking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                <span className="ml-1">Find</span>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {PREFIX_HINT} — the record&apos;s figures load automatically and are attached to the
              query, so they stay readable even if it changes later. Leave blank for a calculation
              issue or anything that names no single record.
            </p>
            {lookupError && <p className="text-xs text-destructive">{lookupError}</p>}
          </div>

          {reference && (
            <RecordFigures
              record={reference.snapshot}
              heading={`${reference.label} · ${reference.referenceNo}`}
            />
          )}

          <div className="space-y-1">
            <Label htmlFor="nq-voucher">Ledger / Voucher ID</Label>
            <Input
              id="nq-voucher"
              value={voucherRef}
              onChange={(e) => setVoucherRef(e.target.value)}
              placeholder="Optional — another voucher or ledger handle worth looking at"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="nq-subject">Subject</Label>
            <Input
              id="nq-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Short summary, e.g. Branch share difference"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="nq-desc">Description</Label>
            <Textarea
              id="nq-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              placeholder="What looks wrong, and what you expected instead"
            />
          </div>

          <PhotoCapture
            entity="finance_ticket"
            value={photos}
            onChange={setPhotos}
            label="Attachment"
            hint="Optional — a photo of the slip, statement or screen"
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleSubmit()}
            disabled={
              mutation.isPending ||
              referencePending ||
              subject.trim().length < 3 ||
              description.trim().length < 3
            }
            title={referencePending ? 'Press Find to confirm the reference, or clear it' : undefined}
          >
            {mutation.isPending ? 'Sending…' : 'Submit to Admin'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Dashboard cards (§18)
// ---------------------------------------------------------------------------

/**
 * Counted from the loaded queue rather than a separate endpoint.
 *
 * The queue is capped at 500 rows, so on a very large backlog these are "of the
 * 500 most recent" rather than of all time. That is the right trade here: a
 * second round trip per card, invalidated by every write, would cost more than
 * the precision is worth on a desk that is meant to be kept near zero — and the
 * cards are a triage aid, not a report. The Reports module is where an exact
 * historical count belongs.
 */
function DashboardCards({ tickets, isAdmin }: { tickets: FinanceTicket[]; isAdmin: boolean }) {
  const counts = useMemo(() => {
    const by = (s: FinanceTicketStatus) => tickets.filter((t) => t.status === s).length;
    // `isFinanceTicketLive` rather than an inline list of the terminal three:
    // that list was written out here and in two other places, and every one of
    // them would have silently excluded `reopened` when migration 95 added it.
    const live = tickets.filter((t) => isFinanceTicketLive(t.status));
    const newest = tickets.reduce((max, t) => Math.max(max, new Date(t.updatedAt).getTime()), 0);
    return {
      open: by('open'),
      underReview: by('under_review'),
      waiting: by('waiting_for_finance'),
      reopened: by('reopened'),
      resolved: by('resolved'),
      closed: by('closed'),
      highPriority: live.filter((t) => t.priority === 'high' || t.priority === 'urgent').length,
      all: tickets.length,
      unassigned: live.filter((t) => !t.assignedTo).length,
      urgent: live.filter((t) => t.priority === 'urgent').length,
      // "Recently updated" is the last 24 hours — the window an admin coming back
      // to the desk in the morning actually cares about.
      // Within a day of the LATEST activity on the desk, not of the wall clock.
      //
      // Reading Date.now() here would make this component non-idempotent — the
      // same queue would render a different number on a re-render — which
      // `react-hooks/purity` rejects and the React Compiler cannot optimise
      // around. Measuring from the newest `updatedAt` needs no clock and is
      // deterministic for a given queue.
      //
      // On any desk that saw activity today the two definitions are the same
      // number. They differ only on a quiet desk, where this shows the last
      // active day's batch rather than a zero — which is the more useful answer
      // to "what moved recently" anyway.
      recent: newest
        ? tickets.filter((t) => newest - new Date(t.updatedAt).getTime() < 24 * 60 * 60 * 1000).length
        : 0,
    };
  }, [tickets]);

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      <StatCard title="Open" value={counts.open} icon={CircleDot} color="blue" />
      <StatCard title="Under Review" value={counts.underReview} icon={Timer} color="orange" />
      <StatCard title="High Priority" value={counts.highPriority} icon={ShieldAlert} color="red" />
      <StatCard title="Waiting for Finance" value={counts.waiting} icon={Clock} color="brown" />
      <StatCard title="Resolved" value={counts.resolved} icon={CheckCircle2} color="green" />
      <StatCard title="Closed" value={counts.closed} icon={Archive} color="brown" />

      {isAdmin && (
        <>
          <StatCard title="Reopened" value={counts.reopened} icon={RotateCcw} color="red" />
          <StatCard title="All Queries" value={counts.all} icon={Inbox} color="blue" />
          <StatCard title="Unassigned" value={counts.unassigned} icon={FileQuestion} color="orange" />
          <StatCard title="Urgent" value={counts.urgent} icon={AlertOctagon} color="red" />
          <StatCard title="Recently Updated" value={counts.recent} icon={Headset} color="green" />
        </>
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
   * Renders §5's FINANCE badge beside every Query ID.
   *
   *     FINANCE
   *     FIN-HD-20260901-00001
   *
   * Off on the finance module's own page, where every row is a finance query and
   * the badge would be noise on all of them; on inside the Admin Support Center,
   * where this table sits beside the branch and production queue and the tag is
   * how a row says which desk it came from.
   */
  sourceTag?: boolean;
}) {
  const abilities = useHelpDeskAbilities();

  const [status, setStatus] = useState<FinanceTicketStatus | 'all'>('all');
  const [queryType, setQueryType] = useState<FinanceQueryType | 'all'>('all');
  const [priority, setPriority] = useState<FinanceQueryPriority | 'all'>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [newKey, setNewKey] = useState(0);
  const [viewing, setViewing] = useState<string | null>(null);

  const filters = useMemo(
    () => ({
      ...(status !== 'all' ? { status } : {}),
      ...(queryType !== 'all' ? { queryType } : {}),
      ...(priority !== 'all' ? { priority } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    }),
    [status, queryType, priority, from, to],
  );

  const { data: tickets = [], isLoading } = useFinanceTickets(filters);

  /**
   * Urgent first, then newest.
   *
   * Sorted here rather than in SQL because the queue is one page: a `.order()`
   * on priority would need a CASE expression PostgREST cannot express, and the
   * rows are already in memory.
   */
  const rows = useMemo(
    () =>
      [...tickets].sort((a, b) => {
        const p = FINANCE_QUERY_PRIORITY_RANK[a.priority] - FINANCE_QUERY_PRIORITY_RANK[b.priority];
        if (p !== 0) return p;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }),
    [tickets],
  );

  /**
   * §4's columns: Query ID · Date · Subject · Category · Priority · Status ·
   * Admin · Last Update · Action.
   *
   * `meta.mobile` is what makes the same definition render as a full table above
   * md and as one card per query below it (§20) — DataTable reads these
   * annotations and needs no second implementation. `title`/`subtitle`/`badge`
   * are the card's head; `mobileFull` puts a field on its own row; `hidden`
   * drops a field from the card entirely, which is how the card stays the six
   * lines §20 asks for rather than a table turned sideways.
   */
  const columns = useMemo(
    () => [
      col.accessor('queryNo', {
        header: 'Query ID',
        meta: { mobile: 'title' },
        cell: ({ row }) => (
          <div className="flex flex-col items-start gap-0.5">
            {sourceTag && (
              <Badge
                variant="secondary"
                className="text-[10px] uppercase tracking-wide bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300"
              >
                Finance
              </Badge>
            )}
            <span className="font-mono text-xs">{row.original.queryNo}</span>
            {row.original.reopenCount > 0 && (
              <span className="text-[10px] text-fuchsia-700 dark:text-fuchsia-400">
                Reopened {row.original.reopenCount}×
              </span>
            )}
          </div>
        ),
      }),
      col.accessor('createdAt', {
        header: 'Date',
        // §20's card names Date explicitly ("Date: 01 Sep 2026"), so it stays on
        // the card as its own row rather than being dropped with the columns the
        // card has no room for. Date-only there — the time belongs on the full
        // table and in the View popup, and a card is read at arm's length.
        meta: { mobileFull: true, mobileLabel: 'Date' },
        cell: (info) => (
          <span className="whitespace-nowrap text-sm">{formatQueryDate(info.getValue(), false)}</span>
        ),
      }),
      col.accessor('subject', {
        header: 'Subject',
        meta: { mobile: 'subtitle', mobileFull: true },
        cell: ({ row }) => (
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{row.original.subject}</p>
            <p className="text-xs text-muted-foreground">
              {row.original.raisedByName}
              {row.original.referenceNo ? ` · ${row.original.referenceNo}` : ''}
            </p>
          </div>
        ),
      }),
      col.accessor((t) => FINANCE_QUERY_TYPE_LABELS[t.queryType], {
        id: 'category',
        header: 'Category',
        // Hidden on the card: §20's card leads with the ID, the subject, the
        // priority and the status, and the category is already the first thing
        // the View popup shows.
        meta: { mobile: 'hidden' },
        cell: ({ row }) => <QueryReference ticket={row.original} />,
      }),
      col.accessor('priority', {
        header: 'Priority',
        meta: { mobile: 'badge', align: 'center' },
        cell: (info) => <QueryPriorityBadge priority={info.getValue()} />,
      }),
      col.accessor('status', {
        header: 'Status',
        meta: { mobile: 'badge', align: 'center' },
        cell: (info) => <QueryStatusBadge status={info.getValue()} />,
      }),
      col.accessor((t) => t.assignedToName ?? '', {
        id: 'admin',
        header: 'Admin',
        meta: { mobile: 'hidden' },
        cell: ({ row }) => {
          const t = row.original;
          if (t.assignedToName) return <span className="text-sm">{t.assignedToName}</span>;
          // An answered-but-unassigned query is normal: an admin can respond
          // without taking the query, and saying "Unassigned" there would read
          // as "nobody has looked at this".
          if (t.respondedByName) return <span className="text-sm">{t.respondedByName}</span>;
          return <span className="text-xs text-muted-foreground">Unassigned</span>;
        },
      }),
      col.accessor('updatedAt', {
        id: 'lastUpdate',
        header: 'Last Update',
        meta: { mobileFull: true, mobileLabel: 'Last update' },
        cell: ({ row }) => {
          const t = row.original;
          const answer = t.adminResponse ?? t.resolutionNote;
          return (
            <div className="min-w-0">
              <p className="whitespace-nowrap text-sm">{formatQueryDate(t.updatedAt)}</p>
              <p className="line-clamp-2 max-w-[16rem] text-xs text-muted-foreground">
                {answer ?? 'Awaiting Admin'}
              </p>
            </div>
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
              aria-label={`View query ${row.original.queryNo}`}
            >
              <Eye className="mr-1 h-4 w-4" /> View
            </Button>
          </div>
        ),
      }),
    ],
    [sourceTag],
  );

  const filterControls = (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={status}
        onChange={(e) => setStatus(e.target.value as typeof status)}
        className="h-9 rounded-md border bg-background px-2 text-sm"
        aria-label="Filter by status"
      >
        <option value="all">All statuses</option>
        {FINANCE_TICKET_STATUSES.map((s) => (
          <option key={s} value={s}>
            {FINANCE_TICKET_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      <select
        value={queryType}
        onChange={(e) => setQueryType(e.target.value as typeof queryType)}
        className="h-9 rounded-md border bg-background px-2 text-sm"
        aria-label="Filter by query type"
      >
        <option value="all">All types</option>
        {FINANCE_QUERY_TYPES.map((t) => (
          <option key={t} value={t}>
            {FINANCE_QUERY_TYPE_LABELS[t]}
          </option>
        ))}
      </select>
      <select
        value={priority}
        onChange={(e) => setPriority(e.target.value as typeof priority)}
        className="h-9 rounded-md border bg-background px-2 text-sm"
        aria-label="Filter by priority"
      >
        <option value="all">All priorities</option>
        {FINANCE_QUERY_PRIORITIES.map((p) => (
          <option key={p} value={p}>
            {FINANCE_QUERY_PRIORITY_LABELS[p]}
          </option>
        ))}
      </select>
      <Input
        type="date"
        value={from}
        onChange={(e) => setFrom(e.target.value)}
        className="h-9 w-auto"
        aria-label="From date"
      />
      <Input
        type="date"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        className="h-9 w-auto"
        aria-label="To date"
      />
    </div>
  );

  return (
    <div className="space-y-6">
      {!embedded && (
        <FinancePageHeader
          title="Finance Help Desk"
          description={
            abilities.admin
              ? 'Queries raised by Finance against financial records. You are the only role that can change, amend, overwrite or delete the record behind one — every action is tied to the Query ID and written to the audit trail.'
              : 'Report an incorrect transaction, a calculation problem or a data discrepancy directly to the Admin. You can raise, view and discuss a query; only the Admin can change the underlying record.'
          }
          actions={
            abilities.report ? (
              <Button
                onClick={() => {
                  setNewKey((k) => k + 1);
                  setShowNew(true);
                }}
              >
                <Plus className="mr-1 h-4 w-4" /> New Query
              </Button>
            ) : undefined
          }
        />
      )}

      <DashboardCards tickets={tickets} isAdmin={abilities.admin} />

      <DataTable
        columns={columns}
        data={rows}
        loading={isLoading}
        searchPlaceholder="Search Query ID, reference, voucher or subject…"
        leading={filterControls}
        actions={
          embedded && abilities.report ? (
            <Button
              size="sm"
              onClick={() => {
                setNewKey((k) => k + 1);
                setShowNew(true);
              }}
            >
              <Plus className="mr-1 h-4 w-4" /> New Query
            </Button>
          ) : undefined
        }
        empty={
          <div className="p-10 text-center text-muted-foreground">
            <Headset className="mx-auto mb-2 h-8 w-8 opacity-50" />
            <p className="text-sm">
              {abilities.admin
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
        <FinanceQueryDetailDialog ticketId={viewing} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}
