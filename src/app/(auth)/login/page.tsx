'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import { getRoleHome } from '@/utils/roleHome';
import { COMPANY_NAME, APP_NAME } from '@/utils/constants';
import { IMAGES } from '@/utils/images';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ForgotPasswordDialog } from '@/components/auth/ForgotPasswordDialog';
import { toast } from 'sonner';
import { Eye, EyeOff, Loader2, Mail, Lock, AlertCircle } from 'lucide-react';

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Invalid email or password.',
  email_not_confirmed: 'Please confirm your email address before signing in.',
  user_banned: 'This account has been deactivated. Contact your administrator.',
  over_request_rate_limit: 'Too many attempts. Please wait a moment and try again.',
  over_email_send_rate_limit: 'Too many attempts. Please wait a moment and try again.',
};

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showForgot, setShowForgot] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError || !data.session) throw signInError ?? new Error('Login failed. Please try again.');

      const authedUser = data.session.user;
      const claims = (authedUser.app_metadata ?? {}) as { mustChangePassword?: boolean };
      const forceChange = claims.mustChangePassword === true;
      const displayName = (authedUser.user_metadata as { displayName?: string } | null)?.displayName;

      // Send only the access token — /api/login verifies it server-side and derives
      // role/branch from it. Claims are deliberately NOT sent from here; the route
      // will not trust them.
      const sessionRes = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: data.session.access_token, rememberMe }),
      });

      if (!sessionRes.ok) {
        // Session cookie was refused (e.g. account has no role assigned). Drop the
        // half-established Supabase session so the app isn't left in a limbo state.
        const { error: sessionErr } = (await sessionRes.json().catch(() => ({}))) as { error?: string };
        await supabase.auth.signOut();
        throw new Error(sessionErr || 'Could not start your session. Please try again.');
      }

      const { role } = (await sessionRes.json()) as { role: string };

      if (forceChange) {
        toast.info('Please set a new password to continue.');
        router.push('/change-password');
      } else {
        toast.success(`Welcome back, ${displayName || 'there'}!`);
        router.push(getRoleHome(role));
      }
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? '';
      const msg = (err as Error).message ?? '';
      let message = ERROR_MESSAGES[code];
      if (!message && /invalid login credentials/i.test(msg)) message = 'Invalid email or password.';
      setError(message || msg || 'Login failed. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-[420px] mx-4">

      {/* Mobile brand header */}
      <div className="flex lg:hidden flex-col items-center gap-3 mb-8">
        <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center shadow-lg overflow-hidden">
          <Image
            src={IMAGES.logo}
            alt={`${COMPANY_NAME} logo`}
            width={56}
            height={56}
            className="w-full h-full object-contain"
            priority
            unoptimized
          />
        </div>
        <div className="text-center">
          <h1 className="text-xl font-bold text-foreground">{COMPANY_NAME}</h1>
          <p className="text-sm text-muted-foreground">ERP Management System</p>
        </div>
      </div>

      {/* Card */}
      <div className="bg-card rounded-2xl shadow-xl border border-border/60 overflow-hidden">

        {/* Card top accent */}
        <div className="h-1 w-full bg-gradient-to-r from-primary via-primary/70 to-primary/30" />

        <div className="px-8 pt-8 pb-9">
          {/* Heading */}
          <div className="mb-7">
            <h2 className="text-2xl font-bold text-foreground tracking-tight">Welcome back</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Sign in to your {APP_NAME} account
            </p>
          </div>

          {/* Error banner */}
          {error && (
            <div className="flex items-start gap-2.5 bg-destructive/8 border border-destructive/20 text-destructive rounded-xl px-4 py-3 mb-5 text-sm">
              <AlertCircle className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-sm font-medium">
                Email address
              </Label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="you@mountainbakes.com"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(''); }}
                  required
                  autoComplete="email"
                  autoFocus
                  className="pl-10 h-11"
                  disabled={loading}
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-medium">
                Password
              </Label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  required
                  autoComplete="current-password"
                  className="pl-10 pr-10 h-11"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {/* Remember me + forgot password */}
            <div className="flex items-center justify-between -mt-2">
              <label
                htmlFor="remember-me"
                className="flex items-center gap-2 text-xs font-medium text-muted-foreground cursor-pointer select-none"
              >
                <input
                  id="remember-me"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  disabled={loading}
                  className="h-3.5 w-3.5 rounded border-border accent-primary cursor-pointer"
                />
                Remember me
              </label>
              <button
                type="button"
                onClick={() => setShowForgot(true)}
                className="text-xs font-medium text-primary hover:underline"
              >
                Forgot Password?
              </button>
            </div>

            {/* Submit */}
            <Button
              type="submit"
              className="w-full h-11 text-sm font-semibold mt-1"
              disabled={loading || !email || !password}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Signing in…
                </>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>

          {/* Footer note */}
          <div className="mt-6 pt-5 border-t border-border/60">
            <p className="text-xs text-center text-muted-foreground">
              Access is restricted to authorised staff only.
              <br />
              Contact your administrator to request access.
            </p>
          </div>
        </div>
      </div>

      {/* Copyright */}
      <p className="text-center text-[11px] text-muted-foreground/60 mt-6">
        &copy; {new Date().getFullYear()} {COMPANY_NAME}. All rights reserved.
      </p>

      <ForgotPasswordDialog open={showForgot} onOpenChange={setShowForgot} />
    </div>
  );
}
