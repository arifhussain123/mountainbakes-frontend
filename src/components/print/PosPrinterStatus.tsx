'use client';

import { useState } from 'react';
import { PrinterSettingsDialog } from '@/components/print/PrinterSettingsDialog';
import { usePosPrinter } from '@/hooks/usePosPrinter';
import { cn } from '@/lib/utils';

/**
 * `● POS Printer Connected` / `● POS Printer Not Connected`, and the way in to
 * Printer Setup.
 *
 * ---------------------------------------------------------------------------
 * It is an indicator, never a gate
 * ---------------------------------------------------------------------------
 * A disconnected printer does not stop anyone selling — the till still takes
 * money when the roll is jammed — so nothing here blocks the page. Its whole job
 * is to let someone notice while the shop is empty rather than with a customer
 * waiting.
 *
 * ---------------------------------------------------------------------------
 * Four states, because they need four different actions
 * ---------------------------------------------------------------------------
 * Not set up (neutral, a prompt), unsupported browser (neutral, and permanent —
 * a red dot would suggest something on this machine can be fixed), not connected
 * (red: plug it in), connected (green). The old two-state pill collapsed the
 * middle two into "Offline", which sent tills hunting for a cable when the real
 * answer was "open this in Chrome".
 *
 * ---------------------------------------------------------------------------
 * Why it also shows when nothing is set up
 * ---------------------------------------------------------------------------
 * Because otherwise a brand new till has no way to reach Printer Setup at all:
 * the only other door is the failure panel, which requires failing a print in
 * front of a customer first. So an unconfigured device gets a quiet, neutral
 * prompt — deliberately not a red dot, because "you have not set this up" is not
 * a fault, and a machine that was never meant to print (the office laptop, a
 * phone) should not wear a permanent error.
 */
export function PosPrinterStatus({ className, role }: { className?: string; role?: string }) {
  const { status, checking, configured } = usePosPrinter();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const state = status?.state ?? (configured ? 'not-connected' : 'not-configured');
  const first = checking && !status;

  const label = first
    ? 'Checking POS printer…'
    : state === 'unsupported'
      ? 'Printing not supported here'
      : state === 'not-configured'
        ? 'Set up POS printer'
        : state === 'connected'
          ? 'POS Printer Connected'
          : 'POS Printer Not Connected';

  const title = first
    ? 'Looking for the POS printer'
    : state === 'unsupported'
      ? status?.reason ?? 'This browser cannot print directly to a POS printer.'
      : state === 'not-configured'
        ? 'Connect the thermal printer attached to this computer'
        : state === 'connected'
          ? `Receipts print straight to ${status?.deviceLabel ?? 'the POS printer'}. Click to change.`
          : status?.reason ?? 'The POS printer is not connected. Click to reconnect it.';

  return (
    <>
      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        className={cn(
          'no-print inline-flex items-center gap-1.5 rounded text-xs font-medium underline-offset-2 hover:underline',
          state === 'connected' ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground',
          className,
        )}
        // The dot alone is not an accessible status and the colour alone is not
        // one either — the text carries the meaning, and this names it as live.
        aria-live="polite"
        title={title}
      >
        <span
          aria-hidden
          className={cn(
            'h-2 w-2 rounded-full',
            first
              ? 'bg-amber-400'
              : state === 'connected'
                ? 'bg-emerald-500'
                : state === 'not-connected'
                  ? 'bg-red-500'
                  : 'bg-neutral-400',
          )}
        />
        {label}
      </button>

      <PrinterSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} role={role} />
    </>
  );
}
