'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
// Aliased: `setRememberMe` is already the useState setter for the checkbox below.
import { signIn, signOut, setRememberMe as persistRememberMeChoice } from '@/lib/auth/session';
import { isValidRole } from '@/utils/roleHome';
import { ROUTES } from '@/utils/routes';
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
  account_inactive: 'This account has been deactivated. Contact your administrator.',
  rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
  auth_not_configured: 'Sign-in is not available right now. Please contact your administrator.',
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

  // Warm every possible landing route while the person is still typing, so the
  // spinner RouteGuard shows during its post-login redirect isn't also waiting
  // on the destination route's chunk to load for the first time.
  useEffect(() => {
    [
      ROUTES.DASHBOARD,
      ROUTES.BRANCH_DASHBOARD,
      ROUTES.BRANCH_NEW_ORDERS,
      ROUTES.PRODUCTION_DASHBOARD,
      '/change-password',
    ].forEach((path) => router.prefetch(path));
  }, [router]);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    // Signing in is the one thing the app genuinely cannot do offline: only
    // the API can issue a session, and no cached anything substitutes for one.
    // Said plainly here rather than letting the request fail with a network
    // error that reads like wrong credentials — the worst thing to show
    // someone at a shop door who is certain their password is right.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setError('You are offline. Signing in needs a connection — reconnect and try again.');
      return;
    }

    setLoading(true);

    try {
      // Must precede sign-in: it decides whether the session about to be issued
      // lands in localStorage (persists) or sessionStorage (dies with the tab).
      persistRememberMeChoice(rememberMe);

      const { user: authedUser } = await signIn(email, password);
      const forceChange = authedUser.mustChangePassword === true;
      const displayName = authedUser.displayName;

      // Role comes from the session the API just issued — never from anything
      // the form supplied — and the API reads it from its own records again on
      // every request, so what is shown here can only ever be narrower than
      // what the API would allow.
      //
      // Fail closed, mirroring AuthProvider and the API's `authenticate` middleware: an
      // account with no recognised role gets no session at all rather than a default
      // one. Drop the half-established session so the app isn't left in limbo.
      if (!isValidRole(authedUser.role)) {
        await signOut();
        throw new Error('This account has no role assigned. Contact your administrator.');
      }

      // Navigation itself is RouteGuard's job — it reacts to AuthProvider's
      // onAuthStateChange the moment this session lands and redirects on its
      // own. Pushing here too raced it for the same destination and could
      // stack a duplicate history entry when this one lost the race.
      if (forceChange) {
        toast.info('Please set a new password to continue.');
      } else {
        toast.success(`Welcome back, ${displayName || 'there'}!`);
      }
    } catch (err: unknown) {
      const code = (err as { code?: string }).code ?? '';
      const msg = (err as Error).message ?? '';
      // A request that never got an answer is a TypeError from fetch (or an
      // abort), and its message is the browser's, not something to show.
      const unreachable = err instanceof TypeError || (err as Error).name === 'AbortError';
      const message = unreachable
        ? 'Could not reach the server. Check your connection and try again.'
        : ERROR_MESSAGES[code];
      setError(message || msg || 'Login failed. Please try again.');

      // Tell the API a sign-in was refused, so Admin → Security can show it.
      //
      // HERE AND NOT INSIDE `signIn`, because this catch also
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
                  className="absolute right-0.5 top-1/2 flex size-10 -translate-y-1/2 items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
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
                className="-my-2.5 flex items-center gap-2 py-2.5 text-xs font-medium text-muted-foreground cursor-pointer select-none"
              >
                <input
                  id="remember-me"
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  disabled={loading}
                  className="h-4 w-4 rounded border-border accent-primary cursor-pointer"
                />
                Remember me
              </label>
              <button
                type="button"
                onClick={() => setShowForgot(true)}
                className="-my-2.5 py-2.5 text-xs font-medium text-primary hover:underline"
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
