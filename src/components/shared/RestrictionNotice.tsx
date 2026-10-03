'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useRequestRestrictionApproval, type RestrictionPreflight } from '@/lib/restrictions';
import type { CreateRestrictionRequestInput, Restriction, RestrictionSeverity } from '@mb/shared';

/**
 * The one notice a popup shows for a Restriction Rule (migration 136): a
 * warning, a block, "Admin approval required", or "Admin Approved".
 *
 * Everything in it — title, wording, demand and CT numbers, figures — was
 * composed by the API. This component decides nothing and adds no text of its
 * own, so the admin Popup Preview and a branch's real popup are the same render.
 *
 * It is drawn INSIDE the popup the user is acting in. There is no toast beside
 * it and no page of its own: one restriction, shown once, where it applies.
 */

const TONE: Record<RestrictionSeverity, { box: string; accent: string; dot: string; chip: string; level: string; glyph: string }> = {
  warning: {
    box: 'border-amber-300 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30',
    accent: 'text-amber-800 dark:text-amber-300',
    dot: 'bg-amber-700 dark:bg-amber-600',
    chip: 'border-amber-300 dark:border-amber-900/60',
    level: 'WARNING',
    glyph: '!',
  },
  blocking: {
    box: 'border-red-300 bg-red-50 dark:border-red-900/60 dark:bg-red-950/30',
    accent: 'text-red-700 dark:text-red-300',
    dot: 'bg-red-700 dark:bg-red-600',
    chip: 'border-red-300 dark:border-red-900/60',
    level: 'BLOCKING',
    glyph: '!',
  },
  admin_approval_required: {
    box: 'border-blue-300 bg-blue-50 dark:border-blue-900/60 dark:bg-blue-950/30',
    accent: 'text-blue-800 dark:text-blue-300',
    dot: 'bg-blue-800 dark:bg-blue-600',
    chip: 'border-blue-300 dark:border-blue-900/60',
    level: 'ADMIN APPROVAL REQUIRED',
    glyph: '?',
  },
  approved: {
    box: 'border-emerald-300 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30',
    accent: 'text-emerald-800 dark:text-emerald-300',
    dot: 'bg-emerald-700 dark:bg-emerald-600',
    chip: 'border-emerald-300 dark:border-emerald-900/60',
    level: 'APPROVED',
    glyph: '✓',
  },
  info: {
    box: 'border-border bg-muted',
    accent: 'text-muted-foreground',
    dot: 'bg-muted-foreground',
    chip: 'border-border',
    level: 'INFO',
    glyph: 'i',
  },
};

