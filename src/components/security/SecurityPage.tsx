'use client';

import { useState } from 'react';
import type { LoginSession } from '@mb/shared';
import { useAuth } from '@/hooks/useAuth';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoginHistoryBoard } from './LoginHistoryBoard';
import { ActiveSessionsBoard } from './ActiveSessionsBoard';
import { SessionDetailDialog } from './SessionDetailDialog';
import { RevokeSessionDialog } from './RevokeSessionDialog';

/**
 * Admin → Security.
 *
 * TWO BOARDS OVER ONE TABLE. Active Sessions is what is happening now — a live
 * roster, grouped by account so that "signed in from three countries at once" is
 * a thing you can see rather than infer. Login History is the record: every
 * sign-in, filtered and paged in SQL. They are tabs rather than two routes
 * because the work moves between them constantly ("this looks odd — has it
 * happened before?"), and a route change would lose the filters on the way back.
 *
 * ACTIVE SESSIONS IS FIRST because it is the tab somebody opens this screen for.
 * The history is where you go once the roster has raised a question.
 *
 * THE DIALOGS LIVE HERE, not inside each board. Both boards open the same detail
 * dialog and the same confirmation, and hoisting them means one instance of each
 * regardless of which tab is showing — so a session opened from the roster and
 * one opened from the history behave identically, and switching tabs with a
 * dialog open does not leave a second copy mounted underneath.
 *
 * NOTHING HERE IS AN AUTHORISATION BOUNDARY. RouteGuard keeps a non-admin off
 * the route and this component hides what it can, but every request these boards
 * make is re-decided by the API against the JWT — the history scopes a non-admin
 * to their own sessions, and both revoke endpoints refuse anyone but a super
 * admin outright.
 */
export function SecurityPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'super_admin';

  const [viewId, setViewId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<{ session: LoginSession; mode: 'one' | 'all' } | null>(null);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Security</h1>
        <p className="text-sm text-muted-foreground">
          Who is signed in, from where, and on what. Locations are resolved from the sign-in
          IP address and are approximate.
        </p>
      </div>

      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">Active Sessions</TabsTrigger>
          <TabsTrigger value="history">Login History</TabsTrigger>
        </TabsList>

        <TabsContent value="active" className="mt-4">
          <ActiveSessionsBoard
            onView={setViewId}
            onRevoke={(session) => setRevoking({ session, mode: 'one' })}
            onRevokeAll={(session) => setRevoking({ session, mode: 'all' })}
          />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <LoginHistoryBoard
            onView={setViewId}
            onRevoke={(session) => setRevoking({ session, mode: 'one' })}
            canRevoke={isAdmin}
          />
        </TabsContent>
      </Tabs>

      <SessionDetailDialog
        sessionId={viewId}
        onClose={() => setViewId(null)}
        {...(isAdmin
          ? {
              onRevoke: (session: LoginSession) => {
                // Closed first, so the confirmation is not stacked on top of the
                // detail it was launched from — two dialogs deep is a place a
                // Cancel button stops meaning what it looks like it means.
                setViewId(null);
                setRevoking({ session, mode: 'one' });
              },
            }
          : {})}
      />

      {revoking && (
        <RevokeSessionDialog
          // Keyed so switching straight from one session's confirmation to
          // another's remounts rather than reusing the first one's typed reason.
          key={`${revoking.session.id}:${revoking.mode}`}
          session={revoking.session}
          mode={revoking.mode}
          onClose={() => setRevoking(null)}
        />
      )}
    </div>
  );
}
