'use client';

import type { WhatsAppConnectionStatus } from '@mb/shared';
import { AlertTriangle, CheckCircle2, FlaskConical, Loader2, PlugZap, ShieldCheck, ShieldOff } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/utils/date';
import { cn } from '@/lib/utils';
import { Pill } from './parts';
import type { Tone } from './purchasing-model';

/**
 * The WhatsApp connection panel (GET /api/purchasing/status).
 *
 * Mock mode gets the loudest treatment on the page, not the quietest: in mock
 * mode every Send "works" — the message is recorded, the demand moves on — and
 * nothing reaches the supplier. A small grey badge would let someone wait a day
 * for a quotation that was never asked for.
 *
 * Only the NAMES of missing variables are shown. The API never returns a value,
 * and this panel has nothing to leak even if it did.
 */

const STATE: Record<WhatsAppConnectionStatus['state'], { label: string; tone: Tone; icon: typeof CheckCircle2 }> = {
  connected: { label: 'Connected', tone: 'good', icon: CheckCircle2 },
  awaiting_webhook: { label: 'Awaiting first webhook', tone: 'waiting', icon: Loader2 },
  configuration_required: { label: 'Configuration required', tone: 'bad', icon: AlertTriangle },
  mock: { label: 'Test mode', tone: 'action', icon: FlaskConical },
};

export function ConnectionPanel({
  status,
  isLoading,
  isError,
  onRetry,
}: {
  status: WhatsAppConnectionStatus | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  if (isLoading) return <Skeleton className="h-24 w-full rounded-xl" />;
  if (isError || !status) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">
        <span className="flex items-center gap-2 text-destructive">
          <PlugZap className="h-4 w-4" aria-hidden /> Could not load the WhatsApp connection status.
        </span>
        <button type="button" className="text-sm font-medium underline" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }

  const s = STATE[status.state];
  const Icon = s.icon;
  return (
    <div
      className={cn(
        'space-y-3 rounded-xl border p-3 sm:p-4',
        status.state === 'mock' && 'border-violet-300 bg-violet-50 dark:border-violet-800 dark:bg-violet-950/40',
        status.state === 'configuration_required' && 'border-destructive/40 bg-destructive/5',
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">WhatsApp</span>
          <Pill tone={s.tone}>
            <Icon className={cn('h-3 w-3', status.state === 'awaiting_webhook' && 'animate-spin')} aria-hidden /> {s.label}
          </Pill>
          <span className="text-xs text-muted-foreground">Provider: {status.provider === 'meta' ? 'Meta Cloud API' : 'Mock (test)'}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className={cn(status.outbox.pending > 0 && 'font-medium')}>Outbox pending: {status.outbox.pending}</span>
          <span className={cn(status.outbox.failed > 0 && 'font-medium text-destructive')}>Failed: {status.outbox.failed}</span>
        </div>
      </div>

      {status.state === 'mock' && (
        <p className="flex items-start gap-2 rounded-lg bg-violet-100 p-2.5 text-sm font-medium text-violet-900 dark:bg-violet-900/40 dark:text-violet-100">
          <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          Test mode, no real WhatsApp messages are sent. Demands, quotations and payments are recorded as usual, but no supplier receives anything.
        </p>
      )}

      <div className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <span className="text-muted-foreground">Business number: </span>
          <span className="font-medium">{status.displayPhoneNumber ?? 'Not set'}</span>
        </div>
        <div className="flex items-center gap-1">
          {status.authorized ? (
            <ShieldCheck className="h-4 w-4 text-emerald-600" aria-hidden />
          ) : (
            <ShieldOff className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
          <span>{status.authorized ? 'Authorized Production number' : 'No authorized number'}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Last webhook: </span>
          <span>{status.lastWebhookAt ? formatDateTime(status.lastWebhookAt) : 'Never'}</span>
        </div>
        <div className="truncate">
          <span className="text-muted-foreground">Templates: </span>
          <span className="font-mono text-xs">
            {status.templates.demand}, {status.templates.update} ({status.templates.language})
          </span>
        </div>
      </div>

      {status.missing.length > 0 && (
        <div className="text-sm">
          <p className="font-medium text-destructive">Not configured on the server:</p>
          <ul className="mt-1 flex flex-wrap gap-1.5">
            {status.missing.map((name) => (
              <li key={name} className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                {name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
