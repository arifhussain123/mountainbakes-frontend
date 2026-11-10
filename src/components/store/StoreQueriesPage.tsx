'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Archive, CheckCircle2, MessageSquare, Plus, Search, Send, XCircle } from 'lucide-react';
import type { StoreQuery, StoreQueryMessage, StoreQueryStatus, StoreQueryType } from '@mb/shared';
import {
  STORE_QUERY_STATUSES, STORE_QUERY_STATUS_LABELS, STORE_QUERY_TYPES, STORE_QUERY_TYPE_LABELS, StoreQueryInputSchema,
} from '@mb/shared';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useDebounce } from '@/hooks/useDebounce';
import {
  newSubmissionKey, useArchiveStoreQuery, useCreateStoreQuery, useReplyStoreQuery, useStoreQueries, useStoreQuery,
} from '@/lib/store';
import { cn } from '@/lib/utils';
import type { Tone } from './parts';
import {
  ConfirmDialog, ErrorBlock, Field, Pill, StorePage, errorMessage, fd, fdt, inputCls, useStoreSession,
} from './parts';

/**
 * Store Queries (spec §13). A Store keeper — or Production, from its own
 * demand page — raises a question; Admin answers in a thread, then resolves
 * or rejects it. For Admin this same page is the queue of every query.
 */

const PAGE = 20;

export const QUERY_TONE: Record<StoreQueryStatus, Tone> = {
  open: 'amber',
  in_review: 'blue',
  responded: 'blue',
  resolved: 'green',
  rejected: 'red',
};

export function QueryStatusPill({ status }: { status: StoreQueryStatus }) {
  return <Pill tone={QUERY_TONE[status]}>{STORE_QUERY_STATUS_LABELS[status]}</Pill>;
}

const RAISER_ROLE: Record<string, string> = { store_user: 'Store', production_user: 'Production', super_admin: 'Admin' };
const SIDE_LABEL: Record<StoreQueryMessage['authorSide'], string> = { store: 'Store', production: 'Production', admin: 'Admin' };

const relatedRefs = (q: StoreQuery) => [q.relatedReceiptNo, q.relatedDemandNo, q.relatedIssueNo].filter((x): x is string => !!x);

/**
 * Keeps the last page on screen while a larger one loads ("Load more"), so the
 * list does not collapse to a skeleton. `scope` is every list parameter except
 * the limit: when it changes, the old rows are not shown for the new filter.
 */
export function useHeld<T>(data: T | undefined, scope: string): T | undefined {
  const [held, setHeld] = useState<{ scope: string; data: T } | null>(null);
  if (data !== undefined && (held?.data !== data || held.scope !== scope)) setHeld({ scope, data });
  return data ?? (held?.scope === scope ? held.data : undefined);
}

/** One idempotency key per submission: reused while the same input is retried, new once it changes or succeeds. */
export function useSubmissionKey() {
  const last = useRef<{ sig: string; key: string } | null>(null);
  return {
    keyFor(sig: string) {
      if (!last.current || last.current.sig !== sig) last.current = { sig, key: newSubmissionKey() };
      return last.current.key;
    },
    reset() { last.current = null; },
  };
}

type TabValue = StoreQueryStatus | 'all';

