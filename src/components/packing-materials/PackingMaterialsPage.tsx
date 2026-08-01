'use client';

import { useEffect, useState } from 'react';
import { createColumnHelper } from '@tanstack/react-table';
import { useAuth } from '@/hooks/useAuth';
import { usePackingMaterials, useUpdatePackingMaterial, useDeletePackingMaterial } from '@/lib/queries';
import { DataTable } from '@/components/shared/DataTable';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PackingMaterialForm } from './PackingMaterialForm';
import { karachiDateStr } from '@mb/shared';
import type { PackingMaterial } from '@mb/shared';
import { toast } from 'sonner';
import { Eye, Pencil, Power, Trash2 } from 'lucide-react';

const col = createColumnHelper<PackingMaterial>();

/**
 * Admin catalogue for packing materials.
 *
 * Deliberately has NO Price and NO Cost column — these are company service items
 * supplied with a demand, never sold. See migration 38.
 *
 * Disable and Delete are genuinely different here, unlike products (whose "delete"
 * is a soft deactivate): Disable hides a material from new demands while keeping it
 * in the catalogue; Delete removes it outright, which is safe because every packing
 * line snapshots the name and the FK is `on delete set null`, so historical demands
 * and printed slips are unaffected.
 */
export function PackingMaterialsPage() {
  const { token } = useAuth();
  // includeInactive: this is the admin view, so disabled materials must be visible
  // and re-enableable.
  const materialsQ = usePackingMaterials(token, { includeInactive: true });
  const updateMut = useUpdatePackingMaterial(token);
  const deleteMut = useDeletePackingMaterial(token);

  const [editMaterial, setEditMaterial] = useState<PackingMaterial | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [viewMaterial, setViewMaterial] = useState<PackingMaterial | null>(null);

  const materials = materialsQ.data ?? [];

  useEffect(() => {
    if (materialsQ.isError) toast.error('Failed to load packing materials');
  }, [materialsQ.isError]);

  async function toggleActive(m: PackingMaterial) {
    try {
      await updateMut.mutateAsync({ id: m.id, input: { isActive: !m.isActive } });
      toast.success(`${m.materialName} ${m.isActive ? 'disabled' : 'enabled'}`);
    } catch {
      toast.error(m.isActive ? 'Could not disable' : 'Could not enable');
    }
  }

  async function handleDelete(m: PackingMaterial) {
    if (!confirm(`Delete "${m.materialName}" from the catalogue? Past demands keep their record.`)) return;
    try {
      await deleteMut.mutateAsync(m.id);
      toast.success(`${m.materialName} deleted`);
    } catch {
      toast.error('Delete failed');
    }
  }

  const columns = [
    col.accessor('materialCode', {
      header: 'Code',
      meta: { mobile: 'subtitle' },
      cell: (i) => <span className="font-mono text-xs text-muted-foreground">{i.getValue()}</span>,
    }),
    col.accessor('materialName', {
      header: 'Packing Material',
      meta: { mobile: 'title' },
      cell: (i) => <span className="font-medium">{i.getValue()}</span>,
    }),
    col.accessor('category', {
      header: 'Category',
      cell: (i) => <span>{i.getValue() || <span className="text-muted-foreground">—</span>}</span>,
    }),
    col.accessor('isActive', {
      header: 'Status',
      meta: { mobile: 'badge' },
      cell: (i) => (
        <Badge variant={i.getValue() ? 'default' : 'secondary'}>{i.getValue() ? 'Active' : 'Inactive'}</Badge>
      ),
    }),
    col.accessor('createdAt', {
      header: 'Created Date',
      cell: (i) => (
        <span className="text-sm text-muted-foreground">
          {i.getValue() ? karachiDateStr(new Date(i.getValue())) : '—'}
        </span>
      ),
    }),
    col.display({
      id: 'actions',
      header: 'Actions',
      cell: ({ row }) => {
        const m = row.original;
        return (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" title="View" onClick={() => setViewMaterial(m)}>
              <Eye className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              title="Edit"
              onClick={() => { setEditMaterial(m); setShowForm(true); }}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={m.isActive ? 'h-8 w-8' : 'h-8 w-8 text-emerald-600 hover:text-emerald-600'}
              title={m.isActive ? 'Disable' : 'Enable'}
              onClick={() => toggleActive(m)}
            >
              <Power className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
              title="Delete"
              onClick={() => handleDelete(m)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      },
    }),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Packing Materials</h2>
          <p className="text-sm text-muted-foreground">
            {materials.length} item{materials.length === 1 ? '' : 's'} · supplied with branch demands, not sold
          </p>
        </div>
        <Button onClick={() => { setEditMaterial(null); setShowForm(true); }}>+ Add Packing Material</Button>
      </div>

      <DataTable
        columns={columns}
        data={materials}
        loading={materialsQ.isLoading}
        searchPlaceholder="Search packing materials, code…"
      />

      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="md:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editMaterial ? 'Edit Packing Material' : 'Add Packing Material'}</DialogTitle>
          </DialogHeader>
          <PackingMaterialForm material={editMaterial} onSuccess={() => setShowForm(false)} />
        </DialogContent>
      </Dialog>

      <Dialog open={!!viewMaterial} onOpenChange={(o) => !o && setViewMaterial(null)}>
        <DialogContent className="md:max-w-md">
          <DialogHeader>
            <DialogTitle>{viewMaterial?.materialName}</DialogTitle>
          </DialogHeader>
          {viewMaterial && (
            <dl className="divide-y rounded-lg border text-sm">
              <div className="flex justify-between px-3 py-2">
                <dt className="text-muted-foreground">Code</dt>
                <dd className="font-mono">{viewMaterial.materialCode}</dd>
              </div>
              <div className="flex justify-between px-3 py-2">
                <dt className="text-muted-foreground">Category</dt>
                <dd>{viewMaterial.category || '—'}</dd>
              </div>
              <div className="flex justify-between px-3 py-2">
                <dt className="text-muted-foreground">Status</dt>
                <dd>{viewMaterial.isActive ? 'Active' : 'Inactive'}</dd>
              </div>
              <div className="flex justify-between px-3 py-2">
                <dt className="text-muted-foreground">Created</dt>
                <dd>{viewMaterial.createdAt ? karachiDateStr(new Date(viewMaterial.createdAt)) : '—'}</dd>
              </div>
              {viewMaterial.description && (
                <div className="px-3 py-2">
                  <dt className="text-muted-foreground">Description</dt>
                  <dd className="mt-1 whitespace-pre-wrap break-words">{viewMaterial.description}</dd>
                </div>
              )}
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
