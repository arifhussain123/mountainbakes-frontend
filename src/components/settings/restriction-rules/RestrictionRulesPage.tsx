'use client';

import { useState } from 'react';
import { restrictionDmy } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useRestrictionRules } from '@/lib/restrictions';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ApprovalsTab } from './ApprovalsTab';
import { AuditTab } from './AuditTab';
import { MonitorTab } from './MonitorTab';
import { PreviewTab } from './PreviewTab';
import { RulesTab } from './RulesTab';
import { time12 } from './format';

/**
 * Admin Settings → Restriction Rules (migration 136).
 *
 * One screen, five tabs: the rules themselves, the approval requests that lift
 * one once, the live state of every branch, the audit trail, and a preview of
 * what a branch is shown. Super Admin only — the API refuses every call here
 * for anyone else, and RouteGuard keeps them off the page.
 */

const TABS = [
  ['rules', 'Rules'],
  ['approvals', 'Approvals'],
  ['monitor', 'Branch Monitor'],
  ['audit', 'Audit Log'],
  ['preview', 'Popup Preview'],
] as const;
type TabKey = (typeof TABS)[number][0];

function HeaderFact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border bg-card px-3 py-2">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={cn('text-[13px] font-semibold', mono && 'font-mono tabular-nums')}>{value}</span>
    </div>
  );
}

export function RestrictionRulesPage() {
  const { token } = useAuth();
  const [tab, setTab] = useState<TabKey>('rules');
  const rulesQ = useRestrictionRules(token);
  const state = rulesQ.data;
  const pending = state?.pendingRequests ?? 0;

  return (
    <div className="flex w-full max-w-[1120px] flex-col gap-[18px] text-[13px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-[620px] flex-col gap-1.5">
          <h1 className="text-[22px] font-bold tracking-tight">Restriction Rules</h1>
          <p className="leading-normal text-pretty text-muted-foreground">
            Control branch demand, sales, cash-deposit, ledger and company-share operations. Rules are enforced by the
            server; branch users see the result inside the popup where they attempt the action.
          </p>
        </div>
        {state && (
          <div className="flex flex-wrap gap-2">
            <HeaderFact label="Business date" value={restrictionDmy(state.businessDate)} mono />
            <HeaderFact label="Timezone" value={state.timezone} />
            <HeaderFact label="Day closes" value={time12(state.closingTime)} />
          </div>
        )}
      </div>

      <div role="tablist" aria-label="Restriction Rules sections" className="flex gap-1 overflow-x-auto border-b [scrollbar-width:none]">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              '-mb-px flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[13px] font-semibold whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
              tab === key ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {label}
            {key === 'approvals' && pending > 0 && (
              <span className="rounded-full bg-primary px-[7px] py-px text-[11px] text-primary-foreground" aria-label={`${pending} pending`}>
                {pending}
              </span>
            )}
          </button>
        ))}
      </div>

      {rulesQ.isLoading && (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-64 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      )}

      {rulesQ.isError && (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border bg-card p-5">
          <p className="font-semibold">The restriction rules could not be loaded.</p>
          <p className="text-muted-foreground">
            {rulesQ.error instanceof Error ? rulesQ.error.message : 'Unknown error.'} If this is a new deployment, the
            database migration for Restriction Rules may not have been applied yet.
          </p>
          <Button variant="outline" onClick={() => void rulesQ.refetch()}>Try again</Button>
        </div>
      )}

      {state && (
        <div role="tabpanel">
          {tab === 'rules' && <RulesTab state={state} />}
          {tab === 'approvals' && <ApprovalsTab />}
          {tab === 'monitor' && <MonitorTab cashLimit={state.rules.cash.dailyLimit.limit} />}
          {tab === 'audit' && <AuditTab />}
          {tab === 'preview' && <PreviewTab state={state} />}
        </div>
      )}
    </div>
  );
}
