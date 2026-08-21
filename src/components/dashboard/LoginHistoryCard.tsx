'use client';

import { useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import type { LoginSession } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useLoginHistory } from '@/lib/queries';
import { DataTable } from '@/components/shared/DataTable';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatDate, formatDateTime, formatTime } from '@/utils/date';
import { cn } from '@/lib/utils';
import { Eye, MapPin } from 'lucide-react';

/**
 * Login History — who signed in, from where, and for how long.
 *
 * On every dashboard, showing DIFFERENT rows to different people: a super admin
 * sees every user's sessions, everyone else sees only their own. That scoping is
 * the API's decision, not this component's — the endpoint pins a non-admin to
 * its own uid whatever it asks for — so this only chooses the heading and
 * whether the User column is worth the width.
 *
 * COUNTRY AND CITY ARE OFTEN BLANK, and that is normal rather than broken. Both
 * are resolved from the login IP by a free third-party lookup that is allowed to
 * fail, time out or be rate-limited without taking the login record with it, and
 * a private address or a mobile carrier frequently resolves to nothing useful.
 * Each blank cell renders an em dash rather than being left empty, so an unknown
 * reads as an unknown and not as a broken cell.
 *
 * DURATION GROWS WHILE YOU WATCH. The top row is usually the very session
 * rendering this table, still open — which is what the Active badge means, and
 * why the query uses the 15-second live stale time rather than the default
 * minute.
 */

const STATE_STYLES: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400',
  ended: 'bg-muted text-muted-foreground',
  expired: 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-400',
};

const STATE_LABELS: Record<string, string> = {
  active: 'Active',
  ended: 'Signed out',
  // Named for what actually happened rather than for the flag: nobody was
  // "expired", they closed the tab without signing out.
  expired: 'Tab closed',
};

/**
 * '3h 42m', '18m', '—'.
 *
 * Minutes are dropped once the figure passes a day, because "1d 4h 09m" is
 * precision nobody reads; under a minute is shown in seconds so a mis-click that
 * signed straight back out does not render as a bare '0m'.
 */
