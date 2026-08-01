'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { DataTable } from '@/components/shared/DataTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { NotificationRecipient, NotificationLogRecord, NotificationChannel, Branch, ClosingDispatchResult } from '@mb/shared';
import { createColumnHelper } from '@tanstack/react-table';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Send, ScrollText } from 'lucide-react';

const col = createColumnHelper<NotificationRecipient>();

const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  both: 'WhatsApp + SMS',
};

interface ProviderInfo {
  provider: string;
  live: boolean;
  retry: { maxAttempts: number; baseDelayMs: number };
}

/** Who a recipient represents — a branch, or a central department. */
function scopeLabel(r: NotificationRecipient, branches: Branch[]): string {
  if (r.branchId) return r.branchName || branches.find((b) => b.id === r.branchId)?.name || 'Branch';
  if (r.department === 'production') return 'Production';
  if (r.department === 'admin') return 'Admin';
  return '—';
}

export function NotificationRecipientsPage() {
  const { token } = useAuth();
  const [recipients, setRecipients] = useState<NotificationRecipient[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [provider, setProvider] = useState<ProviderInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editing, setEditing] = useState<NotificationRecipient | null>(null);
  const [creating, setCreating] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [dispatching, setDispatching] = useState(false);

  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!token) return;
    // `loading` starts true and is only cleared in finally — setting it synchronously
    // here would trigger a cascading render (react-hooks/set-state-in-effect).
    Promise.all([
      apiCall<{ recipients: NotificationRecipient[] }>('/api/closing-notifications/recipients', {}, token),
      apiCall<{ branches: Branch[] }>('/api/branches', {}, token),
      apiCall<ProviderInfo>('/api/closing-notifications/provider', {}, token),
    ])
      .then(([r, b, p]) => {
        setRecipients(r.recipients ?? []);
        setBranches((b.branches ?? []).filter((x) => x.isActive));
        setProvider(p);
      })
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load recipients'))
      .finally(() => setLoading(false));
  }, [token, refreshKey]);

  async function handleDelete(r: NotificationRecipient) {
    if (!confirm(`Remove ${r.recipientName} (${r.mobileNumber}) from the closing summary list?`)) return;
    try {
      await apiCall(`/api/closing-notifications/recipients/${r.id}`, { method: 'DELETE' }, token);
      toast.success('Recipient removed');
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove');
    }
  }

  async function handleToggleActive(r: NotificationRecipient, active: boolean) {
    try {
      await apiCall(`/api/closing-notifications/recipients/${r.id}`, { method: 'PATCH', body: JSON.stringify({ active }) }, token);
      setRecipients((rs) => rs.map((x) => (x.id === r.id ? { ...x, active } : x)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update');
      reload();
    }
  }

  async function handleSendNow() {
    if (!confirm('Generate and send the closing summaries for the last business day now?')) return;
    setDispatching(true);
    try {
      const res = await apiCall<ClosingDispatchResult>(
        '/api/closing-notifications/dispatch', { method: 'POST', body: JSON.stringify({}) }, token,
      );
      if (res.skipped) toast.warning(`Skipped: ${res.skipped}`);
      else toast.success(`${res.reportsGenerated} reports · ${res.messagesSent} sent · ${res.messagesFailed} failed`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Dispatch failed');
    } finally { setDispatching(false); }
  }

  const columns = useMemo(() => [
    col.accessor('recipientName', {
      header: 'Recipient',
      // Cell already stacks name over mobile number.
      meta: { mobile: 'title' },
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.recipientName}</p>
          <p className="text-xs text-muted-foreground font-mono">{row.original.mobileNumber}</p>
        </div>
      ),
    }),
    col.display({
      id: 'scope',
      header: 'Receives',
      meta: { mobile: 'badge' },
      cell: ({ row }) => <Badge variant="outline">{scopeLabel(row.original, branches)}</Badge>,
    }),
    col.accessor('channel', {
      header: 'Channel',
      cell: (info) => <span className="text-sm">{CHANNEL_LABEL[info.getValue()]}</span>,
    }),
    col.accessor('active', {
      header: 'Active',
      cell: ({ row }) => (
        <Switch checked={row.original.active} onCheckedChange={(v) => handleToggleActive(row.original, v)} />
      ),
    }),
    col.display({
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-0.5 justify-end">
          <Button variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => setEditing(row.original)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Remove" onClick={() => handleDelete(row.original)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    }),
    // handleToggleActive/handleDelete close over `token`, which is stable per session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [branches, token]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Notification Recipients</h2>
          <p className="text-sm text-muted-foreground">
            Who receives the 2:00 AM closing summary. Each branch number gets only that branch’s figures.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setShowLogs(true)}>
            <ScrollText className="h-4 w-4 mr-1" /> Delivery Log
          </Button>
          <Button variant="outline" onClick={handleSendNow} disabled={dispatching}>
            <Send className="h-4 w-4 mr-1" /> {dispatching ? 'Sending…' : 'Send Now'}
          </Button>
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4 mr-1" /> Add Recipient
          </Button>
        </div>
      </div>

      {provider && !provider.live && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-amber-700 dark:text-amber-400">Test mode — messages are not being delivered</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            No messaging provider is configured, so summaries are written to the server log and recorded in the
            delivery log, but nothing reaches a real phone. Set <code className="font-mono text-xs">TWILIO_ACCOUNT_SID</code>,{' '}
            <code className="font-mono text-xs">TWILIO_AUTH_TOKEN</code> and a sender
            (<code className="font-mono text-xs">TWILIO_SMS_FROM</code> / <code className="font-mono text-xs">TWILIO_WHATSAPP_FROM</code>)
            in the server environment to go live. Retries: {provider.retry.maxAttempts} attempts.
          </CardContent>
        </Card>
      )}

      <DataTable columns={columns} data={recipients} loading={loading} searchPlaceholder="Search recipients…" />

      {(creating || editing) && (
        <RecipientDialog
          recipient={editing}
          branches={branches}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); reload(); }}
        />
      )}
      {showLogs && <LogsDialog onClose={() => setShowLogs(false)} />}
    </div>
  );
}

