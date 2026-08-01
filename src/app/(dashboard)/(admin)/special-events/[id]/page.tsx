import { EventDetailRoute } from '@/components/special-events/EventDetailRoute';
import { EVENT_ID_PLACEHOLDER } from '@/utils/routes';

/**
 * A static export has to know every path it emits at build time, and event ids are
 * runtime data — so rather than enumerating them, one shell is emitted at the
 * reserved placeholder id and Firebase Hosting rewrites every /special-events/<id>
 * onto it (see `rewrites` in firebase.json). EventDetailRoute reads the real id
 * from the URL.
 *
 * Returning [] here instead would emit no page at all, and a hard load or refresh
 * of an event would 404 — client-side navigation from the list would be the only
 * way in.
 */
export function generateStaticParams() {
  return [{ id: EVENT_ID_PLACEHOLDER }];
}

export default function Page() {
  return (
    <div className="p-4 sm:p-6">
      <EventDetailRoute />
    </div>
  );
}