export function RestrictionNotice({
  restriction: r,
  note,
  children,
  className,
}: {
  restriction: Restriction;
  /** A line of small print under the notice. */
  note?: string;
  /** Actions that belong to the notice — the approval request form. */
  children?: React.ReactNode;
  className?: string;
}) {
  const tone = TONE[r.severity];
  return (
    <div
      // A block is announced at once; a warning waits its turn.
      role={r.severity === 'blocking' || r.severity === 'admin_approval_required' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-lg border p-3.5 text-sm', tone.box, className)}
    >
      <div aria-hidden className={cn('flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white', tone.dot)}>
        {tone.glyph}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex flex-col gap-0.5">
          <span className={cn('text-[10px] font-bold tracking-wider', tone.accent)}>{tone.level}</span>
          <span className="text-[14.5px] font-bold text-foreground">{r.title}</span>
        </div>

        {r.messages.map((m) => (
          <p key={m} className="leading-normal text-foreground/90">{m}</p>
        ))}

        {r.list && r.list.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {r.list.map((item) => (
              <span key={item} className={cn('rounded-md border bg-background px-2 py-0.5 font-mono text-xs font-medium', tone.chip)}>
                {item}
              </span>
            ))}
          </div>
        )}

        {r.shortages && r.shortages.length > 0 && (
          <div className="overflow-x-auto rounded-md bg-background">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="px-3 py-2 text-left font-medium">Product</th>
                  <th className="px-3 py-2 text-center font-medium">Required Qty</th>
                  <th className="px-3 py-2 text-center font-medium">Available Qty</th>
                  <th className="px-3 py-2 text-center font-medium">Less Qty</th>
                </tr>
              </thead>
              <tbody>
                {r.shortages.map((s) => (
                  <tr key={s.productName} className="border-t">
                    <td className="px-3 py-2 font-semibold">{s.productName}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{s.required}</td>
                    <td className="px-3 py-2 text-center tabular-nums">{s.available}</td>
                    <td className={cn('px-3 py-2 text-center font-bold tabular-nums', tone.accent)}>{s.short}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {r.after?.map((m) => (
          <p key={m} className="leading-normal text-foreground/90">{m}</p>
        ))}

        {r.meter && (
          <div
            role="img"
            aria-label={`${r.meter.value}% sold, ${r.meter.required}% required`}
            className={cn('relative h-2 rounded-full border bg-background', tone.chip)}
          >
            <div className={cn('absolute inset-y-0 left-0 rounded-full', tone.dot)} style={{ width: `${Math.min(r.meter.value, 100)}%` }} />
            <div className="absolute -inset-y-1 w-0.5 bg-foreground" style={{ left: `${Math.min(r.meter.required, 100)}%` }} />
          </div>
        )}

        {r.stats && r.stats.length > 0 && (
          <dl className="grid grid-cols-1 gap-x-3 gap-y-1.5 rounded-md bg-background px-3 py-2.5 text-xs sm:grid-cols-2">
            {r.stats.map((s) => (
              <div key={s.label} className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{s.label}</dt>
                <dd className="font-bold tabular-nums">{s.value}</dd>
              </div>
            ))}
          </dl>
        )}

        {r.reason && (
          <div className="flex flex-col gap-0.5 rounded-md bg-background px-3 py-2.5">
            <span className="text-[11px] text-muted-foreground">Reason</span>
            <span className="leading-normal">{r.reason}</span>
          </div>
        )}

        {note && <p className="text-[11.5px] text-muted-foreground">{note}</p>}
        {children}
      </div>
    </div>
  );
}

/**
 * Shown in place of a restriction when the server could not be asked. The
 * action stays unavailable: restrictions depend on the server's current state,
 * and a remembered answer is not permission.
 */
export function ConnectionRequiredNotice({ onRetry, className }: { onRetry?: () => void; className?: string }) {
  return (
    <RestrictionNotice
      className={className}
      restriction={{
        // The code is irrelevant to the render; any member satisfies the type.
        code: 'DEMAND_PENDING_LIMIT',
        severity: 'info',
        title: 'Verification Required',
        messages: ['This action requires an online server verification before it can be submitted.', 'Please reconnect to the internet and try again.'],
        requiresAdminApproval: false,
      }}
    >
      {onRetry && (
        <div>
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>Try Again</Button>
        </div>
      )}
    </RestrictionNotice>
  );
}

/**
 * The preflight result, as a popup renders it: the server's notice, or
 * "Verification Required" when it could not be reached, or nothing.
 *
 * When the restriction can be lifted by Admin, the request form is drawn inside
 * the notice. `request` is everything the request needs except the reason —
 * and none of it is trusted by the API, which works out the branch, the user
 * and the dates itself.
 */
export function RestrictionPanel({
  preflight,
  token,
  request,
  note,
  className,
}: {
  preflight: RestrictionPreflight;
  token: string;
  request?: Omit<CreateRestrictionRequestInput, 'reason'> | null;
  note?: string;
  className?: string;
}) {
  if (preflight.unverified) return <ConnectionRequiredNotice onRetry={preflight.refetch} className={className} />;
  const r = preflight.restriction;
  if (!r) return null;
  return (
    <RestrictionNotice restriction={r} note={note} className={className}>
      {r.canRequestApproval && request && <ApprovalRequestForm token={token} request={request} again={r.requestStatus === 'rejected'} />}
    </RestrictionNotice>
  );
}

function ApprovalRequestForm({
  token,
  request,
  again,
}: {
  token: string;
  request: Omit<CreateRestrictionRequestInput, 'reason'>;
  again: boolean;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const send = useRequestRestrictionApproval(token);

  async function submit() {
    const trimmed = reason.trim();
    if (trimmed.length < 5) {
      setError('Tell Admin why this is needed (at least 5 characters).');
      return;
    }
    setError(null);
    try {
      const { request: created } = await send.mutateAsync({ ...request, reason: trimmed });
      setReason('');
      // The notice itself now reads "Waiting for Admin Approval"; this confirms
      // the tap, it does not repeat the restriction.
      toast.success(`Request ${created.requestNo} sent to Admin`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the request.');
    }
  }

  return (
    <div className="flex flex-col gap-2 pt-1">
      <label className="flex flex-col gap-1.5">
        <span className="text-xs font-semibold">Reason for Admin</span>
        <Textarea
          value={reason}
          onChange={(e) => { setReason(e.target.value); setError(null); }}
          rows={2}
          maxLength={500}
          placeholder="Why is this needed?"
          className="bg-background"
          aria-invalid={!!error}
        />
      </label>
      {error && <p role="alert" className="text-xs font-medium text-destructive">{error}</p>}
      <div>
        <Button type="button" size="sm" onClick={submit} disabled={send.isPending}>
          {send.isPending ? 'Sending…' : again ? 'Request Admin Approval Again' : 'Request Admin Approval'}
        </Button>
      </div>
    </div>
  );
}
