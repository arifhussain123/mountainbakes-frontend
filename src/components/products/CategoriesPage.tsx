'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { useCategories } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Pencil, Trash2, Plus } from 'lucide-react';

export function CategoriesPage() {
  const { token } = useAuth();
  const qc = useQueryClient();
  const [newName, setNewName] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const categoriesQ = useCategories(token);
  const categories = categoriesQ.data ?? [];
  const loading = categoriesQ.isLoading;

  /** Shared cache invalidation — every consumer of the categories query refreshes. */
  function load() { qc.invalidateQueries({ queryKey: ['categories'] }); }

  async function handleAdd() {
    if (!newName.trim()) return;
    setSubmitting(true);
    try {
      await apiCall('/api/products/categories', { method: 'POST', body: JSON.stringify({ name: newName }) }, token);
      setNewName('');
      toast.success('Category added');
      load();
    } catch { toast.error('Failed to add category'); }
    finally { setSubmitting(false); }
  }

  async function handleUpdate(id: string) {
    setSubmitting(true);
    try {
      await apiCall(`/api/products/categories/${id}`, { method: 'PUT', body: JSON.stringify({ name: editName }) }, token);
      setEditId(null);
      toast.success('Category updated');
      load();
    } catch { toast.error('Failed to update'); }
    finally { setSubmitting(false); }
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Remove "${name}"?`)) return;
    try {
      await apiCall(`/api/products/categories/${id}`, { method: 'DELETE' }, token);
      toast.success(`${name} removed`);
      load();
    } catch { toast.error('Delete failed'); }
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h2 className="text-lg font-semibold">Categories</h2>
        <p className="text-sm text-muted-foreground">Manage product categories</p>
      </div>

      {/* Add new */}
      <div className="flex gap-2">
        <Input
          placeholder="New category nameâ€¦"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <Button onClick={handleAdd} disabled={submitting || !newName.trim()}>
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
      </div>

      {/* List */}
      <div className="space-y-2">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />
          ))
        ) : (
          categories.map((cat) => (
            <Card key={cat.id}>
              <CardContent className="p-3 flex items-center justify-between">
                {editId === cat.id ? (
                  <div className="flex items-center gap-2 flex-1">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-8"
                      autoFocus
                    />
                    <Button size="sm" onClick={() => handleUpdate(cat.id)} disabled={submitting}>Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditId(null)}>Cancel</Button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3">
                      <span className="font-medium">{cat.name}</span>
                      <Badge variant={cat.isActive ? 'default' : 'secondary'} className="text-xs">
                        {cat.isActive ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => { setEditId(cat.id); setEditName(cat.name); }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        onClick={() => handleDelete(cat.id, cat.name)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
