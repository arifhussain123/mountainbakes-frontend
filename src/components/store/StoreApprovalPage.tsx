'use client';

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ClipboardList, PackageCheck, Undo2 } from 'lucide-react';
import type { StoreDemand, StoreDemandLine, StoreDemandStatus, StoreIssue, StoreIssueStatus } from '@mb/shared';
import { STORE_ISSUE_STATUS_LABELS } from '@mb/shared';
import { EmptyState } from '@/components/shared/EmptyState';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import {
  newSubmissionKey, useApproveAllStoreDemand, useDecideStoreLine, useIssueStock, useStoreDemandCounts, useStoreDemands, useStoreIssues,
} from '@/lib/store';
import { cn } from '@/lib/utils';
import type { Tone } from './parts';
import {
  DemandStatusPill, ErrorBlock, Fact, Field, LINE_LABEL, LINE_TONE, Pill, StorePage, errorMessage, fd, inputCls, num, plural, qty, rate, rs,
  useStoreSession,
} from './parts';

/**
 * Demand Approval & Issue (design: "Demand Approval and Issue"). The Store
 * keeper decides each line of a Production demand — in full, or less with a
 * reason — then issues the approved quantities. Stock leaves FIFO by batch.
 */

const PAGE = 20;

type TabKey = 'pending' | 'ready' | 'issued' | 'rejected' | 'all';
const TABS: Array<{ key: TabKey; label: string; statuses: StoreDemandStatus[] }> = [
  { key: 'pending', label: 'Pending review', statuses: ['pending_review'] },
  { key: 'ready', label: 'Ready to issue', statuses: ['ready_to_issue'] },
  { key: 'issued', label: 'Issued', statuses: ['issued', 'received'] },
  { key: 'rejected', label: 'Rejected', statuses: ['rejected'] },
  // Cancelled demands are Production's own business; the queue leaves them out.
  { key: 'all', label: 'All', statuses: ['pending_review', 'ready_to_issue', 'issued', 'received', 'rejected'] },
];

const QUICK_REASONS = ['Not enough stock', 'Not in today’s production plan', 'Duplicate request', 'Use a substitute item'];

const ISSUE_TONE: Record<StoreIssueStatus, Tone> = { issued: 'amber', received: 'green', received_with_difference: 'red' };

/** KG and Litre may be split; everything else is counted in whole units (the API's rule). */
const allowsFraction = (unit: string) => ['kg', 'litre', 'liter'].includes(unit.trim().toLowerCase());
const toNum = (s: string) => (s.trim() === '' ? NaN : Number(s));

/** What this line could still be approved for (or, once approved, what it holds). */
function freeFor(l: StoreDemandLine): number {
  const own = l.status === 'approved' ? Math.max(0, (l.approvedQty ?? 0) - l.issuedQty) : 0;
  return l.availableQty - l.committedQty + own;
}
const remainingOf = (l: StoreDemandLine) => Math.max(0, (l.approvedQty ?? 0) - l.issuedQty);
const issuable = (d: StoreDemand) => d.lines.filter((l) => l.status === 'approved' && remainingOf(l) > 0);

/** See StoreQueriesPage: keeps the shown page while "Load more" fetches a bigger one. */
function useHeld<T>(data: T | undefined, scope: string): T | undefined {
  const [held, setHeld] = useState<{ scope: string; data: T } | null>(null);
  if (data !== undefined && (held?.data !== data || held.scope !== scope)) setHeld({ scope, data });
  return data ?? (held?.scope === scope ? held.data : undefined);
}

