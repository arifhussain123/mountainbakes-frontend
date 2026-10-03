'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  addDaysToDateStr,
  restrictionDmy,
  RestrictionGroupSchemas,
  type RestrictionGroup,
  type RestrictionRules,
  type RestrictionRulesState,
} from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useSaveRestrictionGroup, type SaveRestrictionGroupInput } from '@/lib/restrictions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { formatDateTime } from '@/utils/date';
import { time12 } from './format';

/**
 * Admin Settings → Restriction Rules → Rules.
 *
 * Five groups, each saved on its own — the screen never sends a group the admin
 * did not touch. The draft lives here; the server's copy is the source for
 * "Saved …" and for what is actually enforced. Validation is the same Zod
 * schema the API applies, so a Save button that is lit will not be refused.
 */

type Tone = 'ok' | 'warn' | 'block';

const LADDER_TONE: Record<Tone, string> = {
  ok: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
  warn: 'bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  block: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
};

/** "0–1", "2", "3+" — or "—" for a band the thresholds leave empty. */
const range = (from: number, to: number) => (from === to ? String(from) : from > to ? '—' : `${from}–${to}`);

function Ladder({ steps, className }: { steps: { range: string; text: string; tone: Tone }[]; className?: string }) {
  return (
    <div className={cn('flex overflow-hidden rounded-md border', className)}>
      {steps.map((s) => (
        <div key={`${s.range}-${s.text}`} className={cn('flex min-w-[72px] flex-col gap-px px-3 py-1.5', LADDER_TONE[s.tone])}>
          <span className="font-mono text-[11px]">{s.range}</span>
          <span className="text-[11.5px] font-semibold">{s.text}</span>
        </div>
      ))}
    </div>
  );
}

function CodeTag({ code }: { code: string }) {
  return <span className="self-start rounded bg-muted px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground">{code}</span>;
}

function EnabledSwitch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-2 self-start">
      <span className="text-xs text-muted-foreground">{checked ? 'Enabled' : 'Disabled'}</span>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={`${label} enabled`} />
    </label>
  );
}

function OptionSwitch({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="flex items-center gap-2.5">
      <Switch checked={checked} onCheckedChange={onChange} />
      <span className="text-[12.5px] font-semibold">{children}</span>
    </label>
  );
}

function NumberField({
  label,
  unit,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold">{label}</span>
      <span className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          // NaN is how an emptied field is held; shown as blank, refused on save.
          value={Number.isNaN(value) ? '' : value}
          onChange={(e) => onChange(e.target.value === '' ? Number.NaN : Math.max(0, Math.trunc(Number(e.target.value)) || 0))}
          className="h-8 w-[72px]"
        />
        <span className="text-xs text-muted-foreground">{unit}</span>
      </span>
    </label>
  );
}

function Summary({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-foreground/80">
      <span className="text-muted-foreground">Current configuration:</span> {children}
    </p>
  );
}

function FieldError({ children }: { children: React.ReactNode }) {
  return <p role="alert" className="text-xs font-medium text-destructive">{children}</p>;
}

const OFF = 'Disabled — no restriction applied';

