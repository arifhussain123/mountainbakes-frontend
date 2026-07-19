'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';

/**
 * Registers the offline/caching service worker and surfaces an update toast
 * when a new version is waiting. Registered only in production builds so that
 * cache-first asset caching never interferes with the dev HMR pipeline —
 * for local PWA testing run `pnpm --filter @mb/web build && start`.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    let reloading = false;

    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    const register = async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });

        const promptUpdate = (worker: ServiceWorker) => {
          toast('A new version is available', {
            description: 'Refresh to get the latest Mountain Bakes ERP.',
            duration: Infinity,
            action: {
              label: 'Refresh',
              onClick: () => worker.postMessage({ type: 'SKIP_WAITING' }),
            },
          });
        };

        // A worker already waiting (installed on a previous visit).
        if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);

        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              promptUpdate(installing);
            }
          });
        });
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
