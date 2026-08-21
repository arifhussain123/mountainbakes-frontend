'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { pingLoginSession } from '@/lib/loginHistory';
import type { QueryClient } from '@tanstack/react-query';

/**
 * The app's refresh controller — one 2-minute tick that keeps BOTH halves of a
 * running tab current: the data on screen, and the frontend build serving it.
 *
 * The two halves are not equally safe, which is the whole design:
 *
 *   Data     — refetched in place. React Query swaps the new rows in behind the
 *              rendered ones, so there is no reload, no spinner and no flash.
 *              Cheap and non-destructive, so it runs on nearly every tick.
 *   Frontend — can only be applied by reloading the page, which destroys
 *              everything unsaved. So a new build is DETECTED in the background
 *              but never applied while somebody is working (see `isBusy`).
 *
 * This replaces the bare `setInterval` that used to live in QueryProvider — same
 * cadence and same dialog guard, now with the build check on the same tick and
 * a single source of truth the Refresh button can read and drive.
 */

const REFRESH_INTERVAL_MS = 2 * 60 * 1000;

/**
 * How long the app must have been left alone before a new build is applied on
 * its own. Someone who never pauses simply never gets interrupted — they take
 * the update from the button, or on their next natural page load.
 */
const IDLE_BEFORE_AUTO_APPLY_MS = 30 * 1000;

/** Written fresh by scripts/generate-version.mjs on every build. */
const VERSION_URL = '/version.json';

type AppRefreshValue = {
  /** A manual refresh is in flight — drives the button's spinner. */
  refreshing: boolean;
  /** A newer build is live but has not been applied, because applying it would interrupt. */
  updateReady: boolean;
  /** Epoch ms of the last successful data refresh, or null before the first. */
  lastRefreshedAt: number | null;
  /** Refetch now, and apply a waiting build if there is one. What the button calls. */
  refreshNow: () => Promise<void>;
};

const AppRefreshContext = createContext<AppRefreshValue | null>(null);

/** A Dialog is mounted — New Sale, New Order, print preview, any edit form. */
function dialogOpen() {
  // `[data-slot="dialog-content"]` is in the DOM only while a Dialog is open
  // (components/ui/dialog.tsx), so this needs no per-dialog wiring.
  return !!document.querySelector('[data-slot="dialog-content"]');
}

/**
 * Is the user in the middle of something a reload would throw away?
 *
 * Deliberately generous — a missed update costs two minutes, an update applied
 * over a half-typed sale costs the sale.
 */
function isBusy(queryClient: QueryClient, lastInteractionAt: number) {
  if (dialogOpen()) return true;

  // Focus sits in something editable: they are typing right now.
  const el = document.activeElement as HTMLElement | null;
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) {
    return true;
  }

  // A save is in flight. Reloading here loses the user's confirmation of a write
  // that may well have landed — the worst possible moment.
  if (queryClient.isMutating() > 0) return true;

  return Date.now() - lastInteractionAt < IDLE_BEFORE_AUTO_APPLY_MS;
}

/** The live build stamp, or null if it cannot be read (dev, offline, 404). */
async function readDeployedVersion(): Promise<string | null> {
  try {
    // no-store, or the check re-reads the very response it is trying to notice
    // has changed.
    const res = await fetch(VERSION_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as { buildId?: string };
    return body.buildId ?? null;
  } catch {
    return null; // offline, or no stamp in a dev build — simply no update to report
  }
}

/**
 * Reload onto the new build.
 *
 * The service worker only needs telling when a new *worker* is waiting, which is
 * rare — `sw.js` rarely changes. The reload alone is what picks up new JS: the
 * SW serves navigations network-first, so the fresh HTML arrives and points at
 * the new hashed bundles.
 */
async function applyUpdate() {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg?.waiting) {
      reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      // ServiceWorkerRegister reloads on `controllerchange`; give it a moment to
      // take over so we do not reload out from under the handover.
      await new Promise((r) => setTimeout(r, 300));
    }
  } catch {
    /* no SW (dev, unsupported) — the reload below is enough on its own */
  }
  window.location.reload();
}

export function AppRefreshProvider({ children }: { children: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [updateReady, setUpdateReady] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);

  // The build this tab booted on. Every check compares against it, so a reload
  // always resets the baseline — there is no way to get stuck in a reload loop.
  const bootVersion = useRef<string | null>(null);
  // Stamped on mount, not in the initialiser — `Date.now()` during render is
  // impure. 0 until then, which reads as "idle", and the first tick is two
  // minutes out regardless.
  const lastInteractionAt = useRef<number>(0);

  useEffect(() => {
    readDeployedVersion().then((v) => { bootVersion.current = v; });
  }, []);

  // Cheap passive listeners; `pointerdown`/`keydown` are enough to tell working
  // from idle without watching every mousemove.
  useEffect(() => {
    const touch = () => { lastInteractionAt.current = Date.now(); };
    touch(); // opening a screen counts as having just used it
    window.addEventListener('pointerdown', touch, { passive: true });
    window.addEventListener('keydown', touch, { passive: true });
    return () => {
      window.removeEventListener('pointerdown', touch);
      window.removeEventListener('keydown', touch);
    };
  }, []);

  /** True when a newer build is live. Records it for the button either way. */
  const checkForNewBuild = useCallback(async () => {
    const live = await readDeployedVersion();
    if (!live) return false;
    // First successful read wins the baseline, for a tab that booted offline.
    if (!bootVersion.current) { bootVersion.current = live; return false; }
    const isNew = live !== bootVersion.current;
    if (isNew) setUpdateReady(true);
    return isNew;
  }, []);

  const refreshNow = useCallback(async () => {
    setRefreshing(true);
    try {
      // Data first: if a new build sends us into a reload, at least the refetch
      // was not wasted, and if it does not, this is the whole point of the click.
      await queryClient.refetchQueries({ type: 'active' });
      setLastRefreshedAt(Date.now());

      // An explicit click is consent to be interrupted — apply straight away
      // rather than waiting for the idle window the background tick respects.
      if (await checkForNewBuild()) await applyUpdate();
    } finally {
      setRefreshing(false);
    }
  }, [queryClient, checkForNewBuild]);

  useEffect(() => {
    const id = setInterval(async () => {
      // Login History: this tab is still open. Deliberately on THIS tick rather
      // than a timer of its own — the module comment above is explicit that there
      // must be exactly one interval for the session, and "is the tab still
      // open?" is the same question this tick already exists to ask. Unawaited
      // and self-swallowing, so a failed ping cannot delay or skip the refresh
      // below it. Runs even while a Dialog is open: someone mid-entry is the
      // clearest possible evidence the session is alive.
      void pingLoginSession();

      // Data: skipped only while a Dialog is open, so an in-flight refetch never
      // reshuffles props out from under someone mid-entry.
      if (!dialogOpen()) {
        await queryClient.refetchQueries({ type: 'active' });
        setLastRefreshedAt(Date.now());
      }

      // Frontend: detected always, applied only when nothing is at stake. When
      // it is not applied the flag stays up, the button lights, and the next
      // tick tries again.
      if (await checkForNewBuild()) {
        if (!isBusy(queryClient, lastInteractionAt.current)) await applyUpdate();
      }
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [queryClient, checkForNewBuild]);

  return (
    <AppRefreshContext.Provider value={{ refreshing, updateReady, lastRefreshedAt, refreshNow }}>
      {children}
    </AppRefreshContext.Provider>
  );
}

export function useAppRefresh() {
  const ctx = useContext(AppRefreshContext);
  if (!ctx) throw new Error('useAppRefresh must be used within AppRefreshProvider');
  return ctx;
}
