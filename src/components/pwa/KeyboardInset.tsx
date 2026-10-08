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
 * Two companions travel with it. `--vv-top` is how far Chrome has panned the
 * visual viewport down to reveal a focused field: a full-screen dialog pinned
 * to `top: 0` would otherwise have its header (and its close button) above the
 * visible area for as long as the keyboard is up. `data-kb` on <html> is the
 * same fact as a selector, for layouts that must rearrange — not just move —
 * while the keyboard is open (the `kb-open:` variant in globals.css).
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

    const clear = () => {
      root.style.removeProperty('--kb');
      root.style.removeProperty('--vv-top');
      root.removeAttribute('data-kb');
    };

    const update = () => {
      // While pinch-zoomed the visual viewport is small for a different reason;
      // treating that as a keyboard would shove every open sheet up the screen.
      const zoomed = Math.abs(vv.scale - 1) > 0.01;
      const covered = zoomed ? 0 : window.innerHeight - vv.height - vv.offsetTop;
      if (covered > MIN_KEYBOARD_PX) {
        root.style.setProperty('--kb', `${Math.round(covered)}px`);
        root.style.setProperty('--vv-top', `${Math.max(0, Math.round(vv.offsetTop))}px`);
        root.setAttribute('data-kb', '');
      } else {
        clear();
      }
    };

    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      clear();
    };
  }, []);

  return null;
}
