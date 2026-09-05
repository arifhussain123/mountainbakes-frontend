'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
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
  AVAILABILITY_LABELS,
  type DetectedPrinter,
  type PrinterAvailability,
  type PrinterDetection,
} from '@/lib/print/pos/discovery';
import type { PrinterStatus, PrintContext } from '@/lib/print/pos/printerService';
import { isPrinting, subscribeToPrintQueue } from '@/lib/print/pos/printQueue';
import {
  printerWatchSnapshot,
  reconnectAndRefresh,
  refreshPrinterDetection,
  refreshPrinterStatus,
  serverPrinterWatchSnapshot,
  subscribeToPrinterWatch,
} from '@/lib/print/pos/printerStore';

/**
 * The POS printer, as the rest of the app sees it: is it there, what is it, and
 * what should I hand `printSaleReceipt` as context.
 *
 * ---------------------------------------------------------------------------
 * A view onto one shared watcher
 * ---------------------------------------------------------------------------
 * This hook is mounted several times over on one screen — the sales page, the
 * status pill, the print button, the settings dialog. It used to run a poll, a
 * reconnect and a detection pass *per mount*, which meant four `claimInterface`
 * calls on load, four timers, and a fresh `detection` object every thirty
 * seconds handed to the whole sales page. All of that now lives once per branch
 * in `printerStore.ts`; this hook subscribes to it and adds only what needs
 * React — the config from storage, the auth-derived context, and the derived
 * availability word.
 *
 * The device tells us (WebUSB / Web Serial `connect` / `disconnect`), the store
 * also asks on a slow poll, and reconnecting is automatic and silent. The status
 * is advisory: a print never waits for it and is never blocked by it, because the
 * honest answer to "can this print" is to try.
 */

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

  const subscribe = useCallback(
    (listener: () => void) => subscribeToPrinterWatch(branchId, listener),
    [branchId],
  );
  const watch = useSyncExternalStore(
    subscribe,
    () => printerWatchSnapshot(branchId),
    serverPrinterWatchSnapshot,
  );
  const { status, checking, detection } = watch;
  // Live, from the queue, rather than from the last detection pass: the pill
  // turns amber the moment a job goes on the wire and back the moment it ends.
  const printing = useSyncExternalStore(subscribeToPrintQueue, isPrinting, () => false);

  const refreshStatus = useCallback(() => refreshPrinterStatus(branchId), [branchId]);
  const reconnect = useCallback(() => reconnectAndRefresh(branchId), [branchId]);
  const refreshPrinters = useCallback(() => refreshPrinterDetection(branchId), [branchId]);

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
      if (status.state === 'connected') return printing || detection?.selected?.status === 'printing' ? 'printing' : 'ready';
      if (status.state === 'not-configured') return detection?.selected?.status ?? 'unavailable';
      // `not-connected` covers both a cable and a held interface, and detection
      // has already told those apart for the selected device.
      return detection?.selected?.status === 'error' ? 'error' : 'offline';
    }
    return detection?.selected?.status ?? 'unavailable';
  }, [status, detection, printing]);

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
