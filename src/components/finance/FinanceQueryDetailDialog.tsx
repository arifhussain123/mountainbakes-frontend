'use client';

import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import type { FinanceQuery } from '@mb/shared';
import { Pencil, Trash2 } from 'lucide-react';

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

/**
 * "Show Detail" (chagneQuery.md §1/§2) — the complete finance query, read
 * only. Edit/Delete Query are offered here only to Admin, mirroring the
 * table's own row actions.
 */
export function FinanceQueryDetailDialog({
  query,
  open,
  onOpenChange,
  isAdmin,
  onEdit,
  onDelete,
}: {
  query: FinanceQuery | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isAdmin: boolean;
  onEdit: (query: FinanceQuery) => void;
  onDelete: (query: FinanceQuery) => void;
}) {
  if (!query) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>{query.queryNo}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Date" value={query.date} />
          <Field label="Title" value={query.title} />
          <Field label="Amount" value={query.amount.toLocaleString()} />
          <Field label="Category" value={query.category} />
          <Field label="Branch" value={query.branchName} />
          <Field label="Type" value={query.type === 'income' ? 'Income' : 'Expense'} />
        </div>

        <div>
          <p className="text-xs text-muted-foreground">Comment</p>
          <p className="text-sm">{query.comment || '—'}</p>
        </div>

        <div className="grid grid-cols-2 gap-4 border-t pt-3 text-xs text-muted-foreground">
          <p>
            Created {new Date(query.createdAt).toLocaleString()}
            {query.createdByName ? ` by ${query.createdByName}` : ''}
          </p>
          <p>
            Updated {new Date(query.updatedAt).toLocaleString()}
            {query.updatedByName ? ` by ${query.updatedByName}` : ''}
          </p>
        </div>

        {isAdmin && (
          <DialogFooter className="gap-2 sm:justify-between">
            <Button variant="destructive" onClick={() => onDelete(query)}>
              <Trash2 className="h-4 w-4 mr-1" /> Delete Query
            </Button>
            <Button onClick={() => onEdit(query)}>
              <Pencil className="h-4 w-4 mr-1" /> Edit
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}
