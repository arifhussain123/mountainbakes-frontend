'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  configSnapshot,
  isConfigured,
  serverConfigSnapshot,
  subscribeToConfig,
  writeConfig,
  type PosPrinterConfig,
} from '@/lib/print/pos/printerConfig';
import {
  adoptionPatch,
  detectPrinters,
  AVAILABILITY_LABELS,
  type DetectedPrinter,
  type PrinterAvailability,
  type PrinterDetection,
} from '@/lib/print/pos/discovery';
import { printerStatus, reconnectPrinter, type PrinterStatus, type PrintContext } from '@/lib/print/pos/printerService';
import { subscribeToDevices } from '@/lib/print/pos/transport';

/**
 * The POS printer, as the rest of the app sees it: is it there, what is it, and
 * what should I hand `printSaleReceipt` as context.
 *
 * ---------------------------------------------------------------------------
 * The device tells us, and we also ask
 * ---------------------------------------------------------------------------
 * WebUSB and Web Serial both fire `connect` / `disconnect`, so a printer switched
 * on at 8am turns the pill green with nobody pressing anything, and a cable
 * pulled mid-shift turns it grey before the next sale rather than at it. That is
 * the primary signal and it costs nothing.
 *
 * A slow poll sits behind it because events do not cover everything: a network
 * printer has no event at all, and a permission revoked in browser settings fires
 * nothing either. Thirty seconds, skipped while the tab is hidden — an unattended
 * till would otherwise loop forever, and this app already has a 2-second refetch
 * tick that is its dominant source of traffic (see `useAppRefresh`). A
 * `visibilitychange` catch-up covers coming back.
 *
 * ---------------------------------------------------------------------------
 * Reconnecting is automatic, and silent
 * ---------------------------------------------------------------------------
 * On load the hook re-adopts the printer this branch already authorised on this
 * machine — `getDevices()`, no prompt, no dialog. That is what makes "set it up
 * once" true: the counter opens Mountain Bakes in the morning and the printer is
 * simply there. A device that cannot be re-adopted (unplugged, permission
 * cleared) leaves the pill honest rather than raising anything.
 *
 * ---------------------------------------------------------------------------
 * Detection, and the printer nobody chose
 * ---------------------------------------------------------------------------
 * `detectPrinters` runs alongside that reconnect, so a till that has *never* been
 * set up still finds its printer: the grant lives in the browser, not in this
 * app's config, and a device authorised at any point in this machine's life is
 * enumerable from then on with no prompt. When nothing is configured for the
 * branch and such a device is attached, it is adopted here — written to the
 * config as this device's printer — and the counter never sees a chooser.
 *
 * A configured printer is never overridden by that, attached or not. The whole
 * priority chain lives in `discovery.ts`, which also explains why the operating
 * system's own default printer is not a rung any browser can reach.
 *
 * ---------------------------------------------------------------------------
 * The status is advisory
 * ---------------------------------------------------------------------------
 * A print never waits for it and is never blocked by it: the pill can say
 * disconnected because a check happened to run in the half-second the printer was
 * asleep, and the honest answer to "can this print" is to try. What the pill is
 * for is letting someone notice a problem *before* a customer is standing there.
 */

const POLL_MS = 30_000;

/**
 * Devices already adopted automatically this session, as `branch:deviceId`.
 *
 * Module-level rather than a ref, because this hook is mounted several times over
 * at once — the status pill, the print button, the sales page and the settings
 * dialog each call it — and a per-instance guard lets every one of them write the
 * same adoption on the first pass. Same value each time, so nothing corrupts, but
 * it is four storage writes and four change events for one decision.
 *
 * The guard is also not merely an optimisation. `writeConfig` swallows a storage
 * failure — private mode, storage disabled by policy — so on such a machine the
 * config never reads back as configured, and an adoption gated only on "is it
 * configured" would run again on every poll, forever. Keyed by branch as well as
 * device because a shared till genuinely has a second branch account that has
 * adopted nothing yet, and one set of ids for both would deny it its printer.
 */
const ADOPTED = new Set<string>();

export interface PosPrinter {
  config: PosPrinterConfig;
  /** Merge a partial change and persist it for this device + branch. */
  update: (patch: Partial<PosPrinterConfig>) => void;
  /** `true` once a printer has been set up here. */
  configured: boolean;
  status: PrinterStatus | null;
  /** `true` while the very first check is still outstanding. */
  checking: boolean;
  /** Set up, reachable and open — what the status pill calls "Connected". */
  online: boolean;
  /** `false` when this browser cannot reach this kind of printer at all. */
  supported: boolean;
  refreshStatus: () => Promise<PrinterStatus>;
  /** Re-adopt the saved device without prompting, then re-read the status. */
  reconnect: () => Promise<PrinterStatus>;
  /**
   * What the last detection pass found: every authorised printer on this
   * machine, which one this app will use, and how it was chosen. `null` until
   * the first pass returns.
   */
  detection: PrinterDetection | null;
  /** The chosen printer, or `null` when there is nothing to print to. */
  printer: DetectedPrinter | null;
  /** Ready / Printing / Offline / Unavailable / Error — the word for the pill. */
  availability: PrinterAvailability;
  /** That word, spelled for a person. */
  availabilityLabel: string;
  /**
   * Re-enumerate, re-check, and adopt one if nothing is configured — the
   * `Refresh Printers` button. Prompts for nothing.
   */
  refreshPrinters: () => Promise<PrinterDetection>;
  /** Ready to pass straight to `printerService`. */
  context: PrintContext;
}

