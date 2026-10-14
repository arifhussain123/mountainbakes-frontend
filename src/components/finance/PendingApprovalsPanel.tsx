'use client';

import Link from 'next/link';
import { Hourglass } from 'lucide-react';
import {
  FINANCE_PENDING_APPROVAL_LABELS,
  type FinancePendingApproval,
  type FinancePendingApprovalKind,
} from '@mb/shared';
import { useFinancePendingApprovals } from '@/lib/finance';
import { formatCurrency } from '@/utils/currency';
import { formatDate } from '@/utils/date';
import { ROUTES } from '@/utils/routes';

/**
 * Documents awaiting approval, shown on the Daily Ledger.
 *
 * They are not in the book — a document posts its voucher when it is approved —
 * so they are listed above it rather than as ledger rows, the same way branch
 * cash transfers are. The list is NOT limited to the ledger's date: the
 * dashboard counts every pending document, and one dated weeks ago is exactly
 * the one that would otherwise never be found.
 *
 * Each row links to the screen that approves that kind of document; the
 * decision itself stays there, with its own checks.
 */
const REVIEW_ROUTE: Record<FinancePendingApprovalKind, string> = {
  transaction: ROUTES.FINANCE_ENTRIES,
  // The working screens, not the read-only ledgers of the same subjects.
  partner_expense: ROUTES.FINANCE_PARTNER_TRANSACTIONS,
  salary: ROUTES.FINANCE_PAYROLL,
  advance: ROUTES.FINANCE_PAYROLL,
};

export function PendingApprovalsPanel() {
  const { data: items = [], isLoading } = useFinancePendingApprovals();
  if (isLoading || items.length === 0) return null;

  const total = items.reduce((s, i) => s + i.amount, 0);

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900 dark:bg-amber-950/30">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <Hourglass className="h-4 w-4 text-amber-700 dark:text-amber-400" />
          Pending approval — not in the ledger yet
          <span className="rounded-full bg-amber-200 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-900 dark:text-amber-100">
            {items.length}
          </span>
        </p>
        <span className="text-sm font-semibold tabular-nums">{formatCurrency(total)}</span>
      </div>

      <ul className="divide-y divide-amber-200/70 dark:divide-amber-900/70">
        {items.map((i) => (
          <PendingRow key={`${i.kind}:${i.id}`} item={i} />
        ))}
      </ul>
    </div>
  );
}

function PendingRow({ item }: { item: FinancePendingApproval }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2 text-sm">
      <span className="font-mono text-xs">{item.refNo}</span>
      <span className="font-medium">{FINANCE_PENDING_APPROVAL_LABELS[item.kind]}</span>
      <span className="font-semibold tabular-nums">{formatCurrency(item.amount)}</span>
      <span className="min-w-0 break-words text-muted-foreground">
        {[item.description, formatDate(item.date)].filter(Boolean).join(' · ')}
        {item.status === 'draft' ? ' · draft' : ''}
      </span>
      <Link href={REVIEW_ROUTE[item.kind]} className="ml-auto text-xs font-medium text-primary hover:underline">
        Review
      </Link>
    </li>
  );
}
