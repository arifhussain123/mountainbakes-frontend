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
            // Held for a day rather than the default five minutes, because this
            // cache is now written to disk for offline reading (OfflineCache).
            // At the default, a screen the user had not opened in five minutes
            // would be evicted from memory and so be missing from the next
            // snapshot — the app would go offline having forgotten most of
            // itself. Memory cost is bounded by how much this app fetches in a
            // day, which is the same data the snapshot already holds.
            gcTime: 24 * 60 * 60 * 1000,
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

  // The 2-minute fallback refetch that used to live here now runs in
  // AppRefreshProvider (hooks/useAppRefresh.tsx), which puts it on the same tick
  // as the new-build check and exposes it to the Topbar's Refresh button. Same
  // cadence, same dialog guard — one timer instead of two, and one place that
  // decides whether refreshing right now would interrupt someone.

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
