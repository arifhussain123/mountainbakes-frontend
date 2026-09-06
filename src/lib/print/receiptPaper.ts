'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { DEFAULT_PAPER } from './receipt/styles';
import type { PaperWidth } from './receipt/types';

/**
 * Which roll this till has — 80mm or 58mm — remembered per device.
 *
 * This is the whole of what a person configures about printing in Mountain
 * Bakes. Which printer, how it is connected, its address: those are the
 * operating system's, set once in Printers & scanners and never asked for here.
 * The paper width is different — no browser can read it off the driver, and a
 * receipt laid out for 72mm on a 48mm roll loses its amounts column — so it is
 * one choice, kept in this browser, defaulting to the shop's usual 80mm.
 */

const STORAGE_KEY = 'mb.receiptPaper';
/** Same-tab notification — `storage` only fires in *other* tabs. */
const CHANGE_EVENT = 'mb:receipt-paper';

export const PAPER_OPTIONS: { value: PaperWidth; label: string; hint: string }[] = [
  { value: '80mm', label: '80mm roll', hint: 'Standard receipt printer' },
  { value: '58mm', label: '58mm roll', hint: 'Narrow receipt printer' },
];

export function readReceiptPaper(): PaperWidth {
  if (typeof window === 'undefined') return DEFAULT_PAPER;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === '58mm' || raw === '80mm' ? raw : DEFAULT_PAPER;
  } catch {
    return DEFAULT_PAPER;
  }
}

export function writeReceiptPaper(paper: PaperWidth): void {
  try {
    localStorage.setItem(STORAGE_KEY, paper);
  } catch {
    /* Nothing persists, but the view still follows the choice for this session. */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

export function useReceiptPaper(): { paper: PaperWidth; setPaper: (paper: PaperWidth) => void } {
  const paper = useSyncExternalStore(subscribe, readReceiptPaper, () => DEFAULT_PAPER);
  const setPaper = useCallback((next: PaperWidth) => writeReceiptPaper(next), []);
  return { paper, setPaper };
}
