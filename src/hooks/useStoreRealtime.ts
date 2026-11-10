'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useNotifications } from './useNotifications';

/**
 * Dry Items Store notifications → toasts and a refresh of the ['store'] cache.
 *
 * Mounted once in RealtimeBridge, like the other bridges. Each notification
 * reaches only the people it is addressed to (the Store keeper for a new
 * demand, the requester for a decision or an issue, Admin for a query or a
 * receipt difference), so this need not look at the role. History already in
 * the feed on mount is marked seen and never toasted.
 */
const STORE_TYPES = new Set([
  'store_demand',
  'store_demand_reviewed',
  'store_issue',
  'store_issue_received',
  'store_query',
  'store_query_reply',
]);

export function useStoreRealtime() {
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

    const mine = fresh.filter((n) => STORE_TYPES.has(n.type));
    if (!mine.length) return;
    for (const n of mine) {
      toast(n.title, { description: n.message });
      if (n.type === 'store_demand') {
        try {
          navigator.vibrate?.(200);
        } catch {
          /* not supported */
        }
      }
    }
    qc.invalidateQueries({ queryKey: ['store'] });
  }, [notifications, qc]);
}
