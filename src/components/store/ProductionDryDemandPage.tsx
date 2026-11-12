'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { MessageSquare, Plus, Send, X } from 'lucide-react';
import type { StoreDemand, StoreDemandInput, StoreDemandStatus, StoreIssue, StoreItem } from '@mb/shared';
import { STORE_DEMAND_STATUSES, STORE_DEMAND_STATUS_LABELS, StoreDemandInputSchema } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { useCancelStoreDemand, useConfirmStoreIssue, useCreateStoreDemand, useStoreDemands, useStoreIssues, useStoreItems, useStoreQueries } from '@/lib/store';
import { cn } from '@/lib/utils';
import {
  ConfirmDialog, DemandStatusPill, Denied, ErrorBlock, Field, FilterSelect, LINE_LABEL, LINE_TONE, Pill, errorMessage, fd, inputCls, num, plural, qty,
  useStoreSession,
} from './parts';
import type { StoreSession } from './parts';
import { NewStoreQueryDialog, QueryStatusPill, StoreQueryDialog, useHeld, useSubmissionKey } from './StoreQueriesPage';

/**
 * Dry Items Store Demand (design: "Dry Items Store Demand"). Production asks
 * the Store for dry items, confirms what it was handed, and follows its own
 * demands. Production cannot open the /store-* pages, so this page draws its
 * own frame instead of StorePage.
 */

const PAGE = 20;
const MAX_LINES = 60;

/** KG and Litre may be split; everything else is counted in whole units (the API's rule). */
const allowsFraction = (unit: string) => ['kg', 'litre', 'liter'].includes(unit.trim().toLowerCase());
const toNum = (s: string) => (s.trim() === '' ? NaN : Number(s));

interface Line { key: string; itemId: string; qty: string; remarks: string }
let lineSeq = 0;
const newLine = (): Line => ({ key: `line-${++lineSeq}`, itemId: '', qty: '', remarks: '' });

export function ProductionDryDemandPage() {
  const session = useStoreSession();
  const { me, can } = session;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Ask the Store for dry items for the day. The Store approves or rejects each line, then issues; you confirm what you received.
      </p>
      {me.isLoading || (!me.data && !me.isError) ? (
        <div className="grid items-start gap-4 min-[1180px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <Skeleton className="h-96 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      ) : me.isError ? (
        <ErrorBlock error={me.error} onRetry={() => void me.refetch()} />
      ) : !can('demand.create') ? (
        <Denied text="Only Production raises dry-items demand. The Store decides it in Approval & Issue." />
      ) : (
        <ProductionBody session={session} />
      )}
    </div>
  );
}

function ProductionBody({ session }: { session: StoreSession }) {
  const { can } = session;
  return (
    <div className="grid items-start gap-4 min-[1180px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <NewDemandCard session={session} />
      <div className="flex min-w-0 flex-col gap-4">
        {can('issue.confirm') && <AwaitingCard token={session.token} />}
        <DemandsCard token={session.token} />
        {can('queries.raise') && <QueriesCard token={session.token} />}
      </div>
    </div>
  );
}

// ── New demand ──────────────────────────────────────────────────────────────

