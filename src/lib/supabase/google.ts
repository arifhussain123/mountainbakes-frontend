import type { UserIdentity } from '@supabase/supabase-js';
import { supabase } from './client';

/**
 * Google sign-in, on top of Supabase Auth's Google provider.
 *
 * WHY THIS EXISTS. The Login History screen shows the Google account a session
 * was signed in with, beside the Mountain Bakes account. A website cannot read
 * which Google account the Chrome profile is signed into — the browser does not
 * expose it and nothing here tries to — so the only honest way to know it is for
 * the person to authenticate to Mountain Bakes WITH Google. This module is that
 * path: the "Continue with Google" button on the login page, and the "Connect
 * Google account" control that links a Google identity to an existing staff
 * account so the button works for them.
 *
 * NOTHING HERE TELLS THE API ANYTHING. The Google email reaches the login
 * history because the API reads it off the verified token's identities when the
 * session is opened; the browser never submits it.
 *
 * EVERYTHING IS GATED ON THE PROVIDER BEING ENABLED in the Supabase project
 * (Authentication → Providers → Google, with a Google Cloud OAuth client). Until
 * it is, `isGoogleSignInEnabled` answers false and no Google control renders —
 * a button that opens to "Unsupported provider" is worse than no button.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

let enabledPromise: Promise<boolean> | null = null;

/**
 * Is the Google provider switched on for this Supabase project?
 *
 * Read from GoTrue's public settings endpoint, which is what the provider
 * toggle in the dashboard actually changes; there is no client-side flag to
 * mirror and no way to be wrong about it. Cached for the page's life — it
 * changes when an admin flips a switch, not per render. Fails to FALSE: offline
 * or erroring, the form still works and the Google button simply stays hidden.
 */
export function isGoogleSignInEnabled(): Promise<boolean> {
  if (!enabledPromise) {
    enabledPromise = (async () => {
      try {
        if (!supabaseUrl || !supabaseAnonKey) return false;
        const res = await fetch(`${supabaseUrl}/auth/v1/settings`, {
          headers: { apikey: supabaseAnonKey },
        });
        if (!res.ok) return false;
        const body = (await res.json()) as { external?: Record<string, boolean> };
        return body.external?.['google'] === true;
      } catch {
        return false;
      }
    })();
  }
  return enabledPromise;
}

/** The absolute URL Supabase should send the browser back to after Google. */
function redirectTo(path: string): string {
  return `${window.location.origin}${path}`;
}

/**
 * Start a Google sign-in. Leaves the page: Supabase sends the browser to
 * Google and back to `returnPath` with the session in the URL, where the
 * client's `detectSessionInUrl` picks it up and AuthProvider applies it.
 *
 * `prompt: 'select_account'` so a person with several Google accounts in this
 * browser is asked which one — which is exactly the choice the login history is
 * going to record.
 */
export async function signInWithGoogle(returnPath = '/login/'): Promise<void> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: redirectTo(returnPath),
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw error;
}

/** The Google identity linked to the signed-in account, or null. */
export async function getGoogleIdentity(): Promise<UserIdentity | null> {
  const { data, error } = await supabase.auth.getUserIdentities();
  if (error) throw error;
  return data?.identities.find((i) => i.provider === 'google') ?? null;
}

/** The verified email on a Google identity, as Google reported it. */
export function identityEmail(identity: UserIdentity | null): string | null {
  const email = (identity?.identity_data as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' && email ? email : null;
}

/**
 * Link a Google account to the SIGNED-IN staff account. Leaves the page like
 * `signInWithGoogle` and returns to `returnPath`.
 *
 * This is what makes "Continue with Google" usable for existing staff: their
 * Mountain Bakes address (ahmed@mountainbakes.com) and their Google address
 * (arifsiksavi@gmail.com) differ, so Supabase would otherwise treat a Google
 * sign-in as a brand-new account — one with no role, which the app refuses.
 * Linking needs "Manual linking" enabled under Authentication → Settings.
 */
export async function linkGoogleAccount(returnPath: string): Promise<void> {
  const { error } = await supabase.auth.linkIdentity({
    provider: 'google',
    options: {
      redirectTo: redirectTo(returnPath),
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw error;
}

/** Remove the Google identity from the signed-in account. */
export async function unlinkGoogleAccount(identity: UserIdentity): Promise<void> {
  const { error } = await supabase.auth.unlinkIdentity(identity);
  if (error) throw error;
}
