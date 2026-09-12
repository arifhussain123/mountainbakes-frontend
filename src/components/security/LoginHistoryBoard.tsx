'use client';

import { useMemo } from 'react';
import {
  USER_ROLES,
  businessDateStr,
  businessDaysAgoStr,
  type FilterConfig,
  type LoginDeviceType,
  type LoginSession,
  type LoginSessionState,
} from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranches, useLoginFilterOptions, useLoginHistoryPage } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/shared/EmptyState';
import { Pagination } from '@/components/data-engine/Pagination';
import { ActiveFilters, FilterBar } from '@/components/data-engine';
import { useListQueryState } from '@/lib/data-engine/useListQueryState';
import { formatDate, formatTime } from '@/utils/date';
import { cn } from '@/lib/utils';
import { AlertTriangle, Eye, ShieldOff } from 'lucide-react';
import { StaffAvatar } from './StaffAvatar';
import {
  LOGIN_STATUS_LABELS,
  LOGIN_STATUS_STYLES,
  STATE_LABELS,
  STATE_STYLES,
  formatBrowserEmail,
  formatBrowserName,
  formatBrowserVersion,
  formatDeviceKind,
  formatDuration,
  formatLocation,
  formatOs,
} from './sessionFormat';

/**
 * Admin → Security → Login History.
 *
 * WHY THIS DOES NOT USE `DataTable`. That component filters, sorts and pages in
 * the browser over whatever array it is handed — which is right for every other
 * table in the app, and wrong for this one. The login history is the single list
 * that can be asked for every account's rows at once; it has to be filtered and
 * paged in SQL, or the client would be fetching the whole table to show
 * twenty-five rows of it, and the row count under the pager would be a count of
 * what happened to be downloaded rather than of what matched. So the filters
 * here are query parameters and the pager moves `page`, and this file pays for
 * that with its own markup.
 *
 * WHAT THE TABLE SHOWS. Two identity columns, and they are two different facts
 * that are never shown in one another's place:
 *
 *   Browser email      — the Google account the session was signed in WITH,
 *                        when it was signed in with Google. Null, shown as
 *                        "Not recorded", for a password login: a website cannot
 *                        see the browser's Google account by itself.
 *   Mountain Bakes ID  — `MBU-000125`, the identifier this screen is read by
 *                        and the one thing that stays true when an address
 *                        changes.
 *
 * The Mountain Bakes account address is deliberately NOT a column here. The
 * staff ID identifies the account for everything this list is read for, and
 * the address was being mistaken for the browser email. The API still sends it
 * (the Active Sessions roster uses it); this screen just does not print it.
 *
 * Location is one column — 'Manzoor Colony, Karachi, Pakistan' — composed
 * from the neighbourhood, city and country the row actually knows. The
 * neighbourhood exists only for a session whose device sent its position; an
 * IP-resolved row honestly stops at the city.
 *
 * Browser, operating system and device are three columns rather than one, and
 * login status sits apart from session status, because each pair is two facts
 * that an admin filters on separately: "Chrome on Android" and "Chrome on
 * Windows" are the same browser on different devices, and "signed in
 * successfully" and "tab closed" are the start and the end of one session. The
 * IP address gets its own column for the same reason: an admin comparing two
 * sessions is comparing origins, and sending them into a dialog per row to do it
 * is not a workflow.
 *
 * THE FILTER BAR IS TWO ROWS ON PURPOSE. The top row is the narrowing anybody
 * does — who, when, what state. The second is the forensic set — branch, role,
 * place, browser, device — which is folded away behind "More filters" because it
 * is used on maybe one visit in ten and would otherwise make the common case
 * hunt through nine controls to find the search box.
 */

/**
 * The wide table's columns, in order. The staff ID and the email address are
 * the first two and are two different things; the last, empty heading is the
 * actions column. The skeleton and the empty state read this list so their
 * cell counts cannot drift from the real rows.
 */
const HEADERS = [
  'Browser email',
  'Mountain Bakes ID',
  'Login date',
  'Time',
  'Location',
  'Browser',
  'Browser version',
  'Operating system',
  'Device',
  'IP address',
  'Duration',
  'Login status',
  'Session status',
  '',
] as const;

const DEVICE_TYPES: LoginDeviceType[] = ['desktop', 'mobile', 'tablet', 'bot', 'unknown'];

