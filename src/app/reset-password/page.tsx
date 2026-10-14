'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { confirmPasswordReset } from '@/lib/auth/session';
import { PasswordStrengthMeter } from '@/components/auth/PasswordStrengthMeter';
import { isStrongPassword } from '@/utils/password';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, Lock, KeyRound, Eye, EyeOff, AlertCircle } from 'lucide-react';

/**
 * Landing page for password-reset emails. The link carries a single-use token
 * (`/reset-password?token=…`); the new password is posted to the API together
 * with it, and the API is what decides whether the token is still good. No
 * session exists at any point — the person signs in afterwards, with the new
 * password, like anyone else.
 */
export default function ResetPasswordPage() {
  const router = useRouter();
  const [resetToken, setResetToken] = useState('');
  const [ready, setReady] = useState(false); // the link carried a token
  const [checked, setChecked] = useState(false); // finished the initial check
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Read from the address bar in an effect, not with useSearchParams: this
  // page is statically exported, and the query string only exists in the browser.
  useEffect(() => {
    const fromLink = new URLSearchParams(window.location.search).get('token') ?? '';
    setResetToken(fromLink);
    setReady(fromLink !== '');
    setChecked(true);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!isStrongPassword(newPassword)) {
      setError('Password does not meet the requirements.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await confirmPasswordReset(resetToken, newPassword);
      toast.success('Password updated. Please sign in.');
      router.replace('/login');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update password';
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  const canSubmit =
    ready && isStrongPassword(newPassword) && newPassword === confirmPassword && !submitting;

  return (
    <div className="min-h-dvh flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="bg-card rounded-2xl shadow-xl border border-border/60 overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-primary via-primary/70 to-primary/30" />
          <div className="px-8 pt-8 pb-9">
            <div className="mb-6 flex flex-col items-center gap-2 text-center">
              <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                <KeyRound className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-xl font-bold tracking-tight">Reset your password</h2>
              <p className="text-sm text-muted-foreground">
                Choose a new password for your account.
              </p>
            </div>

            {checked && !ready ? (
              <div className="space-y-4">
                <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>This reset link is invalid or has expired. Please request a new one.</span>
                </div>
                <Button className="w-full h-11" onClick={() => router.replace('/login')}>
                  Back to sign in
                </Button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="new-password">New password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="new-password"
                      type={show ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => {
                        setNewPassword(e.target.value);
                        setError('');
                      }}
                      placeholder="••••••••"
                      className="pl-9 pr-10"
                      autoFocus
                      autoComplete="new-password"
                      disabled={submitting || !ready}
                    />
                    <button
                      type="button"
                      onClick={() => setShow((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                      aria-label={show ? 'Hide password' : 'Show password'}
                    >
                      {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <PasswordStrengthMeter password={newPassword} />

                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password">Confirm new password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="confirm-password"
                      type={show ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => {
                        setConfirmPassword(e.target.value);
                        setError('');
                      }}
                      placeholder="••••••••"
                      className="pl-9"
                      autoComplete="new-password"
                      disabled={submitting || !ready}
                    />
                  </div>
                  {confirmPassword && newPassword !== confirmPassword && (
                    <p className="text-xs text-destructive">Passwords do not match</p>
                  )}
                </div>

                {error && (
                  <div className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-sm text-destructive">
                    <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                    <span>{error}</span>
                  </div>
                )}

                <Button type="submit" className="w-full h-11" disabled={!canSubmit}>
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating…
                    </>
                  ) : (
                    'Update Password'
                  )}
                </Button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
