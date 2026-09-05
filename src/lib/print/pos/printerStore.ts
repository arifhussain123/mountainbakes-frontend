'use client';

import { configSnapshot, isConfigured, writeConfig, type PosPrinterConfig, subscribeToConfig } from './printerConfig';
import { adoptionPatch, detectPrinters, type PrinterDetection } from './discovery';
import { printerStatus, reconnectPrinter, type PrinterStatus } from './printerService';
import { isPrinting, subscribeToPrintQueue } from './printQueue';
import { subscribeToDevices } from './transport';

/**
 * One printer watcher per branch, shared by every component that asks.
 *
 * ---------------------------------------------------------------------------
 * What this replaces
 * ---------------------------------------------------------------------------
 * `usePosPrinter` used to own its own poll, its own reconnect and its own
 * detection pass — and it is mounted four or five times over on a single screen
 * (the sales page, the status pill, the print button, the settings dialog, the
 * production preview). Each mount re-ran `reconnectPrinter`, which for WebUSB
 * means `claimInterface` on the device; each ran `detectPrinters` on its own
 * 30-second timer; and each `setDetection` handed a fresh object to a component
 * as large as the sales page, re-rendering it in full. Opening the invoice
 * dialog mounted one more instance *while the auto-print was writing to the
 * printer*, and re-claiming the interface underneath a `transferOut` is a good
 * way to lose the tail of a receipt.
 *
 * Now there is one watcher per branch. It starts when the first component
 * subscribes, stops shortly after the last one leaves, and every component reads
 * the same snapshot through `useSyncExternalStore` — so a status change re-renders
 * the subscribers once, with one object, and the device is opened once.
 *
 * ---------------------------------------------------------------------------
 * The rules it keeps
 * ---------------------------------------------------------------------------
 * - Nothing here prompts. `restore` and `getDevices()` answer from the browser's
 *   permission store; the chooser is only ever opened from a click in Printer
 *   Settings.
 * - A configured printer is never overridden by detection. Adoption writes only
 *   into a config that names none, once per branch and device per session.
 * - No check runs while a job is on the wire. A status probe is harmless, but the
 *   reconnect is not, and "is it connected" has a better answer while printing:
 *   yes, it is receiving bytes.
 * - The poll is skipped while the tab is hidden; `visibilitychange` catches up.
 */

const POLL_MS = 30_000;
/** How long an unsubscribed watcher lingers before stopping — a remount is cheap to absorb. */
const LINGER_MS = 2_000;

export interface PrinterWatch {
  status: PrinterStatus | null;
  /** `true` until the first status check answers. */
  checking: boolean;
  detection: PrinterDetection | null;
}

interface Watcher {
  branchId: string | null;
  state: PrinterWatch;
  listeners: Set<() => void>;
  /** `printerId|connection` at the last reconnect — a change re-opens the device. */
  identity: string;
  timer: ReturnType<typeof setInterval> | null;
  linger: ReturnType<typeof setTimeout> | null;
  stopDeviceEvents: (() => void) | null;
  stopConfigEvents: (() => void) | null;
  stopQueueEvents: (() => void) | null;
  onVisibility: (() => void) | null;
  /** Serialises checks: one in flight per watcher, never a pile-up. */
  inFlight: Promise<void> | null;
  /** A check asked for while one was running — run once more when it ends. */
  again: boolean;
}

const WATCHERS = new Map<string, Watcher>();

/**
 * Devices already adopted automatically this session, as `branch:deviceId`.
 *
 * Not merely an optimisation: `writeConfig` swallows a storage failure (private
 * mode, storage disabled by policy), so on such a machine the config never reads
 * back as configured, and an adoption gated only on "is it configured" would run
 * again on every poll, forever.
 */
const ADOPTED = new Set<string>();

const INITIAL: PrinterWatch = { status: null, checking: true, detection: null };

function keyOf(branchId: string | null | undefined): string {
  return branchId?.trim() || 'default';
}

function identityOf(config: PosPrinterConfig): string {
  return `${config.printerId}|${config.connection}`;
}

/* ────────────────────────────────────────────────────────────────────────────
   Reading
   ──────────────────────────────────────────────────────────────────────────── */

/** The snapshot for `useSyncExternalStore`. Stable until something changes. */
export function printerWatchSnapshot(branchId: string | null | undefined): PrinterWatch {
  return WATCHERS.get(keyOf(branchId))?.state ?? INITIAL;
}

/** The server render has no printer and no way to look for one. */
export function serverPrinterWatchSnapshot(): PrinterWatch {
  return INITIAL;
}

/**
 * Subscribe a component. The first subscriber starts the watcher; the last one
 * leaving stops it after a short linger, so a dialog that closes and reopens does
 * not open the device twice.
 */
export function subscribeToPrinterWatch(branchId: string | null | undefined, listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const watcher = ensure(branchId);
  watcher.listeners.add(listener);
  if (watcher.linger) {
    clearTimeout(watcher.linger);
    watcher.linger = null;
  }
  if (!watcher.timer) start(watcher);
  return () => {
    watcher.listeners.delete(listener);
    if (watcher.listeners.size === 0 && !watcher.linger) {
      watcher.linger = setTimeout(() => {
        watcher.linger = null;
        if (watcher.listeners.size === 0) stop(watcher);
      }, LINGER_MS);
    }
  };
}

/* ────────────────────────────────────────────────────────────────────────────
   Actions — what the hook exposes as refreshStatus / reconnect / refreshPrinters
   ──────────────────────────────────────────────────────────────────────────── */

export async function refreshPrinterStatus(branchId: string | null | undefined): Promise<PrinterStatus> {
  const watcher = ensure(branchId);
  const next = await printerStatus(configSnapshot(branchId));
  update(watcher, { status: next, checking: false });
  return next;
}

