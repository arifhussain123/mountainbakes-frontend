'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNotifications } from './useNotifications';

/**
 * Real-time bridge for a branch's stock figures.
 *
 * Branch stock moves from four directions, and three of them originate somewhere
 * other than the page showing them:
 *
 *   - Production approves a demand      → `production_reviewed`  (New Stock ↑)
 *   - A branch return reaches Production→ `production_return`     (Returned ↑)
 *   - Admin corrects a stock or sale query from the Support Center
 *                                        → `support_resolved`     (any figure)
 *
 * Until now the Stock page fetched once on mount and never again, so an admin
 * correction landed in the database and the ledger while the branch manager kept
 * reading yesterday's numbers off an open tab.
 *
 * Like `usePriceRealtime` and `useProductionRealtime`, this piggybacks on the
 * existing `notifications` stream rather than opening a realtime subscription on
 * `stock` — that table is not in the `supabase_realtime` publication, RLS would
 * block it, and it would sidestep the API data layer. Invalidating the bare
 * `['stock']` prefix catches `qk.stock(branchId)` for every branch, which is what a
 * super_admin switching branches needs.
 *
 * `support_resolved` is not filtered by reference type: the notification carries no
 * subtype, a sale correction moves stock too (`edit_sale_items`), and a refetch is
 * cheap next to showing a stale balance to someone about to sell from it.
 *
 * Call once from any page that displays stock. Notifications already present on
 * mount are marked seen, so arriving on the page never triggers a redundant refetch.
 */
const STOCK_MOVING_TYPES = new Set(['production_reviewed', 'production_return', 'support_resolved']);

export function useStockRealtime() {
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

    // No toast here — the notification itself already reached the user, and the
    // resolution note spells out the before → after. This only refreshes data.
    if (fresh.some((n) => STOCK_MOVING_TYPES.has(n.type))) {
      qc.invalidateQueries({ queryKey: ['stock'] });
    }
  }, [notifications, qc]);
}
