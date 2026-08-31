'use client';

import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useAuth } from '@/hooks/useAuth';
import {
  FINANCE_QUERY_PRIORITY_LABELS,
  FINANCE_QUERY_TYPE_LABELS,
  FINANCE_TICKET_REFERENCE_LABELS,
  FINANCE_TICKET_STATUS_LABELS,
  financeHelpDeskCan,
  type FinanceQueryPriority,
  type FinanceTicket,
  type FinanceTicketStatus,
} from '@mb/shared';

/**
 * Shared vocabulary for the Finance Help Desk.
 *
 * Its own module because the same six status colours and four priority colours
 * are read by the Finance page, the View popup and the admin Support Center tab.
 * Three copies of a colour map is three chances for "Urgent" to be amber in one
 * place and red in another, which is the sort of inconsistency that quietly
 * teaches people to stop trusting the colour.
 */

// ---------------------------------------------------------------------------
// Who is looking
// ---------------------------------------------------------------------------

export interface HelpDeskAbilities {
  /** Can open the Help Desk at all. */
  view: boolean;
  /** Can raise a query and reply to one. Every Finance role except the auditor. */
  report: boolean;
  /**
   * ADMIN. Can respond, move the status, assign, and change or delete the
   * finance record behind a query.
   *
   * NOT A SECURITY BOUNDARY — it decides which buttons render.
   * `requireFinanceHelpDeskAdmin()` on the API decides the same thing again from
   * the JWT, and that is the answer that counts.
   */
  admin: boolean;
}

export function useHelpDeskAbilities(): HelpDeskAbilities {
  const { user } = useAuth();
  const role = user?.role;
  return useMemo(
    () => ({
      view: financeHelpDeskCan(role, 'view'),
      report: financeHelpDeskCan(role, 'report'),
      admin: financeHelpDeskCan(role, 'respond'),
    }),
    [role],
  );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

/**
 * The colour vocabulary, and it is worth stating because it is what someone
 * learns in five minutes and then relies on:
 *
 *   blue    — raised, nobody has it yet
 *   amber   — being worked on
 *   violet  — the ball is back in the raiser's court
 *   emerald — dealt with
 *   red     — not an error, or refused
 *   slate   — filed; nothing further will happen
 */
const STATUS_STYLES: Record<FinanceTicketStatus, string> = {
  open: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  under_review: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  waiting_for_information: 'bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300',
  resolved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  closed: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

export function QueryStatusBadge({
  status,
  className,
}: {
  status: FinanceTicketStatus;
  className?: string;
}) {
  return (
    <Badge variant="secondary" className={cn('whitespace-nowrap', STATUS_STYLES[status], className)}>
      {FINANCE_TICKET_STATUS_LABELS[status]}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

/**
 * Urgent is the only one that shouts.
 *
 * Deliberate: if High were also red, the queue would be a wall of red and
 * Urgent would stop meaning anything. Low is muted rather than coloured for the
 * same reason — it is the default state of "no, this is not on fire".
 */
const PRIORITY_STYLES: Record<FinanceQueryPriority, string> = {
  low: 'bg-muted text-muted-foreground',
  medium: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300',
  urgent: 'bg-red-600 text-white dark:bg-red-700',
};

export function QueryPriorityBadge({
  priority,
  className,
}: {
  priority: FinanceQueryPriority;
  className?: string;
}) {
  return (
    <Badge variant="secondary" className={cn('whitespace-nowrap', PRIORITY_STYLES[priority], className)}>
      {FINANCE_QUERY_PRIORITY_LABELS[priority]}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Reference
// ---------------------------------------------------------------------------

/**
 * What the query is about, in one line.
 *
 * A query with no reference is NORMAL from migration 94 onwards — "Calculation
 * Issue" and "Other" name no record — so this renders the query TYPE rather than
 * an em dash. "—" in the Reference column would read as missing data on a row
 * where nothing is missing.
 */
export function QueryReference({ ticket }: { ticket: FinanceTicket }) {
  if (!ticket.referenceNo) {
    return (
      <span className="text-sm text-muted-foreground">
        {FINANCE_QUERY_TYPE_LABELS[ticket.queryType]}
      </span>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <span className="font-mono text-sm">{ticket.referenceNo}</span>
      <span className="text-xs text-muted-foreground">
        {ticket.referenceType
          ? FINANCE_TICKET_REFERENCE_LABELS[ticket.referenceType]
          : FINANCE_QUERY_TYPE_LABELS[ticket.queryType]}
      </span>
      {ticket.voucherRef && (
        <span className="text-xs text-muted-foreground">Voucher: {ticket.voucherRef}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** en-PK, matching the rest of the module. Null renders as an em dash. */
export function formatQueryDate(iso: string | null | undefined, withTime = true): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return withTime
    ? d.toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })
    : d.toLocaleDateString('en-PK', { dateStyle: 'medium' });
}

// ---------------------------------------------------------------------------
// The referenced record's figures
// ---------------------------------------------------------------------------

/**
 * A finance row rendered generically.
 *
 * The snapshot is a whole API row, so the keys are whatever that table has. It
 * is rendered generically rather than per-type on purpose: a hand-written field
 * list for seven record types is seven lists to forget to update, and the point
 * of the snapshot is to show what was there, not a curated view of it.
 *
 * The soft-delete columns are shown rather than filtered when present — a
 * record that was deleted under another query is the single most important
 * thing about it, and hiding that would leave an admin reading figures for a row
 * that is no longer in the books.
 */
const NOISE_KEYS = new Set([
  'id',
  'createdAt',
  'updatedAt',
  'deletedBy',
  'deletedQueryId',
]);

export function RecordFigures({
  record,
  heading,
  className,
}: {
  record: Record<string, unknown> | null | undefined;
  heading: string;
  className?: string;
}) {
  const rows = useMemo(() => {
    if (!record) return [];
    return Object.entries(record)
      .filter(
        ([k, v]) =>
          !k.endsWith('Id') &&
          !NOISE_KEYS.has(k) &&
          v !== null &&
          v !== '' &&
          typeof v !== 'object',
      )
      .slice(0, 18);
  }, [record]);

  if (!record) return null;

  const deletedAt = record['deletedAt'] as string | null | undefined;

  return (
    <div className={cn('space-y-2 rounded-lg border bg-muted/40 p-3', className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">{heading}</p>
        {deletedAt && (
          <Badge variant="destructive" className="whitespace-nowrap">
            Deleted {formatQueryDate(deletedAt, false)}
          </Badge>
        )}
      </div>
      {deletedAt && (record['deleteReason'] as string | undefined) && (
        <p className="text-xs text-destructive">
          Reason: {String(record['deleteReason'])}
          {record['deletedQueryNo'] ? ` · under ${String(record['deletedQueryNo'])}` : ''}
        </p>
      )}
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
        {rows.map(([key, value]) => (
          <div key={key} className="flex justify-between gap-3">
            <dt className="text-muted-foreground capitalize">
              {key.replace(/([A-Z])/g, ' $1').toLowerCase()}
            </dt>
            <dd className="truncate text-right font-medium tabular-nums">{String(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
