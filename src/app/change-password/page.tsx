'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { apiCall } from '@/utils/api';
import { ChangePasswordSchema } from '@mb/shared';
import { PasswordStrengthMeter } from '@/components/auth/PasswordStrengthMeter';
import { isStrongPassword } from '@/utils/password';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Loader2, Lock, ShieldAlert, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { getRoleHome } from '@/utils/roleHome';

export default function ChangePasswordPage() {
  const router = useRouter();
  const { user, token, loading: authLoading, logout } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Not authenticated at all → back to login.
  useEffect(() => {
    if (!authLoading && !user) router.replace('/login');
  }, [authLoading, user, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    const parsed = ChangePasswordSchema.safeParse({ newPassword, confirmPassword });
    if (!parsed.success) {
      setError(parsed.error.errors[0]?.message ?? 'Please check the password requirements.');
      return;
    }
    setSubmitting(true);
    try {
      await apiCall('/api/auth/change-password', { method: 'POST', body: JSON.stringify({ newPassword }) }, token);
      // The API clears the mustChangePassword claim in app_metadata; refreshing the
      // session is what pulls the new claim into the JWT this app reads. RouteGuard
      // routes off that claim, so without the refresh it would bounce straight back
      // here — nothing else clears the gate.
      await supabase.auth.refreshSession();
      toast.success('Password updated. Welcome!');
      router.replace(getRoleHome(user?.role ?? ''));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update password';
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (authLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const canSubmit = isStrongPassword(newPassword) && newPassword === confirmPassword && !submitting;

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="bg-card rounded-2xl shadow-xl border border-border/60 overflow-hidden">
          <div className="h-1 w-full bg-gradient-to-r from-primary via-primary/70 to-primary/30" />
          <div className="px-8 pt-8 pb-9">
            <div className="mb-6 flex flex-col items-center gap-2 text-center">
              <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
                <ShieldAlert className="h-6 w-6 text-primary" />
              </div>
              <h2 className="text-xl font-bold tracking-tight">Set a new password</h2>
              <p className="text-sm text-muted-foreground">
                For your security you must set a new password before continuing.
              </p>
            </div>

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
                    disabled={submitting}
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
                    disabled={submitting}
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

            <div className="mt-5 pt-4 border-t border-border/60 text-center">
              <button
                type="button"
                onClick={async () => {
                  await logout();
                  router.replace('/login');
                }}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Not you? Sign out
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
