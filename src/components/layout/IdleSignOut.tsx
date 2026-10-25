'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/hooks/useAuth';

/**
 * Sign out a phone or tablet left alone for three minutes (owner's rule,
 * 2026-10-25: phones and tablets, every role).
 *
 * "Alone" means no touch, tap, key, typing or scrolling anywhere in the app —
 * so someone ringing up a sale, adding an order or reading down a list is
 * never signed out: each of those resets the clock. A save still in flight
 * (a sale or order on its way to the server) counts as activity too, so a slow
 * connection cannot cut one off. For the last 30 seconds a banner counts down,
 * and touching anything keeps the session.
 *
 * Desktops and the till PCs are left alone: the rule is for devices that are
 * easily picked up and walked off with.
 *
 * The clock is shared across tabs (localStorage), because they share one
 * session: a tab idle in the background must not sign out the tab in use. It
 * is a timestamp, not a running timer, so a phone that slept or put the app in
 * the background is judged on how long it really was away the moment it comes
 * back.
 */

export const IDLE_LIMIT_MS = 3 * 60_000;
export const WARNING_MS = 30_000;
const TICK_MS = 1_000;
const STORAGE_KEY = 'mb.lastActivityAt';
/** Writes to localStorage at most this often; activity is continuous while scrolling. */
const WRITE_EVERY_MS = 1_000;

const ACTIVITY_EVENTS = ['pointerdown', 'touchstart', 'keydown', 'input', 'scroll', 'wheel'] as const;

/** A phone or tablet: the primary pointer is a finger and there is no hover. */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

function readShared(): number {
  try {
    const v = Number(window.localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}
function writeShared(at: number) {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(at));
  } catch {
    /* private mode or blocked storage: this tab's own clock still works */
  }
}

export function IdleSignOut() {
  const { token, logout } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  /** Set when the clock starts (the effect below), not at render. */
  const lastActivity = useRef(0);
  const lastWrite = useRef(0);
  const signingOut = useRef(false);
  // Read through a ref so the effect below runs once per sign-in. If it
  // re-ran when these objects change — a token refresh, a re-render — each
  // re-run would restart the clock and an idle phone would never sign out.
  const live = useRef({ logout, queryClient, router });
  useEffect(() => {
    live.current = { logout, queryClient, router };
  });
  const signedIn = !!token;

  const markActive = useCallback(() => {
    const now = Date.now();
    lastActivity.current = now;
    if (now - lastWrite.current >= WRITE_EVERY_MS) {
      lastWrite.current = now;
      writeShared(now);
    }
  }, []);

  useEffect(() => {
    if (!signedIn || !isTouchDevice()) return;
    signingOut.current = false;
    markActive();
    lastWrite.current = Date.now();
    writeShared(lastActivity.current);

    const signOutNow = async () => {
      if (signingOut.current) return;
      signingOut.current = true;
      setSecondsLeft(null);
      try {
        await live.current.logout();
      } finally {
        toast.info('Signed out after 3 minutes without activity.');
        live.current.router.replace('/login');
      }
    };

    const check = () => {
      if (signingOut.current) return;
      // A save in flight is someone working, however long it takes.
      if (live.current.queryClient.isMutating() > 0) {
        markActive();
        setSecondsLeft(null);
        return;
      }
      const idle = Date.now() - Math.max(lastActivity.current, readShared());
      if (idle >= IDLE_LIMIT_MS) {
        void signOutNow();
      } else if (idle >= IDLE_LIMIT_MS - WARNING_MS) {
        setSecondsLeft(Math.ceil((IDLE_LIMIT_MS - idle) / 1000));
      } else {
        setSecondsLeft(null);
      }
    };

    const onActivity = () => {
      markActive();
      setSecondsLeft(null);
    };
    // Back from the background: judge the time away at once, not at the next tick.
    const onVisible = () => {
      if (document.visibilityState === 'visible') check();
    };

    // Capture phase: scrolling happens inside <main>, and scroll does not bubble.
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onActivity, { capture: true, passive: true });
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(check, TICK_MS);
    return () => {
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onActivity, { capture: true });
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [signedIn, markActive]);

  if (secondsLeft === null) return null;
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-x-3 top-[calc(0.75rem+env(safe-area-inset-top))] z-[100] rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-lg dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100"
    >
      <p className="font-semibold">Signing out in {secondsLeft}s — no activity for a while.</p>
      <p className="text-xs">Touch anywhere to stay signed in.</p>
    </div>
  );
}
