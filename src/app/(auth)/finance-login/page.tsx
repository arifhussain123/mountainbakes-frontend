'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { signIn, signOut, setRememberMe as persistRememberMeChoice } from '@/lib/auth/session';
import { canAccessFinance } from '@/utils/roleHome';
import { apiCall } from '@/utils/api';
import { loginFailureReason, recordFailedLogin } from '@/lib/loginHistory';
import { COMPANY_NAME } from '@/utils/constants';
import { IMAGES } from '@/utils/images';
import { ROUTES } from '@/utils/routes';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { AlertCircle, ArrowLeft, Eye, EyeOff, IdCard, Loader2, Lock, ShieldCheck } from 'lucide-react';

/**
 * The Finance Ledger's own sign-in.
 *
 * A SEPARATE screen from /login, not a variant of it, for two reasons that
 * each change the flow:
 *
 *   1. It asks for a Finance User ID, not an email. The ID is resolved through
 *      the API first (POST /api/auth/finance-lookup), which answers only for a
 *      finance account, and the resulting address is what gets signed in. See
 *      that endpoint for how the enumeration surface is handled.
 *   2. It refuses any non-finance account outright, even a valid one. Signing in
 *      here with a branch manager's credentials fails — it does not silently
 *      redirect them to the branch dashboard, because the person typing into
 *      this form believes they are entering a finance system and should be told
 *      plainly that they are not in it.
 *
 * SECURITY NOTE, same as everywhere else in this app: none of this is the
 * boundary. The API authorises every request against the account's role on its
 * own. What this screen protects is the user's understanding of where they are.
 */

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Incorrect User ID or password.',
  account_inactive: 'This account has been deactivated. Contact your Finance Admin.',
  rate_limited: 'Too many attempts. Please wait a few minutes and try again.',
  auth_not_configured: 'Sign-in is not available right now. Please contact your administrator.',
};

