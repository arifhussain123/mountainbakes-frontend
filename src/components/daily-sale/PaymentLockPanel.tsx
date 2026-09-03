'use client';

import { useState } from 'react';
import { Lock, LockOpen } from 'lucide-react';
import { toast } from 'sonner';
import {
  DAILY_SALE_MANUAL_METHODS,
  type PaymentMethodLock,
} from '@mb/shared';
import { useSetPaymentMethodLock } from '@/lib/queries';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { PAYMENT_METHOD_LABELS } from '@/utils/constants';
import { karachiDateStr, karachiTimeStr } from '@mb/shared';

/**
 * Admin control over which payment methods a branch may key by hand (§10–§12).
 *
 * ─── All four methods are listed, including Foodpanda ────────────────────────
 * Foodpanda has no field on the Manual Feed form, so unlocking it changes nothing
 * a branch can see today. It is still here, and that is §12's point: the
 * configuration must be able to SAY something about every method rather than have
 * one of them hardcoded shut. If Foodpanda ever starts being handed over in cash
 * at the counter, this is the switch, not a code change.
 *
 * ─── "Default" is shown as a distinct state ──────────────────────────────────
 * A branch nobody has configured reads "on the default" rather than "unlocked" —
 * a different fact, and the difference is what makes the first configuration of a
 * branch legible in the history afterwards. The default itself is derived from
 * one rule (a method somebody physically handles is open) and is spelled out
 * under the list rather than left for someone to infer from the switches.
 *
 * Every change is written to the audit trail with the reason, and a change that
 * matches the stored state writes nothing — pressing Save on an unchanged panel
 * must not leave a history entry claiming a change that did not happen.
 */
export function PaymentLockPanel({
  open,
  onOpenChange,
  branchId,
  branchName,
  locks,
  token,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  branchId: string | null;
  branchName: string | null;
  locks: PaymentMethodLock[];
  token: string;
}) {
  const setLock = useSetPaymentMethodLock(token);
  const [reason, setReason] = useState('');

  async function toggle(lock: PaymentMethodLock, nextLocked: boolean) {
    if (!branchId) return;
    try {
      await setLock.mutateAsync({
        branchId,
        paymentMethod: lock.paymentMethod as 'cash' | 'easypaisa' | 'foodpanda' | 'bank_account',
        isLocked: nextLocked,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      toast.success(
        `${PAYMENT_METHOD_LABELS[lock.paymentMethod] ?? lock.paymentMethod} ${nextLocked ? 'locked' : 'unlocked'}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change the lock');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>Manual Entry Locks</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {!branchId ? (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              Pick a single branch first. A lock governs one shop&apos;s till, so there is no
              configuration to show for &ldquo;all branches&rdquo;.
            </p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {branchName} — which payment methods this branch may enter a counted amount for.
              </p>

              {/* Above the switches, because it is the note that goes WITH the
                  change: each toggle saves immediately, so a reason typed
                  afterwards would attach to nothing. */}
              <div className="space-y-1">
                <Label className="text-xs">Reason (optional, recorded with the change)</Label>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Physical cash verification required"
                />
              </div>

              <div className="divide-y rounded-lg border">
                {locks.map((lock) => (
                  <div key={lock.paymentMethod} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-medium">
                        {lock.isLocked ? (
                          <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <LockOpen className="h-3.5 w-3.5 text-emerald-600" />
                        )}
                        {PAYMENT_METHOD_LABELS[lock.paymentMethod] ?? lock.paymentMethod}
                        {!(DAILY_SALE_MANUAL_METHODS as readonly string[]).includes(lock.paymentMethod) && (
                          <span className="text-xs font-normal text-muted-foreground">
                            · not counted at the shop
                          </span>
                        )}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {lock.source === 'default'
                          ? 'On the default — nobody has configured this branch'
                          : `Set by ${lock.updatedByName || 'an admin'}${
                              lock.updatedAt ? ` · ${stamp(lock.updatedAt)}` : ''
                            }`}
                        {lock.reason ? ` · ${lock.reason}` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs text-muted-foreground">
                        {lock.isLocked ? 'Locked' : 'Unlocked'}
                      </span>
                      {/* Checked = UNLOCKED. The switch reads as "may this branch
                          enter a figure?", which is the question an admin is
                          answering; a switch labelled Locked that has to be OFF
                          to permit something inverts every glance at the panel. */}
                      <Switch
                        checked={!lock.isLocked}
                        disabled={setLock.isPending}
                        onCheckedChange={(next) => toggle(lock, !next)}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-xs text-muted-foreground">
                Locking is enforced by the server, not by this screen: a locked method is
                refused inside the same transaction that would have written the figure. An
                admin can still enter one, and it is recorded as an override.
              </p>
            </>
          )}

          <Button variant="outline" className="w-full" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${karachiDateStr(d)} ${karachiTimeStr(d)}`;
}