export async function reconnectAndRefresh(branchId: string | null | undefined): Promise<PrinterStatus> {
  const watcher = ensure(branchId);
  const config = configSnapshot(branchId);
  await reconnectPrinter(config).catch(() => null);
  watcher.identity = identityOf(config);
  return refreshPrinterStatus(branchId);
}

/**
 * Enumerate, check, and — only when nothing is configured — adopt.
 *
 * Writing the config fires the config event, which the watcher hears and
 * answers by reconnecting to the newly adopted device. Nothing here waits for
 * that: detection is what this answers, and the connection is reported by the
 * status.
 */
export async function refreshPrinterDetection(branchId: string | null | undefined): Promise<PrinterDetection> {
  const watcher = ensure(branchId);
  const current = configSnapshot(branchId);
  const next = await detectPrinters(current);
  update(watcher, { detection: next });

  const chosen = next.selected;
  if (!chosen || isConfigured(current)) return next;
  const key = `${keyOf(branchId)}:${chosen.deviceId}`;
  if (ADOPTED.has(key)) return next;
  const patch = adoptionPatch(chosen, current);
  if (!patch) return next;
  ADOPTED.add(key);
  writeConfig(branchId, { ...configSnapshot(branchId), ...patch });
  return next;
}

/* ────────────────────────────────────────────────────────────────────────────
   The watcher
   ──────────────────────────────────────────────────────────────────────────── */

function ensure(branchId: string | null | undefined): Watcher {
  const key = keyOf(branchId);
  let watcher = WATCHERS.get(key);
  if (!watcher) {
    watcher = {
      branchId: branchId ?? null,
      state: INITIAL,
      listeners: new Set(),
      identity: '',
      timer: null,
      linger: null,
      stopDeviceEvents: null,
      stopConfigEvents: null,
      stopQueueEvents: null,
      onVisibility: null,
      inFlight: null,
      again: false,
    };
    WATCHERS.set(key, watcher);
  }
  return watcher;
}

function update(watcher: Watcher, patch: Partial<PrinterWatch>): void {
  watcher.state = { ...watcher.state, ...patch };
  for (const listener of watcher.listeners) listener();
}

function start(watcher: Watcher): void {
  const branchId = watcher.branchId;

  // The full pass: reconnect (if the device changed since last time), status,
  // detection. Coalesced — a device event, a visibility change and the poll
  // landing together produce one check, then one more if any arrived during it.
  const check = (reason: 'load' | 'poll' | 'event' | 'config'): void => {
    if (watcher.inFlight) {
      watcher.again = true;
      return;
    }
    if (reason === 'poll' && typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    // While a receipt is being written the device is demonstrably connected, and
    // a reconnect in the middle of it is a hazard rather than a check.
    if (isPrinting()) return;

    watcher.inFlight = (async () => {
      const config = configSnapshot(branchId);
      const identity = identityOf(config);
      if (identity !== watcher.identity) {
        watcher.identity = identity;
        await reconnectPrinter(config).catch(() => null);
      }
      const [status, detection] = await Promise.all([
        printerStatus(config).catch(() => null),
        detectPrinters(config).catch(() => null),
      ]);
      const patch: Partial<PrinterWatch> = { checking: false };
      if (status) patch.status = status;
      if (detection) {
        patch.detection = detection;
        // Adoption, on the same pass rather than a second one.
        const chosen = detection.selected;
        if (chosen && !isConfigured(config)) {
          const key = `${keyOf(branchId)}:${chosen.deviceId}`;
          if (!ADOPTED.has(key)) {
            const adoption = adoptionPatch(chosen, config);
            if (adoption) {
              ADOPTED.add(key);
              writeConfig(branchId, { ...configSnapshot(branchId), ...adoption });
            }
          }
        }
      }
      update(watcher, patch);
    })()
      .catch(() => {
        update(watcher, { checking: false });
      })
      .finally(() => {
        watcher.inFlight = null;
        if (watcher.again) {
          watcher.again = false;
          check('event');
        }
      });
  };

  check('load');
  watcher.timer = setInterval(() => check('poll'), POLL_MS);
  watcher.onVisibility = () => {
    if (document.visibilityState !== 'hidden') check('event');
  };
  document.addEventListener('visibilitychange', watcher.onVisibility);
  watcher.stopDeviceEvents = subscribeToDevices(() => check('event'));
  watcher.stopConfigEvents = subscribeToConfig(() => {
    // Only a change of device or route needs the device reopened; a copies
    // count does not. `check` compares identities and reconnects only then.
    if (identityOf(configSnapshot(branchId)) !== watcher.identity) check('config');
  });
  // A job finishing is the one moment the link state is worth re-reading
  // without waiting for the poll: a failed print has just told us something.
  let wasPrinting = isPrinting();
  watcher.stopQueueEvents = subscribeToPrintQueue(() => {
    const printing = isPrinting();
    if (wasPrinting && !printing) check('event');
    wasPrinting = printing;
  });
}

function stop(watcher: Watcher): void {
  if (watcher.timer) clearInterval(watcher.timer);
  watcher.timer = null;
  if (watcher.onVisibility) document.removeEventListener('visibilitychange', watcher.onVisibility);
  watcher.onVisibility = null;
  watcher.stopDeviceEvents?.();
  watcher.stopDeviceEvents = null;
  watcher.stopConfigEvents?.();
  watcher.stopConfigEvents = null;
  watcher.stopQueueEvents?.();
  watcher.stopQueueEvents = null;
  // The snapshot is kept: a remount shows the last known state at once rather
  // than a "checking" flash, and the next start re-checks anyway.
  watcher.identity = '';
}
