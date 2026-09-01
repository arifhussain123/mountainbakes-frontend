'use client';

import { useMemo, useState } from 'react';
import type { LoginSession, LoginSessionState } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useLoginCountries, useLoginHistoryPage } from '@/lib/queries';
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
 * WHAT THE TABLE SHOWS AND WHAT IT DOES NOT. The staff code, never the email
 * address. The list is opened on shop-floor tablets by people looking for a
 * device, a place or a time; `MBU-000125` answers "which account" for all of
 * that, and the activated account is one click away in the detail dialog, which
 * is the only view that reveals it and only to a caller the API allows.
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
}

const NO_FILTERS: Filters = { search: '', state: '', country: '', from: '', to: '', suspiciousOnly: false };

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

  // Every filter change resets to page 1. Without this, narrowing a filter while
  // on page 7 lands on an empty page and reads as "no results" for a filter that
  // has plenty.
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

  const query = useLoginHistoryPage(token, {
    search: filters.search || null,
    state: filters.state || null,
    country: filters.country || null,
    from: filters.from || null,
    to: filters.to || null,
    suspiciousOnly: filters.suspiciousOnly,
    page,
    pageSize: PAGE_SIZE,
  });
  const countries = useLoginCountries(token);

  const rows = query.data?.sessions ?? [];
  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const active = useMemo(
    () => Object.entries(filters).some(([, v]) => v !== '' && v !== false),
    [filters],
  );

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
            placeholder="Search by Mountain Bakes ID or name…"
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
            {(countries.data ?? []).map((c) => (
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

        {active && (
          <Button variant="ghost" size="sm" className="h-11 md:h-9" onClick={() => { setFilters(NO_FILTERS); setPage(1); }}>
            Clear
          </Button>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-hidden rounded-lg border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow data-table-head>
              {['Mountain Bakes ID', 'Login date', 'Time', 'Country', 'City', 'Browser', 'Device', 'Duration', 'Status', ''].map((h, i) => (
                <TableHead key={i} className="text-xs font-semibold uppercase tracking-wide">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 10 }).map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={10} className="p-0">
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
                  <TableCell className="whitespace-nowrap">{s.country || '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">{s.city || '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatBrowser(s)}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatPlatform(s)}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{formatDuration(s.durationMs)}</TableCell>
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
          scrolling table — nine columns on a 390px screen is unreadable, and
          the questions asked on a phone (who, where, when, is it still open)
          are answered by four of them. */}
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
