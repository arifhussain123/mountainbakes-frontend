'use client';

import { formatDistanceKm, geofenceMessage } from '@mb/shared';
import { useGeofence } from '@/providers/GeofenceProvider';
import { Button } from '@/components/ui/button';
import { Loader2, MapPinOff, RefreshCw, ShieldAlert } from 'lucide-react';

/**
 * Hide a transaction UI when the device is outside the branch's authorised area.
 *
 * UX ONLY. The API refuses the same requests on its own terms (see
 * requireInsideGeofence), so removing this component from the tree changes what the
 * user sees and nothing about what they can do. It exists so a cashier learns they
 * are out of area BEFORE filling in a whole sale, rather than at the moment they
 * press Save.
 *
 * Deliberately not applied to anything read-only. Reports, previous sales, the
 * dashboard, notifications and the help desk all stay reachable from anywhere —
 * being out of area stops transactions, not the application.
 */
export function GeofenceGate({
  children,
  /** What is being blocked, for the heading. */
  action = 'Sales',
}: {
  children: React.ReactNode;
  action?: string;
}) {
  const { applies, loading, verdict, refresh, failure, permission } = useGeofence();

  // Not subject to the rule, or the rule is off: render normally. This is the path
  // every admin and production user takes, and every branch user when geofencing
  // is disabled, so it must cost nothing.
  if (!applies) return <>{children}</>;

  if (loading || !verdict) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 p-8 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Verifying your location…</p>
      </div>
    );
  }

  if (verdict.allowed) return <>{children}</>;

  const denied = permission === 'denied' || failure === 'denied';

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center gap-4 p-6 text-center sm:p-10">
      <div className="rounded-full bg-destructive/10 p-4">
        {verdict.outcome === 'blocked' ? (
          <ShieldAlert className="h-8 w-8 text-destructive" />
        ) : (
          <MapPinOff className="h-8 w-8 text-destructive" />
        )}
      </div>

      <h2 className="font-heading text-lg font-semibold">{action} are disabled</h2>

      {/* The wording is fixed in shared/utils/geo so the screen and the API say the
          same thing. The first line is dropped — it is already the heading above. */}
      <p className="whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
        {geofenceMessage(verdict).split('\n').slice(2).join('\n').trim()}
      </p>

      {verdict.outcome === 'blocked' && verdict.distanceKm !== null && (
        <dl className="grid w-full grid-cols-2 gap-3 rounded-lg border bg-card p-4 text-sm">
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Current Distance</dt>
            <dd className="mt-1 text-xl font-bold tabular-nums text-destructive">
              {formatDistanceKm(verdict.distanceKm)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-muted-foreground">Allowed Radius</dt>
            <dd className="mt-1 text-xl font-bold tabular-nums">
              {formatDistanceKm(verdict.radiusKm)}
            </dd>
          </div>
        </dl>
      )}

      {denied ? (
        // A refused permission cannot be re-prompted from script — the browser only
        // asks once and remembers. Offering a "Try again" button here would do
        // nothing at all, so say what will actually work instead.
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
          Location access is blocked for this site. Re-enable it from the padlock icon in
          the address bar (or your browser’s site settings), then reload this page.
        </p>
      ) : (
        <Button variant="outline" onClick={() => void refresh()}>
          <RefreshCw className="mr-1.5 h-4 w-4" /> Check my location again
        </Button>
      )}
    </div>
  );
}
