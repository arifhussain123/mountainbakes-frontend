'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { KeyRound, Plus, Power, UserCog } from 'lucide-react';
import type { StoreAccount, StoreAccountFlags, User } from '@mb/shared';
import { CreateUserSchema } from '@mb/shared';
import { apiCall } from '@/utils/api';
import { EmptyState } from '@/components/shared/EmptyState';
import { ResetPasswordDialog } from '@/components/users/ResetPasswordDialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useInvalidateStore, useSaveStoreAccount, useStoreAccounts, useStoreAudit } from '@/lib/store';
import {
  Card, CardHead, ConfirmDialog, ErrorBlock, Fact, Field, Pill, StorePage, errorMessage, fdt, inputCls, useStoreSession,
} from './parts';

/**
 * Store Accounts (Admin). A Store keeper is an ordinary user with the
 * `store_user` role, created here (POST /api/users) so it lands in the Store
 * with the right role; what it may do beyond the role's defaults is the four
 * switches below (store_accounts). Activate, deactivate and reset password are
 * the Users screen's own endpoints. The Store ID is the department's.
 */

const FLAGS: Array<{ key: keyof StoreAccountFlags; label: string; hint: string }> = [
  { key: 'canManageItems', label: 'Manage items', hint: 'Create and edit Store Items.' },
  { key: 'canEditPrices', label: 'Set prices', hint: 'Add and deactivate Price Control prices. Off by default: Finance and Admin set prices.' },
  { key: 'canAdjustStock', label: 'Adjust stock', hint: 'Record damaged, expired and counted stock, and returns from Production.' },
  { key: 'canIssue', label: 'Issue stock', hint: 'Issue approved demand to Production.' },
];

