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
 * The width bound keeps this from firing on desktop monitors that happen to be
 * wider than they are tall.
 *
 * The HEIGHT bound is what makes it mean "a phone on its side" and nothing
 * else. Width alone also matched an iPad in Split View or Stage Manager, and a
 * desktop window dragged narrow — all landscape, all under 1024px, all perfectly
 * usable, all locked out by a full-screen notice. iOS implements neither the
 * lock above nor the manifest's `orientation`, so there this overlay is the
 * whole mechanism and has to be exact. No phone is taller than 500px sideways;
 * no tablet is shorter.
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
      className="fixed inset-0 z-[9999] hidden flex-col items-center justify-center gap-3 bg-background p-6 text-center [@media(orientation:landscape)_and_(max-width:1023px)_and_(max-height:500px)]:flex"
      role="alert"
    >
      <p className="text-lg font-semibold">Please rotate your device</p>
      <p className="text-sm text-muted-foreground">This app is designed for portrait mode.</p>
    </div>
  );
}
