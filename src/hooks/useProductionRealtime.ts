'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useNotifications } from './useNotifications';

/**
 * Real-time bridge for the Production module. Rather than opening new realtime
 * subscriptions on business tables (blocked by RLS, and against the
 * API-data-layer convention), we piggyback on the existing `notifications`
 * stream: when a production-related notification arrives, invalidate the right
 * React Query caches so the open page refetches instantly. New demands also
 * surface a toast + device vibration.
 *
 * Call once from a Production page. Notifications already seen on mount are
 * marked so we never toast history on first render.
 */
export function useProductionRealtime() {
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

    let refreshOrders = false;
    let refreshStock = false;

    for (const n of fresh) {
      if (n.type === 'production_demand') {
        refreshOrders = true;
        toast('🔔 New Production Demand Received');
        try {
          navigator.vibrate?.(200);
        } catch {
          /* not supported */
        }
      } else if (n.type === 'production_reviewed') {
        // Received by the branch manager when Production approves/rejects their
        // demand. Refresh their order list so the status flips live, and toast.
        refreshOrders = true;
        refreshStock = true;
        const approved = n.title.includes('Approved');
        toast(approved ? '✅ Production Order Approved' : '❌ Production Order Rejected');
      } else if (n.type === 'production_return') {
        refreshStock = true;
      }
    }

    if (refreshOrders) {
      qc.invalidateQueries({ queryKey: ['productionOrders'] });
      qc.invalidateQueries({ queryKey: ['productionOverview'] });
    }
    if (refreshStock) {
      qc.invalidateQueries({ queryKey: ['productionStock'] });
      qc.invalidateQueries({ queryKey: ['productionBranchStock'] });
      qc.invalidateQueries({ queryKey: ['productionReturns'] });
      qc.invalidateQueries({ queryKey: ['productionOverview'] });
    }
  }, [notifications, qc]);
}