function NewDemandCard({ session }: { session: StoreSession }) {
  const { token, today, userName } = session;
  const itemsQ = useStoreItems(token);
  const createM = useCreateStoreDemand(token);
  const keys = useSubmissionKey();

  const [requiredRaw, setRequired] = useState('');
  const [lines, setLines] = useState<Line[]>(() => [newLine()]);
  const [remarks, setRemarks] = useState('');
  const [tried, setTried] = useState(false);
  const required = requiredRaw || today;

  const items = useMemo(() => (itemsQ.data ?? []).filter((i) => i.status === 'active'), [itemsQ.data]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  // Blank lines (nothing chosen, nothing typed) are ignored; a half-filled line is an error.
  const seen = new Set<string>();
  const checked = lines.map((l) => {
    const blank = !l.itemId && !l.qty.trim() && !l.remarks.trim();
    const it: StoreItem | undefined = l.itemId ? byId.get(l.itemId) : undefined;
    const q = toNum(l.qty);
    const e: { item?: string; qty?: string } = {};
    if (!blank) {
      if (!it) e.item = 'Select an item.';
      if (!(q > 0)) e.qty = 'Enter a quantity above 0.';
      else if (q > 1_000_000) e.qty = 'That quantity looks wrong — check the figure.';
      else if (it && !allowsFraction(it.baseUnit) && !Number.isInteger(q)) e.qty = `Whole ${it.baseUnit.toLowerCase()} only.`;
      if (it) {
        if (seen.has(it.id)) e.item = `${it.name} is already on this demand.`;
        seen.add(it.id);
      }
    }
    const free = it ? it.availableQty - (it.committedQty ?? 0) : 0;
    return { l, it, q, e, blank, free, over: !!it && q > 0 && q > free };
  });
  const ready = checked.filter((x) => !x.blank && x.it && !x.e.item && !x.e.qty);
  const lineErr = checked.some((x) => x.e.item || x.e.qty);
  const dateErr = !required || (today && required < today) ? 'Today or later.' : null;
  const formErr = !tried
    ? null
    : lineErr || dateErr
      ? 'Fix the highlighted lines before sending.'
      : ready.length === 0
        ? 'Add at least one item with a quantity.'
        : null;

  const setLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const submit = () => {
    if (createM.isPending) return;
    if (lineErr || dateErr || ready.length === 0) { setTried(true); return; }
    const input: StoreDemandInput = {
      requiredDate: required,
      remarks: remarks.trim() || null,
      lines: ready.map((x) => ({ itemId: x.it!.id, qty: x.q, remarks: x.l.remarks.trim() || null })),
    };
    const parsed = StoreDemandInputSchema.safeParse(input);
    if (!parsed.success) { setTried(true); toast.error(parsed.error.issues[0]?.message ?? 'Check the demand.'); return; }
    createM.mutate({ input: parsed.data, key: keys.keyFor(JSON.stringify(parsed.data)) }, {
      onSuccess: (d) => {
        keys.reset();
        toast.success(`${d.demandNo} sent to the Store with ${plural(d.lines.length, 'item')}.`);
        setLines([newLine()]);
        setRemarks('');
        setRequired('');
        setTried(false);
      },
      onError: (err) => toast.error(errorMessage(err)),
    });
  };

  return (
    <section className="mb-card flex min-w-0 flex-col gap-3.5 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-base font-bold max-md:text-[17px] max-md:font-semibold max-md:tracking-[-0.2px]">New Demand</span>
        <span className="font-mono text-[12.5px] text-muted-foreground">ID on save</span>
      </div>

      <div className="grid gap-2.5 [grid-template-columns:repeat(auto-fit,minmax(min(100%,150px),1fr))]">
        <div className="rounded-lg bg-muted/60 px-2.5 py-2">
          <div className="text-[11.5px] font-semibold text-muted-foreground">Business Date</div>
          <div className="text-[13.5px] font-semibold tabular-nums">{fd(today)}</div>
        </div>
        <div className="min-w-0 rounded-lg bg-muted/60 px-2.5 py-2">
          <div className="text-[11.5px] font-semibold text-muted-foreground">Requested By</div>
          <div className="truncate text-[13.5px] font-semibold">{userName || '—'}</div>
        </div>
        <Field label="Required Delivery Date" required error={tried ? dateErr : null}>
          <input type="date" className={inputCls(tried && !!dateErr)} value={required} min={today || undefined} onChange={(e) => setRequired(e.target.value)} />
        </Field>
      </div>

      {itemsQ.isError ? (
        <ErrorBlock error={itemsQ.error} onRetry={() => void itemsQ.refetch()} />
      ) : (
        <div className="flex flex-col gap-2">
          {checked.map((x) => {
            const err = tried ? x.e.item || x.e.qty : undefined;
            const unit = x.it?.baseUnit ?? '';
            let hint = x.it ? `Free in store: ${qty(Math.max(x.free, 0), unit)}` : itemsQ.isLoading ? 'Loading items…' : 'Active store items only';
            let hintCls = 'text-muted-foreground';
            if (x.over) {
              hint = `More than free stock (${qty(Math.max(x.free, 0), unit)}). Store will have to reject this line or wait for receiving.`;
              hintCls = 'font-semibold text-amber-700 dark:text-amber-400';
            }
            if (err) { hint = err; hintCls = 'font-semibold text-red-700 dark:text-red-400'; }
            return (
              <div key={x.l.key} className={cn('flex flex-col gap-2 rounded-xl border p-2.5', err ? 'border-red-300 bg-red-50/50 dark:border-red-500/40 dark:bg-red-500/5' : 'border-border bg-card')}>
                <div className="flex flex-wrap items-start gap-2">
                  <label className="flex min-w-0 flex-[1_1_200px] flex-col gap-1">
                    <span className="text-xs font-semibold">Item</span>
                    <select
                      aria-label="Item"
                      value={x.l.itemId}
                      onChange={(e) => setLine(x.l.key, { itemId: e.target.value })}
                      className={inputCls(tried && !!x.e.item)}
                    >
                      <option value="">Select dry item</option>
                      {items.map((i) => <option key={i.id} value={i.id}>{i.name} ({i.baseUnit})</option>)}
                    </select>
                  </label>
                  <label className="flex flex-[0_1_150px] flex-col gap-1">
                    <span className="text-xs font-semibold">Required Qty</span>
                    <div className={cn('flex items-center overflow-hidden rounded-lg border bg-card', tried && x.e.qty ? 'border-red-600' : 'border-border')}>
                      <input
                        inputMode="decimal"
                        aria-label="Quantity"
                        placeholder="0"
                        value={x.l.qty}
                        onChange={(e) => setLine(x.l.key, { qty: e.target.value.replace(/[^\d.]/g, '') })}
                        className="h-10 min-w-0 flex-1 bg-transparent px-2.5 text-[15px] font-semibold tabular-nums outline-none md:h-9"
                      />
                      <span className="px-2.5 text-[13px] text-muted-foreground">{unit || '—'}</span>
                    </div>
                  </label>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Remove line"
                    disabled={lines.length <= 1}
                    onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((y) => y.key !== x.l.key) : ls))}
                    className="self-end text-muted-foreground"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <span className={cn('text-xs', hintCls)}>{hint}</span>
                <input
                  value={x.l.remarks}
                  maxLength={200}
                  onChange={(e) => setLine(x.l.key, { remarks: e.target.value })}
                  placeholder="Line remarks (optional), e.g. for wedding cake order"
                  aria-label="Line remarks"
                  className="h-9 w-full min-w-0 rounded-lg border border-border bg-card px-2.5 text-[13px]"
                />
              </div>
            );
          })}
          <button
            type="button"
            disabled={lines.length >= MAX_LINES}
            onClick={() => setLines((ls) => [...ls, newLine()])}
            className="flex h-[38px] items-center gap-1 self-start rounded-lg border border-dashed border-primary/50 bg-card px-3.5 text-[13.5px] font-semibold text-primary transition-colors hover:bg-primary/5 disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> Add item
          </button>
        </div>
      )}

      <Field label="Remarks" optional>
        <Textarea rows={2} maxLength={500} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="What this demand is for" />
      </Field>

      {formErr ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[13px] font-semibold text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">{formErr}</div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2.5 border-t border-border pt-2.5">
        <span className="text-[13.5px] text-muted-foreground">{plural(ready.length, 'item')} ready</span>
        <Button size="lg" className="h-11 px-5 text-[14.5px] font-bold" disabled={createM.isPending} onClick={submit}>
          <Send className="mr-1.5 h-4 w-4" />{createM.isPending ? 'Sending…' : 'Send to Store'}
        </Button>
      </div>
    </section>
  );
}

