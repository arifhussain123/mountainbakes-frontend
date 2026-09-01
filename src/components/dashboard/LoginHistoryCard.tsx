'use client';

import { useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import type { LoginSession } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useLoginHistory } from '@/lib/queries';
import { DataTable } from '@/components/shared/DataTable';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button, buttonVariants } from '@/components/ui/button';
import { formatDate, formatTime } from '@/utils/date';
import { cn } from '@/lib/utils';
import { AlertTriangle, Eye, MapPin, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { ROUTES } from '@/utils/routes';
import { StaffAvatar } from '@/components/security/StaffAvatar';
import { SessionDetailDialog } from '@/components/security/SessionDetailDialog';
import {
  STATE_LABELS,
  STATE_STYLES,
  formatBrowser,
  formatDuration,
  formatPlatform,
} from '@/components/security/sessionFormat';

/**
 * Login History — who signed in, from where, and for how long.
 *
 * On every dashboard, showing DIFFERENT rows to different people: a super admin
 * sees every user's sessions, everyone else sees only their own. That scoping is
 * the API's decision, not this component's — the endpoint pins a non-admin to
 * its own uid whatever it asks for.
 *
 * A GLANCE, NOT THE SECURITY SCREEN. It shows one page of recent sign-ins with
 * no filters and no pager; Admin → Security has both, plus the live session
 * roster and the ability to end a session. The link in the header is for the
 * admin who came here and needed that instead. Before the endpoint was paged
 * this card fetched a capped 500 rows and filtered them in the browser, which
 * meant the cap silently truncated it once the table outgrew the cap.
 *
 * THE STAFF CODE, NOT THE EMAIL. `MBU-000125` identifies the account for
 * everything this card is read for, and the API masks every address in a list
 * regardless of who is asking — this card is open on shared shop-floor devices.
 * Opening a row reveals the address to a caller the API allows, which is why the
 * detail dialog is the shared one from the Security screen and not a local copy:
 * it re-fetches by id, and the API decides.
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

const col = createColumnHelper<LoginSession>();

export function LoginHistoryCard() {
  const { user, token } = useAuth();
  const isAdmin = user?.role === 'super_admin';
  const historyQ = useLoginHistory(token);
  const [viewId, setViewId] = useState<string | null>(null);

  const columns = [
    col.accessor((s) => `${s.userCode ?? ''} ${s.userName}`, {
      id: 'who',
      header: 'Mountain Bakes ID',
      // The mobile card's title. It has to come from a column that is always
      // visible, and this one is — where the old title (Email) was hidden for a
      // non-admin, so every branch and production user got title-less cards.
      meta: { mobile: 'title' },
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <StaffAvatar name={row.original.userName} seed={row.original.userCode} size="sm" />
          <div className="min-w-0">
            <p className="font-mono text-xs font-medium">{row.original.userCode ?? '—'}</p>
            <p className="truncate text-xs text-muted-foreground">{row.original.userName}</p>
          </div>
        </div>
      ),
    }),
    // ISO first so the column sorts chronologically, with the rendered spelling
    // appended so the global filter matches "22 Aug" as well as "2026-08-22".
    col.accessor((s) => `${s.loginAt} ${formatDate(s.loginAt)}`, {
      id: 'date',
      header: 'Login Date',
      meta: { mobile: 'subtitle' },
      cell: ({ row }) => <span className="whitespace-nowrap">{formatDate(row.original.loginAt)}</span>,
    }),
    col.accessor('loginAt', {
      id: 'time',
      header: 'Time',
      meta: { align: 'center' },
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
    col.accessor((s) => formatBrowser(s), {
      id: 'browser',
      header: 'Browser',
      cell: (i) => <span className="whitespace-nowrap">{i.getValue()}</span>,
    }),
    col.accessor((s) => formatPlatform(s), {
      id: 'device',
      header: 'Device',
      cell: (i) => <span className="whitespace-nowrap">{i.getValue()}</span>,
    }),
    col.accessor('durationMs', {
      header: 'Duration',
      meta: { align: 'center' },
      cell: (i) => <span className="tabular-nums">{formatDuration(i.getValue())}</span>,
    }),
    col.accessor('state', {
      header: 'Status',
      meta: { mobile: 'badge' },
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', STATE_STYLES[row.original.state] ?? 'bg-muted')}>
            {STATE_LABELS[row.original.state] ?? row.original.state}
          </span>
          {row.original.isSuspicious && (
            <AlertTriangle
              className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
              aria-label="Flagged as unusual"
            />
          )}
        </div>
      ),
    }),
    col.display({
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <Button variant="ghost" size="sm" onClick={() => setViewId(row.original.id)}>
          <Eye className="mr-1.5 h-4 w-4" /> View
        </Button>
      ),
    }),
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Login History</CardTitle>
            <p className="text-xs text-muted-foreground">
              {isAdmin
                ? 'Every account · recent sign-ins · location is resolved from the login IP and is approximate'
                : `Sign-ins for ${user?.email ?? 'this account'} · location is resolved from your IP and is approximate`}
            </p>
          </div>
          {/* Admin only, because the screen it points at is. A link a branch
              user could see and not open is worse than no link. */}
          {isAdmin && (
            // A styled Link, not a Button wrapping one: this Button is Base UI's,
            // which has no `asChild`, and nesting an anchor inside a <button> is
            // invalid markup that breaks keyboard activation.
            <Link
              href={ROUTES.SECURITY}
              className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'shrink-0')}
            >
              <ShieldAlert className="mr-1.5 h-4 w-4" /> Security
            </Link>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0 sm:px-4 sm:pb-4">
        <DataTable
          columns={columns}
          data={historyQ.data ?? []}
          loading={historyQ.isLoading}
          searchPlaceholder="Search logins…"
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

      {/* The Security screen's own dialog, not a copy. It re-fetches the session
          by id, which is what lets the API decide whether this reader may see
          the activated account — a local copy could only ever show the masked
          address the list row already carried. No `onRevoke`: ending somebody's
          session is an action for the Security screen, not for a dashboard card. */}
      <SessionDetailDialog sessionId={viewId} onClose={() => setViewId(null)} />
    </Card>
  );
}
