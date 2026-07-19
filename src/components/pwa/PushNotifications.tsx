'use client';

/**
 * Web push is disabled — the messaging backend it ran on has been removed,
 * along with its service worker. Kept as a mounted no-op so the
 * dashboard layout is unchanged; reimplement on the Web Push API when needed.
 */
export function PushNotifications() {
  return null;
}
