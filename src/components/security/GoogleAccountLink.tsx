'use client';

import { useEffect, useState } from 'react';
import type { UserIdentity } from '@supabase/supabase-js';
import { usePathname } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  getGoogleIdentity,
  identityEmail,
  isGoogleSignInEnabled,
  linkGoogleAccount,
  unlinkGoogleAccount,
} from '@/lib/supabase/google';
import { toast } from 'sonner';
import { Link2, Loader2, Unlink } from 'lucide-react';

/**
 * "Connect Google account" — the control that makes the Login History's Browser
 * email column fillable for an existing staff account.
 *
 * A staff account signs in as ahmed@mountainbakes.com; the person's Google
 * account is arifsiksavi@gmail.com. Supabase only knows those are the same
 * person once the Google identity is LINKED to the account. Coming back from
 * the link is itself a Google-authenticated session — GoTrue issues a fresh
 * one with the identity attached — so the login history records the Google
 * address from that moment, and on every later "Continue with Google".
 * A password sign-in still records nothing. This is the linking half; the
 * login page has the other.
 *
 * Renders nothing until the Google provider is enabled for the project, so the
 * dashboard does not advertise a button that cannot work.
 */
export function GoogleAccountLink() {
  const pathname = usePathname();
  const [enabled, setEnabled] = useState(false);
  const [identity, setIdentity] = useState<UserIdentity | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void (async () => {
      const on = await isGoogleSignInEnabled();
      if (!active) return;
      setEnabled(on);
      if (!on) return;
      try {
        const found = await getGoogleIdentity();
        if (active) setIdentity(found);
      } catch {
        // Not fatal: the button below still offers to connect.
      }
    })();
    return () => { active = false; };
  }, []);

  if (!enabled) return null;

  const email = identityEmail(identity);

  async function connect() {
    setBusy(true);
    try {
      // Leaves the page and comes back to it; nothing after this runs.
      await linkGoogleAccount(pathname || '/');
    } catch (err) {
      setBusy(false);
      toast.error((err as Error).message || 'Could not start Google sign-in.');
    }
  }

  async function disconnect() {
    if (!identity) return;
    setBusy(true);
    try {
      await unlinkGoogleAccount(identity);
      setIdentity(null);
      toast.success('Google account disconnected.');
    } catch (err) {
      toast.error((err as Error).message || 'Could not disconnect the Google account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {email ? (
        <>
          <span>
            Google account: <span className="font-medium text-foreground">{email}</span>
          </span>
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={disconnect} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5" />}
            <span className="ml-1">Disconnect</span>
          </Button>
        </>
      ) : (
        <>
          <span>Connect your Google account to record it in the login history from now on.</span>
          <Button variant="outline" size="sm" className="h-7 px-2" onClick={connect} disabled={busy}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
            <span className="ml-1">Connect Google account</span>
          </Button>
        </>
      )}
    </div>
  );
}
