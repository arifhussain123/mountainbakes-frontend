'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { pingLoginSession } from '@/lib/loginHistory';
import type { QueryClient } from '@tanstack/react-query';

/**
 * The app's refresh controller — one tick that keeps BOTH halves of a running
 * tab current: the data on screen, and the frontend build serving it.
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
 * This replaces the bare `setInterval` that used to live in QueryProvider —
 * still exactly one interval, now with the build check on the same tick and a
 * single source of truth the Refresh button can read and drive.
 *
 * The tick fires every 2 SECONDS, but ONLY the data half runs that often. The
 * two pieces of work that touch the user's session — the Login History ping and
 * the new-build check that can reload the page — stay on their original 2-minute
 * cadence, one out of every sixty ticks. Making the screen near-live must not
 * mean pinging the session sixty times as often, and must not mean a reload
 * lands sixty times as readily on somebody who has just paused.
 *
 * At this cadence the data half is no longer obviously cheap, so it carries
 * guards a slower tick did not need — see `shouldRefetch`. Every one of them
 * exists to keep a near-live screen from costing the session it is drawn in.
 */

/**
 * How often the data on screen is refetched. This is deliberately aggressive:
 * one forced refetch of every mounted query, ~30 times a minute per open tab.
 * `staleTime` does not apply — `refetchQueries` goes to the network regardless —
 * so this number IS the API request rate for a tab sitting on a busy screen.
 */
const REFRESH_INTERVAL_MS = 2 * 1000;

/**
 * Ticks between the session-affecting work: 60 × 2s = the 2 minutes both the
 * Login History ping and the build check ran at before the data tick sped up.
 * Keep these derived from the interval — hardcoding "60" somewhere else is how
 * the ping cadence quietly drifts the next time this number changes.
 */
const SESSION_TICK_EVERY = Math.round((2 * 60 * 1000) / REFRESH_INTERVAL_MS);

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
 * Is a data refetch safe and worth doing *right now*?
 *
 * At a 2-second cadence this question stops being rhetorical. Each guard is a
 * distinct way the tick would otherwise cost more than the freshness is worth:
 *
 *  - **Hidden tab.** A tab left open on another monitor, or a phone with the
 *    screen off, would otherwise fetch every mounted query 30 times a minute
 *    for as long as it is forgotten. Nobody is reading it. The tick resumes on
 *    `visibilitychange`, which also fires an immediate catch-up refetch, so
 *    coming back to the tab shows fresh data rather than the stale snapshot.
 *  - **Dialog open.** Unchanged from the original design: an in-flight refetch
 *    must never reshuffle props out from under someone mid-entry.
 *  - **Mutation in flight.** A refetch that lands mid-save can roll the pending
 *    write back on screen. At 2s this collides with almost every save there is,
 *    where at 2 minutes it was a rarity.
 */
function shouldRefetch(queryClient: QueryClient) {
  if (document.hidden) return false;
  if (dialogOpen()) return false;
  if (queryClient.isMutating() > 0) return false;
  return true;
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
  // impure. 0 until then, which reads as "idle"; harmless, because the only
  // thing that reads it is the build check, which is a full 2 minutes out.
  const lastInteractionAt = useRef<number>(0);

  /**
   * One refetch at a time.
   *
   * The tick is 2s; a refetch of a heavy screen over a slow connection is not.
   * Without this the intervals overlap, each one queueing another full round of
   * requests behind the last, and a tab on a bad connection digs itself into a
   * backlog it never climbs out of. `setInterval` does not wait for an async
   * callback, so the guard has to be explicit.
   */
  const refetching = useRef(false);

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
    // Claim the same slot the tick uses, so a 2-second tick cannot fire a second
    // round of the same requests underneath the button's own refetch. Unlike the
    // tick this ignores `shouldRefetch` — an explicit click is a request to
    // refresh, dialog open or not.
    refetching.current = true;
    try {
      // Data first: if a new build sends us into a reload, at least the refetch
      // was not wasted, and if it does not, this is the whole point of the click.
      await queryClient.refetchQueries({ type: 'active' });
      setLastRefreshedAt(Date.now());

      // An explicit click is consent to be interrupted — apply straight away
      // rather than waiting for the idle window the background tick respects.
      if (await checkForNewBuild()) await applyUpdate();
    } finally {
      refetching.current = false;
      setRefreshing(false);
    }
  }, [queryClient, checkForNewBuild]);

  const refetchData = useCallback(async () => {
    if (refetching.current || !shouldRefetch(queryClient)) return;
    refetching.current = true;
    try {
      await queryClient.refetchQueries({ type: 'active' });
      setLastRefreshedAt(Date.now());
    } catch {
      // Swallowed on purpose. The callers are `void`-ed — an interval and a
      // visibility listener — so a rejection here would surface as an unhandled
      // one, thirty times a minute, for as long as the network is down. The
      // failure is already visible where it matters: each query keeps its own
      // error state, and `lastRefreshedAt` simply stops advancing.
    } finally {
      refetching.current = false;
    }
  }, [queryClient]);

  // Coming back to a hidden tab: catch up at once rather than showing whatever
  // was on screen when it was backgrounded until the next tick.
  useEffect(() => {
    const onVisible = () => { if (!document.hidden) void refetchData(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refetchData]);

  useEffect(() => {
    let ticks = 0;

    const id = setInterval(() => {
      // Every sixtieth tick is a "session tick" — the 2-minute cadence the whole
      // provider used to run at, preserved for the two jobs that reach past the
      // rendered data and into the user's session.
      const sessionTick = ++ticks % SESSION_TICK_EVERY === 0;

      // Data: every tick, subject to `shouldRefetch` and the overlap guard.
      // Unawaited, so a slow refetch cannot hold up the session work below it —
      // at 2s an awaited refetch would be the thing that delays the ping.
      void refetchData();

      if (!sessionTick) return;

      // Login History: this tab is still open. Deliberately on THIS tick rather
      // than a timer of its own — the module comment above is explicit that there
      // must be exactly one interval for the session, and "is the tab still
      // open?" is the same question this tick already exists to ask. Unawaited
      // and self-swallowing, so a failed ping cannot delay anything. Runs even
      // while a Dialog is open, and even hidden: someone mid-entry — or a tab
      // merely backgrounded — is still a live session, and skipping the ping
      // would close their row out from under them. Held at 2 minutes so the
      // faster data tick does not multiply writes to that row sixtyfold.
      void pingLoginSession();

      // Frontend: also held at 2 minutes. Applying a build means reloading, which
      // ends the session on screen — noticing a deploy sooner is worth nothing
      // next to the risk of that reload firing on a sixtyfold shorter fuse.
      // Detected always, applied only when nothing is at stake; when it is not
      // applied the flag stays up, the button lights, and the next session tick
      // tries again.
      void (async () => {
        if (await checkForNewBuild()) {
          if (!isBusy(queryClient, lastInteractionAt.current)) await applyUpdate();
        }
      })();
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [queryClient, checkForNewBuild, refetchData]);

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
