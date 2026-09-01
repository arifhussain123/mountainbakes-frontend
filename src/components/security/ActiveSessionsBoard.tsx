'use client';

import { useState } from 'react';
import type { ActiveSessionGroup, LoginSession } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useActiveSessions } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatCard } from '@/components/shared/StatCard';
import { formatTime } from '@/utils/date';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Eye,
  Globe2,
  MonitorSmartphone,
  ShieldOff,
  Users,
} from 'lucide-react';
import { StaffAvatar } from './StaffAvatar';
import {
  STATE_LABELS,
  STATE_STYLES,
  formatBrowser,
  formatDuration,
  formatLocation,
  formatPlatform,
} from './sessionFormat';

/**
 * Admin → Security → Active Sessions.
 *
 * GROUPED BY ACCOUNT, and the grouping is the entire feature. A flat list of
 * live sessions answers "who is signed in"; grouped by account it answers "is
 * one account signed in from three countries at once", which is the question
 * that prompted this screen and cannot be read off a flat list at all — the
 * three rows sit apart, sorted by time, and nothing joins them.
 *
 * MULTI-COUNTRY IS A WARNING, NOT A VERDICT, and the screen says so in as many
 * words. A staff member on a VPN, on a roaming SIM, or behind a mobile carrier
 * whose exit node moved will trip it while doing nothing wrong, and the IP
 * geolocation behind it is regularly wrong by a whole country. Nothing here
 * blocks anybody; it offers a look and a way to sign them out, and leaves the
 * judgement to the person reading it.
 *
 * A group is COLLAPSED by default and expands to its sessions. One account on
 * one device is the overwhelmingly common case and needs one line, not four; the
 * accounts worth opening are the ones the badges have already pointed at.
 */