export function StoreAccountsPage() {
  const session = useStoreSession();
  const { token, can } = session;
  const isAdmin = can('accounts');
  const accountsQ = useStoreAccounts(token, isAdmin);
  const auditQ = useStoreAudit(token, { entity: 'account', limit: 20 }, isAdmin);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<StoreAccount | null>(null);
  const [resetting, setResetting] = useState<StoreAccount | null>(null);
  const [toggling, setToggling] = useState<StoreAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const invalidate = useInvalidateStore();
  const rows = accountsQ.data ?? [];

  const toggle = async () => {
    if (!toggling) return;
    setBusy(true);
    try {
      if (toggling.status === 'active') await apiCall(`/api/users/${toggling.userId}`, { method: 'DELETE' }, token);
      else await apiCall(`/api/users/${toggling.userId}/activate`, { method: 'POST' }, token);
      toast.success(`${toggling.displayName} ${toggling.status === 'active' ? 'deactivated' : 'activated'}.`);
      await invalidate();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      setToggling(null);
    }
  };

  return (
    <StorePage
      session={session}
      needs="accounts"
      subtitle="Store keeper accounts and what each may do. The API enforces these on every request."
      actions={<Button onClick={() => setCreating(true)}><Plus className="mr-1.5 h-4 w-4" />Create Store Account</Button>}
    >
      {accountsQ.isLoading ? (
        <Skeleton className="h-40 w-full rounded-2xl" />
      ) : accountsQ.isError ? (
        <ErrorBlock error={accountsQ.error} onRetry={() => void accountsQ.refetch()} />
      ) : rows.length === 0 ? (
        <Card className="p-2">
          <EmptyState icon={UserCog} title="No Store accounts yet" description="Create the Store keeper's login. It opens on the Store Dashboard."
            action={<Button size="sm" onClick={() => setCreating(true)}><Plus className="mr-1.5 h-4 w-4" />Create Store Account</Button>} />
        </Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {rows.map((a) => (
            <Card key={a.userId} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{a.displayName}</div>
                  <div className="truncate text-xs text-muted-foreground">{a.userCode ?? '—'} · {a.email}{a.username ? ` · @${a.username}` : ''}</div>
                </div>
                <Pill tone={a.status === 'active' ? 'green' : 'muted'}>{a.status === 'active' ? 'Active' : a.status === 'suspended' ? 'Suspended' : 'Inactive'}</Pill>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Fact k="Store ID" v={session.me.data?.store.storeCode ?? '—'} />
                <Fact k="Last sign-in" v={a.lastLoginAt ? fdt(a.lastLoginAt) : 'Never'} />
                <Fact k="Created" v={fdt(a.createdAt)} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {FLAGS.map((f) => (
                  <Pill key={f.key} tone={a[f.key] ? 'blue' : 'muted'}>{a[f.key] ? '✓' : '✕'} {f.label}</Pill>
                ))}
              </div>
              {a.notes ? <p className="text-xs text-muted-foreground">{a.notes}</p> : null}
              <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                <Button size="sm" variant="outline" onClick={() => setEditing(a)}><UserCog className="mr-1 h-3.5 w-3.5" />Permissions</Button>
                <Button size="sm" variant="outline" onClick={() => setResetting(a)}><KeyRound className="mr-1 h-3.5 w-3.5" />Reset password</Button>
                <Button size="sm" variant="outline" className={a.status === 'active' ? 'text-red-700' : 'text-emerald-700'} onClick={() => setToggling(a)}>
                  <Power className="mr-1 h-3.5 w-3.5" />{a.status === 'active' ? 'Deactivate' : 'Activate'}
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHead title="Account changes" />
        {auditQ.isLoading ? (
          <Skeleton className="m-4 h-16" />
        ) : (auditQ.data?.rows ?? []).length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">No permission changes yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {auditQ.data!.rows.map((e) => (
              <li key={e.id} className="px-4 py-2.5 text-sm">
                <b>{e.entityRef}</b> · {e.detail} <span className="text-xs text-muted-foreground">· {e.actorName} · {fdt(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {creating && <CreateAccountDialog token={token} onClose={() => setCreating(false)} />}
      {editing && <FlagsDialog token={token} account={editing} onClose={() => setEditing(null)} />}
      <ResetPasswordDialog
        open={!!resetting}
        onOpenChange={(o) => !o && setResetting(null)}
        token={token}
        user={resetting ? ({
          id: resetting.userId, displayName: resetting.displayName, email: resetting.email, role: 'store_user', branchName: null,
        } as unknown as User) : null}
        onDone={() => { setResetting(null); void invalidate(); }}
      />
      <ConfirmDialog
        open={!!toggling}
        onOpenChange={(o) => !o && setToggling(null)}
        title={toggling?.status === 'active' ? `Deactivate ${toggling?.displayName}?` : `Activate ${toggling?.displayName}?`}
        description={toggling?.status === 'active' ? 'They are signed out and can no longer sign in. Everything they recorded stays.' : 'They can sign in to the Store again.'}
        confirmLabel={toggling?.status === 'active' ? 'Deactivate' : 'Activate'}
        destructive={toggling?.status === 'active'}
        pending={busy}
        onConfirm={() => void toggle()}
      />
    </StorePage>
  );
}

function FlagsDialog({ token, account, onClose }: { token: string; account: StoreAccount; onClose: () => void }) {
  const saveM = useSaveStoreAccount(token);
  const [f, setF] = useState<StoreAccountFlags & { notes: string }>({
    canManageItems: account.canManageItems, canEditPrices: account.canEditPrices,
    canAdjustStock: account.canAdjustStock, canIssue: account.canIssue, notes: account.notes ?? '',
  });
  return (
    <Dialog open onOpenChange={(o) => !o && !saveM.isPending && onClose()}>
      <DialogContent className="md:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Permissions · {account.displayName}</DialogTitle>
          <DialogDescription>Receiving, reviewing demand and raising queries are always on for a Store keeper. Finance records are never visible to the Store.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col divide-y divide-border rounded-xl border border-border">
          {FLAGS.map((x) => (
            <label key={x.key} className="flex items-center justify-between gap-4 px-3 py-2.5">
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{x.label}</span>
                <span className="block text-xs text-muted-foreground">{x.hint}</span>
              </span>
              <Switch checked={f[x.key]} onCheckedChange={(v: boolean) => setF((s) => ({ ...s, [x.key]: v }))} />
            </label>
          ))}
        </div>
        <Field label="Notes" optional>
          <input className={inputCls()} value={f.notes} onChange={(e) => setF((s) => ({ ...s, notes: e.target.value }))} />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saveM.isPending}>Cancel</Button>
          <Button
            disabled={saveM.isPending}
            onClick={() => saveM.mutate({ userId: account.userId, input: { ...f, notes: f.notes.trim() || null } }, {
              onSuccess: () => { toast.success('Permissions saved.'); onClose(); },
              onError: (e) => toast.error(errorMessage(e)),
            })}
          >
            {saveM.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateAccountDialog({ token, onClose }: { token: string; onClose: () => void }) {
  const invalidate = useInvalidateStore();
  const [f, setF] = useState({ displayName: '', email: '', username: '', phone: '', password: '' });
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const input = useMemo(() => ({ ...f, email: f.email.trim(), username: f.username.trim().toLowerCase(), displayName: f.displayName.trim(), role: 'store_user' as const, branchId: null }), [f]);
  const parsed = CreateUserSchema.safeParse(input);
  const errs: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) errs[String(i.path[0])] ??= i.message;
  const e = (k: string) => (tried ? errs[k] ?? null : null);
  const set = (k: keyof typeof f) => (v: string) => setF((s) => ({ ...s, [k]: v }));

  const save = async () => {
    if (!parsed.success) { setTried(true); return; }
    setBusy(true);
    try {
      await apiCall('/api/users', { method: 'POST', body: JSON.stringify(parsed.data) }, token);
      toast.success(`${input.displayName} can now sign in to the Dry Items Store.`);
      await invalidate();
      onClose();
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="md:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Create Store Account</DialogTitle>
          <DialogDescription>A Store keeper login for the Dry Items Store. Staff ID is assigned on save; set permissions afterwards.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required error={e('displayName')}><input className={inputCls(!!e('displayName'))} value={f.displayName} onChange={(x) => set('displayName')(x.target.value)} /></Field>
          <Field label="Username" required error={e('username')}><input className={inputCls(!!e('username'))} value={f.username} onChange={(x) => set('username')(x.target.value)} placeholder="e.g. store_waqar" /></Field>
          <Field label="Email" required error={e('email')}><input type="email" className={inputCls(!!e('email'))} value={f.email} onChange={(x) => set('email')(x.target.value)} /></Field>
          <Field label="Phone" required error={e('phone')}><input inputMode="tel" className={inputCls(!!e('phone'))} value={f.phone} onChange={(x) => set('phone')(x.target.value)} /></Field>
          <Field label="Password" required error={e('password')} hint="8 characters or more" className="sm:col-span-2">
            <input type="password" autoComplete="new-password" className={inputCls(!!e('password'))} value={f.password} onChange={(x) => set('password')(x.target.value)} />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? 'Creating…' : 'Create account'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
