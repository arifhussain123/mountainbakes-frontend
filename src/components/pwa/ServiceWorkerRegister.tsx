'use client';

import { useEffect } from 'react';

/**
 * Registers the offline/caching service worker. Registered only in production
 * builds so that cache-first asset caching never interferes with the dev HMR
 * pipeline — for local PWA testing run `pnpm --filter @mb/web build && start`.
 *
 * It no longer decides *when* an update is applied. That belongs to
 * AppRefreshProvider (hooks/useAppRefresh.tsx), which knows whether anyone is
 * mid-entry; the indefinite "new version available" toast this used to raise is
 * now the Topbar's Refresh button lighting up. All that is left here is
 * registration, plus the reload that completes a handover the app asked for.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    let reloading = false;

    // Capture whether this page was already under a worker's control. On a first
    // ever visit `clients.claim()` fires this same event with no update
    // involved — reloading there would bounce the page for no reason.
    const hadController = !!navigator.serviceWorker.controller;

    const onControllerChange = () => {
      if (!hadController || reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    const register = async () => {
      try {
        await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      } catch (err) {
        console.error('[pwa] service worker registration failed', err);
      }
    };

    // Register after load so it never competes with initial page resources.
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  return null;
}
