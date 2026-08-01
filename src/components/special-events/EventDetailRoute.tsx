'use client';

import { usePathname } from 'next/navigation';
import { EventDetailPage } from '@/components/special-events/EventDetailPage';
import { EVENT_ID_PLACEHOLDER } from '@/utils/routes';

/**
 * Reads the event id from the address bar rather than from route params.
 *
 * Only one shell is built for this route (see EVENT_ID_PLACEHOLDER), and Firebase
 * rewrites every /special-events/<id> onto it — so the router's params report the
 * placeholder, the file that was actually served, while `usePathname()` reports the
 * URL the user asked for. Only the latter carries the real id.
 */
export function EventDetailRoute() {
  const pathname = usePathname();
  const eventId = decodeURIComponent(pathname.split('/').filter(Boolean).pop() ?? '');

  // Only reachable by typing the placeholder URL directly — no link in the app
  // produces it, and there is nothing sensible to fetch.
  if (!eventId || eventId === EVENT_ID_PLACEHOLDER) {
    return <p className="text-sm text-muted-foreground">No event selected.</p>;
  }

  return <EventDetailPage eventId={eventId} />;
}