// ── Awaiting confirmation ───────────────────────────────────────────────────

function AwaitingCard({ token }: { token: string }) {
  const q = useStoreIssues(token, { status: 'issued' });
  const [confirming, setConfirming] = useState<StoreIssue | null>(null);
  const rows = q.data?.rows ?? [];
  if (q.isLoading) return <Skeleton className="h-28 w-full rounded-2xl" />;
  if (!q.isError && rows.length === 0) return null;
  return (
    <section className="flex min-w-0 flex-col gap-2.5 rounded-2xl border border-amber-300 bg-amber-50/60 p-3.5 dark:border-amber-500/30 dark:bg-amber-500/5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-base font-bold">Awaiting your confirmation</span>
        {rows.length ? <Pill tone="amber">{rows.length}</Pill> : null}
      </div>
      {q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.map((s) => (
        <div key={s.id} className="flex flex-col gap-1.5 rounded-xl border border-border bg-card px-3.5 py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-mono text-sm font-medium">{s.issueNo} <span className="text-muted-foreground">· {s.demandNo}</span></div>
              <div className="text-[12.5px] text-muted-foreground">
                {fd(s.issueDate)} · issued by {s.issuedByName ?? '—'} · handed to {s.receivedByName}
              </div>
            </div>
            <Button size="sm" onClick={() => setConfirming(s)}>Confirm receipt</Button>
          </div>
          <ul className="flex flex-col">
            {s.lines.map((l) => (
              <li key={l.id} className="flex justify-between gap-3 border-t border-border/60 py-1 text-[13.5px]">
                <span className="min-w-0 truncate font-semibold">{l.itemName}</span>
                <span className="shrink-0 tabular-nums">{qty(l.issuedQty, l.unit)}</span>
              </li>
            ))}
          </ul>
          {s.remarks ? <span className="text-[12.5px] text-muted-foreground">“{s.remarks}”</span> : null}
        </div>
      ))}
      {confirming && <ConfirmReceiptDialog token={token} issue={confirming} onClose={() => setConfirming(null)} />}
    </section>
  );
}

