'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useNotifications } from './useNotifications';

/**
 * Real-time price propagation.
 *
 * The API already fires a `price_changed` notification to branch managers when a
 * price goes live (products.routes.ts). Rather than opening a direct realtime
 * subscription on `products` — blocked by RLS, and against the API-data-layer
 * convention — we piggyback on the existing notifications stream and invalidate the products
 * cache, exactly like useProductionRealtime does for production collections.
 *
 * React Query invalidation already keeps tabs in one browser consistent; this is
 * what makes a price change reach OTHER devices — the cashier's till included —
 * without a reload.
 *
 * Call once from any page that displays prices. Notifications already present on
 * mount are marked seen, so we never toast history on first render.
 */
export function usePriceRealtime(opts?: { toastOnChange?: boolean }) {
  const qc = useQueryClient();
  const { notifications } = useNotifications();
  const seen = useRef<Set<string>>(new Set());
  const initialized = useRef(false);

  useEffect(() => {
    if (!notifications.length) return;

    if (!initialized.current) {
      notifications.forEach((n) => seen.current.add(n.id));
      initialized.current = true;
      return;
    }

    const fresh = notifications.filter((n) => !seen.current.has(n.id));
    if (!fresh.length) return;
    fresh.forEach((n) => seen.current.add(n.id));

    const priceChanges = fresh.filter((n) => n.type === 'price_changed');
    if (!priceChanges.length) return;

    // Bare prefix — catches qk.products() and qk.products(true) alike.
    qc.invalidateQueries({ queryKey: ['products'] });
    qc.invalidateQueries({ queryKey: ['priceHistory'] });

    if (opts?.toastOnChange) {
      priceChanges.forEach(() => toast('💰 Price Updated'));
    }
  }, [notifications, qc, opts?.toastOnChange]);
}
