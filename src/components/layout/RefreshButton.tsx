'use client';

import { RefreshCw } from '@/utils/icons';
import { Button } from '@/components/ui/button';
import { useAppRefresh } from '@/hooks/useAppRefresh';

/**
 * The Refresh control, centred in the Topbar.
 *
 * Two jobs behind one button, which is why it changes appearance rather than
 * splitting in two:
 *
 *   normal        pulls the latest data into the screen you are on.
 *   update ready  a newer build of the app is live; pressing it reloads onto
 *                 that build. Coloured and labelled, because this is the one
 *                 case where pressing it costs you the page you are on.
 *
 * Centred deliberately: in the installed PWA there is no browser reload button,
 * so for those users this is the only way to ask the app to catch up.
 */
export function RefreshButton() {
  const { refreshing, updateReady, refreshNow } = useAppRefresh();

  return (
    <Button
      variant={updateReady ? 'default' : 'ghost'}
      size="sm"
      onClick={() => void refreshNow()}
      disabled={refreshing}
      aria-label={updateReady ? 'Update available — reload the app' : 'Refresh'}
      title={
        updateReady
          ? 'A new version of the app is available — press to load it'
          : 'Refresh the data on this screen'
      }
      className="relative h-9 shrink-0 gap-2 px-3"
    >
      <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
      {/* The word is worth the space when it is a warning; on a normal day the
          icon carries it and the label only shows where there is room. */}
      <span className={updateReady ? 'text-sm font-medium' : 'hidden text-sm sm:inline'}>
        {refreshing ? 'Refreshing…' : updateReady ? 'Update' : 'Refresh'}
      </span>

      {/* Draws the eye to a button that is otherwise quiet chrome. */}
      {updateReady && !refreshing && (
        <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-card" />
        </span>
      )}
    </Button>
  );
}
