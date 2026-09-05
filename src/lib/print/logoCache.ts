'use client';

import { useEffect, useSyncExternalStore } from 'react';

/**
 * The company logo, fetched once and kept as a data URL for every print after.
 *
 * ---------------------------------------------------------------------------
 * Why
 * ---------------------------------------------------------------------------
 * Every printed document — the A4 challan, the invoice, the daily-sale sheet —
 * carries `<img src={settings.logoUrl}>`, a storage URL on another origin. The
 * print preview cannot be generated until that image has loaded, so each print
 * paid for a network round trip (or a cache revalidation) before the dialog
 * could even appear, and a slow link put that wait squarely inside the modal
 * `window.print()`. A data URL has no network to wait for: the bytes are in the
 * document.
 *
 * ---------------------------------------------------------------------------
 * What it does not do
 * ---------------------------------------------------------------------------
 * No canvas, no resize, no re-encode — `FileReader.readAsDataURL` on the fetched
 * blob is asynchronous and leaves the main thread alone. Nothing is done for the
 * ESC/POS path, which prints no logo at all: a thermal receipt here is text, and
 * `PRINTING.md` explains why that is the fast path rather than a bitmap.
 *
 * A logo that will not fetch (a CORS refusal, an outage) falls back to the plain
 * URL for the session and is not retried — the print still works, as it always
 * did, it merely waits for the image again.
 */

/** Above this a data URL bloats every printed document; the plain URL is better. */
const MAX_INLINE_BYTES = 1_500_000;

const RESOLVED = new Map<string, string>();
const PENDING = new Map<string, Promise<string>>();
const LISTENERS = new Set<() => void>();

function notify(): void {
  for (const listener of LISTENERS) listener();
}

function subscribe(listener: () => void): () => void {
  LISTENERS.add(listener);
  return () => {
    LISTENERS.delete(listener);
  };
}

/** The cached form if there is one, else the URL itself. Never `undefined` for a URL. */
export function cachedLogo(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return RESOLVED.get(url) ?? url;
}

/** Fetch and inline once. Safe to call repeatedly; concurrent calls share one fetch. */
export function warmLogo(url: string | null | undefined): Promise<string | undefined> {
  if (!url || typeof window === 'undefined') return Promise.resolve(undefined);
  const done = RESOLVED.get(url);
  if (done) return Promise.resolve(done);
  const pending = PENDING.get(url);
  if (pending) return pending;

  const work = (async () => {
    let value = url;
    try {
      const response = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (response.ok) {
        const blob = await response.blob();
        if (blob.size > 0 && blob.size <= MAX_INLINE_BYTES && blob.type.startsWith('image/')) {
          value = await readAsDataUrl(blob);
        }
      }
    } catch {
      /* Fall back to the URL. The print still works; it just waits for the image. */
    }
    RESOLVED.set(url, value);
    PENDING.delete(url);
    notify();
    return value;
  })();
  PENDING.set(url, work);
  return work;
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * The logo `src` to print: the inlined copy once it exists, the URL until then.
 * Starts the fetch on first use, so the first print after load usually already
 * has it.
 */
export function useCachedLogo(url: string | null | undefined): string | undefined {
  const value = useSyncExternalStore(
    subscribe,
    () => cachedLogo(url),
    () => url ?? undefined,
  );
  useEffect(() => {
    if (url && !RESOLVED.has(url)) void warmLogo(url);
  }, [url]);
  return value;
}