export function usePosPrinter(): PosPrinter {
  const { user } = useAuth();
  const branchId = user?.branchId ?? null;

  const config = useSyncExternalStore(
    subscribeToConfig,
    () => configSnapshot(branchId),
    serverConfigSnapshot,
  );

  const [status, setStatus] = useState<PrinterStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [detection, setDetection] = useState<PrinterDetection | null>(null);

  // The check reads the current config, but must not restart the polling effect
  // every time an unrelated field of it changes (a copies count, the debug flag).
  // A ref is what keeps the effect's dependency list down to the things that
  // genuinely invalidate a check: which device, and how it is reached.
  //
  // Synced in an effect rather than assigned during render — a ref written while
  // rendering is not safe under concurrent React, which may render a tree it then
  // throws away and would leave the ref describing a config nobody is showing.
  // This effect is declared FIRST on purpose: effects run in order, so the ref is
  // current before the polling effect below reads it.
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  const refreshStatus = useCallback(async () => {
    const next = await printerStatus(configRef.current);
    setStatus(next);
    setChecking(false);
    return next;
  }, []);

  const reconnect = useCallback(async () => {
    await reconnectPrinter(configRef.current);
    return refreshStatus();
  }, [refreshStatus]);

  /**
   * Enumerate, check, and — only when nothing is configured — adopt.
   *
   * The adoption is the point of the whole feature and it is deliberately narrow:
   * it writes a printer only into a config that names none. A branch that set one
   * up is left alone even when its printer is unplugged and a different one is
   * attached, because switching rolls under a till without telling anyone is a
   * worse failure than an offline pill.
   *
   * Writing the config re-runs the effect below, which opens the newly adopted
   * device and turns the pill green. Nothing here waits for that: detection is
   * what this function answers, and the connection is reported by the status.
   */
  const refreshPrinters = useCallback(async () => {
    const next = await detectPrinters(configRef.current);
    setDetection(next);

    const current = configRef.current;
    const chosen = next.selected;
    if (!chosen || isConfigured(current)) return next;

    const key = `${branchId ?? 'default'}:${chosen.deviceId}`;
    if (ADOPTED.has(key)) return next;

    const patch = adoptionPatch(chosen, current);
    if (!patch) return next;
    ADOPTED.add(key);
    writeConfig(branchId, { ...configSnapshot(branchId), ...patch });
    return next;
  }, [branchId]);

  const refreshPrintersRef = useRef(refreshPrinters);
  useEffect(() => {
    refreshPrintersRef.current = refreshPrinters;
  }, [refreshPrinters]);

  useEffect(() => {
    let cancelled = false;
    const apply = (next: PrinterStatus) => {
      if (cancelled) return;
      setStatus(next);
      setChecking(false);
    };
    // Through a ref so a new branch id does not tear down the poll and the device
    // subscription — the effect below is keyed on the device, and rebuilding it
    // for an unrelated identity change would drop a `connect` event with it.
    const detect = () => {
      if (cancelled) return;
      void refreshPrintersRef.current().catch(() => null);
    };
    const run = () => {
      if (document.visibilityState === 'hidden') return;
      void printerStatus(configRef.current).then(apply);
      // Detection rides the same beat rather than a timer of its own. Both read
      // the browser's permission store and neither touches the network, so the
      // cost is the same and the two can never disagree about a printer that
      // appeared between one tick and the next.
      void detect();
    };

    // The one prompting-free reconnect, on load and whenever the saved device
    // changes. Failure is not raised: it is exactly what the status then reports.
    void reconnectPrinter(configRef.current)
      .catch(() => null)
      .then(() => printerStatus(configRef.current))
      .then(apply);

    // Detection runs on load in parallel with that, not after it: an unconfigured
    // till has nothing to reconnect *to*, and this is what finds it a printer.
    void detect();

    const timer = setInterval(run, POLL_MS);
    document.addEventListener('visibilitychange', run);
    const stopDeviceEvents = subscribeToDevices(run);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', run);
      stopDeviceEvents();
    };
    // Re-check when the device or the way it is reached changes — those are the
    // edits that make the previous answer meaningless.
  }, [config.printerId, config.connection]);

  const update = useCallback(
    (patch: Partial<PosPrinterConfig>) => {
      writeConfig(branchId, { ...configSnapshot(branchId), ...patch });
    },
    [branchId],
  );

  const context = useMemo<PrintContext>(
    () => ({
      config,
      branchId,
      branchName: user?.branchName ?? null,
      userId: user?.uid ?? null,
    }),
    [config, branchId, user?.branchName, user?.uid],
  );

  const configured = isConfigured(config);

  /**
   * The five-state word, derived from the two sources rather than stored.
   *
   * The link status is the authority on *this* printer — it is the thing that
   * actually opened the device — and detection is the authority on whether one
   * exists at all. Taking the state from the link where there is one, and from
   * detection otherwise, is what keeps a configured-but-unplugged printer saying
   * `Offline` instead of falling back to whatever spare happens to be attached.
   */
  const availability = useMemo<PrinterAvailability>(() => {
    if (status) {
      if (status.state === 'unsupported') return 'unavailable';
      if (status.state === 'connected') return detection?.selected?.status === 'printing' ? 'printing' : 'ready';
      if (status.state === 'not-configured') return detection?.selected?.status ?? 'unavailable';
      // `not-connected` covers both a cable and a held interface, and detection
      // has already told those apart for the selected device.
      return detection?.selected?.status === 'error' ? 'error' : 'offline';
    }
    return detection?.selected?.status ?? 'unavailable';
  }, [status, detection]);

  return {
    config,
    update,
    configured,
    status,
    checking,
    online: status?.state === 'connected',
    supported: status?.supported ?? true,
    refreshStatus,
    reconnect,
    detection,
    printer: detection?.selected ?? null,
    availability,
    availabilityLabel: AVAILABILITY_LABELS[availability],
    refreshPrinters,
    context,
  };
}
