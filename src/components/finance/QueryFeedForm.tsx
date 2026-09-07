'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Loader2, Search } from 'lucide-react';
import {
  FINANCE_QUERY_PRIORITIES,
  FINANCE_QUERY_PRIORITY_LABELS,
  FINANCE_QUERY_TYPES,
  FINANCE_QUERY_TYPE_LABELS,
  FINANCE_QUERY_TYPE_REFERENCE_FIELDS,
  FINANCE_TICKET_FEED_FIELD_LABELS,
  FINANCE_TICKET_PREFIXES,
  type Branch,
  type FinanceQueryPriority,
  type FinanceQueryType,
  type FinanceTicket,
  type FinanceTicketReferenceLookup,
} from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { lookupFinanceReference } from '@/lib/finance';
import { cn } from '@/lib/utils';
import { RecordFigures } from './help-desk-ui';

/**
 * The ONE query form (§4).
 *
 * A Finance user fills it to raise a query; the Admin sees the same form, with
 * the same fields in the same places, when they open the query — and edits,
 * amends or recreates it from there. There is deliberately no second "admin
 * edit" layout and no per-field popup: the brief asks for a feeding form, and
 * a feeding form is one form.
 *
 * It owns no server state. `value`/`onChange` is the whole contract, so the
 * caller decides what to do with the values — create, PATCH, amend, recreate —
 * and the form never has to know which screen it is on. The two helpers below
 * turn a ticket into form state and form state into the API payload, and
 * `feedDiff` says which fields actually moved, which is what a PATCH sends and
 * what a Save button enables on.
 */

export interface FeedState {
  subject: string;
  queryType: FinanceQueryType;
  priority: FinanceQueryPriority;
  description: string;
  /** As typed. Blank means "no amount", not zero — see the schema. */
  amount: string;
  branchId: string;
  /** `YYYY-MM-DD` or blank. */
  businessDate: string;
  remarks: string;
  referenceNo: string;
  voucherRef: string;
  transactionRef: string;
  expenseRef: string;
  incomeRef: string;
}

export const EMPTY_FEED: FeedState = {
  subject: '',
  queryType: 'other',
  priority: 'normal',
  description: '',
  amount: '',
  branchId: '',
  businessDate: '',
  remarks: '',
  referenceNo: '',
  voucherRef: '',
  transactionRef: '',
  expenseRef: '',
  incomeRef: '',
};

/** Form state from a query row — what the Admin's form is pre-filled with. */
export function feedFromTicket(t: FinanceTicket): FeedState {
  return {
    subject: t.subject ?? '',
    queryType: t.queryType,
    priority: t.priority,
    description: t.message ?? '',
    amount: t.amount === null || t.amount === undefined ? '' : String(t.amount),
    branchId: t.branchId ?? '',
    businessDate: t.businessDate ?? '',
    remarks: t.remarks ?? '',
    referenceNo: t.referenceNo ?? '',
    voucherRef: t.voucherRef ?? '',
    transactionRef: t.transactionRef ?? '',
    expenseRef: t.expenseRef ?? '',
    incomeRef: t.incomeRef ?? '',
  };
}

/** The API payload for a FULL form (create / recreate). */
export function feedToPayload(s: FeedState): Record<string, unknown> {
  return {
    subject: s.subject.trim(),
    queryType: s.queryType,
    priority: s.priority,
    description: s.description.trim(),
    amount: s.amount.trim() === '' ? null : Number(s.amount),
    branchId: s.branchId || null,
    businessDate: s.businessDate || null,
    remarks: s.remarks.trim() || null,
    referenceNo: s.referenceNo.trim() || null,
    voucherRef: s.voucherRef.trim() || null,
    transactionRef: s.transactionRef.trim() || null,
    expenseRef: s.expenseRef.trim() || null,
    incomeRef: s.incomeRef.trim() || null,
  };
}

/**
 * Only the fields that differ between two states, as an API payload. Empty
 * when nothing moved — which is what disables Save.
 *
 * Amount is compared numerically so "15000" and "15000.00" are the same
 * figure; everything else is compared trimmed.
 */
