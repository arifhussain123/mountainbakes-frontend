'use client';

import { useMemo, useState } from 'react';
import {
  USER_ROLES,
  businessDateStr,
  businessDaysAgoStr,
  type LoginDeviceType,
  type LoginSession,
  type LoginSessionState,
} from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranches, useLoginFilterOptions, useLoginHistoryPage } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EmptyState } from '@/components/shared/EmptyState';
import { formatDate, formatTime } from '@/utils/date';
import { cn } from '@/lib/utils';
import { AlertTriangle, ChevronLeft, ChevronRight, Eye, Search, ShieldOff } from 'lucide-react';
import { StaffAvatar } from './StaffAvatar';
import {
  STATE_LABELS,
  STATE_STYLES,
  formatBrowser,
  formatDuration,
  formatPlatform,
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
 * WHAT THE TABLE SHOWS. The staff code first, because `MBU-000125` is the
 * identifier this screen is read by and the one thing that stays true when an
 * address changes. The activated address sits underneath it — masked for
 * everyone except a super admin, who is the only caller that sees other
 * people's rows at all and cannot tell one account from another without it. The
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

const PAGE_SIZE = 25;

/** '' is the "no filter" value: a Select cannot hold undefined. */
const ALL = '__all__';

interface Filters {
  search: string;
  state: LoginSessionState | '';
  country: string;
  from: string;
  to: string;
  suspiciousOnly: boolean;
  branchId: string;
  role: string;
  city: string;
  browser: string;
  deviceType: LoginDeviceType | '';
}

const NO_FILTERS: Filters = {
  search: '',
  state: '',
  country: '',
  from: '',
  to: '',
  suspiciousOnly: false,
  branchId: '',
  role: '',
  city: '',
  browser: '',
  deviceType: '',
};

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
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(1);
  const [showMore, setShowMore] = useState(false);

  // Every filter change resets to page 1. Without this, narrowing a filter while
  // on page 7 lands on an empty page and reads as "no results" for a filter that
  // has plenty.
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  /**
   * A quick range is a shortcut for the two date inputs, not a mode.
   *
   * Setting the same fields the pickers set means the range stays visible and
   * editable afterwards — an admin who clicks "Last 7 days" and then widens
   * `from` by two days is doing something obvious, where a hidden mode would
   * have to be cancelled first. Clicking the active one again clears it.
   */
  const applyQuickRange = (days: number) => {
    const from = days === 0 ? businessDateStr() : businessDaysAgoStr(days);
    const to = businessDateStr();
    const alreadyOn = filters.from === from && filters.to === to;
    setFilters((f) => ({ ...f, from: alreadyOn ? '' : from, to: alreadyOn ? '' : to }));
    setPage(1);
  };

  const isQuickRange = (days: number) =>
    filters.from === (days === 0 ? businessDateStr() : businessDaysAgoStr(days)) &&
    filters.to === businessDateStr();

  const query = useLoginHistoryPage(token, {
    search: filters.search || null,
    state: filters.state || null,
    country: filters.country || null,
    from: filters.from || null,
    to: filters.to || null,
    suspiciousOnly: filters.suspiciousOnly,
    branchId: filters.branchId || null,
    role: filters.role || null,
    city: filters.city || null,
    browser: filters.browser || null,
    deviceType: filters.deviceType || null,
    page,
    pageSize: PAGE_SIZE,
  });
  const options = useLoginFilterOptions(token);
  // Only fetched once the drawer is open. The branch list is not otherwise
  // needed by this screen, and a request for it on every visit would be paid by
  // the nine visits in ten that never open the drawer.
  const branches = useBranches(token, { enabled: showMore });

  const rows = query.data?.sessions ?? [];
  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const active = useMemo(
    () => Object.entries(filters).some(([, v]) => v !== '' && v !== false),
    [filters],
  );
  // The count is on the button so a filter set inside the collapsed drawer is
  // never silently narrowing the list — the one genuine hazard of hiding
  // controls behind a toggle.
  const advancedCount = [filters.branchId, filters.role, filters.city, filters.browser, filters.deviceType]
    .filter(Boolean).length;

  return (
    <div className="space-y-4">
      {/* Filters. Wrapped rather than in a fixed grid so a phone stacks them and
          a wide screen puts them on one line without a breakpoint per control. */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.search}
            onChange={(e) => set('search', e.target.value)}
            placeholder="Search by Mountain Bakes ID, name or email…"
            className="h-11 pl-9 md:h-9"
          />
        </div>

        <Select
          value={filters.state || ALL}
          // The primitive hands back `null` when a selection is cleared, so the
          // value is normalised before it is compared with the sentinel.
          onValueChange={(v) => set('state', !v || v === ALL ? '' : (String(v) as LoginSessionState))}
        >
          <SelectTrigger className="h-11 w-[150px] md:h-9">
            <SelectValue placeholder="Any status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any status</SelectItem>
            {(Object.keys(STATE_LABELS) as LoginSessionState[]).map((s) => (
              <SelectItem key={s} value={s}>{STATE_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.country || ALL}
          onValueChange={(v) => set('country', !v || v === ALL ? '' : String(v))}
        >
          <SelectTrigger className="h-11 w-[160px] md:h-9">
            <SelectValue placeholder="Any country" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any country</SelectItem>
            {(options.data?.countries ?? []).map((c) => (
              <SelectItem key={c} value={c}>{c}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Business dates, matching the column the API filters on — so "1 Sep"
            means the bakery's 1 September (08:00 to 02:00 the next morning),
            not the calendar one, and a sign-in at half past midnight lands on
            the day the staff member was working rather than the day after. */}
        <Input
          type="date"
          value={filters.from}
          onChange={(e) => set('from', e.target.value)}
          className="h-11 w-[150px] md:h-9"
          aria-label="From business date"
        />
        <Input
          type="date"
          value={filters.to}
          onChange={(e) => set('to', e.target.value)}
          className="h-11 w-[150px] md:h-9"
          aria-label="To business date"
        />

        <Button
          variant={filters.suspiciousOnly ? 'default' : 'outline'}
          size="sm"
          className="h-11 md:h-9"
          onClick={() => set('suspiciousOnly', !filters.suspiciousOnly)}
        >
          <AlertTriangle className="mr-1.5 h-3.5 w-3.5" /> Flagged
        </Button>

        <Button
          variant={advancedCount > 0 ? 'default' : 'outline'}
          size="sm"
          className="h-11 md:h-9"
          onClick={() => setShowMore((v) => !v)}
          aria-expanded={showMore}
        >
          More filters{advancedCount > 0 ? ` (${advancedCount})` : ''}
        </Button>

        {active && (
          <Button variant="ghost" size="sm" className="h-11 md:h-9" onClick={() => { setFilters(NO_FILTERS); setPage(1); }}>
            Clear
          </Button>
        )}
      </div>

      {/* Quick ranges. Their own row under the filters rather than more controls
          in the same wrap: they set the two date fields above, and sitting
          directly beneath them is what makes that relationship visible. */}
      <div className="flex flex-wrap gap-2">
        {QUICK_RANGES.map(([label, days]) => (
          <Button
            key={label}
            variant={isQuickRange(days) ? 'default' : 'outline'}
            size="sm"
            className="h-9"
            onClick={() => applyQuickRange(days)}
          >
            {label}
          </Button>
        ))}
        <Button
          variant={filters.state === 'active' ? 'default' : 'outline'}
          size="sm"
          className="h-9"
          onClick={() => set('state', filters.state === 'active' ? '' : 'active')}
        >
          Active only
        </Button>
      </div>

      {showMore && (
        <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-3">
          <Select
            value={filters.branchId || ALL}
            onValueChange={(v) => set('branchId', !v || v === ALL ? '' : String(v))}
          >
            <SelectTrigger className="h-11 w-[180px] md:h-9">
              <SelectValue placeholder="Any branch" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any branch</SelectItem>
              {(branches.data ?? []).map((b) => (
                <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.role || ALL}
            onValueChange={(v) => set('role', !v || v === ALL ? '' : String(v))}
          >
            <SelectTrigger className="h-11 w-[170px] md:h-9">
              <SelectValue placeholder="Any role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any role</SelectItem>
              {USER_ROLES.map((r) => (
                <SelectItem key={r} value={r} className="capitalize">
                  {r.replace(/_/g, ' ')}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.city || ALL}
            onValueChange={(v) => set('city', !v || v === ALL ? '' : String(v))}
          >
            <SelectTrigger className="h-11 w-[160px] md:h-9">
              <SelectValue placeholder="Any city" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any city</SelectItem>
              {(options.data?.cities ?? []).map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.browser || ALL}
            onValueChange={(v) => set('browser', !v || v === ALL ? '' : String(v))}
          >
            <SelectTrigger className="h-11 w-[160px] md:h-9">
              <SelectValue placeholder="Any browser" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any browser</SelectItem>
              {(options.data?.browsers ?? []).map((b) => (
                <SelectItem key={b} value={b}>{b}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filters.deviceType || ALL}
            onValueChange={(v) => set('deviceType', !v || v === ALL ? '' : (String(v) as LoginDeviceType))}
          >
            <SelectTrigger className="h-11 w-[150px] md:h-9">
              <SelectValue placeholder="Any device" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Any device</SelectItem>
              {DEVICE_TYPES.map((d) => (
                <SelectItem key={d} value={d} className="capitalize">{d}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Desktop table. `overflow-x-auto` rather than a narrower column set at
          tablet width: eleven columns do not fit a 768px screen, and dropping
          some of them there would mean the same screen answered a different
          question depending on the device it was opened on. Scrolling keeps one
          table with one meaning. */}
      <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow data-table-head>
              {['Mountain Bakes ID', 'Login email', 'Login date', 'Time', 'Country', 'City', 'IP address', 'Browser', 'Device', 'Status', ''].map((h, i) => (
                <TableHead key={i} className="text-xs font-semibold uppercase tracking-wide">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 11 }).map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={11} className="p-0">
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
                  {/* The profile cell: picture, name, staff ID. The address gets
                      its own column beside it rather than a third line here —
                      the spec asks for both, and stacking three values in one
                      cell makes none of them scannable. */}
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <StaffAvatar name={s.userName} seed={s.userCode} size="sm" />
                      <div className="min-w-0">
                        <p className="font-mono text-xs font-medium">{s.userCode ?? '—'}</p>
                        <p className="truncate text-xs text-muted-foreground">{s.userName}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[220px]">
                    <span className="block truncate text-xs" title={s.userEmail}>
                      {s.userEmail || '—'}
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{formatDate(s.loginAt)}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{formatTime(s.loginAt)}</TableCell>
                  <TableCell className="whitespace-nowrap">{s.country || '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">{s.city || '—'}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs">{s.ipAddress || '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatBrowser(s)}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatPlatform(s)}</TableCell>
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
          scrolling table — eleven columns on a 390px screen is unreadable, and
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
                      <p className="truncate text-xs text-muted-foreground">{s.userEmail}</p>
                    </div>
                    <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', STATE_STYLES[s.state])}>
                      {STATE_LABELS[s.state]}
                    </span>
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <div><dt className="text-muted-foreground">Device</dt><dd>{formatBrowser(s)} · {formatPlatform(s)}</dd></div>
                    <div><dt className="text-muted-foreground">Location</dt><dd>{[s.city, s.country].filter(Boolean).join(', ') || '—'}</dd></div>
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
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString()} sign-in{total === 1 ? '' : 's'} · page {page} of {pages}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="h-10 md:h-9" disabled={page <= 1 || query.isFetching} onClick={() => setPage((p) => p - 1)}>
              <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
            <Button variant="outline" size="sm" className="h-10 md:h-9" disabled={page >= pages || query.isFetching} onClick={() => setPage((p) => p + 1)}>
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
