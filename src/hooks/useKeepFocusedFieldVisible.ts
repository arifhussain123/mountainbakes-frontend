'use client';

import { useEffect, type RefObject } from 'react';

/** Room kept above a field — enough for the label that sits over it. */
const MARGIN_TOP = 36;
/** Room kept between a field and the bottom edge (the footer, or the keyboard). */
const MARGIN_BOTTOM = 16;

function isTextEntry(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'range', 'color'].includes(el.type);
  }
  return el.isContentEditable;
}

/**
 * Keeps the field being typed into inside the visible part of ONE scroll
 * container while the on-screen keyboard opens, closes or resizes.
 *
 * WHY THE BROWSER'S OWN SCROLL IS NOT ENOUGH. A browser scrolls a field into
 * view at the moment it is focused — but the keyboard arrives a few hundred
 * milliseconds later, and only then does the dialog shrink to sit above it
 * (`--kb`, see KeyboardInset). By that point the browser is done, and the field
 * it placed correctly is now under the dialog's footer.
 *
 * It moves `scrollTop` on the given container and nothing else. `scrollIntoView`
 * would also scroll every `overflow: hidden` ancestor, which is how a dialog's
 * header ends up pushed off the top of the screen.
 *
 * A combobox input is aligned to the TOP rather than merely revealed: its list
 * opens below it, so it needs the room underneath.
 */
export function useKeepFocusedFieldVisible(scrollerRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let frame = 0;

    const reveal = () => {
      const el = document.activeElement;
      if (!isTextEntry(el) || !scroller.contains(el)) return;
      const box = scroller.getBoundingClientRect();
      const field = el.getBoundingClientRect();
      const top = box.top + MARGIN_TOP;
      const bottom = box.bottom - MARGIN_BOTTOM;

      // Only with the keyboard up (a desktop click must not move the page), and
      // only ever UP — a picker already near the top has its room.
      if (el.getAttribute('role') === 'combobox' && document.documentElement.hasAttribute('data-kb')) {
        if (field.top > top) scroller.scrollTop += field.top - top;
        return;
      }
      if (field.top < top) {
        scroller.scrollTop -= top - field.top;
      } else if (field.bottom > bottom) {
        // Never so far that the field's own top leaves the visible area.
        scroller.scrollTop += Math.min(field.bottom - bottom, field.top - top);
      }
    };

    // One frame later: `--kb` is written in the same event, and the layout it
    // changes has to be in place before anything is measured.
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(reveal);
    };

    const vv = window.visualViewport;
    scroller.addEventListener('focusin', schedule);
    vv?.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener('focusin', schedule);
      vv?.removeEventListener('resize', schedule);
    };
  }, [scrollerRef]);
}
