'use client';

import { useState } from 'react';
import { PrinterSettingsDialog } from '@/components/print/PrinterSettingsDialog';
import { usePosPrinter } from '@/hooks/usePosPrinter';
import { cn } from '@/lib/utils';

/**
 * `● POS Printer Connected` / `● POS Printer Offline`, and the way in to Printer
 * Settings.
 *
 * ---------------------------------------------------------------------------
 * It is an indicator, never a gate
 * ---------------------------------------------------------------------------
 * A disconnected printer does not stop anyone selling — the till still takes
 * money when the roll is jammed — so nothing here blocks the page. Its whole job
 * is to let someone notice the service is down while the shop is empty rather
 * than with a customer waiting.
 *
 * ---------------------------------------------------------------------------
 * Why it also shows when nothing is set up
 * ---------------------------------------------------------------------------
 * Because otherwise a brand new till has no way to reach Printer Settings at all:
 * the only other door is the failure panel, which requires failing a print in
 * front of a customer first. So an unconfigured device gets a quiet, neutral
 * prompt — deliberately not a red dot, because "you have not set this up" is not
 * a fault, and a machine that was never meant to print (the office laptop, a
 * phone) should not wear a permanent error.
 */
export function PosPrinterStatus({ className, role }: { className?: string; role?: string }) {
  const { online, checking, configured, status } = usePosPrinter();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const label = !configured
    ? 'Set up POS printer'
    : checking && !status
      ? 'Checking POS printer…'
      : online
        ? 'POS Printer Connected'
        : 'POS Printer Offline';

  return (
    <>
      <button
        type="button"
        onClick={() => setSettingsOpen(true)}
        className={cn(
          'no-print inline-flex items-center gap-1.5 rounded text-xs font-medium underline-offset-2 hover:underline',
          !configured
            ? 'text-muted-foreground'
            : online
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-muted-foreground',
          className,
        )}
        // The dot alone is not an accessible status and the colour alone is not
        // one either — the text carries the meaning, and this names it as live.
        aria-live="polite"
        title={
          !configured
            ? 'Choose the thermal printer attached to this computer'
            : online
              ? 'Receipts will print directly to the POS printer. Click to change.'
              : 'The local print service is not responding. Click to check the settings.'
        }
      >
        <span
          aria-hidden
          className={cn(
            'h-2 w-2 rounded-full',
            !configured ? 'bg-neutral-400' : checking && !status ? 'bg-amber-400' : online ? 'bg-emerald-500' : 'bg-red-500',
          )}
        />
        {label}
      </button>

      <PrinterSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} role={role} />
    </>
  );
}
