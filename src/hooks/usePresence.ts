'use client';

import type { UserPresence } from '@mb/shared';

/**
 * Presence is disabled — its backing datastore was removed. The hooks are kept
 * so `<PresenceWatcher>` and `<ChatPanel>` still compile; they no-op until
 * presence is reimplemented on Supabase.
 */

// Own presence management — call once at app root
export function useOwnPresence(): void {
  // no-op
}

// Read presence for a set of UIDs
export function usePresence(_uids: string[]): Record<string, UserPresence> {
  return {};
}
