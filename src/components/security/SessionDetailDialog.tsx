'use client';

import type { LoginSession } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useLoginSession } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatDate, formatDateTime } from '@/utils/date';
import { cn } from '@/lib/utils';
import { AlertTriangle, ShieldOff } from 'lucide-react';
import { StaffAvatar } from './StaffAvatar';
import {
  LOCATION_SOURCE_LABELS,
  STATE_LABELS,
  STATE_STYLES,
  formatBrowser,
  formatDuration,
  formatLocation,
  formatPlatform,
} from './sessionFormat';

/**
 * One session, in full.
 *
 * THE ONE PLACE THE ACTIVATED ACCOUNT IS SHOWN UNMASKED, and only to a caller
 * the API decides may see it. Every list on these screens shows the staff code
 * (`MBU-000125`) instead, because a list is read on a shared shop-floor tablet
 * by someone looking for a device or a time, not for an address — and printing
 * every staff email into that view spreads half a credential pair to an audience
 * with no use for it.
 *
 * REFETCHED BY ID rather than handed the row that was clicked. The row carries a
 * MASKED address; the API decides per request whether to reveal it, so reusing
 * the row would mean this dialog could only ever show what the list already had.
 * One extra request, on open only, is the price of the distinction being real
 * rather than cosmetic.
 *
 * Sections mirror the questions asked in order: who, when, where, on what, and
 * — last, because it is the part that only matters once the first four have not
 * settled it — the security detail.
 */

function Row({ label, children, mono }: { label: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('break-words text-right', mono && 'font-mono text-xs')}>{children}</dd>
    </>
  );
}

function Section({ title }: { title: string }) {
  return (
    <dt className="col-span-2 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground first:pt-0">
      {title}
    </dt>
  );
}

