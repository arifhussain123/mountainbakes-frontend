'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
// Aliased: `setRememberMe` is already the useState setter for the checkbox below.
import { supabase, setRememberMe as persistRememberMeChoice } from '@/lib/supabase/client';
import { isGoogleSignInEnabled, signInWithGoogle } from '@/lib/supabase/google';
import { getRoleHome, isValidRole } from '@/utils/roleHome';
import { COMPANY_NAME, APP_NAME } from '@/utils/constants';
import { IMAGES } from '@/utils/images';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ForgotPasswordDialog } from '@/components/auth/ForgotPasswordDialog';
import { loginFailureReason, recordFailedLogin } from '@/lib/loginHistory';
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
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Offer Google only when the project actually has the provider on. Decided
  // from Supabase's own settings, so this page cannot disagree with the
  // dashboard; until then the form is the only way in.
  useEffect(() => {
    let active = true;
    void isGoogleSignInEnabled().then((on) => { if (active) setGoogleEnabled(on); });
    return () => { active = false; };
  }, []);

  /*
   * The return leg of a Google sign-in. Supabase sends the browser back here
   * with the session in the URL; the client picks it up and AuthProvider applies
   * it, and RouteGuard then moves a user WITH a role to their home. What neither
   * of them says anything about is a Google account that is not linked to any
   * staff account: Supabase creates a fresh user for it, the app refuses it for
   * having no role, and without this the person would be dropped back on this
   * form with no idea why. Told plainly, and the half-made session dropped.
   */
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== 'SIGNED_IN' || !session) return;
      const provider = (session.user.app_metadata as { provider?: string } | null)?.provider;
      const role = (session.user.app_metadata as { role?: string } | null)?.role;
      if (provider === 'google' && !isValidRole(role)) {
        void supabase.auth.signOut();
        setError(
          `${session.user.email ?? 'That Google account'} is not connected to a Mountain Bakes account. ` +
            'Sign in with your email and password, then use "Connect Google account" on your dashboard.',
        );
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function handleGoogle() {
    setError('');
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setError('You are offline. Signing in needs a connection — reconnect and try again.');
      return;
    }
    setGoogleLoading(true);
    try {
      persistRememberMeChoice(rememberMe);
      await signInWithGoogle('/login/'); // leaves the page
    } catch (err) {
      setGoogleLoading(false);
      setError((err as Error).message || 'Google sign-in could not start. Please try again.');
    }
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    // Signing in is the one thing the app genuinely cannot do offline: only
    // Supabase can issue a session, and no cached anything substitutes for one.
    // Said plainly here rather than letting signInWithPassword fail with a
    // network error that reads like wrong credentials — the worst thing to show
    // someone at a shop door who is certain their password is right.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setError('You are offline. Signing in needs a connection — reconnect and try again.');
      return;
    }

    setLoading(true);

    try {
      // Must precede sign-in: it decides whether the session Supabase is about to
      // issue lands in localStorage (persists) or sessionStorage (dies with the tab).
      persistRememberMeChoice(rememberMe);

      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError || !data.session) throw signInError ?? new Error('Login failed. Please try again.');

      const authedUser = data.session.user;
      const claims = (authedUser.app_metadata ?? {}) as {
        role?: string;
        mustChangePassword?: boolean;
      };
      const forceChange = claims.mustChangePassword === true;
      const displayName = (authedUser.user_metadata as { displayName?: string } | null)?.displayName;

      // Role comes from app_metadata on the session Supabase just issued — never from
      // anything the form supplied. app_metadata is writable only with the service-role
      // key (the Express API), so it is exactly as trustworthy as the JWT itself.
      //
      // Fail closed, mirroring AuthProvider and the API's `authenticate` middleware: an
      // account with no recognised role gets no session at all rather than a default
      // one. Drop the half-established Supabase session so the app isn't left in limbo.
      if (!isValidRole(claims.role)) {
        await supabase.auth.signOut();
        throw new Error('This account has no role assigned. Contact your administrator.');
      }
      const role = claims.role;

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

      // Tell the API a sign-in was refused, so Admin → Security can show it.
      //
      // HERE AND NOT IN A `signInWithPassword` WRAPPER, because this catch also
      // covers the fail-closed role check above — an account that authenticated
      // but carries no role claim was still refused entry, and 'no_role' is a
      // materially different thing for an admin to see than a wrong password.
      //
      // The address only, never the password, and not awaited: the person is
      // already reading the error above and must not wait on our bookkeeping.
      // The call swallows its own failures — see recordFailedLogin.
      recordFailedLogin(email, loginFailureReason(err));
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

          {/* Google sign-in — only offered when the Supabase project has the
              provider enabled. What it buys, beyond convenience: a session opened
              this way records the Google account it was signed in with in the
              login history, which a password login cannot. */}
          {googleEnabled && (
            <div className="mt-5">
              <div className="relative mb-4">
                <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border/60" /></div>
                <div className="relative flex justify-center text-[11px] uppercase tracking-wide">
                  <span className="bg-card px-2 text-muted-foreground">or</span>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                className="w-full h-11 text-sm font-medium"
                onClick={handleGoogle}
                disabled={loading || googleLoading}
              >
                {googleLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <svg className="h-4 w-4 mr-2" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="#EA4335" d="M12 10.2v3.9h5.4c-.2 1.3-1.6 3.8-5.4 3.8-3.3 0-5.9-2.7-5.9-6s2.6-6 5.9-6c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.3 14.6 2.4 12 2.4 6.7 2.4 2.4 6.7 2.4 12S6.7 21.6 12 21.6c5.5 0 9.2-3.9 9.2-9.3 0-.6-.1-1.1-.2-1.6H12z" />
                  </svg>
                )}
                Continue with Google
              </Button>
            </div>
          )}

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