function TabBar({ value, onChange, counts }: { value: TabKey; onChange: (v: TabKey) => void; counts: Record<TabKey, number> | null }) {
  return (
    <div role="tablist" className="flex gap-0.5 overflow-x-auto overflow-y-hidden border-b border-border">
      {TABS.map((t) => {
        const on = t.key === value;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={cn(
              'flex h-11 shrink-0 items-center gap-1.5 whitespace-nowrap px-3.5 text-sm transition-colors',
              on ? 'font-bold text-foreground shadow-[inset_0_-3px_0_var(--primary)]' : 'font-medium text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
            {counts ? (
              <span className={cn('min-w-5 rounded-full px-1.5 py-px text-center text-xs font-bold tabular-nums', on ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}>
                {counts[t.key]}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

type Modal =
  | { kind: 'reject'; demand: StoreDemand; line: StoreDemandLine }
  | { kind: 'less'; demand: StoreDemand; line: StoreDemandLine }
  | { kind: 'issue'; demand: StoreDemand }
  | { kind: 'issues'; demand: StoreDemand };

export function StoreApprovalPage() {
  const session = useStoreSession();
  const { token, can, today } = session;
  const canIssue = can('issue');

  const [tab, setTab] = useState<TabKey>('pending');
  const [pages, setPages] = useState(1);
  const [modal, setModal] = useState<Modal | null>(null);

  const statuses = TABS.find((t) => t.key === tab)!.statuses;
  const listQ = useStoreDemands(token, { status: statuses, limit: PAGE * pages });
  const data = useHeld(listQ.data, tab);
  const countsQ = useStoreDemandCounts(token);
  const c = countsQ.data;
  const counts: Record<TabKey, number> | null = c
    ? { pending: c.pending_review, ready: c.ready_to_issue, issued: c.issued + c.received, rejected: c.rejected, all: c.all - c.cancelled }
    : null;

  const decideM = useDecideStoreLine(token);
  const approveAllM = useApproveAllStoreDemand(token);

  // The work queues read soonest-needed first; history reads newest first (the API's order).
  const rows = (data?.rows ?? []).slice();
  if (tab === 'pending' || tab === 'ready') {
    rows.sort((a, b) => a.requiredDate.localeCompare(b.requiredDate) || a.demandNo.localeCompare(b.demandNo));
  }
  const tabLabel = TABS.find((t) => t.key === tab)!.label;

  const approve = (l: StoreDemandLine) =>
    decideM.mutate({ lineId: l.id, input: { decision: 'approve' } }, {
      onSuccess: () => toast.success(`${l.itemName} approved for ${qty(l.requestedQty, l.unit)}.`),
      onError: (e) => toast.error(errorMessage(e)),
    });
  const undo = (l: StoreDemandLine) =>
    decideM.mutate({ lineId: l.id, input: { decision: 'undo' } }, {
      onSuccess: () => toast.success(`Approval of ${l.itemName} undone. It is pending again.`),
      onError: (e) => toast.error(errorMessage(e)),
    });
  const approveAll = (d: StoreDemand) =>
    approveAllM.mutate(d.id, {
      onSuccess: (r) => {
        const left = r.skipped ? `${r.skipped} short of stock left for you to decide` : '';
        if (r.approved === 0) toast.warning(r.skipped ? `Nothing fits free stock: ${left}.` : 'Nothing was waiting for a decision.');
        else toast.success(`${plural(r.approved, 'line')} approved${left ? `, ${left}` : ''}.`);
      },
      onError: (e) => toast.error(errorMessage(e)),
    });

  const busyLine = (l: StoreDemandLine) => decideM.isPending && decideM.variables?.lineId === l.id;

  return (
    <StorePage
      session={session}
      subtitle="Approve or reject each line. Approve less only with a reason. Issuing moves stock out of the store, oldest batch first."
      needs="demand.review"
    >
      <TabBar value={tab} onChange={(t) => { setTab(t); setPages(1); }} counts={counts} />

      {listQ.isError && !data ? (
        <ErrorBlock error={listQ.error} onRetry={() => void listQ.refetch()} />
      ) : !data ? (
        <div className="grid gap-3">
          {[0, 1].map((i) => <Skeleton key={i} className="h-48 w-full rounded-2xl" />)}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {tab === 'pending' ? 'No demand waiting for review.' : `Nothing under ${tabLabel}.`}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {rows.map((d) => {
            const pendingLines = d.lines.some((l) => l.status === 'pending');
            const toIssue = issuable(d);
            const open = d.status === 'pending_review' || d.status === 'ready_to_issue';
            const urgent = open && !!today && d.requiredDate <= today;
            return (
              <section key={d.id} className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card">
                <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border bg-muted/40 px-4 py-3">
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <span className="font-mono text-[15px] font-medium">{d.demandNo}</span>
                      <DemandStatusPill status={d.status} />
                      {urgent ? <Pill tone="red">{d.requiredDate < today ? 'Overdue' : 'Needed today'}</Pill> : null}
                    </div>
                    <span className="text-[12.5px] text-muted-foreground">
                      {d.productionCode ?? '—'} · {d.requestedByName ?? '—'} · raised {fd(d.demandDate)} · needed by {fd(d.requiredDate)}
                    </span>
                    {d.remarks ? <span className="text-[13px] text-foreground/80">“{d.remarks}”</span> : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {d.issues.length > 0 && (
                      <Button variant="outline" onClick={() => setModal({ kind: 'issues', demand: d })}>
                        <ClipboardList className="mr-1.5 h-4 w-4" />View {d.issues.length === 1 ? 'issue' : `${d.issues.length} issues`}
                      </Button>
                    )}
                    {pendingLines && (
                      <Button variant="outline" disabled={approveAllM.isPending} onClick={() => approveAll(d)}>
                        {approveAllM.isPending && approveAllM.variables === d.id ? 'Approving…' : 'Approve all that fit'}
                      </Button>
                    )}
                    {canIssue && toIssue.length > 0 && (
                      <Button onClick={() => setModal({ kind: 'issue', demand: d })}>
                        <PackageCheck className="mr-1.5 h-4 w-4" />Issue {plural(toIssue.length, 'approved line')}
                      </Button>
                    )}
                  </div>
                </div>
                {d.lines.map((l) => (
                  <LineRow
                    key={l.id}
                    l={l}
                    busy={busyLine(l)}
                    onApprove={() => approve(l)}
                    onReject={() => setModal({ kind: 'reject', demand: d, line: l })}
                    onLess={() => setModal({ kind: 'less', demand: d, line: l })}
                    onUndo={() => undo(l)}
                  />
                ))}
              </section>
            );
          })}
          {rows.length < data.total && (
            <div className="text-center">
              <Button variant="outline" disabled={listQ.isFetching} onClick={() => setPages((p) => p + 1)}>
                {listQ.isFetching ? 'Loading…' : `Load more (${data.total - rows.length} left)`}
              </Button>
            </div>
          )}
        </div>
      )}

      {modal?.kind === 'reject' && <RejectDialog token={token} demand={modal.demand} line={modal.line} onClose={() => setModal(null)} />}
      {modal?.kind === 'less' && <ApproveLessDialog token={token} demand={modal.demand} line={modal.line} onClose={() => setModal(null)} />}
      {modal?.kind === 'issue' && <IssueDialog token={token} today={today} demand={modal.demand} onClose={() => setModal(null)} />}
      {modal?.kind === 'issues' && <IssuesDialog token={token} demand={modal.demand} onClose={() => setModal(null)} />}
    </StorePage>
  );
}

function Figure({ k, v, className }: { k: string; v: string; className?: string }) {
  return (
    <div className="min-w-0 text-right">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{k}</div>
      <div className={cn('whitespace-nowrap text-sm tabular-nums', className)}>{v}</div>
    </div>
  );
}

function LineRow({ l, busy, onApprove, onReject, onLess, onUndo }: {
  l: StoreDemandLine;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onLess: () => void;
  onUndo: () => void;
}) {
  const free = freeFor(l);
  const pending = l.status === 'pending';
  const short = pending && l.requestedQty > free;
  const approved = l.approvedQty ?? 0;
  const partial = (l.status === 'approved' || l.status === 'issued') && approved < l.requestedQty;
  const canLess = pending && Math.min(l.requestedQty, free) > 0;

  let badge = LINE_LABEL[l.status] ?? l.status;
  if (l.status === 'approved') badge = partial ? `Approved ${num(approved)} of ${qty(l.requestedQty, l.unit)}` : 'Approved';
  if (l.status === 'issued') badge = partial ? `Issued ${num(l.issuedQty)} of ${qty(l.requestedQty, l.unit)}` : 'Issued';

  const notes: Array<{ text: string; tone?: 'bad' }> = [];
  if (l.status === 'rejected') notes.push({ text: `Rejected: ${l.decisionNote ?? '—'}${l.decidedByName ? ` · ${l.decidedByName}` : ''}`, tone: 'bad' });
  if (partial && l.decisionNote) notes.push({ text: `Approved less: ${l.decisionNote}${l.decidedByName ? ` · ${l.decidedByName}` : ''}` });
  if (l.status === 'approved' && l.issuedQty > 0) notes.push({ text: `${qty(l.issuedQty, l.unit)} issued on ${l.issueNos.join(', ')} · ${qty(remainingOf(l), l.unit)} still to issue` });
  if (l.status === 'issued') notes.push({ text: `Issued on ${l.issueNos.join(', ') || '—'}${l.decidedByName ? ` · approved by ${l.decidedByName}` : ''}` });
  if (l.remarks) notes.push({ text: `Production note: ${l.remarks}` });
  if (short) {
    notes.push({
      text: free > 0
        ? `Not enough free stock for all of it. Approve ${qty(free, l.unit)} with a reason, reject it, or wait for receiving.`
        : 'No free stock. Reject it, or wait for receiving and approve then.',
      tone: 'bad',
    });
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2.5 border-t border-border/60 px-4 py-2.5 first:border-t-0', short && 'bg-red-50/60 dark:bg-red-500/5')}>
      <div className="min-w-0 flex-[1_1_200px]">
        <div className="text-sm font-semibold">{l.itemName}</div>
        <div className="text-xs text-muted-foreground">{l.itemNo} · {l.itemCode}</div>
      </div>
      <div className="flex flex-[0_1_auto] gap-4">
        <Figure k="Requested" v={qty(l.requestedQty, l.unit)} className="text-[15px] font-extrabold" />
        <Figure k="In store" v={qty(l.availableQty, l.unit)} />
        <Figure k="Free" v={qty(free, l.unit)} className={cn('font-semibold', short && 'text-red-700 dark:text-red-400')} />
      </div>
      <div className="ml-auto flex flex-[0_0_auto] flex-wrap items-center justify-end gap-1.5">
        {pending ? (
          <>
            {short ? <span className="text-xs font-bold text-red-700 dark:text-red-400">Short {qty(l.requestedQty - Math.max(free, 0), l.unit)}</span> : null}
            {canLess ? (
              <Button variant="ghost" disabled={busy} onClick={onLess} className="text-[13px] text-muted-foreground">Approve less…</Button>
            ) : null}
            <Button
              variant="outline"
              disabled={busy}
              onClick={onReject}
              className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10"
            >
              Reject
            </Button>
            {/* The title sits on a wrapper: a disabled button takes no pointer events, so its own title never shows. */}
            <span title={short ? 'Free stock does not cover the full quantity' : 'Approve the full quantity'} className={cn(short && 'cursor-not-allowed')}>
              <Button
                disabled={busy || short}
                onClick={onApprove}
                className="bg-emerald-700 font-bold text-white hover:bg-emerald-800"
              >
                {busy ? 'Saving…' : 'Approve'}
              </Button>
            </span>
          </>
        ) : (
          <>
            <Pill tone={LINE_TONE[l.status] ?? 'muted'}>{badge}</Pill>
            {l.status === 'approved' && l.issuedQty === 0 ? (
              <Button variant="ghost" size="sm" disabled={busy} onClick={onUndo} className="text-muted-foreground">
                <Undo2 className="mr-1 h-3.5 w-3.5" />{busy ? 'Undoing…' : 'Undo'}
              </Button>
            ) : null}
          </>
        )}
      </div>
      {notes.length > 0 && (
        <div className="flex basis-full flex-col gap-0.5">
          {notes.map((n) => (
            <div key={n.text} className={cn('text-[12.5px]', n.tone === 'bad' ? 'text-red-800 dark:text-red-400' : 'text-muted-foreground')}>{n.text}</div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Reject ──────────────────────────────────────────────────────────────────

function RejectDialog({ token, demand, line, onClose }: { token: string; demand: StoreDemand; line: StoreDemandLine; onClose: () => void }) {
  const decideM = useDecideStoreLine(token);
  const free = freeFor(line);
  const short = line.requestedQty > free;
  const [reason, setReason] = useState(short ? `Not enough stock: ${qty(Math.max(free, 0), line.unit)} free` : '');
  const [tried, setTried] = useState(false);
  const err = tried && !reason.trim() ? 'Give Production a reason.' : null;

  const confirm = () => {
    if (!reason.trim()) { setTried(true); return; }
    decideM.mutate({ lineId: line.id, input: { decision: 'reject', note: reason.trim() } }, {
      onSuccess: () => { toast.success('Line rejected. Production can see the reason.'); onClose(); },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !decideM.isPending && onClose()}>
      <DialogContent className="md:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Reject {line.itemName}</DialogTitle>
          <DialogDescription>{demand.demandNo} · {qty(line.requestedQty, line.unit)} requested · the whole line is rejected</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold">Quick reasons</span>
          <div className="flex flex-wrap gap-1.5">
            {QUICK_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setReason(r)}
                className={cn('h-[34px] rounded-full border px-3 text-[13px] transition-colors', reason === r ? 'border-primary bg-primary/10 font-semibold' : 'border-border bg-card hover:border-primary/50')}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <Field label="Reason Production will see" required error={err}>
          <Textarea rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} className={cn(err && 'border-red-600')} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={decideM.isPending}>Cancel</Button>
          <Button onClick={confirm} disabled={decideM.isPending} className="bg-red-700 text-white hover:bg-red-800">
            {decideM.isPending ? 'Saving…' : 'Reject line'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Approve less (partial approval) ─────────────────────────────────────────

function ApproveLessDialog({ token, demand, line, onClose }: { token: string; demand: StoreDemand; line: StoreDemandLine; onClose: () => void }) {
  const decideM = useDecideStoreLine(token);
  const free = Math.max(0, freeFor(line));
  const max = Math.min(line.requestedQty, free);
  const whole = !allowsFraction(line.unit);
  const startQty = whole ? Math.floor(max) : max;
  const [q, setQ] = useState(startQty > 0 ? String(startQty) : '');
  const [note, setNote] = useState(free < line.requestedQty ? `Only ${qty(free, line.unit)} free in the store` : '');
  const [tried, setTried] = useState(false);

  const n = toNum(q);
  let qErr: string | null = null;
  if (!(n > 0)) qErr = 'Enter a quantity above 0.';
  else if (n > max) qErr = `At most ${qty(max, line.unit)}${max < line.requestedQty ? ' (free stock)' : ''}.`;
  else if (whole && !Number.isInteger(n)) qErr = `Whole ${line.unit.toLowerCase()} only.`;
  const less = n > 0 && n < line.requestedQty;
  const nErr = less && !note.trim() ? 'Tell Production why it gets less.' : null;

  const confirm = () => {
    if (qErr || nErr) { setTried(true); return; }
    decideM.mutate({ lineId: line.id, input: { decision: 'approve', qty: n, note: note.trim() || null } }, {
      onSuccess: () => {
        toast.success(less ? `${line.itemName} approved for ${num(n)} of ${qty(line.requestedQty, line.unit)}.` : `${line.itemName} approved for ${qty(n, line.unit)}.`);
        onClose();
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !decideM.isPending && onClose()}>
      <DialogContent className="md:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Approve less of {line.itemName}</DialogTitle>
          <DialogDescription>
            {demand.demandNo} · {qty(line.requestedQty, line.unit)} requested · {qty(free, line.unit)} free. The rest of the line counts as rejected.
          </DialogDescription>
        </DialogHeader>
        <Field label="Approve quantity" required error={tried ? qErr : null} hint={`Up to ${qty(max, line.unit)}`}>
          <div className={cn('flex items-center overflow-hidden rounded-lg border bg-card', tried && qErr ? 'border-red-600' : 'border-border')}>
            <input
              inputMode="decimal"
              value={q}
              onChange={(e) => setQ(e.target.value.replace(/[^\d.]/g, ''))}
              className="h-10 min-w-0 flex-1 bg-transparent px-3 text-[15px] font-semibold tabular-nums outline-none md:h-9"
              aria-label="Quantity to approve"
            />
            <span className="px-3 text-[13px] text-muted-foreground">{line.unit}</span>
          </div>
        </Field>
        <Field label="Reason Production will see" required={less} error={tried ? nErr : null}>
          <Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className={cn(tried && nErr && 'border-red-600')} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={decideM.isPending}>Cancel</Button>
          <Button onClick={confirm} disabled={decideM.isPending} className="bg-emerald-700 text-white hover:bg-emerald-800">
            {decideM.isPending ? 'Saving…' : less && n > 0 ? `Approve ${qty(n, line.unit)}` : 'Approve'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Issue ───────────────────────────────────────────────────────────────────

function IssueDialog({ token, today, demand, onClose }: { token: string; today: string; demand: StoreDemand; onClose: () => void }) {
  const issueM = useIssueStock(token);
  const lines = issuable(demand);
  const [qtys, setQtys] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.id, String(remainingOf(l))])));
  const [receiver, setReceiver] = useState(demand.requestedByName ?? '');
  const [remarks, setRemarks] = useState('');
  const [tried, setTried] = useState(false);
  const last = useRef<{ sig: string; key: string } | null>(null);

  const rows = lines.map((l) => {
    const rem = remainingOf(l);
    const n = toNum(qtys[l.id] ?? '');
    let err: string | null = null;
    if (Number.isNaN(n) || n < 0) err = 'Enter 0 or more.';
    else if (n > rem) err = `At most ${qty(rem, l.unit)} (approved, not yet issued).`;
    else if (!allowsFraction(l.unit) && !Number.isInteger(n)) err = `Whole ${l.unit.toLowerCase()} only.`;
    else if (n > l.availableQty) err = `Only ${qty(l.availableQty, l.unit)} in store.`;
    return { l, rem, n, err };
  });
  const going = rows.filter((r) => !r.err && r.n > 0);
  const anyErr = rows.some((r) => r.err);
  const receiverErr = !receiver.trim() ? 'Enter who in Production received the items.' : null;
  const noneErr = !anyErr && going.length === 0 ? 'Issue at least one line.' : null;

  const confirm = () => {
    if (anyErr || receiverErr || noneErr) { setTried(true); return; }
    const changed = rows.some((r) => r.n !== r.rem);
    const input = {
      demandId: demand.id,
      receivedBy: receiver.trim(),
      remarks: remarks.trim() || null,
      ...(changed ? { lines: going.map((r) => ({ lineId: r.l.id, qty: r.n })) } : {}),
    };
    const sig = JSON.stringify(input);
    if (!last.current || last.current.sig !== sig) last.current = { sig, key: newSubmissionKey() };
    issueM.mutate({ input, key: last.current.key }, {
      onSuccess: (s) => {
        last.current = null;
        toast.success(`${s.issueNo} issued to Production. Store stock reduced by ${rs(s.totalCost)}.`);
        onClose();
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !issueM.isPending && onClose()}>
      <DialogContent mobile="fullscreen" className="flex flex-col md:max-w-[600px]">
        <DialogHeader>
          <DialogTitle>Issue {demand.demandNo} to Production</DialogTitle>
          <DialogDescription>{plural(lines.length, 'line')} · {demand.productionCode ?? '—'} · {demand.requestedByName ?? '—'}</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 md:max-h-[60vh] md:overflow-y-auto">
          <div className="overflow-hidden rounded-xl border border-border">
            {rows.map(({ l, rem, n, err }) => (
              <div key={l.id} className="flex flex-col gap-1 border-t border-border/60 px-3 py-2.5 first:border-t-0">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-bold">{l.itemName}</div>
                    <div className="text-xs text-muted-foreground">
                      {rem < (l.approvedQty ?? 0) ? `${qty(rem, l.unit)} of ${qty(l.approvedQty, l.unit)} left to issue` : `${qty(rem, l.unit)} approved`}
                      {' · '}In store after issue: <span className="tabular-nums">{qty(l.availableQty - (Number.isNaN(n) ? 0 : n), l.unit)}</span>
                    </div>
                  </div>
                  <div className={cn('flex w-32 shrink-0 items-center overflow-hidden rounded-lg border bg-card', tried && err ? 'border-red-600' : 'border-border')}>
                    <input
                      inputMode="decimal"
                      value={qtys[l.id] ?? ''}
                      onChange={(e) => setQtys((x) => ({ ...x, [l.id]: e.target.value.replace(/[^\d.]/g, '') }))}
                      aria-label={`Issue quantity for ${l.itemName}`}
                      className="h-10 min-w-0 flex-1 bg-transparent px-2.5 text-right text-[15px] font-semibold tabular-nums outline-none md:h-9"
                    />
                    <span className="pr-2.5 pl-1 text-xs text-muted-foreground">{l.unit}</span>
                  </div>
                </div>
                {err && (tried || n > rem || n > l.availableQty) ? <span className="text-xs font-semibold text-red-700 dark:text-red-400">{err}</span> : null}
                {!err && n === 0 ? <span className="text-xs text-muted-foreground">Skipped — stays approved for a later issue.</span> : null}
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-muted/60 px-3 py-2"><Fact k="Issue Date" v={fd(today)} /></div>
            <Field label="Received by (Production)" required error={tried ? receiverErr : null}>
              <input className={inputCls(tried && !!receiverErr)} value={receiver} maxLength={80} onChange={(e) => setReceiver(e.target.value)} placeholder="Name of who took the items" />
            </Field>
            <Field label="Remarks" optional className="sm:col-span-2">
              <input className={inputCls()} value={remarks} maxLength={300} onChange={(e) => setRemarks(e.target.value)} />
            </Field>
          </div>
          {tried && noneErr ? <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] font-semibold text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{noneErr}</div> : null}
          <span className="text-xs text-muted-foreground">Rejected and pending lines are not issued. Issue ID is assigned on save.</span>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={issueM.isPending}>Cancel</Button>
          <Button onClick={confirm} disabled={issueM.isPending}>{issueM.isPending ? 'Issuing…' : 'Confirm Issue'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Issuance record (batches) ───────────────────────────────────────────────

function IssuesDialog({ token, demand, onClose }: { token: string; demand: StoreDemand; onClose: () => void }) {
  const q = useStoreIssues(token, { demandId: demand.id });
  const issues = q.data?.rows ?? [];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent mobile="fullscreen" className="flex flex-col md:max-w-[720px]">
        <DialogHeader>
          <DialogTitle>Issues for {demand.demandNo}</DialogTitle>
          <DialogDescription>What left the store, from which batches, and what Production confirmed.</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 md:max-h-[65vh] md:overflow-y-auto">
          {q.isLoading ? (
            <Skeleton className="h-48 w-full" />
          ) : q.isError ? (
            <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
          ) : issues.length === 0 ? (
            <EmptyState title="No issue recorded yet" />
          ) : issues.map((s) => <IssueRecord key={s.id} s={s} />)}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IssueRecord({ s }: { s: StoreIssue }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-medium">{s.issueNo}</span>
          <Pill tone={ISSUE_TONE[s.status]}>{STORE_ISSUE_STATUS_LABELS[s.status]}</Pill>
        </div>
        <span className="text-[13px] font-semibold tabular-nums">{rs(s.totalCost)}</span>
      </div>
      <div className="px-3 py-2 text-[12.5px] text-muted-foreground">
        {fd(s.issueDate)} · issued by {s.issuedByName ?? '—'} · received by {s.receivedByName}
        {s.remarks ? <> · “{s.remarks}”</> : null}
      </div>
      <ul className="flex flex-col">
        {s.lines.map((l) => {
          const diff = l.receivedQty === null ? null : l.receivedQty - l.issuedQty;
          return (
            <li key={l.id} className="flex flex-col gap-1 border-t border-border/60 px-3 py-2">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-[13.5px] font-semibold">{l.itemName}</span>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] tabular-nums">
                  <span>Issued <b>{qty(l.issuedQty, l.unit)}</b></span>
                  <span>Received <b>{l.receivedQty === null ? '—' : qty(l.receivedQty, l.unit)}</b></span>
                  {diff !== null && diff !== 0 ? <span className="font-semibold text-red-700 dark:text-red-400">Difference {diff > 0 ? '+' : '−'}{qty(Math.abs(diff), l.unit)}</span> : null}
                  <span className="text-muted-foreground">Cost {rs(l.costAmount)}</span>
                </div>
              </div>
              {l.batches.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {l.batches.map((b, i) => (
                    <span key={`${b.batchNo}-${i}`} className="rounded-md bg-muted px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground">
                      <span className="font-mono">{b.batchNo}</span>: {qty(b.qty, l.unit)} @ {rate(b.unitCost)}
                    </span>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {s.confirmedByName || s.confirmNote ? (
        <div className={cn('border-t border-border px-3 py-2 text-[12.5px]', s.status === 'received_with_difference' ? 'text-red-800 dark:text-red-300' : 'text-muted-foreground')}>
          Confirmed by {s.confirmedByName ?? '—'}{s.confirmNote ? `: ${s.confirmNote}` : ''}
        </div>
      ) : null}
    </section>
  );
}