export function SessionDetailDialog({
  sessionId,
  onClose,
  onRevoke,
}: {
  sessionId: string | null;
  onClose: () => void;
  /** Omitted where revoking is not on offer — e.g. the read-only dashboard card. */
  onRevoke?: (session: LoginSession) => void;
}) {
  const { token } = useAuth();
  const q = useLoginSession(token, sessionId);
  const s = q.data;

  return (
    <Dialog open={!!sessionId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>Session detail</DialogTitle>
        </DialogHeader>

        {q.isLoading && (
          <div className="space-y-2 py-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        )}

        {q.isError && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            That session could not be loaded. It may have been removed.
          </p>
        )}

        {s && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <StaffAvatar name={s.userName} seed={s.userCode} size="lg" />
              <div className="min-w-0">
                <p className="truncate font-semibold">{s.userName}</p>
                <p className="font-mono text-xs text-muted-foreground">{s.userCode ?? 'No staff ID'}</p>
              </div>
              <span
                className={cn(
                  'ml-auto inline-flex shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                  STATE_STYLES[s.state],
                )}
              >
                {STATE_LABELS[s.state]}
              </span>
            </div>

            {/* Above the fold, not buried in the grid: it is the reason this
                dialog was opened whenever it applies, and a warning that reads
                after the IP address has already been scrolled past has failed. */}
            {s.isSuspicious && (
              <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/40">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="font-medium text-amber-900 dark:text-amber-200">Unusual sign-in</p>
                  <p className="text-amber-800 dark:text-amber-300">{s.suspiciousReason}</p>
                  {/* Said plainly, every time. The detector runs on IP
                      geolocation and user-agent strings, both of which are
                      routinely wrong for VPNs, mobile carriers and updated
                      browsers — and an admin who reads this as proof will act
                      on it as proof. */}
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    Worth reviewing, not proof of anything. VPNs, mobile networks and
                    approximate IP locations all produce this.
                  </p>
                </div>
              </div>
            )}

            {s.state === 'revoked' && (
              <div className="flex gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
                <ShieldOff className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div>
                  <p className="font-medium">Signed out by {s.revokedByName}</p>
                  <p className="text-muted-foreground">{formatDateTime(s.revokedAt)}</p>
                  {s.revokeReason && <p className="mt-1 text-muted-foreground">{s.revokeReason}</p>}
                </div>
              </div>
            )}

            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <Section title="User" />
              <Row label="Mountain Bakes ID">
                <span className="font-mono">{s.userCode ?? '—'}</span>
              </Row>
              <Row label="Role">
                <span className="capitalize">{(s.userRole ?? '—').replace(/_/g, ' ')}</span>
              </Row>
              <Row label="Branch">{s.branchName || '—'}</Row>
              <Row label="Activated account">
                <span className="break-all">{s.userEmail || '—'}</span>
                {/* Only shown when it IS masked, so the absence of this line is
                    itself the signal that the address is the real one. */}
                {s.emailMasked && (
                  <span className="ml-1 text-xs text-muted-foreground">(hidden)</span>
                )}
              </Row>

              <Section title="Session" />
              <Row label="Signed in">{formatDateTime(s.loginAt)}</Row>
              <Row label={s.endedAt ? 'Ended' : 'Last active'}>
                {formatDateTime(s.endedAt ?? s.lastSeenAt)}
              </Row>
              <Row label="Duration">
                <span className="font-semibold tabular-nums">{formatDuration(s.durationMs)}</span>
              </Row>
              <Row label="Business day">{formatDate(s.date)}</Row>

              <Section title="Location" />
              <Row label="Place">{formatLocation(s)}</Row>
              <Row label="Region">{s.region || '—'}</Row>
              <Row label="Timezone">{s.timezone || '—'}</Row>
              <Row label="IP address" mono>{s.ipAddress || '—'}</Row>
              {/* NAMED, NOT IMPLIED. Every value above is a commercial
                  database's opinion about which network an address belongs to —
                  a city at best, wherever the exit node is on a VPN, and
                  routinely a whole country wrong on a mobile carrier. An admin
                  deciding whether to sign somebody out has to know which kind of
                  claim they are reading, and a sentence in a page header they
                  scrolled past is not that. */}
              <Row label="Source">{LOCATION_SOURCE_LABELS[s.locationSource]}</Row>
              {/* Only where there are coordinates, and never as a map link. For
                  source=IP this pair is the middle of a city — pinning it would
                  present a whole city's answer as a place a person stood. */}
              {s.latitude !== null && s.longitude !== null && (
                <Row label="Coordinates" mono>
                  {s.latitude.toFixed(4)}, {s.longitude.toFixed(4)}
                  <span className="ml-1 font-sans text-xs text-muted-foreground">
                    ({s.locationSource === 'IP' ? 'city centre, approximate' : 'device fix'})
                  </span>
                </Row>
              )}

              <Section title="Device" />
              <Row label="Browser">{formatBrowser(s)}</Row>
              <Row label="Platform">{formatPlatform(s)}</Row>
              <Row label="OS version">{s.osVersion || '—'}</Row>
              {/* Both omitted rather than shown as '—' when absent, unlike the
                  rows above. A missing model on a laptop and a missing screen
                  size on an old session are the normal case, not a gap worth a
                  line each in a dialog that is already long. */}
              {s.deviceName && <Row label="Model">{s.deviceName}</Row>}
              {s.screenSize && (
                <Row label="Screen">
                  {s.screenSize}
                  {/* Labelled at the point of display, because it is the one
                      field on this row the BROWSER volunteered rather than the
                      server observing. */}
                  <span className="ml-1 text-xs text-muted-foreground">(device-reported)</span>
                </Row>
              )}

              <Section title="Security" />
              <Row label="Session ID" mono>{s.id}</Row>
              {/* Shown, and shown as absent where it is. A row from before this
                  feature shipped cannot be revoked at the authentication layer,
                  and an admin needs to know that is why the button is missing
                  rather than assuming the screen is broken. */}
              <Row label="Auth session" mono>{s.authSessionId ?? 'not recorded'}</Row>
              <Row label="Sign-in method">Email and password · Supabase Auth</Row>

              {s.userAgent && (
                <>
                  <Section title="Raw user agent" />
                  {/* The parsed browser and platform above are a READING of this
                      string, and a user agent is a self-declaration that lies by
                      convention — Edge claims to be Chrome, which claims to be
                      Safari. Showing the original underneath is what keeps a
                      wrong reading visibly a reading. */}
                  <dd className="col-span-2 break-all rounded-md bg-muted/40 p-2.5 font-mono text-xs">
                    {s.userAgent}
                  </dd>
                </>
              )}
            </dl>
          </div>
        )}

        <DialogFooter>
          {s && onRevoke && s.canRevoke && (
            <Button variant="destructive" onClick={() => onRevoke(s)}>
              <ShieldOff className="mr-1.5 h-4 w-4" /> Sign out this session
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
