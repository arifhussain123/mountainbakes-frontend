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
 * The status is advisory
 * ---------------------------------------------------------------------------
 * A print never waits for it and is never blocked by it: the pill can say
 * disconnected because a check happened to run in the half-second the printer was
 * asleep, and the honest answer to "can this print" is to try. What the pill is
 * for is letting someone notice a problem *before* a customer is standing there.
 */

const POLL_MS = 30_000;

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

  useEffect(() => {
    let cancelled = false;
    const apply = (next: PrinterStatus) => {
      if (cancelled) return;
      setStatus(next);
      setChecking(false);
    };
    const run = () => {
      if (document.visibilityState === 'hidden') return;
      void printerStatus(configRef.current).then(apply);
    };

    // The one prompting-free reconnect, on load and whenever the saved device
    // changes. Failure is not raised: it is exactly what the status then reports.
    void reconnectPrinter(configRef.current)
      .catch(() => null)
      .then(() => printerStatus(configRef.current))
      .then(apply);

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
    context,
  };
}
