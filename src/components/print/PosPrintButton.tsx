'use client';

import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PrinterSettingsDialog } from '@/components/print/PrinterSettingsDialog';
import { usePosPrinter } from '@/hooks/usePosPrinter';
import { PosPrintError } from '@/lib/print/pos/printerService';
import { isRetryable, needsSettings, type PrintErrorCode } from '@/lib/print/pos/errors';
import type { PrintResult } from '@/lib/print/pos/printerService';
import { cn } from '@/lib/utils';
import { AlertTriangle, Check, Loader2, Printer, RefreshCw, Settings } from 'lucide-react';
import { toast } from 'sonner';

/**
 * The Print button for a thermal receipt.
 *
 * ---------------------------------------------------------------------------
 * What pressing it does, and what it never does
 * ---------------------------------------------------------------------------
 * It sends the document to the printer. There is no preview, no destination
 * picker, no Print/Cancel pair to answer — the destination was chosen once in
 * Printer Settings and the bytes go straight there.
 *
 * **A failure never opens the browser dialog by itself.** That would be a
 * different document (an A4 page box) appearing unbidden in place of the receipt
 * someone asked for, and it is the behaviour this work exists to remove. The
 * failure panel offers a browser print only where the surface passed one in, and
 * only as a labelled button a person decides to press.
 *
 * ---------------------------------------------------------------------------
 * Double-press protection is here and in two other places
 * ---------------------------------------------------------------------------
 * This button disables itself for the duration, the print service refuses a
 * second print of the same document while one is in flight, and the local agent
 * ignores a job id it has already run. Three layers because they catch different
 * things: an impatient double-click, two different buttons aimed at one sale, and
 * a request retried after its response was lost.
 */

type PrintState = 'idle' | 'printing' | 'printed' | 'failed';

export interface PosPrintButtonProps {
  /** Does the print. Usually a closure over `printSaleReceipt` / `printProductionOrder`. */
  print: () => Promise<PrintResult>;
  label?: string;
  /**
   * An explicit browser-print escape hatch, offered only in the failure panel.
   * Omit it on surfaces that have no printable HTML — an option that produces a
   * blank page is worse than no option.
   */
  onBrowserPrint?: () => void;
  /** Runs after a successful print — marking the order printed, closing a dialog. */
  onPrinted?: (result: PrintResult) => void;
  /** The signed-in role, so Printer Settings knows whether to offer diagnostics. */
  role?: string;
  /**
   * Fire the print once, as soon as this mounts, without waiting for a press.
   *
   * For "Save & Print", where the press already happened on the sale form and a
   * second one at the receipt would be a step the counter did not ask for. It is
   * strictly a *press substitute*: the same state machine, the same duplicate
   * guards and the same failure panel run, so an auto-print that fails is as
   * visible as one someone pressed.
   */
  autoPrint?: boolean;
  disabled?: boolean;
  variant?: ComponentProps<typeof Button>['variant'];
  size?: ComponentProps<typeof Button>['size'];
  className?: string;
}

export function PosPrintButton({
  print,
  label = 'Print',
  onBrowserPrint,
  onPrinted,
  role,
  autoPrint = false,
  disabled,
  variant = 'default',
  size = 'default',
  className,
}: PosPrintButtonProps) {
  const { configured } = usePosPrinter();
  const [state, setState] = useState<PrintState>('idle');
  const [error, setError] = useState<{ code: PrintErrorCode; message: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // The "Printed ✓" state reverts on a timer, and the timer has to be cancelled
  // if the dialog closes first — a setState on an unmounted tree is a warning
  // nobody will read and a leak that outlives the sale.
  const revert = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (revert.current) clearTimeout(revert.current); }, []);

  const run = useCallback(async () => {
    if (state === 'printing') return;
    setState('printing');
    setError(null);
    try {
      const result = await print();
      setState('printed');
      // `duplicate` means the agent recognised the job and did NOT print again.
      // Saying "Printed" would be a lie that costs someone a reprint they think
      // they already have.
      toast.success(result.duplicate ? 'Already printed — no second copy sent.' : 'Printed successfully');
      onPrinted?.(result);
      revert.current = setTimeout(() => setState('idle'), 2500);
    } catch (caught) {
      const failure = caught instanceof PosPrintError
        ? caught
        : new PosPrintError('print-failed', 'Unable to print. Check the POS printer connection.');
      setState('failed');
      setError({ code: failure.code, message: failure.message });
    }
  }, [print, state, onPrinted]);

  /*
   * Auto-print fires exactly once per mount.
   *
   * The ref, not the `state`, is what enforces that. `run` is recreated whenever
   * `print` changes identity — which it does on every render of a parent that
   * builds the closure inline — so an effect keyed on it would re-fire the print
   * on every re-render of the sales page, and the customer would get a receipt
   * per keystroke somewhere else on the screen.
   */
  const autoFired = useRef(false);
  useEffect(() => {
    if (!autoPrint || autoFired.current || disabled) return;
    autoFired.current = true;
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPrint, disabled]);

  const busy = state === 'printing';

  return (
    <>
      <Button
        variant={state === 'failed' ? 'destructive' : variant}
        size={size}
        // Disabled while in flight, which is the first of the three duplicate
        // guards. Not disabled when the printer is unconfigured: pressing it then
        // is how someone discovers they need to set one up, and the failure panel
        // takes them straight there.
        disabled={disabled || busy}
        onClick={run}
        className={cn('no-print', className)}
        title={configured ? 'Send this receipt to the POS printer' : 'No POS printer set up on this device yet'}
      >
        {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
        {state === 'printed' && <Check className="mr-1.5 h-4 w-4" />}
        {state === 'failed' && <AlertTriangle className="mr-1.5 h-4 w-4" />}
        {state === 'idle' && <Printer className="mr-1.5 h-4 w-4" />}
        {busy ? 'Printing…' : state === 'printed' ? 'Printed' : state === 'failed' ? 'Print Failed' : label}
      </Button>

      <Dialog open={Boolean(error)} onOpenChange={(open) => { if (!open) { setError(null); setState('idle'); } }}>
        <DialogContent className="md:max-w-sm">
          <DialogHeader>
            <DialogTitle>Could not print</DialogTitle>
          </DialogHeader>

          {/* The service's own sentence, which names the printer or the port where
              it can. No stack, no status code, no URL — those are in the debug
              panel, for the one role that can act on them. */}
          <p className="text-sm text-muted-foreground">{error?.message}</p>

          <div className="grid gap-2">
            {error && isRetryable(error.code) && (
              <Button onClick={() => { setError(null); void run(); }}>
                <RefreshCw className="mr-1.5 h-4 w-4" /> Retry
              </Button>
            )}
            <Button
              variant={error && needsSettings(error.code) ? 'default' : 'outline'}
              onClick={() => { setError(null); setState('idle'); setSettingsOpen(true); }}
            >
              <Settings className="mr-1.5 h-4 w-4" /> Printer Settings
            </Button>
            {onBrowserPrint && (
              <Button
                variant="ghost"
                onClick={() => { setError(null); setState('idle'); onBrowserPrint(); }}
              >
                Print through the browser instead
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <PrinterSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} role={role} />
    </>
  );
}
