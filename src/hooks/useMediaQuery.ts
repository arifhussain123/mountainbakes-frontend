'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Tailwind's default breakpoint minimums, in px.
 *
 * Kept in sync with Tailwind by hand because v4 is CSS-first — there is no
 * tailwind.config to read these from, and globals.css only overrides the type
 * scale, not the breakpoints.
 */
export const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

/**
 * Subscribe to a media query.
 *
 * Returns false on the server and on the first client render, then settles to
 * the real value after mount. That means layout decisions driven by this hook
 * flash their mobile branch once on desktop — so prefer a plain `md:` class when
 * CSS alone can express the layout, and reach for this hook only when the
 * *behaviour* differs (e.g. whether tapping a nav link should close a drawer),
 * not merely the styling.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onStoreChange);
      return () => mql.removeEventListener('change', onStoreChange);
    },
    [query]
  );

  // useSyncExternalStore rather than useEffect + setState: matchMedia is exactly
  // the "external store" this hook exists for, and reading it in getSnapshot
  // means the first committed render already has the right value instead of
  // rendering false and then re-rendering. It also keeps the React Compiler's
  // set-state-in-effect rule satisfied.
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false // Server snapshot: assume the mobile branch, matching mobile-first CSS.
  );
}

/** True at or above the given breakpoint. `useBreakpoint('md')` ≙ Tailwind `md:`. */
export function useBreakpoint(bp: Breakpoint): boolean {
  return useMediaQuery(`(min-width: ${BREAKPOINTS[bp]}px)`);
}

/**
 * True below `md` — the phone layout, where the bottom nav and drawer apply.
 *
 * Replaces the imperative `window.innerWidth < 768` checks that were scattered
 * through the layout components: those read the width once during an event and
 * never updated on resize or orientation change.
 */
export function useIsMobile(): boolean {
  return !useBreakpoint('md');
}
