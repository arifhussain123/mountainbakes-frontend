'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { resolveShareSplit, type FinanceSettings, type ShareBasis } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useBranches } from '@/lib/queries';
import { useFinanceMutation, useFinanceSettings } from '@/lib/finance';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { FinancePageHeader, Money, ReadOnlyNotice, useFinanceAbilities } from './finance-ui';
import { AlertTriangle, Percent } from 'lucide-react';

/**
 * Finance Settings — the numbers the rest of the module reads.
 *
 * The company/branch split lives here and NOT in code, which is the brief's
 * explicit requirement. Two consequences that shape this screen:
 *
 *   * The two percentages are edited as ONE number. Typing 80 into company and
 *     forgetting branch would fail the table's CHECK as an opaque 23514, so the
 *     branch share is derived (100 − company) and the pair is always submitted
 *     together, which is what the API's refine() expects.
 *   * Changing a percentage does not restate history. Each approved income row
 *     snapshots the split it was approved under; this only affects what is
 *     approved from now on. The screen says so, because the opposite assumption
 *     is the natural one.
 *
 * Changing an opening balance POSTS A VOUCHER for the difference rather than
 * silently rewriting the book's starting position — the response names the
 * vouchers and the toast repeats them.
 */
export function FinanceSettingsPage() {
  const abilities = useFinanceAbilities();
  const { data: settings, isLoading } = useFinanceSettings();

  return (
    <div className="space-y-6">
      <FinancePageHeader
        title="Finance Settings"
        description="Share percentages, opening balances and the workflow switches for the whole module."
      />

      <ReadOnlyNotice abilities={abilities} />

      {isLoading || !settings ? (
        <div className="space-y-4">
          <Skeleton className="h-56 w-full rounded-lg" />
          <Skeleton className="h-56 w-full rounded-lg" />
        </div>
      ) : (
        /* Keyed on `updatedAt` so a successful save remounts the form and the
           fields re-read the STORED values (the server rounds to 2dp). That is
           the React-sanctioned way to reset state from a prop — an effect that
           called setState on every settings change would cascade renders, and
           `updatedAt` only moves when something was actually written. */
        <SettingsForm key={settings.updatedAt} settings={settings} canConfigure={abilities.configure} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function SettingsForm({ settings, canConfigure }: { settings: FinanceSettings; canConfigure: boolean }) {
  const mut = useFinanceMutation<{ settings: FinanceSettings; postedVouchers: string[] }>();
  const { token } = useAuth();
  const branchesQ = useBranches(token ?? '');
  // A stored percentage means the branch is deliberately off the default, even
  // when it happens to equal it today — so this filters on "has a value", not
  // on "differs from the current setting".
  const overrides = (branchesQ.data ?? []).filter((b) => b.companySharePct != null);

  const [companyPct, setCompanyPct] = useState(String(settings.companySharePct));
  const [shareBasis, setShareBasis] = useState<ShareBasis>(settings.shareBasis);
  const [openingCash, setOpeningCash] = useState(String(settings.openingCashBalance));
  const [openingBank, setOpeningBank] = useState(String(settings.openingBankBalance));
  const [openingDate, setOpeningDate] = useState(settings.openingBalanceDate ?? '');

  const company = Number(companyPct);
  const companyValid = Number.isFinite(company) && company >= 0 && company <= 100;
  const branch = companyValid ? Math.round((100 - company) * 100) / 100 : 0;

  /** One helper for all of them — every save is a PATCH of the changed subset. */
  async function save(patch: Record<string, unknown>, success: string) {
    try {
      const result = await mut.mutateAsync({ path: '/api/finance/settings', method: 'PUT', body: patch });
      const vouchers = result?.postedVouchers ?? [];
      toast.success(
        vouchers.length > 0 ? `${success} · posted ${vouchers.join(', ')}` : success,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not save these settings');
    }
  }

  async function saveToggle(key: string, value: boolean, label: string) {
    await save({ [key]: value }, `${label} ${value ? 'on' : 'off'}`);
  }

  return (
    <div className="space-y-6">
      {/* ── Share split ── */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div>
            <h3 className="font-semibold">Default company &amp; branch share</h3>
            <p className="text-sm text-muted-foreground">
              Applied to every branch income approval from now on, except where a branch has been given its own rate.
              Already-approved days keep the split they were approved under.
            </p>
          </div>

          {overrides.length > 0 && (
            /* Read-only on purpose: the per-branch rate is edited on Admin →
               Branches (that screen owns the branch record and is Super Admin's,
               not the finance permission model's). Listing them here anyway,
               because the obvious reading of a global 75/25 is that it applies
               to everyone — and a finance user changing it needs to know which
               branches will not move. */
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {overrides.length} branch{overrides.length === 1 ? '' : 'es'} on its own rate — not affected by the
                figure above
              </p>
              <ul className="mt-2 space-y-1">
                {overrides.map((b) => {
                  const split = resolveShareSplit(b.companySharePct, settings.companySharePct);
                  return (
                    <li key={b.id} className="flex items-baseline justify-between gap-4">
                      <span>{b.name}</span>
                      <span className="font-medium tabular-nums">
                        {split.companySharePct}% / {split.branchSharePct}%
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">Change these in Admin → Branches.</p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label>Company share</Label>
              <div className="relative">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  inputMode="decimal"
                  disabled={!canConfigure}
                  value={companyPct}
                  onChange={(e) => setCompanyPct(e.target.value)}
                  className="pr-9"
                />
                <Percent className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
            </div>

            <div className="space-y-1">
              <Label>Branch share</Label>
              {/* Derived, never typed — see the header note. */}
              <div className="relative">
                <Input value={companyValid ? branch : '—'} readOnly disabled className="pr-9" />
                <Percent className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground">Always 100% minus the company share.</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Struck on</Label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { value: 'gross', label: 'Gross collection' },
                  { value: 'net', label: 'Net of branch expenses' },
                ] as const
              ).map((o) => (
                <button
                  key={o.value}
                  type="button"
                  disabled={!canConfigure}
                  onClick={() => setShareBasis(o.value)}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50',
                    shareBasis === o.value ? 'border-primary bg-primary/10 text-primary' : 'border-input hover:bg-accent',
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>

          {/* A worked example on a round number: the split is the setting people
              are most likely to get wrong, and 10,000 makes the effect obvious. */}
          {companyValid && (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                On a {shareBasis === 'gross' ? 'gross collection' : 'net figure'} of Rs. 10,000
              </p>
              <div className="mt-1.5 flex gap-6">
                <span>
                  Company <Money value={10000 * (company / 100)} className="font-semibold" />
                </span>
                <span>
                  Branch <Money value={10000 * (branch / 100)} className="font-semibold" />
                </span>
              </div>
            </div>
          )}

          {canConfigure && (
            <Button
              disabled={!companyValid || mut.isPending}
              onClick={() =>
                void save(
                  { companySharePct: company, branchSharePct: branch, shareBasis },
                  'Share settings saved',
                )
              }
            >
              {mut.isPending ? 'Saving…' : 'Save share settings'}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ── Opening balances ── */}
      <Card>
        <CardContent className="space-y-4 p-5">
          <div>
            <h3 className="font-semibold">Opening balances</h3>
            <p className="text-sm text-muted-foreground">
              What the company held before the first ledger entry.
            </p>
          </div>

          <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>
              Changing these posts a real voucher for the difference rather than restating the book. The ledger stays
              consistent with itself and the change is visible in the trail.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>Opening cash</Label>
              <Input
                type="number"
                step="0.01"
                inputMode="decimal"
                disabled={!canConfigure}
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Opening bank</Label>
              <Input
                type="number"
                step="0.01"
                inputMode="decimal"
                disabled={!canConfigure}
                value={openingBank}
                onChange={(e) => setOpeningBank(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>As at</Label>
              <Input
                type="date"
                disabled={!canConfigure}
                value={openingDate}
                onChange={(e) => setOpeningDate(e.target.value)}
              />
            </div>
          </div>

          {canConfigure && (
            <Button
              disabled={mut.isPending}
              onClick={() =>
                void save(
                  {
                    openingCashBalance: Number(openingCash) || 0,
                    openingBankBalance: Number(openingBank) || 0,
                    openingBalanceDate: openingDate || null,
                  },
                  'Opening balances saved',
                )
              }
            >
              {mut.isPending ? 'Saving…' : 'Save opening balances'}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* ── Workflow ── */}
      <Card>
        <CardContent className="space-y-1 p-5">
          <div className="mb-3">
            <h3 className="font-semibold">Workflow</h3>
            <p className="text-sm text-muted-foreground">How income reaches the pending list, and who may write.</p>
          </div>

          <ToggleRow
            label="Import branch income automatically"
            description="Pull approved branch closings into the pending list without anyone pressing Import."
            checked={settings.autoImportBranchIncome}
            disabled={!canConfigure || mut.isPending}
            onChange={(v) => void saveToggle('autoImportBranchIncome', v, 'Automatic import')}
          />

          <ToggleRow
            label="Require admin verification"
            description="Insert the Admin-verifies step between import and Finance approval. With this off, imported income goes straight to Finance."
            checked={settings.requireAdminVerification}
            disabled={!canConfigure || mut.isPending}
            onChange={(v) => void saveToggle('requireAdminVerification', v, 'Admin verification')}
          />

          <ToggleRow
            label="Allow Super Admin to modify finance records"
            description="Super Admins can always view finance data and reports. This grants them write access as well — off by default, because separation of duties is the point of a finance module."
            checked={settings.allowSuperAdminWrite}
            disabled={!canConfigure || mut.isPending}
            onChange={(v) => void saveToggle('allowSuperAdminWrite', v, 'Super Admin write access')}
            emphasis
          />

          <p className="pt-3 text-xs text-muted-foreground">
            Last updated {new Date(settings.updatedAt).toLocaleString('en-PK')}
            {settings.updatedBy ? ` by ${settings.updatedBy}` : ''}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
  emphasis,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  /** For the one switch that widens who can move money. */
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 border-b py-3 last:border-b-0',
        emphasis && 'rounded-lg border-b-0 bg-muted/40 px-3',
      )}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onChange(Boolean(v))}
        aria-label={label}
        className="mt-0.5 flex-shrink-0"
      />
    </div>
  );
}
