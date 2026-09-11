'use client';

import { useState } from 'react';
import type { FinanceAuditLog } from '@mb/shared';
import { useFinanceAudit } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { cn } from '@/lib/utils';
import { FinancePageHeader } from './finance-ui';
import { DateFilter, FilterBar, FilterField, FilterSelect } from './finance-actions';
import { ChevronDown, ChevronRight, Monitor, ShieldCheck, Wifi } from 'lucide-react';

/**
 * The audit trail.
 *
 * Append-only in the database — there is no edit and no delete, for anyone, and
 * so there is nothing on this page but reading. A trail with a delete button is
 * not a trail.
 *
 * Each entry expands to the before/after values, the IP and the device, which is
 * what an auditor asks for first: not "who approved this" but "what did it look
 * like before they did".
 */

const PAGE_SIZE = 50;

/**
 * Every action `logFinanceAudit` can write, in FinanceAuditAction's own order.
 *
 * The Help Desk's five — resolved, reopened, reopen_requested, deleted and
 * salary_revised — were missing while the trail was already recording them, so
 * a Query ID could be searched for but its resolution could not be filtered to.
 * §3 asks that the Query ID be visible in the audit history; a filter that
 * cannot name the action that produced the row is half of that.
 */
const ACTIONS = [
  'created', 'updated', 'submitted', 'verified', 'approved', 'rejected',
  'posted', 'reversed', 'adjusted', 'locked', 'imported', 'settings_updated',
  'salary_revised', 'resolved', 'reopened', 'reopen_requested', 'deleted',
];

const ENTITIES = [
  { value: 'ledger_entry', label: 'Ledger entry' },
  { value: 'ledger_head', label: 'Ledger head' },
  { value: 'finance_transaction', label: 'Income / expense entry' },
  { value: 'income_approval', label: 'Branch income' },
  { value: 'salary_payment', label: 'Salary payment' },
  { value: 'employee_advance', label: 'Employee advance' },
  { value: 'partner_expense', label: 'Partner expense' },
  { value: 'employee', label: 'Employee' },
  { value: 'day_closing', label: 'Day closing' },
  { value: 'settings', label: 'Settings' },
  { value: 'branch_share_payment', label: 'Branch share payment' },
  { value: 'finance_partner', label: 'Partner' },
  // The Help Desk query itself. `entityRef` on these rows is the Query ID, which
  // is what makes FIN-HD-… searchable here (§3).
  { value: 'finance_ticket', label: 'Help Desk query' },
];

/** Colour by consequence, matching the status vocabulary used across the module. */
const ACTION_STYLES: Record<string, string> = {
  approved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  posted: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  reversed: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  adjusted: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  locked: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  settings_updated: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  resolved: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  reopened: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-300',
  reopen_requested: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-300',
  deleted: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
};

export function FinanceAuditPage() {
  const [entity, setEntity] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(0);

  const { data, isLoading } = useFinanceAudit({
    entity: entity || undefined,
    action: action || undefined,
    from: from || undefined,
    to: to || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function setFilter(fn: () => void) {
    fn();
    setPage(0);
  }

  return (
    <div className="space-y-6">
      <FinancePageHeader
        title="Audit Trail"
        description="Every finance action, with who did it, from where, and what changed. Append-only — nothing here can be edited or removed."
      />

      <FilterBar>
        <FilterField label="Record type">
          <FilterSelect
            value={entity}
            onChange={(v) => setFilter(() => setEntity(v))}
            allLabel="All records"
            options={ENTITIES}
          />
        </FilterField>
        <FilterField label="Action">
          <FilterSelect
            value={action}
            onChange={(v) => setFilter(() => setAction(v))}
            allLabel="All actions"
            options={ACTIONS.map((a) => ({ value: a, label: a.replace(/_/g, ' ') }))}
          />
        </FilterField>
        <FilterField label="From">
          <DateFilter value={from} onChange={(v) => setFilter(() => setFrom(v))} />
        </FilterField>
        <FilterField label="To">
          <DateFilter value={to} onChange={(v) => setFilter(() => setTo(v))} />
        </FilterField>
      </FilterBar>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="No audit entries"
          description="Approvals, adjustments and settings changes are recorded here as they happen."
        />
      ) : (
        <div className="divide-y overflow-hidden rounded-lg border bg-card">
          {logs.map((log) => (
            <AuditRow key={log.id} log={log} />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <span>{total} recorded {total === 1 ? 'action' : 'actions'}</span>
        <div className="flex items-center gap-2">
          <span>Page {page + 1} of {pageCount}</span>
          <Button
            variant="outline"
            size="sm"
            className="h-11 md:h-7"
            disabled={page === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-11 md:h-7"
            disabled={page + 1 >= pageCount}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AuditRow({ log }: { log: FinanceAuditLog }) {
  const [open, setOpen] = useState(false);
  const hasDetail = Boolean(log.previousValues || log.newValues || log.ipAddress || log.deviceInfo);

  return (
    <div>
      <button
        type="button"
        onClick={() => hasDetail && setOpen((o) => !o)}
        className={cn(
          'flex w-full items-start gap-3 p-3 text-left',
          hasDetail && 'hover:bg-muted/30',
        )}
      >
        <div className="mt-0.5 flex-shrink-0 text-muted-foreground">
          {hasDetail ? (
            open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
          ) : (
            <span className="block h-4 w-4" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="secondary"
              className={cn('capitalize', ACTION_STYLES[log.action] ?? 'bg-muted text-muted-foreground')}
            >
              {log.action.replace(/_/g, ' ')}
            </Badge>
            <span className="text-sm font-medium">
              {ENTITIES.find((e) => e.value === log.entity)?.label ?? log.entity.replace(/_/g, ' ')}
            </span>
            {log.entityRef && <span className="font-mono text-xs text-muted-foreground">{log.entityRef}</span>}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {log.actorName || 'Unknown user'}
            {log.actorRole ? ` · ${log.actorRole.replace(/_/g, ' ')}` : ''} ·{' '}
            {new Date(log.createdAt).toLocaleString('en-PK')}
          </p>
        </div>
      </button>

      {open && (
        <div className="space-y-3 border-t bg-muted/20 p-3 pl-10">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <ValueBlock title="Previous values" values={log.previousValues} />
            <ValueBlock title="New values" values={log.newValues} />
          </div>

          <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
            {log.ipAddress && (
              <span className="flex items-center gap-1.5">
                <Wifi className="h-3.5 w-3.5" />
                {log.ipAddress}
              </span>
            )}
            {log.deviceInfo && (
              <span className="flex min-w-0 items-center gap-1.5">
                <Monitor className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">{log.deviceInfo}</span>
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ValueBlock({ title, values }: { title: string; values: Record<string, unknown> | null }) {
  if (!values || Object.keys(values).length === 0) {
    return (
      <div className="rounded-lg border bg-card p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">—</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border bg-card p-3">
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <dl className="space-y-1 text-sm">
        {Object.entries(values).map(([key, value]) => (
          <div key={key} className="flex items-baseline justify-between gap-3">
            {/* camelCase keys come straight from the API snapshot; spaced out so
                they read as words rather than identifiers. */}
            <dt className="text-xs capitalize text-muted-foreground">
              {key.replace(/([A-Z])/g, ' $1').toLowerCase()}
            </dt>
            <dd className="min-w-0 break-words text-right font-medium">
              {value === null || value === undefined
                ? '—'
                : typeof value === 'object'
                  ? JSON.stringify(value)
                  : String(value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
