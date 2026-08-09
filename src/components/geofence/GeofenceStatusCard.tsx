'use client';

import { formatDistanceKm } from '@mb/shared';
import { useGeofence } from '@/providers/GeofenceProvider';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MapPin, RefreshCw } from 'lucide-react';

/** '2:41 PM' — the last-verified stamp. Locale-formatted, so it reads naturally. */
function formatTime(iso: string | null): string {
  if (!iso) return 'Not yet verified';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Not yet verified';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function coords(point: { latitude: number; longitude: number } | null): string {
  if (!point) return '—';
  return `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
}

/**
 * Live geofence status for the branch dashboard.
 *
 * Renders nothing when the rule does not apply — an admin has no branch radius to
 * be inside of, and a card reading "Not applicable" is just noise on their screen.
 *
 * The amber "near boundary" state is the one worth having: it warns while the user
 * can still act on it, rather than only telling them once sales have already
 * stopped.
 */
export function GeofenceStatusCard() {
  const {
    applies,
    loading,
    verdict,
    position,
    branchCentre,
    branchName,
    radiusKm,
    lastVerifiedAt,
    refresh,
  } = useGeofence();

  if (!applies) return null;

  const proximity = verdict?.proximity ?? 'unknown';
  const allowed = verdict?.allowed ?? false;

  const tone = loading
    ? { dot: 'bg-muted-foreground', text: 'text-muted-foreground', label: 'Checking your location…' }
    : allowed && proximity === 'near_boundary'
      ? { dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-400', label: 'Near the edge of the allowed area' }
      : allowed
        ? { dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-400', label: 'Inside Authorized Area' }
        : { dot: 'bg-red-500', text: 'text-red-700 dark:text-red-400', label: 'Outside Authorized Area' };

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full', tone.dot)} aria-hidden />
          <div>
            <p className={cn('text-sm font-semibold leading-tight', tone.text)}>{tone.label}</p>
            <p className="text-xs text-muted-foreground">
              {branchName ? `${branchName} · ` : ''}
              {radiusKm != null ? `${formatDistanceKm(radiusKm)} radius` : 'No radius set'}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void refresh()}
          aria-label="Re-check my location"
          className="shrink-0"
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
        </Button>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-4">
        <div>
          <dt className="uppercase tracking-wide text-muted-foreground">Distance</dt>
          <dd className={cn('mt-0.5 font-semibold tabular-nums', tone.text)}>
            {verdict?.distanceKm != null ? formatDistanceKm(verdict.distanceKm) : '—'}
          </dd>
        </div>
        <div>
          <dt className="uppercase tracking-wide text-muted-foreground">Last verified</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{formatTime(lastVerifiedAt)}</dd>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <dt className="flex items-center gap-1 uppercase tracking-wide text-muted-foreground">
            <MapPin className="h-3 w-3" /> Your position
          </dt>
          <dd className="mt-0.5 truncate font-mono text-[11px]">{coords(position)}</dd>
        </div>
        <div className="col-span-2 sm:col-span-1">
          <dt className="flex items-center gap-1 uppercase tracking-wide text-muted-foreground">
            <MapPin className="h-3 w-3" /> Branch
          </dt>
          <dd className="mt-0.5 truncate font-mono text-[11px]">{coords(branchCentre)}</dd>
        </div>
      </dl>
    </div>
  );
}
