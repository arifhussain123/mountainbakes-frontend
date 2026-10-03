'use client';

import { useAuth } from '@/hooks/useAuth';
import { useRestrictionMonitor } from '@/lib/restrictions';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/utils/date';
import { MONITOR_STATUS_PILL } from './format';

const TH = 'border-b px-4 py-3 text-left text-[11.5px] font-semibold text-muted-foreground';
const TD = 'border-b px-4 py-3';

/** Live restriction state per active branch, under the rules as currently saved. */
export function MonitorTab({ cashLimit }: { cashLimit: number }) {
  const { token } = useAuth();
  const q = useRestrictionMonitor(token, true);
  const rows = q.data?.branches ?? [];

  return (
    <div className="flex flex-col gap-2.5">
      <p className="text-muted-foreground">Live restriction state per branch, evaluated with the current rule configuration.</p>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[860px] border-collapse">
          <thead>
            <tr>
              <th className={TH}>Branch</th>
              <th className={cn(TH, 'text-center')}>Awaiting verification</th>
              <th className={TH}>Demand numbers</th>
              <th className={TH}>Oldest awaiting</th>
              <th className={cn(TH, 'text-center')}>Sales this hour</th>
              <th className={cn(TH, 'text-center')}>Deposits today</th>
              <th className={TH}>Demand status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.branchId}>
                <td className={cn(TD, 'font-semibold')}>{m.branchName}</td>
                <td className={cn(TD, 'text-center font-bold tabular-nums')}>{m.pendingCount}</td>
                <td className={cn(TD, 'font-mono text-xs')}>{m.pendingDemandNumbers.join(', ') || '—'}</td>
                <td className={cn(TD, 'text-foreground/80')}>
                  {m.oldestPending ? `${m.oldestPending.demandNumber} · ${formatDateTime(m.oldestPending.submittedAt)}` : '—'}
                </td>
                <td className={cn(TD, 'text-center tabular-nums')}>{m.salesThisHour} / hr</td>
                <td className={cn(TD, 'text-center tabular-nums')}>{m.depositsToday} / {cashLimit}</td>
                <td className={TD}>
                  <span className={cn('rounded-full px-[9px] py-[3px] text-[11px] font-bold', MONITOR_STATUS_PILL[m.demandStatus])}>
                    {m.demandStatus}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {q.isLoading && <p className="p-6 text-center text-muted-foreground">Loading branches…</p>}
        {q.isError && <p role="alert" className="p-6 text-center text-destructive">Could not load the branch monitor.</p>}
        {q.isSuccess && rows.length === 0 && <p className="p-6 text-center text-muted-foreground">No active branches.</p>}
      </div>
    </div>
  );
}
