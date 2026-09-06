'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * What the print action should present itself as on this device.
 *
 * - `print` — a printer is (probably) set up, so offer **Print**.
 * - `save`  — no printer software, so offer **Save as PDF**.
 */
export type PrintMode = 'print' | 'save';

/** Device preference: `auto` defers to detection, the others pin the answer. */
export type PrintPreference = 'auto' | PrintMode;

const STORAGE_KEY = 'mb.printMode';
/** Same-tab notification — `storage` only fires in *other* tabs. */
const CHANGE_EVENT = 'mb:print-mode';

/**
 * IMPORTANT — no browser can enumerate installed printers.
 *
 * There is no web API that reports whether printer software or a driver exists:
 * `window.print()` hands off to the OS dialog and tells us nothing about what it
 * found. So this is a *heuristic default*, not a fact, and the user can correct
 * it per device (`setPreference`) — that choice is what actually decides the UI.
 *
 * The heuristic: phones and tablets are assumed to have no printer set up (their
 * print sheet lands on "Save as PDF" in practice), desktops are assumed to have
 * one. `userAgentData.mobile` when the browser exposes it, UA sniff otherwise.
 * Either way the button still opens the same OS dialog — only the wording of the
 * promise changes, so a wrong guess costs a label, never a lost document.
 */
function detectMode(): PrintMode {
  if (typeof window === 'undefined' || typeof window.print !== 'function') return 'save';

  const nav = navigator as Navigator & {
    userAgentData?: { mobile?: boolean };
  };
  if (typeof nav.userAgentData?.mobile === 'boolean') {
    return nav.userAgentData.mobile ? 'save' : 'print';
  }

  const ua = navigator.userAgent;
  // iPadOS reports a Mac UA, so touch points are the only tell.
  const iPad = /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
  return /Android|iPhone|iPod|iPad|Mobile/i.test(ua) || iPad ? 'save' : 'print';
}

// Detection cannot change while the tab is open, so resolve it once. Keeping it
// stable also matters for useSyncExternalStore, which compares snapshots by
// identity and would loop on a value recomputed per render.
let detectedMode: PrintMode | null = null;
function getDetectedMode(): PrintMode {
  if (detectedMode === null) detectedMode = detectMode();
  return detectedMode;
}

function getPreference(): PrintPreference {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === 'print' || raw === 'save' ? raw : 'auto';
  } catch {
    return 'auto'; // Private mode / storage disabled — fall back to detection.
  }
}

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener('storage', onStoreChange);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener('storage', onStoreChange);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
}

export interface PrintCapability {
  /** Resolved mode — the preference when set, otherwise detection. */
  mode: PrintMode;
  /** `true` when the UI should say "Print" rather than "Save as PDF". */
  canPrint: boolean;
  /** What this device was told, `auto` if it has never been told anything. */
  preference: PrintPreference;
  /** What detection guessed, regardless of the preference. */
  detected: PrintMode;
  /** Pin (or un-pin, with `auto`) the mode for this device. */
  setPreference: (pref: PrintPreference) => void;
}

/**
 * Decides whether a print surface offers **Print** or **Save as PDF**.
 *
 * Read the caveat on `detectMode` before trusting `mode`: the guess is a default
 * for the label, and `setPreference` is how a device that disagrees gets fixed.
 * Both modes call `window.print()` — on a machine with no printer installed the
 * browser dialog offers "Save as PDF" as its only destination, which is exactly
 * what the "save" wording promises.
 */
export function usePrintCapability(): PrintCapability {
  const preference = useSyncExternalStore(subscribe, getPreference, () => 'auto' as const);
  const detected = useSyncExternalStore(subscribe, getDetectedMode, () => 'print' as const);

  const setPreference = useCallback((pref: PrintPreference) => {
    try {
      if (pref === 'auto') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      // Storage unavailable: nothing persists, but still notify so the current
      // view does not look frozen — it reverts to detection on the next load.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  const mode: PrintMode = preference === 'auto' ? detected : preference;
  return { mode, canPrint: mode === 'print', preference, detected, setPreference };
}
