import { Loader2 } from 'lucide-react';

/**
 * Landing route.
 *
 * This used to be a server `redirect('/login')`. A static export has no server to
 * run it, so the decision moved into RouteGuard (mounted in the root layout), which
 * sends '/' to the role's home when there is a session and to /login when there
 * isn't — the same rule the old middleware applied.
 *
 * The guard holds its own spinner until it has decided, so this body is only ever
 * on screen for the instant before the redirect commits. Match that spinner rather
 * than flashing something different.
 */
export default function RootPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  );
}
