'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { apiCall } from '@/utils/api';
import { resetErrorMessage } from '@/utils/authErrors';
import type { User } from '@mb/shared';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Copy, Check, Loader2 } from 'lucide-react';

function ToggleRow({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-0.5">
        <Label className="text-sm">{label}</Label>
        <p className="text-xs text-muted-foreground">{desc}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

export function ResetPasswordDialog({
  user,
  open,
  onOpenChange,
  token,
  onDone,
}: {
  user: User | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  onDone: () => void;
}) {
  const [generateTemp, setGenerateTemp] = useState(true);
  const [sendEmail, setSendEmail] = useState(false);
  const [forceChange, setForceChange] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // The parent remounts this dialog (via key) each time it opens, so these
  // defaults act as a fresh reset without a state-syncing effect.
  if (!user) return null;

  async function handleSave() {
    if (!user) return;
    if (!generateTemp && !sendEmail) {
      toast.error('Choose a temporary password or a reset email.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiCall<{ tempPassword: string | null; email: string | null }>(
        `/api/users/${user.id}/reset-password`,
        { method: 'POST', body: JSON.stringify({ generateTemp, sendEmail, forceChange }) },
        token
      );
      // Admin is authenticated → trigger Supabase's reset email for the target.
      //
      // resetPasswordForEmail RETURNS { error }, it does not throw — the old
      // try/catch here only ever caught a network failure, so a rejected send
      // (unreachable domain, rate limit) was swallowed and the admin still saw
      // "Password reset". Check the returned error and say so instead.
      let emailError: string | null = null;
      if (res.email) {
        const { error: sendError } = await supabase.auth.resetPasswordForEmail(res.email, {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (sendError) {
          console.error('Reset email failed', sendError);
          emailError = resetErrorMessage(sendError, 'The reset email could not be sent.');
        }
      }

      // The password change itself already succeeded server-side, so this is a
      // warning rather than an error — and it matters most when no temporary
      // password was generated, since then the email was the only way in.
      if (emailError) {
        toast.warning(`Password reset, but no email was sent. ${emailError}`, { duration: 10000 });
      } else {
        toast.success('Password reset');
      }
      onDone();
      if (res.tempPassword) {
        setTempPassword(res.tempPassword); // keep dialog open to reveal it once
      } else {
        onOpenChange(false);
      }
    } catch (err) {
      toast.error(resetErrorMessage(err, 'Reset failed'));
    } finally {
      setSubmitting(false);
    }
  }

  async function copyTemp() {
    if (!tempPassword) return;
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy — select and copy manually.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>Reset this user&apos;s password and (optionally) email them a link.</DialogDescription>
        </DialogHeader>

        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          <p className="font-medium">{user.displayName}</p>
          <p className="text-xs text-muted-foreground">{user.email}</p>
          <p className="mt-0.5 text-xs capitalize">
            Role: {user.role.replace('_', ' ')}
            {user.branchName ? ` · ${user.branchName}` : ''}
          </p>
        </div>

        {tempPassword ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="mb-1.5 text-xs text-muted-foreground">
                Temporary password (shown once — copy it now and share it securely):
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 select-all rounded border bg-background px-2 py-1 font-mono text-sm">
                  {tempPassword}
                </code>
                <Button type="button" variant="outline" size="icon" onClick={copyTemp} aria-label="Copy password">
                  {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            </div>
            <Button className="w-full" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-3">
              <ToggleRow
                label="Generate temporary password"
                desc="Sets a new random password immediately."
                checked={generateTemp}
                onChange={setGenerateTemp}
              />
              <ToggleRow
                label="Send reset email"
                desc="Emails the user a password-reset link."
                checked={sendEmail}
                onChange={setSendEmail}
              />
              <ToggleRow
                label="Force change on next login"
                desc="User must set a new password before using the app."
                checked={forceChange}
                onChange={setForceChange}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving…
                  </>
                ) : (
                  'Save'
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
