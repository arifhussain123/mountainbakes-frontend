'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@/hooks/useAuth';
import {
  configSnapshot,
  serverConfigSnapshot,
  subscribeToConfig,
  writeConfig,
  isConfigured,
  type PosPrinterConfig,
} from '@/lib/print/pos/printerConfig';
import { checkAgent, type AgentStatus, type PrintContext } from '@/lib/print/pos/printerService';

/**
 * The POS printer, as the rest of the app sees it: is it there, what is it, and
 * what should I hand `printSaleReceipt` as context.
 *
 * ---------------------------------------------------------------------------
 * The status is polled, and it is deliberately not aggressive
 * ---------------------------------------------------------------------------
 * There is no push from a local HTTP service, so knowing whether the agent is up
 * means asking. The interval is 30 seconds and the check is skipped while the tab
 * is hidden — an unattended till would otherwise sit in a loop forever, and this
 * app already has a 2-second refetch tick that is its dominant source of traffic
 * (see `useAppRefresh`). A `visibilitychange` catch-up covers coming back.
 *
 * The status is **advisory**. A print never waits for it and is never blocked by
 * it: the pill can say offline because a check happened to fail a moment ago, and
 * the honest answer to "can this print" is to try. What the pill is for is
 * letting someone notice the agent is down *before* a customer is standing there.
 */

const POLL_MS = 30_000;

export interface PosPrinter {
  config: PosPrinterConfig;
  /** Merge a partial change and persist it for this device + branch. */
  update: (patch: Partial<PosPrinterConfig>) => void;
  /** `true` once a printer has been chosen here. */
  configured: boolean;
  status: AgentStatus | null;
  /** `true` while the very first health check is still outstanding. */
  checking: boolean;
  /** Agent up *and* a printer chosen — what the status pill calls "Connected". */
  online: boolean;
  refreshStatus: () => Promise<AgentStatus>;
  /** Ready to pass straight to the print service. */
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

  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [checking, setChecking] = useState(true);

  // The check reads the current config, but must not restart the polling effect
  // every time an unrelated field of it changes (a copies count, the debug flag).
  // A ref is what keeps the effect's dependency list down to the one thing that
  // genuinely invalidates a poll: where the agent lives.
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
    const next = await checkAgent(configRef.current);
    setStatus(next);
    setChecking(false);
    return next;
  }, []);

  useEffect(() => {
    let cancelled = false;
    const run = () => {
      if (document.visibilityState === 'hidden') return;
      void checkAgent(configRef.current).then((next) => {
        if (cancelled) return;
        setStatus(next);
        setChecking(false);
      });
    };

    run();
    const timer = setInterval(run, POLL_MS);
    document.addEventListener('visibilitychange', run);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', run);
    };
    // Re-poll when the agent address or token changes — those are the edits that
    // make the previous answer meaningless.
  }, [config.agentUrl, config.agentToken]);

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
    online: Boolean(status?.reachable) && configured,
    refreshStatus,
    context,
  };
}
