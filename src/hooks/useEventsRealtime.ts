'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useNotifications } from './useNotifications';

/**
 * Real-time bridge for the Special Events module.
 *
 * Same approach as useProductionRealtime: rather than opening a realtime
 * subscription on the event tables (they are API-owned and default-deny under
 * RLS), piggyback on the existing `notifications` stream. When an event
 * notification arrives, invalidate the caches the open page is reading.
 *
 * Mounted once in RealtimeBridge, not per page — otherwise a toast only fires
 * while the user happens to be on the matching screen, and two mounted pages
 * double-fire it.
 */
export function useEventsRealtime() {
  const qc = useQueryClient();
  const { notifications } = useNotifications();
  const seen = useRef<Set<string>>(new Set());
  const initialized = useRef(false);

  useEffect(() => {
    if (!notifications.length) return;

    // Everything present on mount is history — never toast it.
    if (!initialized.current) {
      notifications.forEach((n) => seen.current.add(n.id));
      initialized.current = true;
      return;
    }

    const fresh = notifications.filter((n) => !seen.current.has(n.id));
    if (!fresh.length) return;
    fresh.forEach((n) => seen.current.add(n.id));

    let refreshEvents = false;
    let refreshDemands = false;

    for (const n of fresh) {
      switch (n.type) {
        case 'event_created':
          refreshEvents = true;
          toast('📅 New Special Event');
          break;
        case 'event_reminder':
          refreshEvents = true;
          toast(`🔔 ${n.title}`);
          try {
            navigator.vibrate?.(200);
          } catch {
            /* not supported */
          }
          break;
        case 'event_demand_due':
          refreshEvents = true;
          refreshDemands = true;
          // The deadline one deserves to stay on screen longer than the rest.
          toast(`⏰ ${n.title}`, { duration: 10_000 });
          break;
        case 'event_demand_submitted':
          refreshDemands = true;
          refreshEvents = true;
          toast('📥 Event Demand Submitted');
          break;
        case 'event_demand_reviewed':
          refreshDemands = true;
          refreshEvents = true;
          toast(n.title.includes('Approved') ? '✅ Event Demand Approved' : '❌ Event Demand Rejected');
          break;
        case 'event_production_updated':
          refreshEvents = true;
          qc.invalidateQueries({ queryKey: ['eventProductionStatus'] });
          break;
        default:
          break;
      }
    }

    if (refreshEvents) {
      qc.invalidateQueries({ queryKey: ['specialEvents'] });
      qc.invalidateQueries({ queryKey: ['specialEvent'] });
      qc.invalidateQueries({ queryKey: ['eventCalendar'] });
      qc.invalidateQueries({ queryKey: ['eventSummary'] });
    }
    if (refreshDemands) {
      qc.invalidateQueries({ queryKey: ['eventDemands'] });
      qc.invalidateQueries({ queryKey: ['eventMyDemand'] });
      qc.invalidateQueries({ queryKey: ['eventConsolidatedDemand'] });
    }
  }, [notifications, qc]);
}