export default function FinanceLoginPage() {
  const router = useRouter();
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Warm the landing route while the person is still typing, so the spinner
  // RouteGuard shows during its post-login redirect isn't also waiting on the
  // destination route's chunk to load for the first time.
  useEffect(() => {
    [ROUTES.FINANCE_DASHBOARD, '/change-password'].forEach((path) => router.prefetch(path));
  }, [router]);

  /**
   * Abandon a half-established session.
   *
   * Reached when the password was right but the account is not a finance one.
   * A session has already been issued by that point — leaving it in place
   * would let the user simply navigate to a dashboard they were just refused.
   */
  async function abandonSession(message: string): Promise<never> {
    await signOut();
    throw new Error(message);
  }

  async function handleCredentials(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    /*
     * What a refused attempt is recorded AGAINST.
     *
     * Finance signs in by Finance User ID, not by address, so until the lookup
     * below resolves one there is no email to record — and a lookup that 404s is
     * itself a failed attempt worth seeing. So this starts as the identifier
     * that was actually typed and is upgraded to the address once one is known.
     * Both are honest answers to "what was entered", which is what the column
     * means; `maskEmail` already handles a value with no '@' by masking it
     * whole.
     */
    let attemptedAs = userId.trim();

    try {
      // Must precede sign-in: it decides whether the session about to be
      // issued lands in localStorage or sessionStorage.
      persistRememberMeChoice(rememberMe);

      // 1 — Finance User ID → email. A 404 here means "no finance account with
      // that ID", deliberately indistinguishable from a wrong password below.
      const { email } = await apiCall<{ email: string }>('/api/auth/finance-lookup', {
        method: 'POST',
        body: JSON.stringify({ userId: userId.trim() }),
      });
      attemptedAs = email;

      // 2 — Sign in.
      const { user } = await signIn(email, password);
      await finishSignIn(user);
    } catch (err: unknown) {
      setError(resolveMessage(err));
      // Recorded for Admin → Security, exactly as on the main login page. This
      // catch also covers the abandoned-session path above — an account that
      // authenticated but is not a finance one was still refused entry and is
      // worth an admin seeing.
      recordFailedLogin(attemptedAs, loginFailureReason(err));
    } finally {
      setLoading(false);
    }
  }

  /**
   * The role gate.
   *
   * Read from the session the API just issued — never from anything this form
   * supplied.
   */
  async function finishSignIn(claims: { role?: string; mustChangePassword?: boolean }) {
    if (!canAccessFinance(claims.role)) {
      await abandonSession(
        'Those credentials are not for a Finance account. Use the main sign-in page for Branch, Production or Admin access.',
      );
    }

    // Navigation itself is RouteGuard's job from here — it reacts to
    // AuthProvider's onAuthStateChange the moment this session lands and
    // redirects on its own, the same as on the main login page.
    if (claims.mustChangePassword === true) {
      toast.info('Please set a new password to continue.');
      return;
    }

    toast.success('Signed in to Finance Ledger');
  }

  function resolveMessage(err: unknown): string {
    const code = (err as { code?: string }).code ?? '';
    const msg = (err as Error).message ?? '';
    if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code]!;
    // A wrong password and an unknown User ID must read identically, or the form
    // becomes an oracle for which finance IDs exist.
    if (/No Finance account matches/i.test(msg)) {
      return 'Incorrect User ID or password.';
    }
    if (err instanceof TypeError || (err as Error).name === 'AbortError') {
      return 'Could not reach the server. Check your connection and try again.';
    }
    return msg || 'Sign-in failed. Please try again.';
  }

  return (
    <div className="mx-4 w-full max-w-[420px]">
      <div className="mb-8 flex flex-col items-center gap-3 lg:hidden">
        <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl bg-primary shadow-lg">
          <Image
            src={IMAGES.logo}
            alt={`${COMPANY_NAME} logo`}
            width={56}
            height={56}
            className="h-full w-full object-contain"
            priority
            unoptimized
          />
        </div>
        <div className="text-center">
          <h1 className="text-xl font-bold text-foreground">{COMPANY_NAME}</h1>
          <p className="text-sm text-muted-foreground">Finance Ledger</p>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border/60 bg-card shadow-xl">
        <div className="h-1 w-full bg-gradient-to-r from-emerald-500 via-emerald-400/70 to-emerald-300/30" />

        <div className="px-8 pt-8 pb-9">
          <div className="mb-7 flex items-start gap-3">
            <div className="rounded-xl bg-emerald-50 p-2.5 text-emerald-600 dark:bg-emerald-950 dark:text-emerald-400">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-2xl font-bold tracking-tight text-foreground">Finance Ledger</h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Accounts department sign-in
              </p>
            </div>
          </div>

          {error && (
            <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleCredentials} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="userId" className="text-sm font-medium">
                Finance User ID
              </Label>
              <div className="relative">
                <IdCard className="absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="userId"
                  placeholder="e.g. fin_accounts"
                  value={userId}
                  onChange={(e) => {
                    setUserId(e.target.value);
                    setError('');
                  }}
                  required
                  autoComplete="username"
                  autoFocus
                  autoCapitalize="none"
                  spellCheck={false}
                  className="h-11 pl-10"
                  disabled={loading}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-medium">
                Password
              </Label>
              <div className="relative">
                <Lock className="absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError('');
                  }}
                  required
                  autoComplete="current-password"
                  className="h-11 pr-10 pl-10"
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute top-1/2 right-0 flex size-10 -translate-y-1/2 items-center justify-center text-muted-foreground hover:text-foreground"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <label className="-my-2 flex cursor-pointer items-center gap-2 py-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 rounded border-input accent-primary"
                disabled={loading}
              />
              Keep me signed in on this device
            </label>

            <Button type="submit" size="lg" className="h-11 w-full" disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>

          <div className="mt-6 border-t pt-5">
            <Link
              href={ROUTES.LOGIN}
              className="-my-2.5 flex items-center justify-center gap-1.5 py-2.5 text-sm text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Branch, Production or Admin sign-in
            </Link>
          </div>
        </div>
      </div>

      <p className="mt-5 text-center text-xs text-muted-foreground">
        Access is restricted to Finance and Super Admin accounts.
      </p>
    </div>
  );
}
