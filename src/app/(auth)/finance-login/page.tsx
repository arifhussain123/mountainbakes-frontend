'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase, setRememberMe as persistRememberMeChoice } from '@/lib/supabase/client';
import { canAccessFinance, getRoleHome } from '@/utils/roleHome';
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
 * A SEPARATE screen from /login, not a variant of it, for three reasons that
 * each change the flow:
 *
 *   1. It asks for a Finance User ID, not an email. Supabase Auth only speaks
 *      email/password, so the ID is resolved through the API first
 *      (POST /api/auth/finance-lookup) and the resulting address is what gets
 *      signed in. See that endpoint for how the enumeration surface is handled.
 *   2. It refuses any non-finance account outright, even a valid one. Signing in
 *      here with a branch manager's credentials fails — it does not silently
 *      redirect them to the branch dashboard, because the person typing into
 *      this form believes they are entering a finance system and should be told
 *      plainly that they are not in it.
 *   3. It handles the optional TOTP second factor, which the operations login
 *      has no reason to.
 *
 * SECURITY NOTE, same as everywhere else in this app: none of this is the
 * boundary. The API authorises every request against the JWT's role claim on its
 * own. What this screen protects is the user's understanding of where they are.
 */

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: 'Incorrect User ID or password.',
  user_banned: 'This account has been deactivated. Contact your Finance Admin.',
  over_request_rate_limit: 'Too many attempts. Please wait a moment and try again.',
};

type Stage = 'credentials' | 'mfa';

export default function FinanceLoginPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('credentials');
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [factorId, setFactorId] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  /**
   * Abandon a half-established session.
   *
   * Reached when the password was right but the account is not a finance one, or
   * the second factor was never completed. Supabase has already issued a
   * session by that point — leaving it in place would let the user simply
   * navigate to a dashboard they were just refused.
   */
  async function abandonSession(message: string): Promise<never> {
    await supabase.auth.signOut();
    setStage('credentials');
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
      // Must precede sign-in: it decides whether the session Supabase is about
      // to issue lands in localStorage or sessionStorage.
      persistRememberMeChoice(rememberMe);

      // 1 — Finance User ID → email. A 404 here means "no finance account with
      // that ID", deliberately indistinguishable from a wrong password below.
      const { email } = await apiCall<{ email: string }>('/api/auth/finance-lookup', {
        method: 'POST',
        body: JSON.stringify({ userId: userId.trim() }),
      });
      attemptedAs = email;

      // 2 — Sign in.
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError || !data.session) throw signInError ?? new Error('Sign-in failed. Please try again.');

      // 3 — Second factor, when the account has one enrolled. Supabase reports
      // this as an assurance-level gap: the session exists at aal1 but the
      // account requires aal2, so it is not yet a usable session.
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (aal && aal.nextLevel === 'aal2' && aal.nextLevel !== aal.currentLevel) {
        const { data: factors } = await supabase.auth.mfa.listFactors();
        const totp = factors?.totp?.[0];
        if (!totp) {
          await abandonSession(
            'This account requires two-factor authentication, but no authenticator is enrolled. Contact your Finance Admin.',
          );
        }
        const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
          factorId: totp!.id,
        });
        if (challengeError || !challenge) throw challengeError ?? new Error('Could not start two-factor verification.');

        setFactorId(totp!.id);
        setChallengeId(challenge.id);
        setStage('mfa');
        return;
      }

      await finishSignIn(data.session.user.app_metadata as { role?: string });
    } catch (err: unknown) {
      setError(resolveMessage(err));
      // Recorded for Admin → Security, exactly as on the main login page. This
      // catch also covers the abandoned-session paths above — an account that
      // authenticated but is not a finance one, or one whose second factor was
      // never enrolled, was still refused entry and is worth an admin seeing.
      recordFailedLogin(attemptedAs, loginFailureReason(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleMfa(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { data, error: verifyError } = await supabase.auth.mfa.verify({
        factorId,
        challengeId,
        code: mfaCode.trim(),
      });
      if (verifyError || !data) throw verifyError ?? new Error('That code was not accepted.');

      const { data: session } = await supabase.auth.getSession();
      await finishSignIn((session.session?.user.app_metadata ?? {}) as { role?: string });
    } catch (err: unknown) {
      setError(resolveMessage(err));
      setMfaCode('');
    } finally {
      setLoading(false);
    }
  }

  /**
   * The role gate.
   *
   * Read from `app_metadata` on the session Supabase just issued — never from
   * anything this form supplied. app_metadata is writable only with the
   * service-role key, so it is exactly as trustworthy as the JWT itself.
   */
  async function finishSignIn(claims: { role?: string; mustChangePassword?: boolean }) {
    if (!canAccessFinance(claims.role)) {
      await abandonSession(
        'Those credentials are not for a Finance account. Use the main sign-in page for Branch, Production or Admin access.',
      );
    }

    if (claims.mustChangePassword === true) {
      toast.info('Please set a new password to continue.');
      router.push('/change-password');
      return;
    }

    toast.success('Signed in to Finance Ledger');
    router.push(getRoleHome(claims.role!));
  }

  function resolveMessage(err: unknown): string {
    const code = (err as { code?: string }).code ?? '';
    const msg = (err as Error).message ?? '';
    if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code]!;
    // A wrong password and an unknown User ID must read identically, or the form
    // becomes an oracle for which finance IDs exist.
    if (/invalid login credentials/i.test(msg) || /No Finance account matches/i.test(msg)) {
      return 'Incorrect User ID or password.';
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
                {stage === 'credentials'
                  ? 'Accounts department sign-in'
                  : 'Enter the 6-digit code from your authenticator'}
              </p>
            </div>
          </div>

          {error && (
            <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {stage === 'credentials' ? (
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
                    className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
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
          ) : (
            <form onSubmit={handleMfa} className="space-y-5">
              <div className="space-y-1.5">
                <Label htmlFor="mfaCode" className="text-sm font-medium">
                  Authentication code
                </Label>
                <Input
                  id="mfaCode"
                  // `inputMode` rather than type="number": a numeric input strips
                  // leading zeros, and a TOTP code beginning 0 is perfectly valid.
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="000000"
                  value={mfaCode}
                  onChange={(e) => {
                    setMfaCode(e.target.value.replace(/\D/g, ''));
                    setError('');
                  }}
                  required
                  autoFocus
                  autoComplete="one-time-code"
                  className="h-12 text-center font-mono text-lg tracking-[0.5em]"
                  disabled={loading}
                />
              </div>

              <Button type="submit" size="lg" className="h-11 w-full" disabled={loading || mfaCode.length !== 6}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                {loading ? 'Verifying…' : 'Verify'}
              </Button>

              <button
                type="button"
                onClick={async () => {
                  await supabase.auth.signOut();
                  setStage('credentials');
                  setMfaCode('');
                  setError('');
                }}
                className="w-full text-sm text-muted-foreground hover:text-foreground"
              >
                Start over
              </button>
            </form>
          )}

          <div className="mt-6 border-t pt-5">
            <Link
              href={ROUTES.LOGIN}
              className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
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
