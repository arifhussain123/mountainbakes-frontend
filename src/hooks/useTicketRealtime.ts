'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useNotifications } from './useNotifications';

/**
 * Real-time bridge for the Support / Query ticket system. Like the production and
 * price bridges, it piggybacks on the existing `notifications` stream instead of
 * subscribing to ticket tables directly: when a `ticket_*` notification arrives,
 * invalidate the ticket caches so the open page refetches instantly, and toast.
 *
 * Mounted once app-wide via RealtimeBridge. Notifications already present on the
 * first render are marked seen so we never toast history.
 */
export function useTicketRealtime() {
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

    let touched = false;
    for (const n of fresh) {
      if (n.type.startsWith('ticket_')) {
        touched = true;
        toast(`🎫 ${n.title}`, { description: n.message });
      }
    }

    if (touched) {
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['ticket'] });
      qc.invalidateQueries({ queryKey: ['ticketStats'] });
    }
  }, [notifications, qc]);
}
