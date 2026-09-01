'use client';

import { useState } from 'react';
import type { LoginSession } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { useRevokeSession, useRevokeAllSessions } from '@/lib/queries';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { ShieldOff } from 'lucide-react';
import { formatDevice, formatLocation } from './sessionFormat';

/**
 * Confirming that somebody else is about to be signed out.
 *
 * ONE COMPONENT FOR BOTH ACTIONS — one session, or every session for an account
 * — because they are the same decision with a different blast radius, and
 * splitting them into two dialogs would mean two copies of the reason field, two
 * copies of the result message and two chances for the wording to drift.
 *
 * WHAT IT NAMES BEFORE ASKING. The staff code, the device and the location, and
 * for the account-wide form the number of sessions. A confirmation that says
 * only "are you sure?" is a confirmation nobody reads; naming the thing is what
 * makes the difference between ending the right session and ending the one
 * above it in a list that refreshed a moment ago.
 *
 * MOUNTED ONLY WHILE OPEN, and keyed on the session it is for. That is what
 * resets the reason field — there is no effect clearing it, because unmounting
 * does the job and a dialog reopened for a DIFFERENT session must never arrive
 * carrying the previous one's reason into that session's audit row.
 *
 * WHAT IT PROMISES IS DELIBERATELY HEDGED. Revocation deletes the authentication
 * session — the refresh token dies immediately — but a Supabase access token is
 * stateless and cannot be withdrawn once issued. The ping that every open tab
 * sends closes that gap within about two minutes. The dialog says so rather than
 * claiming an instant cut-off it cannot deliver, because an admin acting on a
 * suspected compromise needs to know whether to also change the password.
 */
export function RevokeSessionDialog({
  session,
  mode,
  onClose,
}: {
  /** The session being ended, or — in 'all' mode — one belonging to the account. */
  session: LoginSession | null;
  mode: 'one' | 'all';
  onClose: () => void;
}) {
  const { token, user } = useAuth();
  const revokeOne = useRevokeSession(token);
  const revokeAll = useRevokeAllSessions(token);
  const [reason, setReason] = useState('');

  const pending = revokeOne.isPending || revokeAll.isPending;

  if (!session) return null;

  const who = session.userCode ?? session.userName;
  // Clearing your OWN account. The server keeps the acting session either way —
  // that protection is not this component's to grant — but the sentence below
  // has to match what will actually happen, or an admin declines a safe action.
  const own = session.userId != null && session.userId === user?.uid;

  async function submit() {
    if (!session) return;
    const trimmed = reason.trim();
    try {
      const result =
        mode === 'all'
          ? await revokeAll.mutateAsync({
              userId: session.userId!,
              ...(trimmed ? { reason: trimmed } : {}),
            })
          : await revokeOne.mutateAsync({
              sessionId: session.id,
              ...(trimmed ? { reason: trimmed } : {}),
            });

      // The two counts are reported separately, not summed. "3 signed out" and
      // "our record of 3 closed, but 1 authentication session had already
      // lapsed" are different facts, and an admin chasing a compromise is
      // entitled to the second one.
      toast.success(
        `${result.revoked} session${result.revoked === 1 ? '' : 's'} signed out`,
        {
          description:
            result.authSessionsEnded > 0
              ? `${result.authSessionsEnded} authentication session${result.authSessionsEnded === 1 ? '' : 's'} ended. Any open tab signs out within about two minutes.`
              : 'The authentication sessions had already lapsed. Any open tab signs out within about two minutes.',
        },
      );
      onClose();
    } catch (err) {
      toast.error((err as Error).message || 'Could not sign that session out');
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && onClose()}>
      <DialogContent className="md:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === 'all' ? 'Sign out all other sessions?' : 'Sign out this session?'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-lg border bg-muted/30 p-3 text-sm">
            <dt className="text-muted-foreground">Mountain Bakes ID</dt>
            <dd className="text-right font-mono">{who}</dd>
            <dt className="text-muted-foreground">Name</dt>
            <dd className="truncate text-right">{session.userName}</dd>
            {mode === 'one' && (
              <>
                <dt className="text-muted-foreground">Device</dt>
                <dd className="text-right">{formatDevice(session)}</dd>
                <dt className="text-muted-foreground">Location</dt>
                <dd className="text-right">{formatLocation(session)}</dd>
              </>
            )}
          </dl>

          <p className="text-sm text-muted-foreground">
            {mode === 'all'
              ? own
                ? 'Every other session on your account will be signed out, including devices that never appeared in this list. The browser you are using now is kept.'
                : 'Every session for this account will be signed out, including devices that never appeared in this list.'
              : 'This browser will be signed out. Other devices signed in as this account are not affected.'}{' '}
            An open tab stops working within about two minutes; the sign-in itself is
            already dead.
          </p>

          <div className="space-y-1.5">
            <Label htmlFor="revoke-reason">Reason (optional)</Label>
            <Textarea
              id="revoke-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              rows={2}
              placeholder="Recorded in the audit log — e.g. 'device reported lost'"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button variant="destructive" onClick={submit} disabled={pending}>
            <ShieldOff className="mr-1.5 h-4 w-4" />
            {pending ? 'Signing out…' : mode === 'all' ? 'Sign out all' : 'Sign out'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
