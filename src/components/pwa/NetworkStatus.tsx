'use client';

import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

const OFFLINE_TOAST = 'mb-offline';

/**
 * Watches connectivity and drives the offline experience:
 *  - a persistent notice while disconnected, saying what still works;
 *  - on reconnect, refetches everything on screen and confirms.
 *
 * The message is deliberately specific about what offline means HERE. It used to
 * promise "changes will sync automatically once you reconnect", which was never
 * true: the Background Sync queue that would have carried them is disabled and
 * nothing was ever put in it (see public/sw.js). Reading offline is what works —
 * the last synced data is restored from disk by OfflineCache — and a write is
 * refused up front by apiCall with a message saying so.
 */
export function NetworkStatus() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const goOffline = () => {
      toast.warning("You're offline", {
        id: OFFLINE_TOAST,
        description: 'You can still look things up. Saving is paused until you reconnect.',
        duration: Infinity,
      });
    };

    const goOnline = () => {
      toast.dismiss(OFFLINE_TOAST);
      // Everything on screen is now whatever was last synced, so pull it all
      // fresh rather than waiting for it to go stale on its own.
      queryClient.invalidateQueries();
      toast.success('Back online', { description: 'Bringing your data up to date…', duration: 2500 });
    };

    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);

    // Reflect the state on first mount (e.g. loaded while already offline).
    if (typeof navigator !== 'undefined' && !navigator.onLine) goOffline();

    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, [queryClient]);

  return null;
}
