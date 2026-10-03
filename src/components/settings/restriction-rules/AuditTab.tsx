'use client';

import { useState } from 'react';
import { RESTRICTION_CODES } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useRestrictionEvents } from '@/lib/restrictions';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/utils/date';
import { EVENT_RESULT_PILL, chipClass } from './format';

const TH = 'border-b px-3.5 py-[11px] text-left text-[11px] font-semibold text-muted-foreground';
const TD = 'border-b px-3.5 py-2.5';

/** RULES_CONFIG is not a rule — it is the trail of changes to the rules themselves. */
const FILTERS = [...RESTRICTION_CODES, 'RULES_CONFIG'] as const;

/** Every time a rule warned, blocked, was asked to be lifted, was decided, or was reconfigured. */
export function AuditTab() {
  const { token } = useAuth();
  const [ruleCode, setRuleCode] = useState<string | null>(null);
  const q = useRestrictionEvents(token, ruleCode, true);
  const events = q.data?.events ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {[null, ...FILTERS].map((code) => (
          <button
            key={code ?? 'all'}
            type="button"
            aria-pressed={ruleCode === code}
            onClick={() => setRuleCode(code)}
            className={cn('h-7 rounded-full border px-2.5 font-mono text-[11px] font-semibold', chipClass(ruleCode === code))}
          >
            {code ?? 'All'}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[1040px] border-collapse text-xs">
          <thead>
            <tr>
              <th className={TH}>Event</th>
              <th className={TH}>Rule</th>
              <th className={TH}>Branch / User</th>
              <th className={TH}>Transaction / Request</th>
              <th className={TH}>Date &amp; time</th>
              <th className={TH}>Value / Threshold</th>
              <th className={TH}>Action</th>
              <th className={TH}>Result</th>
              <th className={TH}>Approval</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td className={cn(TD, 'font-mono')}>{e.eventNo}</td>
                <td className={cn(TD, 'font-mono text-[11px]')}>{e.ruleCode}</td>
                <td className={TD}>
                  <div className="flex flex-col gap-px">
                    <span className="font-semibold">{e.branchName ?? '—'}</span>
                    <span className="text-muted-foreground">{e.userName ?? '—'}</span>
                  </div>
                </td>
                <td className={cn(TD, 'font-mono')}>{e.ref ?? '—'}</td>
                <td className={cn(TD, 'text-foreground/80')}>{formatDateTime(e.createdAt)}</td>
                <td className={cn(TD, 'tabular-nums')}>
                  {e.currentValue !== null && e.threshold !== null ? `${e.currentValue} / ${e.threshold}` : '—'}
                </td>
                <td className={TD}>{e.action}</td>
                <td className={TD}>
                  <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-bold whitespace-nowrap', EVENT_RESULT_PILL[e.result] ?? 'bg-muted')}>
                    {e.result}
                  </span>
                </td>
                <td className={cn(TD, 'font-mono')}>{e.approvalNo ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {q.isLoading && <p className="p-6 text-center text-muted-foreground">Loading events…</p>}
        {q.isError && <p role="alert" className="p-6 text-center text-destructive">Could not load the audit log.</p>}
        {q.isSuccess && events.length === 0 && <p className="p-6 text-center text-muted-foreground">No events recorded for this rule yet.</p>}
      </div>
      {events.length >= 200 && <p className="text-xs text-muted-foreground">Showing the latest 200 events.</p>}
    </div>
  );
}