function ConfirmReceiptDialog({ token, issue, onClose }: { token: string; issue: StoreIssue; onClose: () => void }) {
  const confirmM = useConfirmStoreIssue(token);
  const [got, setGot] = useState<Record<string, string>>(() => Object.fromEntries(issue.lines.map((l) => [l.id, String(l.issuedQty)])));
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);

  const rows = issue.lines.map((l) => {
    const n = toNum(got[l.id] ?? '');
    let err: string | null = null;
    if (Number.isNaN(n) || n < 0) err = 'Enter 0 or more.';
    else if (n > l.issuedQty) err = `At most ${qty(l.issuedQty, l.unit)} — what was issued.`;
    return { l, n, err };
  });
  const diffs = rows.filter((r) => !r.err && r.n !== r.l.issuedQty);
  const anyErr = rows.some((r) => r.err);
  const noteErr = diffs.length > 0 && !note.trim() ? 'Explain the difference between issued and received.' : null;

  const confirm = () => {
    if (anyErr || noteErr) { setTried(true); return; }
    confirmM.mutate({
      id: issue.id,
      input: {
        ...(diffs.length ? { lines: diffs.map((r) => ({ issueItemId: r.l.id, receivedQty: r.n })) } : {}),
        note: note.trim() || null,
      },
    }, {
      onSuccess: (s) => {
        toast.success(diffs.length ? `${s.issueNo} confirmed with a difference. Admin has been told.` : `${s.issueNo} confirmed as received in full.`);
        onClose();
      },
      onError: (e) => toast.error(errorMessage(e)),
    });
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !confirmM.isPending && onClose()}>
      <DialogContent mobile="fullscreen" className="flex flex-col md:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Confirm {issue.issueNo}</DialogTitle>
          <DialogDescription>{issue.demandNo} · handed to {issue.receivedByName}. Change a quantity only if you received less.</DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 md:max-h-[60vh] md:overflow-y-auto">
          <div className="overflow-hidden rounded-xl border border-border">
            {rows.map(({ l, n, err }) => (
              <div key={l.id} className="flex flex-col gap-1 border-t border-border/60 px-3 py-2.5 first:border-t-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-bold">{l.itemName}</div>
                    <div className="text-xs text-muted-foreground">Issued {qty(l.issuedQty, l.unit)}</div>
                  </div>
                  <div className={cn('flex w-32 shrink-0 items-center overflow-hidden rounded-lg border bg-card', err && (tried || n > l.issuedQty) ? 'border-red-600' : 'border-border')}>
                    <input
                      inputMode="decimal"
                      aria-label={`Received quantity for ${l.itemName}`}
                      value={got[l.id] ?? ''}
                      onChange={(e) => setGot((x) => ({ ...x, [l.id]: e.target.value.replace(/[^\d.]/g, '') }))}
                      className="h-10 min-w-0 flex-1 bg-transparent px-2.5 text-right text-[15px] font-semibold tabular-nums outline-none md:h-9"
                    />
                    <span className="pr-2.5 pl-1 text-xs text-muted-foreground">{l.unit}</span>
                  </div>
                </div>
                {err && (tried || n > l.issuedQty) ? <span className="text-xs font-semibold text-red-700 dark:text-red-400">{err}</span> : null}
                {!err && n !== l.issuedQty ? <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">{num(l.issuedQty - n)} {l.unit} short</span> : null}
              </div>
            ))}
          </div>
          <Field label="Note" required={diffs.length > 0} optional={diffs.length === 0} error={tried ? noteErr : null}
            hint={diffs.length ? 'A difference is flagged to Admin with this note.' : undefined}>
            <Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} className={cn(tried && noteErr && 'border-red-600')} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={confirmM.isPending}>Cancel</Button>
          <Button onClick={confirm} disabled={confirmM.isPending}>
            {confirmM.isPending ? 'Saving…' : diffs.length ? 'Confirm with difference' : 'Received in full'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Your demands ────────────────────────────────────────────────────────────

function DemandsCard({ token }: { token: string }) {
  const [filter, setFilter] = useState<StoreDemandStatus | ''>('');
  const [pages, setPages] = useState(1);
  const [cancelling, setCancelling] = useState<StoreDemand | null>(null);
  const listQ = useStoreDemands(token, { status: filter ? [filter] : undefined, limit: PAGE * pages });
  const data = useHeld(listQ.data, filter);
  const cancelM = useCancelStoreDemand(token);
  const rows = data?.rows ?? [];

  return (
    <section className="flex min-w-0 flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-base font-bold">Your demands</span>
        <FilterSelect label="Status" value={filter} onChange={(v) => { setFilter(v as StoreDemandStatus | ''); setPages(1); }}>
          <option value="">All statuses</option>
          {STORE_DEMAND_STATUSES.map((s) => <option key={s} value={s}>{STORE_DEMAND_STATUS_LABELS[s]}</option>)}
        </FilterSelect>
      </div>
      {listQ.isError && !data ? (
        <ErrorBlock error={listQ.error} onRetry={() => void listQ.refetch()} />
      ) : !data ? (
        <div className="grid gap-2">{[0, 1].map((i) => <Skeleton key={i} className="h-28 w-full rounded-xl" />)}</div>
      ) : rows.length === 0 ? (
        <div className="mb-card rounded-xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          {filter ? 'No demands with this status.' : 'No demands yet. Your first one appears here once sent.'}
        </div>
      ) : (
        <>
          {rows.map((d) => (
            <DemandCard key={d.id} d={d} onCancel={() => setCancelling(d)} />
          ))}
          {rows.length < data.total && (
            <Button variant="outline" className="self-center" disabled={listQ.isFetching} onClick={() => setPages((p) => p + 1)}>
              {listQ.isFetching ? 'Loading…' : `Load more (${data.total - rows.length} left)`}
            </Button>
          )}
        </>
      )}
      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title={`Cancel ${cancelling?.demandNo ?? 'demand'}?`}
        description="The Store will no longer see it. This can't be undone — raise a new demand if you still need the items."
        confirmLabel="Cancel demand"
        destructive
        pending={cancelM.isPending}
        onConfirm={() => {
          if (!cancelling) return;
          cancelM.mutate(cancelling.id, {
            onSuccess: (d) => { toast.success(`${d.demandNo} cancelled.`); setCancelling(null); },
            onError: (e) => { toast.error(errorMessage(e)); setCancelling(null); },
          });
        }}
      />
    </section>
  );
}

function DemandCard({ d, onCancel }: { d: StoreDemand; onCancel: () => void }) {
  const canCancel = d.status === 'pending_review' && d.lines.every((l) => l.status === 'pending');
  return (
    <div className="mb-card flex flex-col gap-2 rounded-xl border border-border bg-card px-3.5 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-sm font-medium">{d.demandNo}</div>
          <div className="text-[12.5px] text-muted-foreground">
            Raised {fd(d.demandDate)} · needed by {fd(d.requiredDate)}{d.productionCode ? ` · Production ID ${d.productionCode}` : ''}
          </div>
        </div>
        <span className="shrink-0"><DemandStatusPill status={d.status} /></span>
      </div>
      <ul className="flex flex-col">
        {d.lines.map((l) => {
          const approved = l.approvedQty ?? 0;
          const partial = (l.status === 'approved' || l.status === 'issued') && approved < l.requestedQty;
          const notes: string[] = [];
          if (partial) notes.push(`Approved ${num(approved)} of ${qty(l.requestedQty, l.unit)}`);
          if (l.status === 'approved' && l.issuedQty > 0) notes.push(`${qty(l.issuedQty, l.unit)} issued so far`);
          if (l.decisionNote) notes.push(`Store: ${l.decisionNote}`);
          if (l.remarks) notes.push(`Your note: ${l.remarks}`);
          return (
            <li key={l.id} className="flex items-start justify-between gap-2.5 border-t border-border/60 py-1.5 text-[13.5px]">
              <div className="min-w-0">
                <b className="font-semibold">{l.itemName}</b> · <span className="tabular-nums">{qty(l.requestedQty, l.unit)}</span>
                {notes.map((n) => (
                  <div key={n} className={cn('text-[12.5px]', l.status === 'rejected' && n.startsWith('Store:') ? 'text-red-800 dark:text-red-400' : 'text-muted-foreground')}>{n}</div>
                ))}
              </div>
              <span className="shrink-0"><Pill tone={LINE_TONE[l.status] ?? 'muted'}>{LINE_LABEL[l.status] ?? l.status}</Pill></span>
            </li>
          );
        })}
      </ul>
      {d.remarks ? <span className="text-[12.5px] text-muted-foreground">{d.remarks}</span> : null}
      {d.status === 'cancelled' && d.cancelledAt ? (
        <span className="text-[12.5px] text-muted-foreground">Cancelled {fd(d.cancelledAt)}{d.cancelledByName ? ` by ${d.cancelledByName}` : ''}</span>
      ) : null}
      {canCancel ? (
        <Button variant="outline" size="sm" onClick={onCancel} className="self-start border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10">
          Cancel demand
        </Button>
      ) : null}
    </div>
  );
}

// ── Queries ─────────────────────────────────────────────────────────────────

function QueriesCard({ token }: { token: string }) {
  const q = useStoreQueries(token, { limit: 5 });
  const [raising, setRaising] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const rows = q.data?.rows ?? [];
  return (
    <section className="mb-card flex min-w-0 flex-col gap-2.5 rounded-2xl border border-border bg-card p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-base font-bold">Questions for the Store?</div>
          <div className="text-[12.5px] text-muted-foreground">A wrong quantity, a missing item, a demand question — Admin answers here.</div>
        </div>
        <Button variant="outline" size="sm" onClick={() => setRaising(true)}><MessageSquare className="mr-1.5 h-3.5 w-3.5" />Raise a query</Button>
      </div>
      {q.isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : q.isError ? (
        <ErrorBlock error={q.error} onRetry={() => void q.refetch()} />
      ) : rows.length === 0 ? null : (
        <ul className="flex flex-col">
          {rows.map((r) => (
            <li key={r.id} className="border-t border-border/60">
              <button type="button" onClick={() => setOpenId(r.id)} className="flex w-full items-start justify-between gap-2.5 py-2 text-left hover:bg-muted/40">
                <div className="min-w-0">
                  <div className="truncate text-[13.5px]"><span className="font-mono text-xs text-muted-foreground">{r.queryNo}</span> <span className="font-semibold">{r.subject}</span></div>
                  {r.lastReply ? <div className="line-clamp-2 text-[12.5px] text-muted-foreground"><b className="font-semibold">Admin:</b> {r.lastReply}</div> : null}
                </div>
                <span className="shrink-0"><QueryStatusPill status={r.status} /></span>
              </button>
            </li>
          ))}
          {q.data && q.data.total > rows.length ? (
            <li className="border-t border-border/60 pt-2 text-xs text-muted-foreground">Showing the latest {rows.length} of {q.data.total}.</li>
          ) : null}
        </ul>
      )}
      {raising && <NewStoreQueryDialog token={token} initial={{ queryType: 'production_demand' }} onClose={() => setRaising(false)} onCreated={(r) => setOpenId(r.id)} />}
      {openId && <StoreQueryDialog token={token} id={openId} isAdmin={false} onClose={() => setOpenId(null)} />}
    </section>
  );
}
