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
import type { Branch } from '@mb/shared';
import { CreateBranchSchema, type CreateBranchInput } from '@mb/shared';
import { createColumnHelper } from '@tanstack/react-table';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Pencil, Trash2, Store } from 'lucide-react';

const col = createColumnHelper<Branch>();

export function BranchesPage() {
  const { token } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [editBranch, setEditBranch] = useState<Branch | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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

  async function onSubmit(data: CreateBranchInput) {
    setSubmitting(true);
    try {
      if (editBranch) {
        await apiCall(`/api/branches/${editBranch.id}`, { method: 'PUT', body: JSON.stringify(data) }, token);
        toast.success('Branch updated');
      } else {
        await apiCall('/api/branches', { method: 'POST', body: JSON.stringify(data) }, token);
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
      cell: () => (
        <div className="w-9 h-9 rounded-lg bg-secondary/10 flex items-center justify-center">
          <Store className="h-4 w-4 text-secondary" />
        </div>
      ),
    }),
    col.accessor('name', { header: 'Branch Name', cell: (info) => <span className="font-semibold">{info.getValue()}</span> }),
    col.accessor('location', { header: 'Location' }),
    col.accessor('managerName', { header: 'Manager', cell: (info) => info.getValue() || <span className="text-muted-foreground">Unassigned</span> }),
    col.accessor('phone', { header: 'Phone' }),
    col.accessor('isActive', {
      header: 'Status',
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
        <Button onClick={() => { setEditBranch(null); form.reset(); setShowForm(true); }}>+ Add Branch</Button>
      </div>

      <DataTable columns={columns} data={branches} loading={loading} searchPlaceholder="Search branchesâ€¦" />

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
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
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Savingâ€¦' : editBranch ? 'Update Branch' : 'Add Branch'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