function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600) % 24;
  const days = Math.floor(totalSeconds / 86400);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m`;
}

/** 'Skardu, Pakistan' · 'Pakistan' · '—'. */
function formatLocation(s: LoginSession): string {
  const parts = [s.city, s.country].filter(Boolean);
  return parts.length ? parts.join(', ') : '—';
}

/**
 * 'Chrome on Windows' out of a user-agent string.
 *
 * Crude by design and only ever shown in the detail dialog next to the raw
 * string it came from, so a wrong guess is visibly a guess. Order matters: Edge
 * and Chrome both claim to be Safari, and Edge also claims to be Chrome, so the
 * most specific claim has to be tested first.
 */
function describeDevice(ua: string | null): string {
  if (!ua) return '—';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : 'Browser';

  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : 'device';

  return `${browser} on ${os}`;
}

const col = createColumnHelper<LoginSession>();

export function LoginHistoryCard() {
  const { user, token } = useAuth();
  const isAdmin = user?.role === 'super_admin';
  const historyQ = useLoginHistory(token);
  const [viewRow, setViewRow] = useState<LoginSession | null>(null);

  const columns = [
    // ISO first so the column sorts chronologically, with the rendered spelling
    // appended so the global filter matches "22 Aug" as well as "2026-08-22".
    col.accessor((s) => `${s.loginAt} ${formatDate(s.loginAt)}`, {
      id: 'date',
      header: 'Login Date',
      // The mobile card's title, and it has to come from a column that is always
      // visible. It used to be Email, which is hidden for a non-admin — so every
      // branch and production user got a stack of title-less cards on a phone.
      meta: { mobile: 'title' },
      cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.loginAt)}</span>,
    }),
    col.accessor('loginAt', {
      id: 'time',
      header: 'Time',
      meta: { align: 'center', mobile: 'subtitle' },
      cell: (i) => <span className="whitespace-nowrap tabular-nums text-muted-foreground">{formatTime(i.getValue())}</span>,
    }),
    col.accessor((s) => s.country ?? '', {
      id: 'country',
      header: 'Country',
      cell: ({ row }) => <span className="whitespace-nowrap">{row.original.country || '—'}</span>,
    }),
    col.accessor((s) => s.city ?? '', {
      id: 'city',
      header: 'City',
      cell: ({ row }) => <span className="whitespace-nowrap">{row.original.city || '—'}</span>,
    }),
    col.accessor('userEmail', {
      header: 'Email',
      meta: { mobileFull: true },
      cell: (i) => <span className="break-all font-medium">{i.getValue()}</span>,
    }),
    col.accessor('durationMs', {
      header: 'Duration',
      meta: { align: 'center' },
      cell: (i) => <span className="tabular-nums">{formatDuration(i.getValue())}</span>,
    }),
    col.accessor('state', {
      header: 'Status',
      meta: { mobile: 'badge' },
      cell: (i) => (
        <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', STATE_STYLES[i.getValue()] ?? 'bg-muted')}>
          {STATE_LABELS[i.getValue()] ?? i.getValue()}
        </span>
      ),
    }),
    col.display({
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => setViewRow(row.original)}>
          <Eye className="mr-1.5 h-4 w-4" /> View
        </Button>
      ),
    }),
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Login History</CardTitle>
        <p className="text-xs text-muted-foreground">
          {isAdmin
            ? 'Every account · last 90 days · location is resolved from the login IP and is approximate'
            : 'Your sign-ins · last 90 days · location is resolved from your IP and is approximate'}
        </p>
      </CardHeader>
      <CardContent className="p-0 sm:px-4 sm:pb-4">
        <DataTable
          columns={columns}
          data={historyQ.data ?? []}
          loading={historyQ.isLoading}
          searchPlaceholder="Search logins…"
          // Hidden rather than dropped for a non-admin: everyone's rows carry an
          // email, but when they are all the SAME email the column is a wall of
          // one repeated value. An admin, comparing accounts, needs it.
          columnVisibility={{ userEmail: !!isAdmin }}
          pageSize={10}
          empty={
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <MapPin className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm font-medium">No sign-ins recorded yet</p>
              <p className="text-sm text-muted-foreground">
                History starts from the first sign-in after this feature went live.
              </p>
            </div>
          }
        />
      </CardContent>

      <Dialog open={!!viewRow} onOpenChange={(o) => !o && setViewRow(null)}>
        <DialogContent className="md:max-w-lg">
          <DialogHeader>
            <DialogTitle>Session Detail</DialogTitle>
          </DialogHeader>
          {viewRow && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2.5 text-sm">
              <dt className="text-muted-foreground">User</dt>
              <dd className="break-all text-right font-medium">{viewRow.userName || viewRow.userEmail}</dd>

              <dt className="text-muted-foreground">Email</dt>
              <dd className="break-all text-right">{viewRow.userEmail}</dd>

              <dt className="text-muted-foreground">Role</dt>
              <dd className="text-right capitalize">{(viewRow.userRole ?? '—').replace(/_/g, ' ')}</dd>

              <dt className="text-muted-foreground">Branch</dt>
              <dd className="truncate text-right">{viewRow.branchName || '—'}</dd>

              <dt className="text-muted-foreground">Signed in</dt>
              <dd className="text-right">{formatDateTime(viewRow.loginAt)}</dd>

              <dt className="text-muted-foreground">
                {viewRow.endedAt ? 'Signed out' : 'Last seen'}
              </dt>
              <dd className="text-right">{formatDateTime(viewRow.endedAt ?? viewRow.lastSeenAt)}</dd>

              <dt className="text-muted-foreground">Duration</dt>
              <dd className="text-right font-semibold tabular-nums">{formatDuration(viewRow.durationMs)}</dd>

              <dt className="text-muted-foreground">Status</dt>
              <dd className="text-right">
                <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', STATE_STYLES[viewRow.state] ?? 'bg-muted')}>
                  {STATE_LABELS[viewRow.state] ?? viewRow.state}
                </span>
              </dd>

              <dt className="text-muted-foreground">Location</dt>
              <dd className="text-right">{formatLocation(viewRow)}</dd>

              <dt className="text-muted-foreground">Region</dt>
              <dd className="text-right">{viewRow.region || '—'}</dd>

              <dt className="text-muted-foreground">IP address</dt>
              <dd className="break-all text-right font-mono text-xs">{viewRow.ipAddress || '—'}</dd>

              <dt className="text-muted-foreground">Device</dt>
              <dd className="text-right">{describeDevice(viewRow.userAgent)}</dd>

              <dt className="text-muted-foreground">Business day</dt>
              <dd className="text-right">{formatDate(viewRow.date)}</dd>

              {viewRow.userAgent && (
                <>
                  <dt className="col-span-2 pt-1 text-muted-foreground">User agent</dt>
                  <dd className="col-span-2 break-all rounded-md bg-muted/40 p-2.5 font-mono text-xs">
                    {viewRow.userAgent}
                  </dd>
                </>
              )}
            </dl>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewRow(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