// --- Add / edit -------------------------------------------------------------
type ScopeKind = 'branch' | 'production' | 'admin';

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Normalize common Pakistani mobile formats to E.164 (+92…). This is a
 * Pakistan-only business, so a bare 03xx / 3xx number is assumed +92 — but the
 * dialog always SHOWS the resulting international number before saving, so it is
 * never the silent country-guess that closing-notifications.schemas.ts warns
 * against. Anything already starting with '+' is left untouched, so other-country
 * numbers still work when entered in full international form.
 */
function normalizeMobile(raw: string): string {
  const s = raw.replace(/[\s()\-.]/g, '');
  if (!s) return '';
  if (s.startsWith('+')) return s;
  if (s.startsWith('0092')) return '+92' + s.slice(4);
  if (s.startsWith('92') && s.length === 12) return '+' + s;
  if (s.startsWith('0') && s.length === 11) return '+92' + s.slice(1); // 0300xxxxxxx
  if (s.startsWith('3') && s.length === 10) return '+92' + s; // 300xxxxxxx
  return s; // unrecognized — leave as-is so validation prompts for + format
}

function RecipientDialog({ recipient, branches, onClose, onSaved }: {
  recipient: NotificationRecipient | null;
  branches: Branch[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { token } = useAuth();
  const isEdit = !!recipient;
  const [scope, setScope] = useState<ScopeKind>(
    recipient?.branchId ? 'branch' : ((recipient?.department as ScopeKind) ?? 'branch'),
  );
  const [branchId, setBranchId] = useState(recipient?.branchId ?? '');
  const [name, setName] = useState(recipient?.recipientName ?? '');
  const [mobile, setMobile] = useState(recipient?.mobileNumber ?? '');
  const [channel, setChannel] = useState<NotificationChannel>(recipient?.channel ?? 'whatsapp');
  const [active, setActive] = useState(recipient?.active ?? true);
  const [busy, setBusy] = useState(false);

  // Server requires E.164; normalize local PK numbers here so the user isn't
  // round-tripped for it, and validate/save the normalized value.
  const normalizedMobile = normalizeMobile(mobile);
  const mobileValid = E164.test(normalizedMobile);
  const willReformat = mobileValid && normalizedMobile !== mobile.trim();
  const valid = name.trim().length >= 2 && mobileValid && (scope !== 'branch' || !!branchId);

  async function save() {
    setBusy(true);
    try {
      if (isEdit) {
        await apiCall(`/api/closing-notifications/recipients/${recipient!.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ recipientName: name.trim(), mobileNumber: normalizedMobile, channel, active }),
        }, token);
        toast.success('Recipient updated');
      } else {
        await apiCall('/api/closing-notifications/recipients', {
          method: 'POST',
          body: JSON.stringify({
            branchId: scope === 'branch' ? branchId : null,
            department: scope === 'branch' ? null : scope,
            recipientName: name.trim(),
            mobileNumber: normalizedMobile,
            channel,
            active,
          }),
        }, token);
        toast.success('Recipient added');
      }
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit recipient' : 'Add recipient'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Update the number, channel, or status. Who they receive cannot be changed — remove and re-add instead.'
              : 'Choose whose summary this number receives. A branch recipient only ever gets that branch’s figures.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {!isEdit && (
            <>
              <div className="space-y-1">
                <Label>Receives</Label>
                <Select value={scope} onValueChange={(v) => setScope(v as ScopeKind)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="branch">A branch summary</SelectItem>
                    <SelectItem value="production">Production summary</SelectItem>
                    <SelectItem value="admin">Admin (all branches + production + company)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {scope === 'branch' && (
                <div className="space-y-1">
                  <Label>Branch</Label>
                  <Select value={branchId} onValueChange={(v) => setBranchId(v ?? '')}>
                    <SelectTrigger><SelectValue placeholder="Select a branch" /></SelectTrigger>
                    <SelectContent>
                      {branches.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </>
          )}

          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Ali Raza" />
          </div>

          <div className="space-y-1">
            <Label>Mobile number</Label>
            <Input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="03001234567 or +923001234567" />
            {willReformat ? (
              <p className="text-xs text-muted-foreground">Will be saved as <span className="font-mono">{normalizedMobile}</span></p>
            ) : mobile.trim() && !mobileValid ? (
              <p className="text-xs text-destructive">Enter a valid mobile number, e.g. 03001234567 or +923001234567</p>
            ) : null}
          </div>

          <div className="space-y-1">
            <Label>Channel</Label>
            <Select value={channel} onValueChange={(v) => setChannel(v as NotificationChannel)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
                <SelectItem value="both">WhatsApp + SMS</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label>Active</Label>
              <p className="text-xs text-muted-foreground">Inactive numbers are skipped at 2:00 AM</p>
            </div>
            <Switch checked={active} onCheckedChange={setActive} />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy || !valid}>{busy ? 'Saving…' : 'Save'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Delivery log -----------------------------------------------------------
type LogRow = NotificationLogRecord & { recipientName?: string | null; mobileNumber?: string | null };

function LogsDialog({ onClose }: { onClose: () => void }) {
  const { token } = useAuth();
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiCall<{ logs: LogRow[] }>('/api/closing-notifications/logs', {}, token)
      .then((r) => setLogs(r.logs ?? []))
      .catch((err) => toast.error(err instanceof Error ? err.message : 'Failed to load logs'))
      .finally(() => setLoading(false));
  }, [token]);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="md:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Delivery log</DialogTitle>
          <DialogDescription>Every closing-summary send attempt, newest first.</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
          ) : logs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Nothing sent yet.</p>
          ) : (
            <div className="space-y-2">
              {logs.map((l) => (
                <div key={l.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Badge variant={l.status === 'sent' ? 'secondary' : l.status === 'failed' ? 'destructive' : 'outline'}>
                        {l.status}
                      </Badge>
                      <span className="font-medium">{l.recipientName ?? 'Removed recipient'}</span>
                      <span className="text-xs text-muted-foreground font-mono">{l.mobileNumber ?? ''}</span>
                    </div>
                    <span className="text-xs text-muted-foreground">{l.businessDate} · {l.channel}</span>
                  </div>
                  {l.errorMessage && (
                    <p className="text-xs text-destructive mt-1">
                      {l.errorMessage}{l.retryCount > 0 ? ` (after ${l.retryCount} ${l.retryCount === 1 ? 'retry' : 'retries'})` : ''}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
