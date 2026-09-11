'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { DailySaleRecord } from '@mb/shared';
import { useDecideDailySale } from '@/lib/queries';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

/**
 * Unlock a closed record (§11).
 *
 * A dialog rather than a plain button because the REASON is mandatory, and it is
 * mandatory because it is the entire audit value of an unlock: "Admin unlocked
 * this record" answers nothing six weeks later, while "physical cash
 * verification required" does. It is enforced in three places — this form, the
 * Zod schema, and `decide_daily_sale_record` — and only the last of those is a
 * boundary.
 *
 * Unlocking clears the verification stamp. A record that has gone back to being
 * counted must not carry a sign-off from somebody who signed off different
 * numbers, and the branch is told that here rather than discovering it after.
 */
export function UnlockDialog({
  open,
  onOpenChange,
  record,
  token,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  record: DailySaleRecord | null;
  token: string;
}) {
  const decide = useDecideDailySale(token);
  const [reason, setReason] = useState('');

  async function submit() {
    if (!record?.id) return;
    if (reason.trim().length < 3) {
      toast.error('Say why this record is being unlocked');
      return;
    }
    try {
      await decide.mutateAsync({ id: record.id, action: 'unlock', reason: reason.trim() });
      toast.success('Record unlocked — the branch can enter figures again');
      setReason('');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not unlock the record');
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!decide.isPending) onOpenChange(o);
      }}
    >
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>Unlock Daily Sale Record</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {record && (
            <div className="rounded-lg border bg-muted/40 p-3 text-sm">
              <p className="font-medium">{record.branchName}</p>
              <p className="text-muted-foreground">Business date {record.businessDate}</p>
            </div>
          )}

          <div className="space-y-1">
            <Label>Reason</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Physical cash verification required"
            />
            <p className="text-xs text-muted-foreground">
              The record goes back to Pending Verification and the existing sign-off is
              cleared. This is recorded in the history with your name.
            </p>
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={decide.isPending}
            >
              Cancel
            </Button>
            <Button className="flex-1" onClick={submit} disabled={decide.isPending}>
              {decide.isPending ? 'Unlocking…' : 'Unlock'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
