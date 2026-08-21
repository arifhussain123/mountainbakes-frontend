'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { startLoginSession } from '@/lib/loginHistory';

/**
 * Opens the Login History session for the signed-in user.
 *
 * Mounted once in the dashboard layout, alongside RealtimeBridge and for the
 * same reason: it must run regardless of the current route and exactly once per
 * session, not once per navigation.
 *
 * WHY MOUNT AND NOT AN AUTH EVENT. A static export has no auth event to hook on
 * a hard reload — the tab lands straight on the dashboard with a valid session
 * already restored from Web Storage, and no sign-in ever fires. So the trigger
 * is "a signed-in dashboard exists", and telling a genuine new login apart from
 * a reload is left to the server, which is the only side that can decide it:
 * the client offers back the id it holds and the server honours it only if that
 * session is really still live and really this user's.
 *
 * The ref guards against a second call from React's development double-invoke
 * and from the token refreshing under us; `uid` in the dependency list is what
 * lets a genuine account switch open a new session rather than resume the old
 * one.
 *
 * Renders nothing. The ping lives on AppRefreshProvider's existing 2-minute
 * tick and the close in AuthProvider's logout — neither belongs to a component.
 */
export function LoginHistoryBridge() {
  const { user } = useAuth();
  const startedFor = useRef<string | null>(null);

  useEffect(() => {
    const uid = user?.uid;
    if (!uid || startedFor.current === uid) return;
    startedFor.current = uid;
    void startLoginSession();
  }, [user?.uid]);

  return null;
}