/**
 * The quick filters, as the date range each one actually means.
 *
 * BUSINESS DATES, not calendar ones, because that is the column the API filters
 * on — so "Today" means the bakery's today (08:00 through 02:00 the next
 * morning), and a sign-in at half past midnight lands on the day the person was
 * working rather than the day after. `businessDaysAgoStr(6)` and not `(7)`:
 * "last 7 days" includes today, so it is today plus the six before it.
 */
const QUICK_RANGES: ReadonlyArray<readonly [label: string, days: number]> = [
  ['Today', 0],
  ['Last 7 days', 6],
  ['Last 30 days', 29],
];

export function LoginHistoryBoard({
  onView,
  onRevoke,
  canRevoke,
}: {
  onView: (sessionId: string) => void;
  onRevoke: (session: LoginSession) => void;
  canRevoke: boolean;
}) {
  const { token } = useAuth();
  const list = useListQueryState({
    syncUrl: true,
    filterKeys: ['state', 'country', 'businessDate', 'suspiciousOnly', 'branchId', 'role', 'city', 'browser', 'deviceType'],
  });

  /**
   * A quick range is a shortcut for the two date inputs, not a mode.
   *
   * Setting the same fields the date-range filter sets means the range stays
   * visible and editable afterwards — an admin who clicks "Last 7 days" and
   * then widens `from` by two days is doing something obvious, where a hidden
   * mode would have to be cancelled first. Clicking the active one again
   * clears it.
   */
  const applyQuickRange = (days: number) => {
    const from = days === 0 ? businessDateStr() : businessDaysAgoStr(days);
    const to = businessDateStr();
    if (isQuickRange(days)) {
      list.clearFilter('businessDate');
    } else {
      list.setFilter('businessDate', 'gte', from);
      list.setFilter('businessDate', 'lte', to);
    }
  };

  const isQuickRange = (days: number) =>
    list.getFilter('businessDate', 'gte')?.value === (days === 0 ? businessDateStr() : businessDaysAgoStr(days)) &&
    list.getFilter('businessDate', 'lte')?.value === businessDateStr();

  const options = useLoginFilterOptions(token);
  const branches = useBranches(token);

  const filters = useMemo<FilterConfig[]>(
    () => [
      {
        key: 'state', label: 'Status', type: 'select', placement: 'bar',
        options: (Object.keys(STATE_LABELS) as LoginSessionState[]).map((s) => ({ value: s, label: STATE_LABELS[s] })),
      },
      { key: 'country', label: 'Country', type: 'select', placement: 'bar', options: (options.data?.countries ?? []).map((c) => ({ value: c, label: c })) },
      { key: 'businessDate', label: 'Date', type: 'date-range', placement: 'bar' },
      {
        key: 'suspiciousOnly', label: 'Flagged', type: 'boolean', placement: 'bar',
        options: [{ value: 'true', label: 'Flagged only' }, { value: 'false', label: 'Not flagged' }],
      },
      { key: 'branchId', label: 'Branch', type: 'select', options: (branches.data ?? []).map((b) => ({ value: b.id, label: b.name })) },
      { key: 'role', label: 'Role', type: 'select', options: USER_ROLES.map((r) => ({ value: r, label: r.replace(/_/g, ' ') })) },
      { key: 'city', label: 'City', type: 'select', options: (options.data?.cities ?? []).map((c) => ({ value: c, label: c })) },
      { key: 'browser', label: 'Browser', type: 'select', options: (options.data?.browsers ?? []).map((b) => ({ value: b, label: b })) },
      { key: 'deviceType', label: 'Device', type: 'select', options: DEVICE_TYPES.map((d) => ({ value: d, label: d })) },
    ],
    [options.data, branches.data],
  );

  const stateFilter = list.getFilter('state')?.value as LoginSessionState | undefined;

  const query = useLoginHistoryPage(token, {
    search: list.state.search || null,
    state: stateFilter || null,
    country: (list.getFilter('country')?.value as string | undefined) || null,
    from: (list.getFilter('businessDate', 'gte')?.value as string | undefined) || null,
    to: (list.getFilter('businessDate', 'lte')?.value as string | undefined) || null,
    suspiciousOnly: list.getFilter('suspiciousOnly')?.value === 'true',
    branchId: (list.getFilter('branchId')?.value as string | undefined) || null,
    role: (list.getFilter('role')?.value as string | undefined) || null,
    city: (list.getFilter('city')?.value as string | undefined) || null,
    browser: (list.getFilter('browser')?.value as string | undefined) || null,
    deviceType: (list.getFilter('deviceType')?.value as LoginDeviceType | undefined) || null,
    page: list.state.page,
    pageSize: list.state.pageSize,
  });

  const rows = query.data?.sessions ?? [];
  const total = query.data?.total ?? 0;
  const active = list.hasActiveFilters;

  return (
    <div className="space-y-4">
      <FilterBar
        list={list}
        filters={filters}
        searchPlaceholder="Search by Mountain Bakes ID, name, email, place, browser, IP or status…"
        leading={
          /* Quick ranges. Their own group ahead of the filters rather than more
             controls in the same wrap: they set the same businessDate filter
             the Date range control does, and an admin toggling "Active only"
             is doing the same thing the Status filter does from a shortcut. */
          <div className="flex flex-wrap gap-2">
            {QUICK_RANGES.map(([label, days]) => (
              <Button
                key={label}
                variant={isQuickRange(days) ? 'default' : 'outline'}
                size="sm"
                className="h-11 md:h-9"
                onClick={() => applyQuickRange(days)}
              >
                {label}
              </Button>
            ))}
            <Button
              variant={stateFilter === 'active' ? 'default' : 'outline'}
              size="sm"
              className="h-11 md:h-9"
              onClick={() => (stateFilter === 'active' ? list.clearFilter('state') : list.setFilter('state', 'eq', 'active'))}
            >
              Active only
            </Button>
          </div>
        }
      />
      <ActiveFilters
        filters={list.activeFilters}
        configs={filters}
        search={list.state.search}
        onRemove={list.clearFilter}
        onClearSearch={() => list.setSearch('')}
        onClearAll={list.clearAll}
      />

      {/* Desktop table. `overflow-x-auto` rather than a narrower column set at
          tablet width: fourteen columns do not fit a 768px screen, and dropping
          some of them there would mean the same screen answered a different
          question depending on the device it was opened on. Scrolling keeps one
          table with one meaning. */}
      <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow data-table-head>
              {HEADERS.map((h, i) => (
                <TableHead key={i} className="text-xs font-semibold uppercase tracking-wide">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {HEADERS.map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={HEADERS.length} className="p-0">
                  <EmptyState
                    title="No sign-ins found"
                    description={active ? 'Try widening the filters.' : 'History starts from the first sign-in after this feature went live.'}
                    className="border-0"
                  />
                </TableCell>
              </TableRow>
            ) : (
              rows.map((s) => (
                <TableRow key={s.id} className="transition-colors hover:bg-muted/30">
                  {/* The Google account, first because it is the column this
                      screen was asked for. Null for a password login. */}
                  <TableCell className="max-w-[240px]">
                    <span
                      className={cn('block truncate text-xs', !s.browserEmail && 'italic text-muted-foreground')}
                      title={s.browserEmail || undefined}
                    >
                      {formatBrowserEmail(s)}
                    </span>
                  </TableCell>
                  {/* The profile cell: picture, name, staff ID. The addresses get
                      their own columns beside it rather than more lines here —
                      the spec asks for each, and stacking values in one cell
                      makes none of them scannable. */}
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <StaffAvatar name={s.userName} seed={s.userCode} size="sm" />
                      <div className="min-w-0">
                        <p className="font-mono text-xs font-medium">{s.userCode ?? '—'}</p>
                        <p className="truncate text-xs text-muted-foreground">{s.userName}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(s.loginAt)}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{formatTime(s.loginAt)}</TableCell>
                  {/* Neighbourhood, city, country — whatever is known. The
                      source is in the detail view; here the words say what they
                      can and stop. */}
                  <TableCell className="max-w-[260px]">
                    <span
                      className={cn('block truncate', !(s.area || s.city || s.country) && 'italic text-muted-foreground')}
                      title={formatLocation(s)}
                    >
                      {formatLocation(s)}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatBrowserName(s)}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{formatBrowserVersion(s)}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatOs(s)}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDeviceKind(s)}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs">{s.ipAddress || '—'}</TableCell>
                  {/* `coalesce(ended, last seen) − login`, derived server-side.
                      For a live session it is "so far"; the state pill beside
                      it says which. */}
                  <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{formatDuration(s.durationMs)}</TableCell>
                  {/* Guarded: the web app and the API deploy separately, and a
                      row from an API that predates `loginStatus` must show a
                      dash rather than an empty pill. */}
                  <TableCell>
                    {s.loginStatus ? (
                      <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', LOGIN_STATUS_STYLES[s.loginStatus])}>
                        {LOGIN_STATUS_LABELS[s.loginStatus]}
                      </span>
                    ) : '—'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', STATE_STYLES[s.state])}>
                        {STATE_LABELS[s.state]}
                      </span>
                      {s.isSuspicious && (
                        <AlertTriangle
                          className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400"
                          aria-label="Flagged as unusual"
                        />
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => onView(s.id)}>
                        <Eye className="mr-1.5 h-4 w-4" /> View
                      </Button>
                      {canRevoke && s.canRevoke && (
                        <Button variant="ghost" size="sm" onClick={() => onRevoke(s)}>
                          <ShieldOff className="h-4 w-4 text-destructive" />
                          <span className="sr-only">Sign out</span>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Phone cards. Same rows, re-laid out rather than a horizontally
          scrolling table — fourteen columns on a 390px screen is unreadable, and
          the questions asked on a phone (who, where, when, is it still open)
          are answered by five of them. */}
      <div className="space-y-2 md:hidden">
        {query.isLoading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 w-full rounded-lg" />)
          : rows.length === 0
            ? <EmptyState title="No sign-ins found" description={active ? 'Try widening the filters.' : undefined} />
            : rows.map((s) => (
                <div key={s.id} className="rounded-lg border bg-card p-3">
                  <div className="flex items-start gap-3">
                    <StaffAvatar name={s.userName} seed={s.userCode} />
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-sm font-medium">{s.userCode ?? '—'}</p>
                      <p className="truncate text-xs text-muted-foreground">{s.userName}</p>
                      <p className={cn('truncate text-xs', s.browserEmail ? 'text-foreground' : 'italic text-muted-foreground')}>
                        {formatBrowserEmail(s)}
                      </p>
                    </div>
                    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', STATE_STYLES[s.state])}>
                      {STATE_LABELS[s.state]}
                    </span>
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <div><dt className="text-muted-foreground">Browser</dt><dd>{formatBrowserName(s)} {formatBrowserVersion(s)}</dd></div>
                    <div><dt className="text-muted-foreground">Operating system</dt><dd>{formatOs(s)}</dd></div>
                    <div><dt className="text-muted-foreground">Device</dt><dd>{formatDeviceKind(s)}</dd></div>
                    <div className="col-span-2"><dt className="text-muted-foreground">Location</dt><dd>{formatLocation(s)}</dd></div>
                    <div><dt className="text-muted-foreground">Login</dt><dd className="tabular-nums">{formatDate(s.loginAt)} · {formatTime(s.loginAt)}</dd></div>
                    <div><dt className="text-muted-foreground">Duration</dt><dd className="tabular-nums">{formatDuration(s.durationMs)}</dd></div>
                    <div className="col-span-2"><dt className="text-muted-foreground">IP address</dt><dd className="font-mono">{s.ipAddress || '—'}</dd></div>
                  </dl>

                  {s.isSuspicious && (
                    <p className="mt-2 flex gap-1.5 rounded-md bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      {s.suspiciousReason}
                    </p>
                  )}

                  <div className="mt-3 flex gap-2">
                    <Button variant="outline" size="sm" className="h-10 flex-1" onClick={() => onView(s.id)}>
                      <Eye className="mr-1.5 h-4 w-4" /> View
                    </Button>
                    {canRevoke && s.canRevoke && (
                      <Button variant="destructive" size="sm" className="h-10 flex-1" onClick={() => onRevoke(s)}>
                        <ShieldOff className="mr-1.5 h-4 w-4" /> Sign out
                      </Button>
                    )}
                  </div>
                </div>
              ))}
      </div>

      {/* Pager. Rendered whenever there are rows, even on a single page, so the
          row count is always visible — "how many sign-ins match this filter" is
          half of what an admin came to the screen to find out. */}
      {total > 0 && (
        <Pagination
          page={list.state.page}
          pageSize={list.state.pageSize}
          total={total}
          onPageChange={list.setPage}
          onPageSizeChange={list.setPageSize}
          loading={query.isFetching}
        />
      )}
    </div>
  );
}
