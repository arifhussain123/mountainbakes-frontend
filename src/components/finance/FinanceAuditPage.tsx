'use client';

import { useMemo, useState } from 'react';
import type { FilterConfig, FinanceAuditLog } from '@mb/shared';
import { useFinanceAudit } from '@/lib/finance';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { Pagination } from '@/components/data-engine/Pagination';
import { FilterBar, ActiveFilters } from '@/components/data-engine';
import { useListQueryState } from '@/lib/data-engine/useListQueryState';
import { cn } from '@/lib/utils';
import { FinancePageHeader } from './finance-ui';
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
  const list = useListQueryState({ syncUrl: true, filterKeys: ['entity', 'action', 'businessDate'] });

  const filters = useMemo<FilterConfig[]>(
    () => [
      { key: 'entity', label: 'Record type', type: 'select', placement: 'bar', options: ENTITIES },
      {
        key: 'action', label: 'Action', type: 'select',
        options: ACTIONS.map((a) => ({ value: a, label: a.replace(/_/g, ' ') })),
      },
      { key: 'businessDate', label: 'Date', type: 'date-range', placement: 'bar' },
    ],
    [],
  );

  const { data, isLoading } = useFinanceAudit({
    entity: list.getFilter('entity')?.value as string | undefined,
    action: list.getFilter('action')?.value as string | undefined,
    from: list.getFilter('businessDate', 'gte')?.value as string | undefined,
    to: list.getFilter('businessDate', 'lte')?.value as string | undefined,
    limit: list.state.pageSize,
    offset: (list.state.page - 1) * list.state.pageSize,
  });

  const logs = data?.logs ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-6">
      <FinancePageHeader
        title="Audit Trail"
        description="Every finance action, with who did it, from where, and what changed. Append-only — nothing here can be edited or removed."
      />

      <FilterBar list={list} filters={filters} searchable={false} />
      <ActiveFilters
        filters={list.activeFilters}
        configs={filters}
        onRemove={list.clearFilter}
        onClearAll={list.clearAll}
      />

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

      <Pagination
        page={list.state.page}
        pageSize={list.state.pageSize}
        total={total}
        onPageChange={list.setPage}
        onPageSizeChange={list.setPageSize}
        loading={isLoading}
      />
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