export function ActiveSessionsBoard({
  onView,
  onRevoke,
  onRevokeAll,
}: {
  onView: (sessionId: string) => void;
  onRevoke: (session: LoginSession) => void;
  /** Carries the group's live count, which the dialog spells out before asking. */
  onRevokeAll: (session: LoginSession, sessionCount: number) => void;
}) {
  const { token } = useAuth();
  const q = useActiveSessions(token);
  const [open, setOpen] = useState<Set<string>>(new Set());

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  if (q.isLoading) {
    return (
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-lg" />)}
        </div>
        {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
      </div>
    );
  }

  const data = q.data;
  const groups = data?.groups ?? [];

  // Counted from the groups rather than from a server field, because the two
  // conditions the banner is about are exactly what the grouping already
  // computed — an account live in more than one country, and an account with a
  // session the detector flagged. A third round-trip to be told the same thing
  // would be a number that could disagree with the rows underneath it.
  const flagged = groups.filter((g) => g.multiCountry || g.hasSuspicious);

  return (
    <div className="space-y-4">
      {/* THE BANNER IS A PROMPT, NOT A VERDICT, and it says so in its own words
          rather than leaving the reader to supply the qualification. Every
          signal behind it is weak on its own: IP geolocation is a commercial
          database that is regularly a country wrong, a VPN or a roaming SIM
          relocates somebody without their knowing, and a browser update makes a
          familiar device look new. It is here because an admin who opens this
          screen for an unrelated reason should still be told that something is
          worth a look — and it is worded so that reading it as proof takes
          effort. */}
      {flagged.length > 0 && (
        <div className="flex gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/40">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="text-sm">
            <p className="font-medium text-amber-900 dark:text-amber-200">
              {flagged.length === 1
                ? 'One account has unusual sign-in activity'
                : `${flagged.length} accounts have unusual sign-in activity`}
            </p>
            <p className="text-amber-800 dark:text-amber-300">
              {/* Named, not merely counted. An admin scanning a long roster
                  should not have to expand groups to find which ones the
                  banner meant. */}
              {flagged.map((g) => g.userCode ?? g.userName).join(' · ')} — signed in from
              more than one country at once, or on a device or from a place this account
              has not used before. Review the sessions below before acting; a VPN, a
              roaming SIM, a new phone and an approximate IP location all look exactly
              like this.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard title="Live sessions" value={data?.totalSessions ?? 0} icon={MonitorSmartphone} color="blue" />
        <StatCard title="Accounts signed in" value={data?.totalUsers ?? 0} icon={Users} color="blue" />
        <StatCard
          title="In multiple countries"
          value={data?.multiCountryUsers ?? 0}
          icon={Globe2}
          // Warning-coloured only when it is non-zero. A tile that is permanently
          // red is wallpaper within a week and stops being read at all, which
          // costs exactly the one reading it exists for.
          color={data && data.multiCountryUsers > 0 ? 'red' : 'blue'}
        />
      </div>

      {groups.length === 0 ? (
        <EmptyState
          title="Nobody is signed in"
          description="A session counts as live while its tab has checked in within the last ten minutes."
        />
      ) : (
        <div className="space-y-2">
          {groups.map((g) => (
            <GroupRow
              key={g.userId ?? g.userCode ?? g.sessions[0]!.id}
              group={g}
              expanded={open.has(g.userId ?? g.userCode ?? g.sessions[0]!.id)}
              onToggle={() => toggle(g.userId ?? g.userCode ?? g.sessions[0]!.id)}
              onView={onView}
              onRevoke={onRevoke}
              onRevokeAll={onRevokeAll}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function GroupRow({
  group: g,
  expanded,
  onToggle,
  onView,
  onRevoke,
  onRevokeAll,
}: {
  group: ActiveSessionGroup;
  expanded: boolean;
  onToggle: () => void;
  onView: (sessionId: string) => void;
  onRevoke: (session: LoginSession) => void;
  onRevokeAll: (session: LoginSession, sessionCount: number) => void;
}) {
  const many = g.sessionCount > 1;

  return (
    <div
      className={cn(
        'rounded-lg border bg-card',
        g.multiCountry && 'border-amber-300 dark:border-amber-900',
      )}
    >
      {/* The whole head is the toggle, so the target is a row rather than a
          12px chevron — this list is used on a tablet. */}
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 p-3 text-left"
        aria-expanded={expanded}
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <StaffAvatar name={g.userName} seed={g.userCode} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-mono text-sm font-medium">{g.userCode ?? '—'}</span>
            <span className="truncate text-sm text-muted-foreground">{g.userName}</span>
            {g.userRole && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] capitalize text-muted-foreground">
                {g.userRole.replace(/_/g, ' ')}
              </span>
            )}
          </div>
          {/* The activated address, under the staff code rather than replacing
              it. The code is what this screen is read by and what survives an
              address change; the address is what an admin needs to be sure they
              are about to sign out the account they mean. */}
          <p className="truncate text-xs text-muted-foreground">{g.userEmail}</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {many ? `${g.sessionCount} active sessions` : `${formatBrowser(g.sessions[0]!)} · ${formatLocation(g.sessions[0]!)}`}
            {' · last active '}
            {formatTime(g.lastSeenAt)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {g.hasSuspicious && (
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" aria-label="Flagged as unusual" />
          )}
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
            <span className="size-1.5 rounded-full bg-current" />
            {g.sessionCount}
          </span>
        </div>
      </button>

      {/* The multi-country warning sits OUTSIDE the collapsed body on purpose:
          it is the reason to open the group, so hiding it behind the toggle
          would mean only someone who already suspected something would find it. */}
      {g.multiCountry && (
        <div className="mx-3 mb-3 flex gap-2 rounded-md bg-amber-50 p-2.5 text-xs dark:bg-amber-950/40">
          <Globe2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <p className="text-amber-800 dark:text-amber-300">
            <span className="font-medium">Signed in from {g.countries.length} countries: </span>
            {g.countries.join(' · ')}. Review the sessions below — a VPN, a roaming SIM or an
            approximate IP location all look like this.
          </p>
        </div>
      )}

      {expanded && (
        <div className="border-t">
          {g.sessions.map((s) => (
            <div key={s.id} className="flex flex-col gap-2 border-b p-3 last:border-b-0 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span>{formatBrowser(s)} · {formatPlatform(s)}</span>
                  {/* Per SESSION, not per group. A person can have one tab in
                      front of them and another asleep on a laptop at home, and
                      a single badge on the group would have to lie about one of
                      them — which is the second device this screen exists to
                      surface. */}
                  <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', STATE_STYLES[s.state])}>
                    {STATE_LABELS[s.state]}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatLocation(s)} · signed in {formatTime(s.loginAt)} · last active {formatTime(s.lastSeenAt)} ·{' '}
                  <span className="tabular-nums">{formatDuration(s.durationMs)}</span>
                </p>
                {s.isSuspicious && (
                  <p className="mt-1 flex gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    {s.suspiciousReason}
                  </p>
                )}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button variant="outline" size="sm" className="h-10 flex-1 md:h-9 sm:flex-none" onClick={() => onView(s.id)}>
                  <Eye className="mr-1.5 h-4 w-4" /> View
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 flex-1 md:h-9 sm:flex-none"
                  disabled={!s.canRevoke}
                  onClick={() => onRevoke(s)}
                  // A session recorded before revocation existed has no
                  // authentication handle to delete, so the button is disabled
                  // and says why rather than failing when pressed.
                  title={s.canRevoke ? undefined : 'This session predates session revocation and cannot be ended from here'}
                >
                  <ShieldOff className="mr-1.5 h-4 w-4 text-destructive" /> Sign out
                </Button>
              </div>
            </div>
          ))}

          {many && (
            <div className="p-3">
              <Button variant="destructive" size="sm" className="h-10 w-full md:h-9 sm:w-auto" onClick={() => onRevokeAll(g.sessions[0]!, g.sessionCount)}>
                <ShieldOff className="mr-1.5 h-4 w-4" /> Sign out all sessions for {g.userCode ?? g.userName}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
