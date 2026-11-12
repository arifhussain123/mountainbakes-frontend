'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { AlertTriangle, Lock, RotateCw } from 'lucide-react';
import type { StoreAction, StoreDemandStatus, StoreMe } from '@mb/shared';
import { STORE_DEMAND_STATUS_LABELS } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useStoreMe } from '@/lib/store';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { ROUTES, normalizePath } from '@/utils/routes';
import { canOpenStorePage } from '@/utils/storeAccess';

export { ConfirmDialog } from '@/components/purchasing/parts';

// ── Session ──────────────────────────────────────────────────────────────────

/**
 * Token, the caller's Store permissions (GET /api/store/me) and a `can()`
 * that hides what the API would refuse. The API decides; this only stops a
 * button from being offered that would 403.
 */
export function useStoreSession() {
  const { token, user } = useAuth();
  const t = token ?? '';
  const me = useStoreMe(t);
  const can = (a: StoreAction) => !!me.data?.can?.[a];
  return { token: t, role: user?.role ?? '', userName: user?.displayName ?? user?.email ?? '', me, can, today: me.data?.businessDate ?? '' };
}

export type StoreSession = ReturnType<typeof useStoreSession>;

// ── Formatting ───────────────────────────────────────────────────────────────

const PK = 'en-PK';

/** Rs. 12,345 (whole rupees, as the Store pages show money). */
export function rs(n: number | null | undefined): string {
  const v = Number(n ?? 0);
  return `${v < 0 ? '−' : ''}Rs. ${Math.round(Math.abs(v)).toLocaleString(PK)}`;
}

/** A quantity: up to 3 decimals, grouped. */
export function num(n: number | null | undefined): string {
  return (Math.round(Number(n ?? 0) * 1000) / 1000).toLocaleString(PK, { maximumFractionDigits: 3 });
}

export const qty = (n: number | null | undefined, unit: string | null | undefined) => `${num(n)} ${unit ?? ''}`.trim();

/** Rs. 2,000.50 / KG — a per-unit rate keeps its paisa. */
export function rate(n: number | null | undefined, unit?: string): string {
  const v = Number(n ?? 0).toLocaleString(PK, { maximumFractionDigits: 2 });
  return unit ? `Rs. ${v}/${unit}` : `Rs. ${v}`;
}

