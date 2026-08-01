import type { QueryClient } from '@tanstack/react-query';

/**
 * Registration seam for the plain-async layer of the product price facade.
 *
 * Why this exists: `useAuth()` is React state, so there is no global store a plain
 * async function can read a token from. And the token it exposes is captured once
 * and never refreshed, while Supabase access tokens expire — so reading a fresh one
 * via `supabase.auth.getSession()` (which auto-refreshes) is strictly more correct
 * for non-React callers.
 *
 * The QueryClient is registered here too so the plain functions can go through
 * `fetchQuery` and share ONE cache with the React hooks. Without that, a
 * module-level cache here would drift from the React Query cache on every
 * mutation — exactly the stale-price bug this module exists to remove.
 *
 * Called once from providers/QueryProvider.tsx. React hooks pass their token
 * explicitly and use useQueryClient(), so they work even if this is never wired.
 */

export interface ProductPriceConfig {
  getToken: () => string | Promise<string>;
  queryClient: QueryClient;
}

let config: ProductPriceConfig | null = null;

export function configureProductPrice(cfg: ProductPriceConfig): void {
  config = cfg;
}

/** @internal Explicit token wins; then the configured getter. */
export async function resolveToken(explicit?: string): Promise<string> {
  if (explicit) return explicit;
  if (config) return (await config.getToken()) || '';

  // Fallback so the module still works if configureProductPrice was never called.
  // Dynamic import keeps the Supabase client out of the module graph of anything
  // that merely imports this facade, keeping SSR bundles clean.
  try {
    const { supabase } = await import('@/lib/supabase/client');
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? '';
  } catch {
    return '';
  }
}

/** @internal Throws with an actionable message rather than a null deref. */
export function resolveQueryClient(): QueryClient {
  if (!config?.queryClient) {
    throw new Error(
      'productPrice: no QueryClient registered. Call configureProductPrice({ queryClient, getToken }) ' +
        'at startup (see providers/QueryProvider.tsx), or use the React hooks in @/lib/queries instead.',
    );
  }
  return config.queryClient;
}

/** @internal Test seam. */
export function resetProductPriceConfig(): void {
  config = null;
}