function TabBar<T extends string>({ value, onChange, tabs }: {
  value: T;
  onChange: (v: T) => void;
  tabs: Array<{ value: T; label: string; count?: number }>;
}) {
  return (
    <div role="tablist" className="flex gap-0.5 overflow-x-auto overflow-y-hidden border-b border-border">
      {tabs.map((t) => {
        const on = t.value === value;
        return (
          <button
            key={t.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.value)}
            className={cn(
              'flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap px-3.5 text-sm transition-colors',
              on ? 'font-bold text-foreground shadow-[inset_0_-3px_0_var(--primary)]' : 'font-medium text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            {t.count !== undefined ? (
              <span className={cn('min-w-5 rounded-full px-1.5 py-px text-center text-xs font-bold tabular-nums', on ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                {t.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function StoreQueriesPage() {
  const session = useStoreSession();
  const { token, can } = session;
  const isAdmin = can('queries.admin');
  const canRaise = can('queries.raise') && !isAdmin;

  const [tab, setTab] = useState<TabValue>('all');
  const [search, setSearch] = useState('');
  const term = useDebounce(search.trim(), 300);
  const [archived, setArchived] = useState(false);
  const [pages, setPages] = useState(1);
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const params = { status: tab === 'all' ? undefined : tab, search: term || undefined, archived: archived || undefined };
  const listQ = useStoreQueries(token, { ...params, limit: PAGE * pages });
  const data = useHeld(listQ.data, JSON.stringify(params));
  const rows = data?.rows ?? [];
  const counts = data?.counts;

  const pick = (t: TabValue) => { setTab(t); setPages(1); };

  return (
    <StorePage
      session={session}
      subtitle={isAdmin
        ? 'Questions from the Store and Production. Reply in the thread, then resolve or reject.'
        : 'Ask Admin about receiving, stock, a demand or an issue. Replies arrive here.'}
      needs={isAdmin ? 'queries.admin' : 'queries.raise'}
      actions={canRaise ? <Button onClick={() => setCreating(true)}><Plus className="mr-1.5 h-4 w-4" />New Query</Button> : null}
    >
      <TabBar<TabValue>
        value={tab}
        onChange={pick}
        tabs={[
          { value: 'all', label: 'All', count: counts?.all },
          ...STORE_QUERY_STATUSES.map((s) => ({ value: s, label: STORE_QUERY_STATUS_LABELS[s], count: counts?.[s] })),
        ]}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPages(1); }}
            placeholder={isAdmin ? 'Search query ID, subject or name…' : 'Search query ID or subject…'}
            aria-label="Search queries"
            className={cn(inputCls(), 'pl-9')}
          />
        </div>
        {isAdmin && (
          <button
            type="button"
            aria-pressed={archived}
            onClick={() => { setArchived((a) => !a); setPages(1); }}
            className={cn(
              'flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-medium transition-colors',
              archived ? 'border-secondary bg-secondary text-secondary-foreground' : 'border-border bg-card text-foreground hover:border-primary/50',
            )}
          >
            <Archive className="h-3.5 w-3.5" /> Archived
          </button>
        )}
        {data ? <span className="ml-auto text-[13px] text-muted-foreground">{rows.length} of {data.total}</span> : null}
      </div>

      {listQ.isError && !data ? (
        <ErrorBlock error={listQ.error} onRetry={() => void listQ.refetch()} />
      ) : !data ? (
        <div className="grid gap-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-2xl" />)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title={term ? 'No query matches this search' : archived ? 'Nothing archived' : tab === 'all' ? 'No queries yet' : `Nothing under ${STORE_QUERY_STATUS_LABELS[tab]}.`}
          description={term ? 'Check the query ID or try fewer words.' : canRaise && tab === 'all' && !archived ? 'Raise one when something about stock, a receipt or an issue does not add up.' : undefined}
          action={canRaise && tab === 'all' && !term && !archived ? <Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1.5 h-4 w-4" />New Query</Button> : undefined}
          className="bg-card"
        />
      ) : (
        <section className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="hidden grid-cols-[110px_minmax(0,1fr)_150px_160px_100px_110px] gap-3 border-b border-border bg-muted/40 px-4 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground lg:grid">
            <span>Query ID</span><span>Subject</span><span>Related</span><span>Raised by</span><span>Date</span><span>Status</span>
          </div>
          <ul>
            {rows.map((q) => <QueryRow key={q.id} q={q} onOpen={() => setOpenId(q.id)} />)}
          </ul>
          {rows.length < data.total && (
            <div className="border-t border-border p-3 text-center">
              <Button variant="outline" size="sm" disabled={listQ.isFetching} onClick={() => setPages((p) => p + 1)}>
                {listQ.isFetching ? 'Loading…' : `Load more (${data.total - rows.length} left)`}
              </Button>
            </div>
          )}
        </section>
      )}

      {creating && <NewStoreQueryDialog token={token} onClose={() => setCreating(false)} onCreated={(q) => setOpenId(q.id)} />}
      {openId && <StoreQueryDialog token={token} id={openId} isAdmin={isAdmin} onClose={() => setOpenId(null)} />}
    </StorePage>
  );
}

function QueryRow({ q, onOpen }: { q: StoreQuery; onOpen: () => void }) {
  const refs = relatedRefs(q);
  return (
    <li className="border-t border-border first:border-t-0">
      <button
        type="button"
        onClick={onOpen}
        className="grid w-full gap-1 px-4 py-3 text-left transition-colors hover:bg-muted/40 lg:grid-cols-[110px_minmax(0,1fr)_150px_160px_100px_110px] lg:items-center lg:gap-3"
      >
        <div className="flex items-center justify-between gap-2 lg:block">
          <span className="font-mono text-[13px] font-medium">{q.queryNo}</span>
          <span className="lg:hidden"><QueryStatusPill status={q.status} /></span>
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{q.subject}</div>
          <div className="text-xs text-muted-foreground">{STORE_QUERY_TYPE_LABELS[q.queryType]}</div>
          {q.lastReply ? (
            <div className="mt-0.5 line-clamp-1 text-xs text-foreground/80"><span className="font-semibold">Admin:</span> {q.lastReply}</div>
          ) : null}
        </div>
        <div className="font-mono text-xs text-muted-foreground">
          {refs.length ? refs.join(' · ') : <span className="font-sans lg:inline">—</span>}
        </div>
        <div className="min-w-0 text-[13px]">
          <span className="font-medium">{q.raisedByName ?? '—'}</span>
          {q.raisedByRole ? <span className="text-muted-foreground"> · {RAISER_ROLE[q.raisedByRole] ?? q.raisedByRole}</span> : null}
        </div>
        <div className="text-[13px] tabular-nums text-muted-foreground">{fd(q.createdAt)}</div>
        <div className="hidden lg:block"><QueryStatusPill status={q.status} /></div>
      </button>
    </li>
  );
}

// ── New query ────────────────────────────────────────────────────────────────

/**
 * Raise a query (Store keeper or Production). Mounted only while open, so each
 * opening starts blank. `initial` prefills the type and related numbers when it
 * is raised from a demand or an issue.
 */
export function NewStoreQueryDialog({ token, onClose, onCreated, initial }: {
  token: string;
  onClose: () => void;
  onCreated?: (q: StoreQuery) => void;
  initial?: { queryType?: StoreQueryType; relatedReceiptNo?: string; relatedDemandNo?: string; relatedIssueNo?: string; subject?: string };
}) {
  const createM = useCreateStoreQuery(token);
  const keys = useSubmissionKey();
  const [tried, setTried] = useState(false);
  const [f, setF] = useState({
    subject: initial?.subject ?? '',
    queryType: initial?.queryType ?? ('other' as StoreQueryType),
    description: '',
    relatedReceiptNo: initial?.relatedReceiptNo ?? '',
    relatedDemandNo: initial?.relatedDemandNo ?? '',
    relatedIssueNo: initial?.relatedIssueNo ?? '',
  });
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  const ref = (v: string) => v.trim().toUpperCase() || null;
  const input = {
    subject: f.subject.trim(),
    queryType: f.queryType,
    description: f.description.trim(),
    relatedReceiptNo: ref(f.relatedReceiptNo),
    relatedDemandNo: ref(f.relatedDemandNo),
    relatedIssueNo: ref(f.relatedIssueNo),
  };
  const parsed = StoreQueryInputSchema.safeParse(input);
  const errs: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
  const e = (k: string) => (tried ? errs[k] ?? null : null);

  const save = () => {
    if (!parsed.success) { setTried(true); return; }
    createM.mutate({ input: parsed.data, key: keys.keyFor(JSON.stringify(parsed.data)) }, {
      onSuccess: (q) => {
        keys.reset();
        toast.success(`${q.queryNo} sent to Admin. Replies show in its thread.`);
        onClose();
        onCreated?.(q);
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !createM.isPending && onClose()}>
      <DialogContent mobile="fullscreen" className="md:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>New Query</DialogTitle>
          <DialogDescription>Admin answers in the query&apos;s thread. Query ID is assigned on save.</DialogDescription>
        </DialogHeader>
        <div className="grid content-start gap-3 sm:grid-cols-2">
          <Field label="Subject" required error={e('subject')} className="sm:col-span-2">
            <input className={inputCls(!!e('subject'))} value={f.subject} maxLength={120} onChange={(x) => set('subject', x.target.value)} placeholder="e.g. 2 bags short on RCV-000014" />
          </Field>
          <Field label="Query Type" required className="sm:col-span-2">
            <select className={inputCls()} value={f.queryType} onChange={(x) => set('queryType', x.target.value as StoreQueryType)}>
              {STORE_QUERY_TYPES.map((t) => <option key={t} value={t}>{STORE_QUERY_TYPE_LABELS[t]}</option>)}
            </select>
          </Field>
          <Field label="Description" required error={e('description')} className="sm:col-span-2">
            <Textarea rows={4} maxLength={2000} value={f.description} onChange={(x) => set('description', x.target.value)} placeholder="What happened, which items, and what you expected" className={cn(e('description') && 'border-red-600')} />
          </Field>
          <Field label="Receipt No." optional error={e('relatedReceiptNo')}>
            <input className={cn(inputCls(!!e('relatedReceiptNo')), 'font-mono uppercase')} value={f.relatedReceiptNo} onChange={(x) => set('relatedReceiptNo', x.target.value)} placeholder="RCV-000001" />
          </Field>
          <Field label="Demand No." optional error={e('relatedDemandNo')}>
            <input className={cn(inputCls(!!e('relatedDemandNo')), 'font-mono uppercase')} value={f.relatedDemandNo} onChange={(x) => set('relatedDemandNo', x.target.value)} placeholder="DRD-000001" />
          </Field>
          <Field label="Issue No." optional error={e('relatedIssueNo')}>
            <input className={cn(inputCls(!!e('relatedIssueNo')), 'font-mono uppercase')} value={f.relatedIssueNo} onChange={(x) => set('relatedIssueNo', x.target.value)} placeholder="ISS-000001" />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={createM.isPending}>Cancel</Button>
          <Button onClick={save} disabled={createM.isPending}>{createM.isPending ? 'Sending…' : 'Send Query'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Query detail and thread ─────────────────────────────────────────────────

/**
 * One query with its conversation. The raiser replies (a reply on a Responded
 * query reopens it); Admin replies, changes the status, resolves, rejects, and
 * archives a closed one.
 */
export function StoreQueryDialog({ token, id, isAdmin, onClose }: { token: string; id: string; isAdmin: boolean; onClose: () => void }) {
  const qQ = useStoreQuery(token, id);
  const replyM = useReplyStoreQuery(token);
  const archiveM = useArchiveStoreQuery(token);
  const [body, setBody] = useState('');
  const [status, setStatus] = useState<StoreQueryStatus | ''>('');
  const [archiving, setArchiving] = useState(false);
  const q = qQ.data;
  const closed = q?.status === 'resolved' || q?.status === 'rejected';
  const archivedQ = !!q?.archivedAt;
  const canReply = !!q && !archivedQ && (isAdmin || !closed);
  const busy = replyM.isPending || archiveM.isPending;

  const send = (next?: StoreQueryStatus) => {
    if (!q) return;
    const text = body.trim();
    const st = next ?? (status || undefined);
    if (!text && !st) { toast.error('Write a reply or change the status.'); return; }
    replyM.mutate({ id: q.id, input: { body: text || null, status: st && st !== q.status ? st : undefined } }, {
      onSuccess: (r) => {
        setBody('');
        setStatus('');
        toast.success(r.status !== q.status ? `${r.queryNo} is now ${STORE_QUERY_STATUS_LABELS[r.status]}.` : 'Reply sent.');
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  const messages = q?.messages ?? [];
  const refs = q ? relatedRefs(q) : [];

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent mobile="fullscreen" className="flex flex-col md:max-w-[680px]">
        <DialogHeader className="pr-8">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{q?.queryNo ?? 'Query'}</span>
            {q ? <QueryStatusPill status={q.status} /> : null}
            {archivedQ ? <Pill tone="muted">Archived</Pill> : null}
          </DialogTitle>
          <DialogDescription>
            {q ? `${STORE_QUERY_TYPE_LABELS[q.queryType]} · raised by ${q.raisedByName ?? '—'}${q.raisedByRole ? ` (${RAISER_ROLE[q.raisedByRole] ?? q.raisedByRole})` : ''} · ${fdt(q.createdAt)}` : ' '}
          </DialogDescription>
        </DialogHeader>

        {qQ.isLoading ? (
          <div className="grid gap-2"><Skeleton className="h-16 w-full" /><Skeleton className="h-32 w-full" /></div>
        ) : qQ.isError || !q ? (
          <ErrorBlock error={qQ.error} onRetry={() => void qQ.refetch()} />
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 md:max-h-[55vh] md:overflow-y-auto">
            <div className="rounded-xl border border-border bg-muted/30 p-3">
              <div className="text-[15px] font-semibold">{q.subject}</div>
              {refs.length ? (
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {refs.map((r) => <span key={r} className="rounded-md bg-card px-1.5 py-0.5 font-mono text-xs ring-1 ring-border">{r}</span>)}
                </div>
              ) : null}
              <p className="mt-2 whitespace-pre-wrap text-sm">{q.description}</p>
            </div>

            <ol className="flex flex-col gap-2" aria-label="Conversation">
              {messages.length === 0 ? (
                <li className="text-center text-[13px] text-muted-foreground">No replies yet.</li>
              ) : messages.map((m) => <ThreadMessage key={m.id} m={m} />)}
            </ol>
          </div>
        )}

        {q && (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            {canReply ? (
              <>
                <Textarea
                  rows={2}
                  maxLength={2000}
                  value={body}
                  onChange={(x) => setBody(x.target.value)}
                  placeholder={isAdmin ? 'Reply to the raiser…' : q.status === 'responded' ? 'Reply — this reopens the query for Admin' : 'Add to your query…'}
                  aria-label="Reply"
                />
                {isAdmin && (
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label="Status"
                      value={status}
                      onChange={(x) => setStatus(x.target.value as StoreQueryStatus | '')}
                      className="h-9 min-w-0 rounded-lg border border-border bg-card px-2 text-[13px]"
                    >
                      <option value="">Keep status ({STORE_QUERY_STATUS_LABELS[q.status]})</option>
                      {STORE_QUERY_STATUSES.filter((s) => s !== q.status).map((s) => <option key={s} value={s}>Mark {STORE_QUERY_STATUS_LABELS[s]}</option>)}
                    </select>
                    <span className="text-xs text-muted-foreground">A reply on an open query marks it Responded.</span>
                  </div>
                )}
              </>
            ) : (
              <p className="rounded-lg bg-muted px-3 py-2 text-[13px] text-muted-foreground">
                {archivedQ ? 'This query is archived. It is kept with its conversation and can no longer be answered.' : `This query is ${STORE_QUERY_STATUS_LABELS[q.status].toLowerCase()}. Raise a new query if something is still wrong.`}
              </p>
            )}
          </div>
        )}

        <DialogFooter className="flex-wrap">
          {isAdmin && q && closed && !archivedQ && (
            <Button variant="ghost" className="text-red-700 sm:mr-auto" disabled={busy} onClick={() => setArchiving(true)}>
              <Archive className="mr-1.5 h-4 w-4" />Delete
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={busy}>Close</Button>
          {isAdmin && canReply && q && (
            <>
              {q.status !== 'rejected' && (
                <Button variant="outline" className="border-red-200 text-red-700 hover:bg-red-50 dark:border-red-500/30 dark:hover:bg-red-500/10" disabled={busy} onClick={() => send('rejected')}>
                  <XCircle className="mr-1.5 h-4 w-4" />Reject
                </Button>
              )}
              {q.status !== 'resolved' && (
                <Button variant="outline" className="border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/30 dark:hover:bg-emerald-500/10" disabled={busy} onClick={() => send('resolved')}>
                  <CheckCircle2 className="mr-1.5 h-4 w-4" />Resolve
                </Button>
              )}
            </>
          )}
          {canReply && (
            <Button disabled={busy || (!body.trim() && !status)} onClick={() => send()}>
              <Send className="mr-1.5 h-4 w-4" />{replyM.isPending ? 'Sending…' : 'Send'}
            </Button>
          )}
        </DialogFooter>

        <ConfirmDialog
          open={archiving}
          onOpenChange={setArchiving}
          title={`Delete ${q?.queryNo ?? 'query'}?`}
          description="It leaves the queue; it and its conversation are kept."
          confirmLabel="Delete"
          destructive
          pending={archiveM.isPending}
          onConfirm={() => {
            if (!q) return;
            archiveM.mutate(q.id, {
              onSuccess: () => { toast.success(`${q.queryNo} archived.`); setArchiving(false); onClose(); },
              onError: (err) => { toast.error(errorMessage(err)); setArchiving(false); },
            });
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function ThreadMessage({ m }: { m: StoreQueryMessage }) {
  const admin = m.authorSide === 'admin';
  const change = m.statusChange
    ? admin
      ? `${m.authorName ?? 'Admin'} marked it ${STORE_QUERY_STATUS_LABELS[m.statusChange]}`
      : `${m.authorName ?? SIDE_LABEL[m.authorSide]}'s reply reopened it`
    : null;
  return (
    <li className="flex flex-col gap-1">
      {m.body ? (
        <div className={cn('flex flex-col gap-0.5', admin ? 'items-start' : 'items-end')}>
          <div className={cn(
            'max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm',
            admin ? 'rounded-bl-sm bg-primary/10 text-foreground' : 'rounded-br-sm bg-muted text-foreground',
          )}>
            {m.body}
          </div>
          <span className="px-1 text-[11.5px] text-muted-foreground">
            {m.authorName ?? '—'} · {SIDE_LABEL[m.authorSide]} · {fdt(m.createdAt)}
          </span>
        </div>
      ) : null}
      {change ? (
        <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
          <span className="h-px flex-1 bg-border" />
          <span>{change}{m.body ? '' : ` · ${fdt(m.createdAt)}`}</span>
          <span className="h-px flex-1 bg-border" />
        </div>
      ) : null}
    </li>
  );
}