/** 10 Nov 2026 */
export function fd(d: string | null | undefined): string {
  if (!d) return '—';
  const x = new Date(`${String(d).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(x.getTime())) return String(d);
  return x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** 10 Nov 2026, 14:05 (Karachi) */
export function fdt(ts: string | null | undefined): string {
  if (!ts) return '—';
  const x = new Date(ts);
  if (Number.isNaN(x.getTime())) return String(ts);
  return x.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' });
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The API's own sentence for a refusal says more than a generic failure. */
export function errorMessage(err: unknown, fallback = 'Something went wrong. Try again.'): string {
  return err instanceof ApiError || err instanceof Error ? err.message || fallback : fallback;
}

/** YYYY-MM-DD arithmetic on a business date (no time zone in play). */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ── Status pills (design: Store pages) ───────────────────────────────────────

export type Tone = 'amber' | 'blue' | 'green' | 'red' | 'muted';
const TONES: Record<Tone, string> = {
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
  green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  red: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300',
  muted: 'bg-muted text-muted-foreground',
};

export function Pill({ tone, children, className }: { tone: Tone; children: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold', TONES[tone], className)}>
      {children}
    </span>
  );
}

export const DEMAND_TONE: Record<StoreDemandStatus, Tone> = {
  pending_review: 'amber',
  ready_to_issue: 'blue',
  issued: 'green',
  received: 'green',
  rejected: 'red',
  cancelled: 'muted',
};

export function DemandStatusPill({ status }: { status: StoreDemandStatus }) {
  return <Pill tone={DEMAND_TONE[status]}>{STORE_DEMAND_STATUS_LABELS[status]}</Pill>;
}

export const LINE_TONE: Record<string, Tone> = { pending: 'amber', approved: 'blue', issued: 'green', rejected: 'red' };
export const LINE_LABEL: Record<string, string> = { pending: 'Pending', approved: 'Approved', issued: 'Issued', rejected: 'Rejected' };

/** Stock state of an item: Inactive / Out / Low / OK. */
export function stockTone(status: string, available: number, minStock: number): { tone: Tone; label: string } {
  if (status !== 'active') return { tone: 'muted', label: 'Inactive' };
  if (available <= 0) return { tone: 'red', label: 'Out of stock' };
  if (available <= minStock) return { tone: 'red', label: 'Low' };
  return { tone: 'green', label: 'OK' };
}

// ── Layout pieces ────────────────────────────────────────────────────────────

const STORE_TABS: Array<[string, string]> = [
  [ROUTES.STORE_DASHBOARD, 'Dashboard'],
  [ROUTES.STORE_ITEMS, 'Store Items'],
  [ROUTES.STORE_PRICES, 'Price Control'],
  [ROUTES.STORE_RECEIVING, 'New Stock Receiving'],
  [ROUTES.STORE_STOCK, 'Store Stock'],
  [ROUTES.STORE_APPROVAL, 'Approval & Issue'],
  [ROUTES.STORE_LEDGER, 'Stock Ledger'],
  [ROUTES.STORE_REPORTS, 'Reports'],
  [ROUTES.STORE_QUERIES, 'Queries'],
  [ROUTES.STORE_ACCOUNTS, 'Accounts'],
  [ROUTES.STORE_SETTINGS, 'Settings'],
];

/**
 * The Store's own page tabs (the design's pill row). A Store keeper has them
 * in the sidebar, so on a wide screen they are hidden for that role; Admin and
 * Finance reach the Store from one sidebar entry and move inside it here.
 */
export function StoreTabs({ role }: { role: string }) {
  const path = normalizePath(usePathname() ?? '');
  const tabs = STORE_TABS.filter(([href]) => canOpenStorePage(role, href));
  return (
    <nav aria-label="Dry Items Store" className={cn('-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1', role === 'store_user' && 'lg:hidden')}>
      {tabs.map(([href, label]) => {
        const on = path === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={on ? 'page' : undefined}
            className={cn(
              'flex h-9 shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-[13px] transition-colors',
              on ? 'border-secondary bg-secondary font-semibold text-secondary-foreground' : 'border-border bg-card text-foreground hover:border-primary/50',
            )}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Store page frame: the Store tabs, a subtitle with the store id, the page's
 * actions on the right, and a loading / no-access state while /me resolves.
 */
export function StorePage({
  session,
  subtitle,
  actions,
  needs = 'view',
  children,
}: {
  session: StoreSession;
  subtitle: ReactNode;
  actions?: ReactNode;
  /** The action this page is for; without it the page says so instead of 403-ing every call. */
  needs?: StoreAction;
  children: ReactNode;
}) {
  const { me, role } = session;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <StoreTabs role={role} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="min-w-0 text-sm text-muted-foreground">
          {me.data ? <span className="font-medium text-foreground">{me.data.store.storeCode}</span> : null}
          {me.data ? ' · ' : null}
          {subtitle}
        </p>
        {actions && me.data?.can[needs] ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {me.isLoading ? (
        <div className="grid gap-3">
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      ) : me.isError ? (
        <ErrorBlock error={me.error} onRetry={() => void me.refetch()} />
      ) : !me.data?.can[needs] ? (
        <Denied />
      ) : (
        children
      )}
    </div>
  );
}

export function Denied({ text = 'Your account cannot open this part of the Store. Ask Admin if you need it.' }: { text?: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
      <Lock className="h-5 w-5" />
      {text}
    </div>
  );
}

export function ErrorBlock({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-red-200 bg-red-50 p-6 text-center text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
      <AlertTriangle className="h-5 w-5" />
      <span>{errorMessage(error, 'Could not load this. Check the connection and try again.')}</span>
      {onRetry && (
        <Button size="sm" variant="outline" onClick={onRetry}>
          <RotateCw className="mr-1.5 h-3.5 w-3.5" /> Try again
        </Button>
      )}
    </div>
  );
}

/** White card with the design's 14px radius and hairline border. */
/** Phone (light): the redesign's white card (mb-card, globals.css). */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('mb-card min-w-0 rounded-2xl border border-border bg-card', className)}>{children}</section>;
}

export function CardHead({ title, right, className }: { title: ReactNode; right?: ReactNode; className?: string }) {
  return (
    // Phone (light): a plain H3 heading on the card, no rule (mb-head).
    <div className={cn('mb-head flex items-center justify-between gap-3 border-b border-border px-4 py-3', className)}>
      <span className="mb-head-title text-[13px] font-bold uppercase tracking-wide text-muted-foreground">{title}</span>
      {right}
    </div>
  );
}

/** KPI tile (Store Dashboard): small caps label, big tabular figure, one line of context. */
export function Kpi({ label, value, sub, tone, href, hero }: {
  label: string; value: string; sub?: string; tone?: 'good' | 'warn' | 'bad' | 'info'; href?: string;
  /** Phone (light) only: the headline figure as the violet hero. */
  hero?: boolean;
}) {
  const color = tone === 'good' ? 'text-emerald-700 dark:text-emerald-400' : tone === 'warn' ? 'text-amber-700 dark:text-amber-400' : tone === 'bad' ? 'text-red-700 dark:text-red-400' : tone === 'info' ? 'text-blue-800 dark:text-blue-300' : 'text-foreground';
  const body = (
    <>
      <span className="text-[11.5px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn('truncate text-lg font-extrabold tabular-nums tracking-tight sm:text-[23px]', color)}>{value}</span>
      {sub ? <span className="text-[12.5px] leading-snug text-muted-foreground">{sub}</span> : null}
    </>
  );
  // Phone (light): a pastel tile (mb-tile), or the violet hero.
  const cls = cn('flex min-w-0 flex-col gap-1 rounded-2xl border border-border bg-card px-4 py-3.5 text-foreground', hero ? 'mb-hero mb-hero-strip' : 'mb-tile');
  return href ? (
    <Link href={href} className={cn(cls, 'transition-colors hover:border-primary/50')}>{body}</Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** The design's segmented control: a muted track with the chosen option raised. */
export function Segmented<T extends string>({ value, options, onChange, className }: {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div role="tablist" className={cn('inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg bg-muted p-0.5 max-md:rounded-2xl max-md:p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            'h-8 shrink-0 whitespace-nowrap rounded-md px-3 text-[13px] font-medium transition-colors',
            value === o.value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Label + value cell used in detail panels and facts rows. */
export function Fact({ k, v, className }: { k: string; v: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground">{k}</div>
      <div className="truncate text-sm font-medium tabular-nums">{v}</div>
    </div>
  );
}

// ── Date range (Today / Yesterday / Last 7 days / This month / Custom) ───────

export type RangePreset = 'today' | 'yesterday' | 'last7' | 'month' | 'custom';

export function presetRange(preset: RangePreset, today: string): { from: string; to: string } | null {
  if (!today) return null;
  switch (preset) {
    case 'today': return { from: today, to: today };
    case 'yesterday': { const y = addDays(today, -1); return { from: y, to: y }; }
    case 'last7': return { from: addDays(today, -6), to: today };
    case 'month': return { from: `${today.slice(0, 8)}01`, to: today };
    default: return null;
  }
}

export function DateRange({ today, from, to, preset, onChange, presets = true }: {
  today: string;
  from: string;
  to: string;
  preset: RangePreset;
  onChange: (next: { from: string; to: string; preset: RangePreset }) => void;
  presets?: boolean;
}) {
  const pick = (p: RangePreset) => {
    const r = presetRange(p, today);
    onChange(r ? { ...r, preset: p } : { from, to, preset: 'custom' });
  };
  const input = 'h-9 rounded-lg border border-border bg-card px-2 text-[13px] tabular-nums';
  return (
    <div className="flex flex-wrap items-center gap-2">
      {presets && (
        <Segmented<RangePreset>
          value={preset}
          onChange={pick}
          options={[
            { value: 'today', label: 'Today' },
            { value: 'yesterday', label: 'Yesterday' },
            { value: 'last7', label: 'Last 7 days' },
            { value: 'month', label: 'This month' },
            { value: 'custom', label: 'Custom' },
          ]}
        />
      )}
      <div className="flex items-center gap-1.5">
        <input type="date" aria-label="From" className={input} value={from} max={to || today}
          onChange={(e) => e.target.value && onChange({ from: e.target.value, to, preset: 'custom' })} />
        <span className="text-xs text-muted-foreground">to</span>
        <input type="date" aria-label="To" className={input} value={to} min={from} max={today}
          onChange={(e) => e.target.value && onChange({ from, to: e.target.value, preset: 'custom' })} />
      </div>
    </div>
  );
}

/** A plain select styled like the design's filter controls. */
export function FilterSelect({ value, onChange, children, label, className }: {
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn('h-9 min-w-0 rounded-lg border border-border bg-card px-2 text-[13px] text-foreground', className)}
    >
      {children}
    </select>
  );
}

/** Field wrapper for the Store forms: label, control, and a hint that turns into the error. */
export function Field({ label, required, optional, hint, error, children, className }: {
  label: string;
  required?: boolean;
  optional?: boolean;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn('flex min-w-0 flex-col gap-1', className)}>
      <span className="text-[12.5px] font-semibold text-foreground">
        {label}
        {required ? <span className="text-red-600"> *</span> : null}
        {optional ? <span className="font-normal text-muted-foreground"> (optional)</span> : null}
      </span>
      {children}
      {error ? <span className="text-xs font-semibold text-red-700 dark:text-red-400">{error}</span> : hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export const inputCls = (bad?: boolean) =>
  cn('h-10 w-full min-w-0 rounded-lg border bg-card px-3 text-sm text-foreground md:h-9', bad ? 'border-red-600' : 'border-border');

/** Read the Store keeper's StoreMe, typed. */
export type { StoreMe };
