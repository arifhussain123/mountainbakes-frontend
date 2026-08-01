'use client';

import { useProductionRealtime } from '@/hooks/useProductionRealtime';
import { usePriceRealtime } from '@/hooks/usePriceRealtime';
import { useEventsRealtime } from '@/hooks/useEventsRealtime';

/**
 * App-wide notification → cache/toast bridge, mounted once in the dashboard
 * layout (inside RealtimeProvider).
 *
 * These hooks turn incoming notifications into React Query invalidations and
 * toasts. They used to be mounted per-page, so a demand/approval toast only
 * fired while the user happened to be on the matching page — and could
 * double-fire when two mounted pages overlapped. Mounting them once here makes
 * the toasts and cache refreshes fire regardless of the current route, with a
 * single de-dup `seen` set per hook.
 *
 * Renders nothing; it exists solely for its effects.
 */
export function RealtimeBridge() {
  useProductionRealtime();
  usePriceRealtime();
  useEventsRealtime();
  return null;
}
