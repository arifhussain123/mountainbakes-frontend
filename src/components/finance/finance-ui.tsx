'use client';

import { useMemo } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useSettings } from '@/hooks/useSettings';
import { useFinanceSettings } from '@/lib/finance';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  financeCan,
  FINANCE_DOC_STATUS_LABELS,
  FINANCE_ROLE_LABELS,
  isFinanceRole,
  type FinanceDocStatus,
  type FinancePermission,
  type IncomeApprovalStatus,
  type LedgerEntryStatus,
} from '@mb/shared';

/**
 * Shared building blocks for the Finance Ledger screens.
 *
 * Three things live here because getting them subtly different across eleven
 * pages is the failure mode this module can least afford: how money is
 * formatted, what a status looks like, and who is allowed to press a button.
 */

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

export interface FinanceAbilities {
  view: boolean;
  create: boolean;
  approve: boolean;
  adjust: boolean;
  configure: boolean;
  /** True while the finance settings are still loading. */
  loading: boolean;
  roleLabel: string;
}

/**
 * What the signed-in user may do in this module.
 *
 * Reads `allowSuperAdminWrite` from finance settings so a Super Admin's buttons
 * appear exactly when the grant is on — the same input the API's requireFinance
 * uses, so the UI and the server agree instead of the user discovering the
 * difference through a 403.
 *
 * THIS IS NOT A SECURITY BOUNDARY. It decides which buttons render. Every one of
 * them hits an endpoint that re-decides the same question against the JWT, which
 * is where the actual answer lives — the same relationship RouteGuard has with
 * the API. Hiding a button is courtesy; refusing the request is enforcement.
 *
 * Defaults to the RESTRICTIVE answer while settings load: a Super Admin sees
 * read-only controls for a moment rather than an Approve button that turns out
 * not to work.
 */
export function useFinanceAbilities(): FinanceAbilities {
  const { user } = useAuth();
  const { data: settings, isLoading } = useFinanceSettings();

  return useMemo(() => {
    const role = user?.role;
    const allowSuperAdminWrite = settings?.allowSuperAdminWrite ?? false;
    const can = (p: FinancePermission) => financeCan(role, p, allowSuperAdminWrite);

    return {
      view: can('view'),
      create: can('create'),
      approve: can('approve'),
      adjust: can('adjust'),
      configure: can('configure'),
      loading: isLoading,
      roleLabel: isFinanceRole(role)
        ? FINANCE_ROLE_LABELS[role]
        : role === 'super_admin'
          ? 'Super Admin'
          : '',
    };
  }, [user?.role, settings?.allowSuperAdminWrite, isLoading]);
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

/**
 * Format an amount the way the rest of the app does — en-PK grouping, the
 * currency symbol from app settings.
 *
 * ALWAYS two decimals in this module, unlike the operations screens which drop
 * them. A ledger that rounds to whole rupees on screen produces a column that
 * does not add up to its own total, and the first person to notice is an
 * auditor.
 */
export function useMoney() {
  const { settings } = useSettings();
  const symbol = settings?.currencySymbol || 'Rs.';

  return useMemo(() => {
    const format = (value: number | null | undefined, opts?: { blankZero?: boolean }) => {
      const n = Number(value ?? 0);
      if (!Number.isFinite(n)) return '—';
      if (opts?.blankZero && n === 0) return '—';
      return `${symbol} ${n.toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };
    return { symbol, format };
  }, [symbol]);
}

/**
 * A money cell.
 *
 * `tabular-nums` is not decoration — proportional digits make a column of
 * figures impossible to scan for a misplaced decimal, which is most of what
 * reading a ledger is.
 */
export function Money({
  value,
  className,
  blankZero,
  signed,
}: {
  value: number | null | undefined;
  className?: string;
  /** Render a zero as an em dash — a cash book leaves the unused side empty. */
  blankZero?: boolean;
  /** Colour by sign. For net figures, never for a debit/credit column. */
  signed?: boolean;
}) {
  const { format } = useMoney();
  const n = Number(value ?? 0);

  return (
    <span
      className={cn(
        'tabular-nums',
        signed && n < 0 && 'text-destructive',
        signed && n > 0 && 'text-emerald-600 dark:text-emerald-400',
        className,
      )}
    >
      {format(value, { blankZero })}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

type AnyStatus = FinanceDocStatus | IncomeApprovalStatus | LedgerEntryStatus | string;

/**
 * One badge for every status in the module.
 *
 * The colour vocabulary is fixed and worth stating, because it is what a user
 * learns in the first five minutes and then relies on:
 *   amber   — waiting on somebody
 *   emerald — money is in the book
 *   slate   — settled and locked; nothing further will happen
 *   red     — rejected or reversed
 */
const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-muted text-muted-foreground',
  pending_verification: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  pending_approval: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  approved: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300',
  posted: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  locked: 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  rejected: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
  reversed: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300',
};

const EXTRA_LABELS: Record<string, string> = {
  pending_verification: 'Pending Verification',
  reversed: 'Reversed',
};

export function StatusBadge({ status, className }: { status: AnyStatus; className?: string }) {
  const label =
    EXTRA_LABELS[status] ??
    FINANCE_DOC_STATUS_LABELS[status as FinanceDocStatus] ??
    status.replace(/_/g, ' ');

  return (
    <Badge
      variant="secondary"
      className={cn('capitalize', STATUS_STYLES[status] ?? 'bg-muted text-muted-foreground', className)}
    >
      {label}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

/** Page header with an optional right-hand action cluster. */
export function FinancePageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <h2 className="text-lg font-semibold">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * The banner a read-only user sees.
 *
 * Shown rather than silently rendering a page with no buttons: "why can't I
 * approve this" is otherwise a support ticket, and the answer is one sentence.
 */
export function ReadOnlyNotice({ abilities }: { abilities: FinanceAbilities }) {
  if (abilities.loading || abilities.create || abilities.approve) return null;
  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      You are signed in as <span className="font-medium">{abilities.roleLabel || 'a read-only user'}</span> — this
      module is read-only for your role.
    </div>
  );
}
