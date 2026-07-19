'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

const OFFLINE_TOAST = 'mb-offline';

/**
 * Watches connectivity and drives offline UX + auto-sync:
 *  - shows a persistent "You're offline" toast while disconnected;
 *  - on reconnect, refetches server data (React Query) and asks the service
 *    worker to flush any Background-Sync queue, then confirms.
 */
export function NetworkStatus() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const goOffline = () => {
      toast.error("You're offline", {
        id: OFFLINE_TOAST,
        description: 'Changes will sync automatically once you reconnect.',
        duration: Infinity,
      });
    };

    const goOnline = () => {
      toast.dismiss(OFFLINE_TOAST);
      // Refresh any stale data now that the network is back.
      queryClient.invalidateQueries();
      // Ask the service worker to replay queued offline mutations.
      navigator.serviceWorker?.controller?.postMessage({ type: 'FLUSH_QUEUE' });
      toast.success('Back online', { description: 'Syncing your latest data…', duration: 2500 });
    };

    const onSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'SYNC_COMPLETE') {
        queryClient.invalidateQueries();
        toast.success('Changes synced');
      }
    };

    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    navigator.serviceWorker?.addEventListener('message', onSwMessage);

    // Reflect the state on first mount (e.g. loaded while already offline).
    if (typeof navigator !== 'undefined' && !navigator.onLine) goOffline();

    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
      navigator.serviceWorker?.removeEventListener('message', onSwMessage);
    };
  }, [queryClient]);

  return null;
}
