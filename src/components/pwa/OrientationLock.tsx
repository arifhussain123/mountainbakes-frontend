'use client';

import { useEffect } from 'react';

/**
 * Keeps the app in portrait on phones/tablets.
 *
 * The Screen Orientation Lock API only works in a fullscreen or installed
 * (standalone) context and only on browsers that implement it (mainly
 * Android Chrome) — it throws everywhere else, so the call is best-effort
 * and silently ignored on failure. The `landscape:max-lg:flex` overlay below
 * is the actual cross-browser fix: nothing can stop a phone from physically
 * rotating, so instead the app blocks interaction and asks for portrait
 * whenever the viewport reports landscape on a phone/tablet-sized screen.
 * The `max-lg` bound keeps this from firing on desktop monitors that happen
 * to be wider than they are tall.
 */
export function OrientationLock() {
  useEffect(() => {
    const orientation = screen.orientation as ScreenOrientation & { lock?: (type: string) => Promise<void> };
    orientation?.lock?.('portrait').catch(() => {
      // Not fullscreen/standalone, or unsupported — the CSS overlay below covers it.
    });
  }, []);

  return (
    <div
      className="fixed inset-0 z-[9999] hidden flex-col items-center justify-center gap-3 bg-background p-6 text-center landscape:max-lg:flex"
      role="alert"
    >
      <p className="text-lg font-semibold">Please rotate your device</p>
      <p className="text-sm text-muted-foreground">This app is designed for portrait mode.</p>
    </div>
  );
}
