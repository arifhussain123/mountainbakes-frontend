'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  RESTRICTION_REQUEST_STATUS_LABELS,
  RESTRICTION_REQUEST_TYPES,
  RESTRICTION_REQUEST_TYPE_LABELS,
  daysBetweenDateStr,
  restrictionDmy,
  type RestrictionRequest,
  type RestrictionRequestType,
} from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useDecideRestrictionRequest, useRestrictionRequests } from '@/lib/restrictions';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { formatCurrency } from '@/utils/currency';
import { formatDateTime } from '@/utils/date';
import { REQUEST_STATUS_PILL, chipClass } from './format';

/**
 * Admin Settings → Restriction Rules → Approvals.
 *
 * The queue of one-time requests to lift a rule. Approving here does not create
 * the demand, the deposit or the ledger entry — it authorises the requester to
 * submit exactly the transaction they described, once. The API spends the
 * approval when that transaction goes through.
 */

/** One line under the type, in the list. */
function summary(r: RestrictionRequest): string {
  const date = restrictionDmy(r.requestedDate);
  if (r.type === 'BACKDATED_DEMAND') return `Demand for ${date}`;
  if (r.type === 'CASH_DEPOSIT_LIMIT') return `One more deposit for ${date}`;
  return [r.entryLabel, r.amount !== null ? formatCurrency(r.amount) : null, date].filter(Boolean).join(' · ');
}

/** Why the rule fired, in a sentence — computed from the request, not typed by anyone. */
function context(r: RestrictionRequest): string {
  const days = daysBetweenDateStr(r.requestedDate, r.currentBusinessDate);
  const back = `${days} ${days === 1 ? 'day' : 'days'} before the business date it was requested on`;
  if (r.type === 'BACKDATED_DEMAND') return `Requested date is ${back}.`;
  if (r.type === 'LEDGER_BACKDATE') return `Entry date is ${back}.`;
  if (r.type === 'CASH_DEPOSIT_LIMIT') return 'The daily cash-deposit limit had been reached.';
  return 'Company Share is normally received through Branch Cash Deposit.';
}

function fields(r: RestrictionRequest): [string, string][] {
  const out: [string, string][] = [['Branch', r.branchName ?? 'Company-wide']];
  if (r.type === 'LEDGER_BACKDATE' || r.type === 'COMPANY_SHARE_INCOME') {
    out.push(['Ledger entry type', r.entryLabel ?? '—']);
    out.push(['Amount', r.amount !== null ? formatCurrency(r.amount) : '—']);
    out.push(['Description', r.description || '—']);
  } else if (r.description) {
    out.push(['Details', r.description]);
  }
  out.push(
    [r.type === 'BACKDATED_DEMAND' ? 'Requested business date' : 'Requested date', restrictionDmy(r.requestedDate)],
    ['Current business date', restrictionDmy(r.currentBusinessDate)],
    ['Requested by', r.requestedByName],
    ['Requested at', formatDateTime(r.requestedAt)],
  );
  return out;
}

function decisionFields(r: RestrictionRequest): [string, string][] {
  const out: [string, string][] = [
    ['Approval ID', r.approvalNo ?? '—'],
    ['Approver', r.decidedByName ?? '—'],
    ['Approval time', formatDateTime(r.decidedAt)],
    ['Decision', RESTRICTION_REQUEST_STATUS_LABELS[r.status]],
    ['Reason', r.adminReason || '—'],
  ];
  if (r.status === 'approved') out.push(['Used on', r.consumedRef ?? (r.consumedAt ? 'Used' : 'Not used yet')]);
  return out;
}