export function feedDiff(base: FeedState, next: FeedState): Record<string, unknown> {
  const full = feedToPayload(next);
  const from = feedToPayload(base);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(full)) {
    const a = from[key];
    const b = full[key];
    const same = key === 'amount' ? Number(a ?? NaN) === Number(b ?? NaN) || (a === null && b === null) : a === b;
    if (!same) out[key] = b;
  }
  return out;
}

/** Human labels for the diff, for a "you are changing…" summary. */
export function feedChangeLabels(diff: Record<string, unknown>): string[] {
  return Object.keys(diff).map(
    (k) => FINANCE_TICKET_FEED_FIELD_LABELS[k as keyof typeof FINANCE_TICKET_FEED_FIELD_LABELS] ?? k,
  );
}

const PREFIX_HINT = FINANCE_TICKET_PREFIXES.map((p) => `${p}-…`).join(', ');

const selectClass = 'h-11 w-full rounded-md border bg-background px-2 text-sm md:h-9';

export function QueryFeedForm({
  value,
  onChange,
  branches,
  readOnly = false,
  idPrefix = 'qf',
  showPriority = true,
  className,
}: {
  value: FeedState;
  onChange: (next: FeedState) => void;
  /** The branch list; the caller loads it so the form stays free of fetches. */
  branches: Branch[];
  /** The raiser reading a submitted query, or an auditor. Every field renders, none edit. */
  readOnly?: boolean;
  /** Unique per instance — the form can be on screen twice (detail + recreate). */
  idPrefix?: string;
  showPriority?: boolean;
  className?: string;
}) {
  const { token } = useAuth();
  const [reference, setReference] = useState<FinanceTicketReferenceLookup | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState('');

  const set = <K extends keyof FeedState>(key: K, v: FeedState[K]) => onChange({ ...value, [key]: v });

  async function handleLookup() {
    const ref = value.referenceNo.trim();
    if (!ref) return;
    setLooking(true);
    setLookupError('');
    setReference(null);
    try {
      const found = await lookupFinanceReference(ref, token);
      setReference(found);
      onChange({ ...value, referenceNo: found.referenceNo });
    } catch (err) {
      setLookupError(err instanceof Error ? err.message : 'Could not find that reference');
    } finally {
      setLooking(false);
    }
  }

  // §2: only the reference handles a query type calls for. The resolvable
  // Reference ID is always offered; the free-text ones follow the type.
  const handles = FINANCE_QUERY_TYPE_REFERENCE_FIELDS[value.queryType] ?? [];
  const id = (k: string) => `${idPrefix}-${k}`;

  return (
    <div className={cn('space-y-4', className)}>
      <div className="space-y-1">
        <Label htmlFor={id('subject')}>Subject</Label>
        <Input
          id={id('subject')}
          value={value.subject}
          onChange={(e) => set('subject', e.target.value)}
          placeholder="Short summary, e.g. Branch share difference"
          readOnly={readOnly}
          className={readOnly ? 'bg-muted' : undefined}
        />
      </div>

      <div className={cn('grid gap-3', showPriority ? 'sm:grid-cols-2' : '')}>
        <div className="space-y-1">
          <Label htmlFor={id('type')}>Query type</Label>
          <select
            id={id('type')}
            value={value.queryType}
            onChange={(e) => set('queryType', e.target.value as FinanceQueryType)}
            disabled={readOnly}
            className={selectClass}
          >
            {FINANCE_QUERY_TYPES.map((t) => (
              <option key={t} value={t}>
                {FINANCE_QUERY_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        {showPriority && (
          <div className="space-y-1">
            <Label htmlFor={id('priority')}>Priority</Label>
            <select
              id={id('priority')}
              value={value.priority}
              onChange={(e) => set('priority', e.target.value as FinanceQueryPriority)}
              disabled={readOnly}
              className={selectClass}
            >
              {FINANCE_QUERY_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {FINANCE_QUERY_PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1">
          <Label htmlFor={id('amount')}>Amount</Label>
          <Input
            id={id('amount')}
            value={value.amount}
            onChange={(e) => set('amount', e.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            placeholder="Optional"
            readOnly={readOnly}
            className={cn('tabular-nums', readOnly && 'bg-muted')}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={id('branch')}>Branch</Label>
          <select
            id={id('branch')}
            value={value.branchId}
            onChange={(e) => set('branchId', e.target.value)}
            disabled={readOnly}
            className={selectClass}
          >
            <option value="">— None —</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={id('date')}>Business date</Label>
          <Input
            id={id('date')}
            type="date"
            value={value.businessDate}
            onChange={(e) => set('businessDate', e.target.value)}
            readOnly={readOnly}
            className={readOnly ? 'bg-muted' : undefined}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor={id('desc')}>Description</Label>
        <Textarea
          id={id('desc')}
          value={value.description}
          onChange={(e) => set('description', e.target.value)}
          rows={4}
          placeholder="What looks wrong, and what you expected instead"
          readOnly={readOnly}
          className={readOnly ? 'bg-muted' : undefined}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor={id('ref')}>Reference ID</Label>
        <div className="flex gap-2">
          <Input
            id={id('ref')}
            value={value.referenceNo}
            onChange={(e) => {
              set('referenceNo', e.target.value);
              setReference(null);
              setLookupError('');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void handleLookup();
              }
            }}
            placeholder="e.g. RV-000001 — optional"
            readOnly={readOnly}
            className={cn('font-mono', readOnly && 'bg-muted')}
          />
          {!readOnly && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void handleLookup()}
              disabled={looking || !value.referenceNo.trim()}
            >
              {looking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              <span className="ml-1">Find</span>
            </Button>
          )}
        </div>
        {!readOnly && (
          <p className="text-xs text-muted-foreground">
            {PREFIX_HINT} — a reference is checked when you save; press Find to see its figures first.
          </p>
        )}
        {lookupError && <p className="text-xs text-destructive">{lookupError}</p>}
      </div>

      {reference && (
        <RecordFigures record={reference.snapshot} heading={`${reference.label} · ${reference.referenceNo}`} />
      )}

      {handles.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {handles.includes('transactionRef') && (
            <div className="space-y-1">
              <Label htmlFor={id('txn')}>Transaction ID</Label>
              <Input
                id={id('txn')}
                value={value.transactionRef}
                onChange={(e) => set('transactionRef', e.target.value)}
                placeholder="Optional"
                readOnly={readOnly}
                className={readOnly ? 'bg-muted' : undefined}
              />
            </div>
          )}
          {handles.includes('expenseRef') && (
            <div className="space-y-1">
              <Label htmlFor={id('exp')}>Expense ID</Label>
              <Input
                id={id('exp')}
                value={value.expenseRef}
                onChange={(e) => set('expenseRef', e.target.value)}
                placeholder="Optional"
                readOnly={readOnly}
                className={readOnly ? 'bg-muted' : undefined}
              />
            </div>
          )}
          {handles.includes('incomeRef') && (
            <div className="space-y-1">
              <Label htmlFor={id('inc')}>Income ID</Label>
              <Input
                id={id('inc')}
                value={value.incomeRef}
                onChange={(e) => set('incomeRef', e.target.value)}
                placeholder="Optional"
                readOnly={readOnly}
                className={readOnly ? 'bg-muted' : undefined}
              />
            </div>
          )}
          {handles.includes('voucherRef') && (
            <div className="space-y-1">
              <Label htmlFor={id('voucher')}>Ledger / Voucher ID</Label>
              <Input
                id={id('voucher')}
                value={value.voucherRef}
                onChange={(e) => set('voucherRef', e.target.value)}
                placeholder="Optional"
                readOnly={readOnly}
                className={readOnly ? 'bg-muted' : undefined}
              />
            </div>
          )}
        </div>
      )}

      <div className="space-y-1">
        <Label htmlFor={id('remarks')}>Remarks</Label>
        <Textarea
          id={id('remarks')}
          value={value.remarks}
          onChange={(e) => set('remarks', e.target.value)}
          rows={2}
          placeholder="Optional"
          readOnly={readOnly}
          className={readOnly ? 'bg-muted' : undefined}
        />
      </div>
    </div>
  );
}
