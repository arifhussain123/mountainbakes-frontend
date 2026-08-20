'use client';

import { useState } from 'react';
import type { StockRow } from '@mb/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertTriangle } from 'lucide-react';

/**
 * Admin → Branch Stock → Delete.
 *
 * "Delete this product's stock" means two genuinely different things, and the
 * difference is not recoverable once chosen, so this dialog makes the admin pick
 * rather than guessing for them:
 *
 * - **Set to zero** — an ordinary correction. The balance goes to 0 and the
 *   ledger keeps every movement that took it there, so the day still reconciles,
 *   past reports still read the same, and typing the old number back in undoes
 *   it. This is what "delete" means almost every time.
 *
 * - **Delete permanently** — removes the `stock` row and EVERY `stock_history`
 *   row for this product in this branch. Opening balances are derived from that
 *   history, so this restates every past day for the product; a daily-closing
 *   snapshot taken earlier keeps the old figures and will now disagree with
 *   anything recomputed. Orders are untouched — a sale still exists, only its
 *   effect on stock is gone. It exists for a product mis-seeded into the wrong
 *   branch that should be genuinely absent rather than sitting at zero forever.
 *
 * The permanent option is gated on typing the product name, the same way the rest
 * of the app gates a destructive confirm — a mis-click cannot reach it.
 */
export function DeleteBranchStockDialog({
  row,
  branchName,
  pending,
  onOpenChange,
  onConfirm,
}: {
  row: StockRow | null;
  branchName: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (mode: 'zero' | 'purge') => void;
}) {
  const [confirmText, setConfirmText] = useState('');

  // Clear the typed confirmation whenever the dialog opens on a different row —
  // otherwise a name typed for one product would still unlock the next.
  const [lastId, setLastId] = useState<string | null>(null);
  if (row?.productId !== lastId) {
    setLastId(row?.productId ?? null);
    setConfirmText('');
  }

  const canPurge = !!row && confirmText.trim().toLowerCase() === row.productName.trim().toLowerCase();

  return (
    <Dialog open={!!row} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>Delete stock — {row?.productName ?? ''}</DialogTitle>
        </DialogHeader>

        {row && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {row.productName} currently has a balance of{' '}
              <span className="font-semibold tabular-nums text-foreground">{row.balance}</span> at{' '}
              {branchName || 'this branch'}.
            </p>

            <div className="space-y-2 rounded-lg border p-3">
              <p className="font-medium">Set to zero</p>
              <p className="text-sm text-muted-foreground">
                Corrects the balance to 0 and keeps the movement history. Reversible — type the old
                figure back in to undo it.
              </p>
              <Button onClick={() => onConfirm('zero')} disabled={pending}>
                {pending ? 'Working…' : 'Set to zero'}
              </Button>
            </div>

            <div className="space-y-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
              <p className="flex items-center gap-1.5 font-medium text-destructive">
                <AlertTriangle className="h-4 w-4" /> Delete permanently
              </p>
              <p className="text-sm text-muted-foreground">
                Deletes the stock row and every movement ever recorded for this product at this
                branch. This cannot be undone, and past figures derived from those movements —
                opening balances, closing snapshots, reports — will change. Sales themselves are
                not deleted.
              </p>
              <div className="space-y-1">
                <Label htmlFor="purge-confirm">
                  Type <span className="font-semibold">{row.productName}</span> to confirm
                </Label>
                <Input
                  id="purge-confirm"
                  value={confirmText}
                  onChange={(e) => setConfirmText(e.target.value)}
                  placeholder={row.productName}
                  autoComplete="off"
                />
              </div>
              <Button variant="destructive" onClick={() => onConfirm('purge')} disabled={!canPurge || pending}>
                {pending ? 'Working…' : 'Delete permanently'}
              </Button>
            </div>
          </div>
        )}

        <div className="flex justify-end pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
