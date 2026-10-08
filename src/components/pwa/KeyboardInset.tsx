'use client';

import { useEffect } from 'react';

/**
 * Publishes the on-screen keyboard's height as the CSS variable `--kb` on
 * <html>, for the Dialog to sit above (see ui/dialog.tsx).
 *
 * WHY THIS EXISTS. When the iOS keyboard opens, the LAYOUT viewport does not
 * change — only the visual viewport shrinks. Anything `position: fixed; bottom:
 * 0` therefore stays where it was, which is now behind the keyboard, and CSS
 * has no unit for "the part of the screen that is not keyboard". Chrome on
 * Android behaves the same way since v108. `visualViewport` is the one place
 * the real figure can be read.
 *
 * Mounted ONCE, in the root layout. It writes a style property and nothing
 * else — no state, no re-render — so a keyboard opening costs the React tree
 * nothing.
 */

/** Below this it is browser chrome moving, not a keyboard. */
const MIN_KEYBOARD_PX = 120;

export function KeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;

    const update = () => {
      // While pinch-zoomed the visual viewport is small for a different reason;
      // treating that as a keyboard would shove every open sheet up the screen.
      const zoomed = Math.abs(vv.scale - 1) > 0.01;
      const covered = zoomed ? 0 : window.innerHeight - vv.height - vv.offsetTop;
      if (covered > MIN_KEYBOARD_PX) root.style.setProperty('--kb', `${Math.round(covered)}px`);
      else root.style.removeProperty('--kb');
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--kb');
    };
  }, []);

  return null;
}