function Section({
  title,
  shownIn,
  status,
  dirty,
  footer,
  children,
  className,
}: {
  title: string;
  shownIn: string;
  status: string;
  dirty: boolean;
  footer: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('flex flex-col overflow-hidden rounded-xl border bg-card', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div className="flex flex-col gap-0.5">
          <h2 className="text-[15px] font-bold">{title}</h2>
          <span className="text-xs text-muted-foreground">Shown in: {shownIn}</span>
        </div>
        <span className={cn('text-xs font-medium', dirty ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground')}>{status}</span>
      </div>
      {children}
      <div className="flex justify-end border-t bg-muted/40 px-5 py-3">{footer}</div>
    </section>
  );
}

/** A rule laid out across the full width: text and controls left, its switch right. */
function WideRule({
  name,
  code,
  description,
  enabled,
  onEnabled,
  children,
}: {
  name: string;
  code: string;
  description: string;
  enabled: boolean;
  onEnabled: (v: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 border-t px-5 py-[18px]">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13.5px] font-bold">{name}</span>
            <CodeTag code={code} />
          </div>
          <p className="text-[13px] leading-normal text-pretty text-muted-foreground">{description}</p>
        </div>
        {children}
      </div>
      <EnabledSwitch checked={enabled} onChange={onEnabled} label={name} />
    </div>
  );
}

/** A rule in a narrow card: name and switch on one line, everything else stacked. */
function CardRule({
  name,
  code,
  description,
  enabled,
  onEnabled,
  summary,
  children,
}: {
  name: string;
  code: string;
  description: string;
  enabled: boolean;
  onEnabled: (v: boolean) => void;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col gap-3 border-t px-5 py-[18px]">
      <div className="flex justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[13.5px] font-bold">{name}</span>
          <CodeTag code={code} />
        </div>
        <EnabledSwitch checked={enabled} onChange={onEnabled} label={name} />
      </div>
      <p className="text-[13px] leading-normal text-pretty text-muted-foreground">{description}</p>
      <div className={cn('flex flex-col gap-3', !enabled && 'opacity-45')}>{children}</div>
      <div className="mt-auto">
        <Summary>{summary}</Summary>
      </div>
    </div>
  );
}

export function RulesTab({ state }: { state: RestrictionRulesState }) {
  const { token } = useAuth();
  const save = useSaveRestrictionGroup(token);
  const [draft, setDraft] = useState<RestrictionRules>(state.rules);
  const [saving, setSaving] = useState<RestrictionGroup | null>(null);

  /** Replace one rule inside one group, leaving the rest of the draft alone. */
  function patch<G extends RestrictionGroup, R extends keyof RestrictionRules[G]>(
    group: G,
    rule: R,
    change: Partial<RestrictionRules[G][R]>,
  ) {
    setDraft((d) => ({ ...d, [group]: { ...d[group], [rule]: { ...d[group][rule], ...change } } }));
  }

  const dirty = (g: RestrictionGroup) => JSON.stringify(draft[g]) !== JSON.stringify(state.rules[g]);
  const valid = (g: RestrictionGroup) => RestrictionGroupSchemas[g].safeParse(draft[g]).success;

  function status(g: RestrictionGroup): string {
    if (dirty(g)) return 'Unsaved changes';
    const at = state.saved[g].updatedAt;
    return at ? `Saved ${formatDateTime(at)}` : 'Using defaults';
  }

  async function saveGroup(g: RestrictionGroup) {
    if (!dirty(g) || !valid(g)) return;
    setSaving(g);
    try {
      const next = await save.mutateAsync({ group: g, config: draft[g] } as SaveRestrictionGroupInput);
      // Take the server's copy of THIS group; other groups keep their drafts.
      setDraft((d) => ({ ...d, [g]: next.rules[g] }));
      toast.success('Rules saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save the rules');
    } finally {
      setSaving(null);
    }
  }

  const saveButton = (g: RestrictionGroup, label: string) => (
    <Button onClick={() => saveGroup(g)} disabled={!dirty(g) || !valid(g) || saving !== null}>
      {saving === g ? 'Saving…' : label}
    </Button>
  );

  const { pendingLimit: dp, backdated: bd, lowSales: cs } = draft.demand;
  const hs = draft.sales.hourly;
  const cd = draft.cash.dailyLimit;
  const lg = draft.ledger.backdate;
  const co = draft.company.shareIncome;

  const n = (v: number) => (Number.isNaN(v) ? 0 : v);
  const dpErr = !(n(dp.warnAt) < n(dp.blockAt));
  const csErr = !(n(cs.minSoldPercent) >= 1 && n(cs.minSoldPercent) <= 100);
  const closes = time12(state.closingTime);
  const lgFrom = restrictionDmy(addDaysToDateStr(state.businessDate, -n(lg.allowedDays)));
  const today = restrictionDmy(state.businessDate);

  return (
    <div className="flex flex-col gap-[18px]">
      <Section
        title="Demand Restrictions"
        shownIn="New Demand popup"
        status={status('demand')}
        dirty={dirty('demand')}
        footer={saveButton('demand', 'Save demand rules')}
      >
        <WideRule
          name="Pending verification limit"
          code="DEMAND_PENDING_LIMIT"
          description="Counts a branch's demands in the Awaiting Verification status: sent by Production, not yet verified as received by the branch. Their demand numbers are listed in the popup when blocked."
          enabled={dp.enabled}
          onEnabled={(v) => patch('demand', 'pendingLimit', { enabled: v })}
        >
          <div className={cn('flex flex-wrap items-end gap-5', !dp.enabled && 'opacity-45')}>
            <NumberField label="Warning threshold" unit="awaiting" min={0} value={dp.warnAt} onChange={(v) => patch('demand', 'pendingLimit', { warnAt: v })} />
            <NumberField label="Blocking threshold" unit="awaiting" min={1} value={dp.blockAt} onChange={(v) => patch('demand', 'pendingLimit', { blockAt: v })} />
            <Ladder
              steps={[
                { range: range(0, n(dp.warnAt) - 1), text: 'Allowed', tone: 'ok' },
                { range: range(n(dp.warnAt), n(dp.blockAt) - 1), text: 'Warning', tone: 'warn' },
                { range: `${n(dp.blockAt)}+`, text: 'Blocked', tone: 'block' },
              ]}
            />
          </div>
          {dpErr && <FieldError>Warning threshold must be lower than the blocking threshold.</FieldError>}
          <Summary>{dp.enabled ? `Warn at ${n(dp.warnAt)} awaiting verification · block new demands at ${n(dp.blockAt)}+` : OFF}</Summary>
        </WideRule>

        <WideRule
          name="Backdated demand"
          code="BACKDATED_DEMAND"
          description="A demand dated before the current business date is held until Admin approves it. Approval is one-time and tied to that demand."
          enabled={bd.enabled}
          onEnabled={(v) => patch('demand', 'backdated', { enabled: v })}
        >
          <div className={cn(!bd.enabled && 'opacity-45')}>
            <OptionSwitch checked={bd.requireApproval} onChange={(v) => patch('demand', 'backdated', { requireApproval: v })}>
              Requires Admin approval
            </OptionSwitch>
          </div>
          <Summary>{bd.enabled ? (bd.requireApproval ? 'Backdated demands held for Admin approval' : 'Backdated demands blocked') : OFF}</Summary>
        </WideRule>

        <WideRule
          name="Low sales after closing"
          code="LOW_SALES_AFTER_CLOSING"
          description="After the branch closing time, a new demand is blocked if the sold share of applicable opening/available stock is below the minimum. Uses the existing stock calculation."
          enabled={cs.enabled}
          onEnabled={(v) => patch('demand', 'lowSales', { enabled: v })}
        >
          <div className={cn('flex flex-wrap items-end gap-5', !cs.enabled && 'opacity-45')}>
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold">Closing time</span>
              <div className="flex h-8 items-center gap-2 rounded-md border border-dashed bg-muted/50 px-2.5">
                <span className="font-semibold">{closes}</span>
                <span className="text-[11.5px] text-muted-foreground">from Business Hours</span>
              </div>
            </div>
            <NumberField label="Minimum sold percentage" unit="%" min={1} max={100} value={cs.minSoldPercent} onChange={(v) => patch('demand', 'lowSales', { minSoldPercent: v })} />
          </div>
          {csErr && <FieldError>Enter a percentage between 1 and 100.</FieldError>}
          <Summary>{cs.enabled ? `After ${closes}, block new demand if less than ${n(cs.minSoldPercent)}% of stock sold` : OFF}</Summary>
        </WideRule>
      </Section>

      <Section
        title="Sales Restrictions"
        shownIn="New Sale popup"
        status={status('sales')}
        dirty={dirty('sales')}
        footer={saveButton('sales', 'Save sales rules')}
      >
        <WideRule
          name="Hourly sales activity"
          code="HOURLY_SALES_LIMIT"
          description={`Counts the completed sales a branch has recorded in the current business hour, determined by the server in ${state.timezone} time. Device clocks are ignored. While the count is below the required number, the popup shows a warning. The counter resets each hour.`}
          enabled={hs.enabled}
          onEnabled={(v) => patch('sales', 'hourly', { enabled: v })}
        >
          <div className={cn('flex flex-wrap items-end gap-5', !hs.enabled && 'opacity-45')}>
            <NumberField label="Required sales" unit="sales / hour" min={1} value={hs.threshold} onChange={(v) => patch('sales', 'hourly', { threshold: v })} />
            <Ladder
              steps={[
                { range: range(0, n(hs.threshold) - 1), text: 'Warning', tone: 'warn' },
                { range: `${n(hs.threshold)}+`, text: 'Normal', tone: 'ok' },
              ]}
            />
          </div>
          <Summary>
            {hs.enabled ? `Warn while a branch has fewer than ${n(hs.threshold)} sales in the current hour · sales are never blocked` : OFF}
          </Summary>
        </WideRule>
      </Section>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(320px,100%),1fr))] gap-[18px]">
        <Section title="Cash Deposit Restrictions" shownIn="Cash Deposit popup" status={status('cash')} dirty={dirty('cash')} footer={saveButton('cash', 'Save')}>
          <CardRule
            name="Daily forward limit"
            code="CASH_DEPOSIT_LIMIT"
            description="Counts cash-deposit transactions forwarded per branch per business date. Each uses the existing server-generated CT number."
            enabled={cd.enabled}
            onEnabled={(v) => patch('cash', 'dailyLimit', { enabled: v })}
            summary={cd.enabled ? `${n(cd.limit)} deposits per business day${cd.allowExceptions ? ' · Admin exceptions allowed' : ' · no exceptions'}` : OFF}
          >
            <NumberField label="Maximum per business day" unit="transactions" min={1} value={cd.limit} onChange={(v) => patch('cash', 'dailyLimit', { limit: v })} />
            <OptionSwitch checked={cd.allowExceptions} onChange={(v) => patch('cash', 'dailyLimit', { allowExceptions: v })}>
              Allow one-time Admin exceptions
            </OptionSwitch>
          </CardRule>
        </Section>

        <Section title="Ledger Restrictions" shownIn="Ledger Entry popup" status={status('ledger')} dirty={dirty('ledger')} footer={saveButton('ledger', 'Save')}>
          <CardRule
            name="Back-entry period"
            code="LEDGER_BACKDATE"
            description="Entries within the period are saved directly. Older entries are held until Admin approves; the ledger entry is not created before then."
            enabled={lg.enabled}
            onEnabled={(v) => patch('ledger', 'backdate', { enabled: v })}
            summary={lg.enabled ? `${n(lg.allowedDays)} days direct · older requires Admin approval` : OFF}
          >
            <NumberField label="Allowed back entry" unit="days" min={0} value={lg.allowedDays} onChange={(v) => patch('ledger', 'backdate', { allowedDays: v })} />
            <div className="flex flex-col gap-1 rounded-lg bg-muted/60 px-3 py-2.5 text-xs">
              <span className="text-muted-foreground">With business date {today}</span>
              <span><span className="font-semibold">Direct:</span> <span className="font-mono">{lgFrom} → {today}</span></span>
              <span><span className="font-semibold">Needs approval:</span> <span className="font-mono">before {lgFrom}</span></span>
            </div>
          </CardRule>
        </Section>

        <Section title="Company Share Restrictions" shownIn="Income popup" status={status('company')} dirty={dirty('company')} footer={saveButton('company', 'Save')}>
          <CardRule
            name="Company Share as income"
            code="COMPANY_SHARE_INCOME"
            description="Company Share is received through Branch Cash Deposit. Selecting it as an Income category is held for Admin approval."
            enabled={co.enabled}
            onEnabled={(v) => patch('company', 'shareIncome', { enabled: v })}
            summary={co.enabled ? (co.allowApproval ? 'Direct entry blocked · Admin approval required' : 'Direct entry always blocked') : OFF}
          >
            <div className="flex items-center justify-between gap-2.5 rounded-lg bg-muted/60 px-3 py-2.5">
              <span className="text-[12.5px] font-semibold">Direct income entry</span>
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11.5px] font-bold text-red-700 dark:bg-red-950/40 dark:text-red-300">Blocked</span>
            </div>
            <OptionSwitch checked={co.allowApproval} onChange={(v) => patch('company', 'shareIncome', { allowApproval: v })}>
              Allow via Admin approval
            </OptionSwitch>
          </CardRule>
        </Section>
      </div>

      <section className="grid grid-cols-[repeat(auto-fit,minmax(min(220px,100%),1fr))] gap-4 rounded-xl border bg-muted/40 px-5 py-4 text-[13px]">
        <div className="flex flex-col gap-1">
          <span className="font-bold">Server enforced</span>
          <span className="leading-normal text-muted-foreground">Every rule is re-evaluated by the API. Client-sent branch, user, date or approval values are ignored.</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-bold">Offline</span>
          <span className="leading-normal text-muted-foreground">Restricted actions show “Verification Required” in the popup. Cached results are never authoritative.</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="font-bold">Admin only</span>
          <span className="leading-normal text-muted-foreground">Branch users cannot view or change these settings. All changes are written to the audit log.</span>
        </div>
      </section>
    </div>
  );
}