function FieldGrid({ items }: { items: [string, string][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="flex min-w-0 flex-col gap-0.5">
          <dt className="text-[11px] text-muted-foreground">{k}</dt>
          <dd className="font-semibold [overflow-wrap:anywhere]">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function StatusPill({ r, className }: { r: RestrictionRequest; className?: string }) {
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap', REQUEST_STATUS_PILL[r.status], className)}>
      {RESTRICTION_REQUEST_STATUS_LABELS[r.status]}
    </span>
  );
}

export function ApprovalsTab() {
  const { token } = useAuth();
  const [type, setType] = useState<RestrictionRequestType | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);
  const q = useRestrictionRequests(token, { type });
  const decide = useDecideRestrictionRequest(token);

  const requests = q.data?.requests ?? [];
  // Nothing chosen yet → the first in the list, which is the newest.
  const selected = requests.find((r) => r.id === selectedId) ?? requests[0] ?? null;

  function select(id: string) {
    setSelectedId(id);
    setReason('');
    setReasonError(false);
  }

  async function submit(decision: 'approved' | 'rejected') {
    if (!selected) return;
    const trimmed = reason.trim();
    if (decision === 'rejected' && !trimmed) {
      setReasonError(true);
      return;
    }
    try {
      const { request } = await decide.mutateAsync({ id: selected.id, decision, reason: trimmed || undefined });
      setReason('');
      setReasonError(false);
      toast.success(`${request.requestNo} ${decision} (${request.approvalNo})`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not record the decision');
    }
  }

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex flex-wrap gap-1.5">
        {[null, ...RESTRICTION_REQUEST_TYPES].map((t) => (
          <button
            key={t ?? 'all'}
            type="button"
            aria-pressed={type === t}
            onClick={() => { setType(t); setSelectedId(null); }}
            className={cn('h-[30px] rounded-full border px-3 text-xs font-semibold', chipClass(type === t))}
          >
            {t ? RESTRICTION_REQUEST_TYPE_LABELS[t] : 'All'}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(340px,100%),1fr))] items-start gap-4">
        <div className="overflow-hidden rounded-xl border bg-card">
          {requests.map((r) => {
            const active = selected?.id === r.id;
            return (
              <button
                key={r.id}
                type="button"
                aria-current={active}
                onClick={() => select(r.id)}
                className={cn(
                  'flex w-full flex-col gap-1.5 border-b px-4 py-3.5 text-left outline-none last:border-b-0 focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50',
                  active ? 'bg-accent shadow-[inset_3px_0_0_var(--primary)]' : 'hover:bg-muted/50',
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-medium">{r.requestNo}</span>
                  <StatusPill r={r} />
                </span>
                <span className="font-bold">{RESTRICTION_REQUEST_TYPE_LABELS[r.type]} · {r.branchName ?? 'Company-wide'}</span>
                <span className="text-xs text-muted-foreground">{summary(r)}</span>
                <span className="text-[11.5px] text-muted-foreground/80">{r.requestedByName} · {formatDateTime(r.requestedAt)}</span>
              </button>
            );
          })}
          {q.isLoading && <p className="p-6 text-center text-muted-foreground">Loading requests…</p>}
          {q.isError && <p role="alert" className="p-6 text-center text-destructive">Could not load the requests.</p>}
          {q.isSuccess && requests.length === 0 && <p className="p-6 text-center text-muted-foreground">No requests in this category.</p>}
        </div>

        {selected && (
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="flex flex-wrap items-start justify-between gap-2.5 px-5 py-4">
              <div className="flex flex-col gap-1">
                <span className="font-mono text-xs text-muted-foreground">{selected.requestNo}</span>
                <h3 className="text-base font-bold">{RESTRICTION_REQUEST_TYPE_LABELS[selected.type]}</h3>
              </div>
              <StatusPill r={selected} className="px-2.5 py-[3px] text-[11.5px]" />
            </div>

            <div className="px-5 pb-4">
              <FieldGrid items={fields(selected)} />
            </div>

            <div className="mx-5 mb-4 flex flex-col gap-0.5 rounded-lg bg-muted/60 px-3 py-2.5">
              <span className="text-[11px] text-muted-foreground">{selected.branchId ? 'Branch reason' : 'Reason given'}</span>
              <span className="leading-normal [overflow-wrap:anywhere]">{selected.reason}</span>
            </div>

            <div className="mx-5 mb-4 flex flex-wrap items-center gap-1.5 text-xs text-foreground/80">
              <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">{selected.type}</span>
              <span>{context(selected)}</span>
            </div>

            {selected.status === 'pending' ? (
              <div className="flex flex-col gap-2.5 border-t bg-muted/40 px-5 py-4">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-semibold">
                    Admin reason <span className="font-normal text-muted-foreground">(required to reject, shown to the requester)</span>
                  </span>
                  <Textarea
                    value={reason}
                    onChange={(e) => { setReason(e.target.value); setReasonError(false); }}
                    rows={3}
                    maxLength={500}
                    placeholder="e.g. Utility bill verified against receipt"
                    className="bg-background"
                    aria-invalid={reasonError}
                  />
                </label>
                {reasonError && <p role="alert" className="text-xs font-medium text-destructive">Enter a reason before rejecting.</p>}
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" className="text-destructive" disabled={decide.isPending} onClick={() => submit('rejected')}>
                    Reject
                  </Button>
                  <Button disabled={decide.isPending} onClick={() => submit('approved')}>
                    {decide.isPending ? 'Saving…' : 'Approve'}
                  </Button>
                </div>
                <p className="text-[11.5px] text-muted-foreground">
                  Approval is one-time and tied to this request. It cannot be reused for another transaction.
                </p>
              </div>
            ) : (
              <div className="border-t bg-muted/40 px-5 py-4">
                <FieldGrid items={decisionFields(selected)} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
