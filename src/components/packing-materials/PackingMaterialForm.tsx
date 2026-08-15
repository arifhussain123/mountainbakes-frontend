'use client';

import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useCreatePackingMaterial, useUpdatePackingMaterial } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { PackingMaterial } from '@mb/shared';

/**
 * Create / edit a packing material.
 *
 * Note what is NOT here: price and cost. Packing materials are service items, not
 * saleable products — compare ProductForm, which requires both. Adding them here
 * would be the first step toward treating these as stock to sell.
 */
export function PackingMaterialForm({
  material,
  onSuccess,
}: {
  material: PackingMaterial | null;
  onSuccess: () => void;
}) {
  const { token } = useAuth();
  const createMut = useCreatePackingMaterial(token);
  const updateMut = useUpdatePackingMaterial(token);

  const [materialCode, setMaterialCode] = useState(material?.materialCode ?? '');
  const [materialName, setMaterialName] = useState(material?.materialName ?? '');
  const [category, setCategory] = useState(material?.category ?? '');
  const [description, setDescription] = useState(material?.description ?? '');

  const submitting = createMut.isPending || updateMut.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const code = materialCode.trim();
    const name = materialName.trim();
    if (code.length < 2 || name.length < 2) {
      toast.error('Code and name are both required');
      return;
    }

    try {
      if (material) {
        await updateMut.mutateAsync({
          id: material.id,
          input: { materialCode: code, materialName: name, category: category.trim(), description: description.trim() },
        });
        toast.success(`${name} updated`);
      } else {
        await createMut.mutateAsync({
          materialCode: code,
          materialName: name,
          category: category.trim(),
          description: description.trim(),
        });
        toast.success(`${name} added`);
      }
      onSuccess();
    } catch (err) {
      // The API returns 409 with a readable message when the code is taken.
      toast.error(err instanceof Error ? err.message : 'Could not save packing material');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="pm-code">Code</Label>
          <Input
            id="pm-code"
            value={materialCode}
            onChange={(e) => setMaterialCode(e.target.value)}
            placeholder="PACK-016"
            autoComplete="off"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pm-category">Category</Label>
          <Input
            id="pm-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            placeholder="Shoppers, Boxes, Consumables…"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="pm-name">Packing Material</Label>
        <Input
          id="pm-name"
          value={materialName}
          onChange={(e) => setMaterialName(e.target.value)}
          placeholder="1 Pound Cake Box"
          autoComplete="off"
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="pm-description">Description (optional)</Label>
        <Textarea
          id="pm-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Any notes…"
        />
      </div>

      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        {material ? 'Save Changes' : 'Add Packing Material'}
      </Button>
    </form>
  );
}
