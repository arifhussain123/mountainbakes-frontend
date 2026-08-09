'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, useEffect } from 'react';
import { configureProductPrice } from '@/utils/productPrice';

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            retry: 1,
            // Live data is refreshed by notification-driven invalidation
            // (useProductionRealtime / usePriceRealtime), so refetching on every
            // window focus is redundant and just multiplies API traffic.
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  // Give the product-price facade the same QueryClient the hooks use, so its
  // plain async functions share one cache and one invalidation path with them.
  // getSession() returns an auto-refreshed access token, unlike the token useAuth
  // captures once.
  useEffect(() => {
    configureProductPrice({
      queryClient,
      getToken: async () => {
        const { supabase } = await import('@/lib/supabase/client');
        const { data } = await supabase.auth.getSession();
        return data.session?.access_token ?? '';
      },
    });
  }, [queryClient]);

  // Fallback freshness net on top of notification-driven invalidation: every 2
  // minutes, silently refetch whatever's currently on screen (no page reload,
  // no visible flash — React Query just swaps data in place). Skipped whenever
  // a Dialog is open (New Sale, New Order, print preview, any edit form) so an
  // in-flight refetch never reshuffles props out from under someone mid-entry —
  // `[data-slot="dialog-content"]` is only in the DOM while a Dialog is open
  // (see `components/ui/dialog.tsx`), so this needs no per-dialog wiring.
  useEffect(() => {
    const REFRESH_INTERVAL_MS = 2 * 60 * 1000;
    const id = setInterval(() => {
      if (document.querySelector('[data-slot="dialog-content"]')) return;
      queryClient.refetchQueries({ type: 'active' });
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [queryClient]);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
