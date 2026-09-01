'use client';

import { useMemo, useState } from 'react';
import {
  LOGIN_ATTEMPT_REASONS,
  LOGIN_ATTEMPT_REASON_LABELS,
  businessDateStr,
  businessDaysAgoStr,
  type LoginAttemptReason,
} from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useLoginAttempts, useLoginFilterOptions } from '@/lib/queries';
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
import { ChevronLeft, ChevronRight, Info, Search } from 'lucide-react';
import { formatBrowser, formatPlatform } from './sessionFormat';

/**
 * Admin → Security → Failed Logins.
 *
 * THE ONE SCREEN HERE THAT IS NOT ABOUT AN ACCOUNT. Every row is an address that
 * was typed into a login form and refused; there is no session behind it, no
 * staff code, and — deliberately — no link to a Mountain Bakes user. Resolving
 * the typed address to an account would be the email-as-identity mistake the
 * rest of this feature exists to avoid, and it would quietly turn this table
 * into a confirmation of which addresses are real accounts. An admin who needs
 * to know that looks the address up in Users, which is a deliberate act by
 * somebody entitled to perform it.
 *
 * THE BANNER IS NOT DECORATION. These rows are posted by the browser that saw
 * the failure — the API is not in the request path of a login, so it cannot
 * observe one — which means they are forgeable by anyone who can reach the API.
 * An admin reading "14 failures on this address" has to know that before acting
 * on it, and the banner is the only place they will be told. Nothing in the app
 * acts on these rows automatically, and nothing should be built that does.
 *
 * NO REVOKE, NO VIEW DIALOG. There is nothing to end and nothing more to show —
 * the eight columns are the whole row. A screen that offered an action it could
 * not take would be worse than one that offers none.
 */

const PAGE_SIZE = 25;
const ALL = '__all__';

interface Filters {
  search: string;
  reason: LoginAttemptReason | '';
  country: string;
  from: string;
  to: string;
}

const NO_FILTERS: Filters = { search: '', reason: '', country: '', from: '', to: '' };

/** Business dates, for the reason the history board's ranges are. */
const QUICK_RANGES: ReadonlyArray<readonly [label: string, days: number]> = [
  ['Today', 0],
  ['Last 7 days', 6],
  ['Last 30 days', 29],
];

export function FailedLoginsBoard() {
  const { token } = useAuth();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [page, setPage] = useState(1);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPage(1);
  };

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

  const query = useLoginAttempts(token, {
    search: filters.search || null,
    reason: filters.reason || null,
    country: filters.country || null,
    from: filters.from || null,
    to: filters.to || null,
    page,
    pageSize: PAGE_SIZE,
  });
  // Shared with the history board — the countries are the same set, because both
  // tables resolve their locations through the same IP lookup.
  const options = useLoginFilterOptions(token);

  const rows = query.data?.attempts ?? [];
  const total = query.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const active = useMemo(() => Object.values(filters).some((v) => v !== ''), [filters]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-muted-foreground">
          Sign-ins that were refused. Each row is the address that was typed — not a
          Mountain Bakes account, and not proof that the account exists. These are
          reported by the browser that saw the failure, so treat a burst as something
          to look into rather than as evidence on its own. No password, or any part of
          one, is ever recorded.
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filters.search}
            onChange={(e) => set('search', e.target.value)}
            placeholder="Search the address that was typed…"
            className="h-11 pl-9 md:h-9"
          />
        </div>

        <Select
          value={filters.reason || ALL}
          onValueChange={(v) => set('reason', !v || v === ALL ? '' : (String(v) as LoginAttemptReason))}
        >
          <SelectTrigger className="h-11 w-[200px] md:h-9">
            <SelectValue placeholder="Any reason" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any reason</SelectItem>
            {LOGIN_ATTEMPT_REASONS.map((r) => (
              <SelectItem key={r} value={r}>{LOGIN_ATTEMPT_REASON_LABELS[r]}</SelectItem>
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

        {active && (
          <Button variant="ghost" size="sm" className="h-11 md:h-9" onClick={() => { setFilters(NO_FILTERS); setPage(1); }}>
            Clear
          </Button>
        )}
      </div>

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
      </div>

      {/* Desktop table */}
      <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
        <Table>
          <TableHeader>
            <TableRow data-table-head>
              {['Date', 'Time', 'Email typed', 'Country', 'City', 'IP address', 'Browser', 'Device', 'Reason'].map((h, i) => (
                <TableHead key={i} className="text-xs font-semibold uppercase tracking-wide">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {query.isLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 9 }).map((__, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="p-0">
                  <EmptyState
                    title="No failed sign-ins"
                    description={
                      active
                        ? 'Try widening the filters.'
                        : 'Nothing has been refused. Records start from the first refusal after this feature went live.'
                    }
                    className="border-0"
                  />
                </TableCell>
              </TableRow>
            ) : (
              rows.map((a) => (
                <TableRow key={a.id} className="transition-colors hover:bg-muted/30">
                  <TableCell className="whitespace-nowrap">{formatDate(a.attemptedAt)}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">{formatTime(a.attemptedAt)}</TableCell>
                  <TableCell className="max-w-[240px]">
                    <span className="block truncate" title={a.email}>{a.email}</span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{a.country || '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">{a.city || '—'}</TableCell>
                  <TableCell className="whitespace-nowrap font-mono text-xs">{a.ipAddress || '—'}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatBrowser(a)}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatPlatform(a)}</TableCell>
                  <TableCell>
                    {/* One colour for every reason, and it is deliberately not
                        red. A mistyped password is the overwhelmingly common
                        case; painting the whole column as an alert would make
                        the screen look like an incident every morning and train
                        the reader to ignore it. */}
                    <span className="inline-flex whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {LOGIN_ATTEMPT_REASON_LABELS[a.reason]}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Phone cards */}
      <div className="space-y-2 md:hidden">
        {query.isLoading
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-28 w-full rounded-lg" />)
          : rows.length === 0
            ? <EmptyState title="No failed sign-ins" description={active ? 'Try widening the filters.' : undefined} />
            : rows.map((a) => (
                <div key={a.id} className="rounded-lg border bg-card p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="min-w-0 flex-1 truncate text-sm font-medium">{a.email}</p>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                      {LOGIN_ATTEMPT_REASON_LABELS[a.reason]}
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <div><dt className="text-muted-foreground">When</dt><dd className="tabular-nums">{formatDate(a.attemptedAt)} · {formatTime(a.attemptedAt)}</dd></div>
                    <div><dt className="text-muted-foreground">Location</dt><dd>{[a.city, a.country].filter(Boolean).join(', ') || '—'}</dd></div>
                    <div><dt className="text-muted-foreground">Device</dt><dd>{formatBrowser(a)} · {formatPlatform(a)}</dd></div>
                    <div><dt className="text-muted-foreground">IP address</dt><dd className="font-mono">{a.ipAddress || '—'}</dd></div>
                  </dl>
                </div>
              ))}
      </div>

      {total > 0 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString()} failed attempt{total === 1 ? '' : 's'} · page {page} of {pages}
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
