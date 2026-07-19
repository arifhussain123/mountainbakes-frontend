'use client';

import { useOwnPresence } from '@/hooks/usePresence';

export function PresenceWatcher() {
  useOwnPresence();
  return null;
}
