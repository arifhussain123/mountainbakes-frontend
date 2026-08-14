'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { DataTable } from '@/components/shared/DataTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Branch, FinanceSettings } from '@mb/shared';
import { CreateBranchSchema, resolveShareSplit, type CreateBranchInput } from '@mb/shared';
import { createColumnHelper } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Pencil, Trash2, Store } from 'lucide-react';

const col = createColumnHelper<Branch>();

/**
 * The company/branch split is edited here, per branch, as ONE number.
 *
 * Leaving the field blank stores `null`, which means "follow the global split in
 * Finance Settings" — not zero. That distinction is the whole point of the
 * column (see migration 68): a branch left on the default must move when the
 * default moves, a branch explicitly put on 70 must not. So the form has to be
 * able to express "empty", which is why the value is held as a string and only
 * converted at submit.
 *
 * Only the company half is ever typed. The branch share is 100 − company and is
 * shown read-only, for the same reason Finance Settings does it: two
 * independently-edited numbers is how a split stops summing to 100.
 */
const INHERIT = '';

export function BranchesPage() {
  const { token } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [editBranch, setEditBranch] = useState<Branch | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Held outside react-hook-form because the field's meaningful empty state is
  // `null` ("inherit"), and a number input registered with valueAsNumber turns
  // an empty box into NaN — which would fail the schema instead of clearing the
  // override. Converted once, at submit.
  const [sharePct, setSharePct] = useState<string>(INHERIT);
  const [financeSettings, setFinanceSettings] = useState<FinanceSettings | null>(null);

  const form = useForm<CreateBranchInput>({
    resolver: zodResolver(CreateBranchSchema),
    defaultValues: { name: '', location: '', phone: '', address: '', city: 'Karachi', dailyBudget: 0, weeklyBudget: 0, monthlyBudget: 0 },
  });

  const [refreshKey, setRefreshKey] = useState(0);
  function load() { setRefreshKey((k) => k + 1); }

  useEffect(() => {
    if (!token) return;
    apiCall<{ branches: Branch[] }>('/api/branches', {}, token)
      .then((r) => setBranches(r.branches))
      .finally(() => setLoading(false));
  }, [token, refreshKey]);

  // The global split, so the form can name the percentage a blank field will
  // inherit. Best-effort: an admin whose finance access is off still gets a
  // working branch form, just without the "inherits 75%" hint.
  useEffect(() => {
    if (!token) return;
    apiCall<{ settings: FinanceSettings }>('/api/finance/settings', {}, token)
      .then((r) => setFinanceSettings(r.settings))
      .catch(() => setFinanceSettings(null));
  }, [token]);

  const defaultCompanyPct = financeSettings?.companySharePct ?? 75;
  // Live preview of what the open form would store. A blank (or unparseable)
  // box resolves to the global split, which is exactly what submitting it does.
  const formSplit = resolveShareSplit(
    sharePct.trim() === INHERIT ? null : Number(sharePct),
    defaultCompanyPct,
  );

  async function onSubmit(data: CreateBranchInput) {
    const trimmed = sharePct.trim();
    if (trimmed !== INHERIT) {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        toast.error('Company share must be a number between 0 and 100, or blank to use the global split');
        return;
      }
    }
    // null, not undefined: an explicit null is what CLEARS an existing override
    // on the server (apiToRow drops undefined and preserves null).
    const payload = { ...data, companySharePct: trimmed === INHERIT ? null : Number(trimmed) };

    setSubmitting(true);
    try {
      if (editBranch) {
        await apiCall(`/api/branches/${editBranch.id}`, { method: 'PUT', body: JSON.stringify(payload) }, token);
        toast.success('Branch updated');
      } else {
        await apiCall('/api/branches', { method: 'POST', body: JSON.stringify(payload) }, token);
        toast.success('Branch added');
      }
      setShowForm(false);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSubmitting(false); }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Deactivate "${name}"?`)) return;
    try {
      await apiCall(`/api/branches/${id}`, { method: 'DELETE' }, token);
      toast.success(`${name} deactivated`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to deactivate branch');
    }
  }

  const columns = [
    col.display({
      id: 'icon',
      header: '',
      // Decoration that earns its place only in a wide row — a card already has
      // the branch name as its heading.
      meta: { mobile: 'hidden' },
      cell: () => (
        <div className="w-9 h-9 rounded-lg bg-secondary/10 flex items-center justify-center">
          <Store className="h-4 w-4 text-secondary" />
        </div>
      ),
    }),
    col.accessor('name', { header: 'Branch Name', meta: { mobile: 'title' }, cell: (info) => <span className="font-semibold">{info.getValue()}</span> }),
    col.accessor('location', { header: 'Location', meta: { mobile: 'subtitle' } }),
    col.accessor('managerName', { header: 'Manager', cell: (info) => info.getValue() || <span className="text-muted-foreground">Unassigned</span> }),
    col.accessor('phone', { header: 'Phone' }),
    col.display({
      id: 'share',
      header: 'Company / Branch',
      cell: ({ row }) => {
        const split = resolveShareSplit(row.original.companySharePct, defaultCompanyPct);
        return (
          <div className="whitespace-nowrap">
            <span className="font-medium">{split.companySharePct}%</span>
            <span className="text-muted-foreground"> / {split.branchSharePct}%</span>
            {/* The badge is the point of the column: it separates "on its own
                terms" from "happens to match today's default", which is the
                distinction that decides whether this branch moves when the
                global split is changed. */}
            {!split.isOverride && (
              <Badge variant="secondary" className="ml-2 text-[10px]">Default</Badge>
            )}
          </div>
        );
      },
    }),
    col.accessor('isActive', {
      header: 'Status',
      meta: { mobile: 'badge' },
      cell: (info) => <Badge variant={info.getValue() ? 'default' : 'secondary'}>{info.getValue() ? 'Active' : 'Inactive'}</Badge>,
    }),
    col.display({
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => {
            setEditBranch(row.original);
            form.reset({
              name: row.original.name, location: row.original.location, phone: row.original.phone,
              address: row.original.address, city: row.original.city,
              dailyBudget: row.original.dailyBudget ?? 0, weeklyBudget: row.original.weeklyBudget ?? 0, monthlyBudget: row.original.monthlyBudget ?? 0,
            });
            setSharePct(row.original.companySharePct == null ? INHERIT : String(row.original.companySharePct));
            setShowForm(true);
          }}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(row.original.id, row.original.name)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    }),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Branches</h2>
          <p className="text-sm text-muted-foreground">{branches.length} branches</p>
        </div>
        <Button onClick={() => { setEditBranch(null); form.reset(); setSharePct(INHERIT); setShowForm(true); }}>+ Add Branch</Button>
      </div>

      <DataTable columns={columns} data={branches} loading={loading} searchPlaceholder="Search branchesâ€¦" />

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="md:max-w-md">
          <DialogHeader><DialogTitle>{editBranch ? 'Edit Branch' : 'Add Branch'}</DialogTitle></DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {(['name', 'location', 'phone', 'address', 'city'] as const).map((field) => (
              <div key={field} className="space-y-1">
                <Label className="capitalize">{field}</Label>
                <Input {...form.register(field)} placeholder={field === 'name' ? 'Mountain Bakes DHA' : ''} />
                {form.formState.errors[field] && <p className="text-xs text-destructive">{form.formState.errors[field]?.message}</p>}
              </div>
            ))}
            <div className="grid grid-cols-3 gap-2">
              {([
                ['dailyBudget', 'Daily Budget'],
                ['weeklyBudget', 'Weekly Budget'],
                ['monthlyBudget', 'Monthly Budget'],
              ] as const).map(([field, label]) => (
                <div key={field} className="space-y-1">
                  <Label className="text-xs">{label}</Label>
                  <Input type="number" min={0} placeholder="0" {...form.register(field, { setValueAs: (v) => v === '' || v == null ? 0 : Number(v) })} />
                </div>
              ))}
            </div>

            {/* ── Income share ── */}
            <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
              <div>
                <Label className="text-sm">Company share</Label>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  How this branch&apos;s daily collection is split when Finance approves it. Leave blank to follow the
                  global split in Finance Settings.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Company %</Label>
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    inputMode="decimal"
                    placeholder={`${defaultCompanyPct} (default)`}
                    value={sharePct}
                    onChange={(e) => setSharePct(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Branch %</Label>
                  {/* Derived, never typed — always 100 minus the company share. */}
                  <Input value={formSplit.branchSharePct} readOnly disabled />
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                {formSplit.isOverride ? (
                  <>
                    This branch keeps <span className="font-medium text-foreground">{formSplit.branchSharePct}%</span>{' '}
                    and the company takes{' '}
                    <span className="font-medium text-foreground">{formSplit.companySharePct}%</span>. Already-approved
                    days keep the split they were approved under.
                  </>
                ) : (
                  <>
                    Following the global split —{' '}
                    <span className="font-medium text-foreground">
                      {formSplit.companySharePct}% company / {formSplit.branchSharePct}% branch
                    </span>
                    . This branch will move if that setting changes.
                  </>
                )}
              </p>
            </div>

            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Savingâ€¦' : editBranch ? 'Update Branch' : 'Add Branch'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
