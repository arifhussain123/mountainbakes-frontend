'use client';

import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { PrinterSettingsDialog } from '@/components/print/PrinterSettingsDialog';
import { usePosPrinter } from '@/hooks/usePosPrinter';
import { PosPrintError, type PrintJobSnapshot, type PrintResult } from '@/lib/print/pos/printerService';
import { canReconnect, isRetryable, needsSettings, type PrintErrorCode } from '@/lib/print/pos/errors';
import { cn } from '@/lib/utils';
import { beginPrintTrace, printTrace } from '@/lib/print/diagnostics';
import { AlertTriangle, Check, Clock, Loader2, Plug, Printer, RefreshCw, Settings } from 'lucide-react';
import { toast } from 'sonner';

/**
 * The Print button for a thermal receipt.
 *
 * ---------------------------------------------------------------------------
 * What pressing it does, and what it never does
 * ---------------------------------------------------------------------------
 * It queues the document for the printer and returns. There is no preview, no
 * destination picker, no Print/Cancel pair to answer — the destination was chosen
 * once in Printer Settings and the bytes go straight there, from the queue in
 * `printQueue.ts`, one job at a time per printer. The press itself does no
 * composing and no I/O; the button repaints as *Printing…* (or *Queued* when a
 * receipt is already on the wire) and the rest of the screen stays usable.
 *
 * **A failure never opens the browser dialog by itself.** That would be a
 * different document (an A4 page box) appearing unbidden in place of the receipt
 * someone asked for. The failure panel offers a browser print only where the
 * surface passed one in, and only as a labelled button a person decides to press.
 *
 * ---------------------------------------------------------------------------
 * Double-press protection is here and in one other place
 * ---------------------------------------------------------------------------
 * This button disables itself for the duration, and the queue folds a second
 * request for the same document onto the job already in flight. Two layers
 * because they catch different things: an impatient double-click, and two
 * different buttons aimed at one sale (a reprint from the sales table while the
 * invoice dialog's own Print is still running) — the second of which now simply
 * follows the first job to its result rather than being shown an error.
 *
 * ---------------------------------------------------------------------------
 * A printer that is merely unplugged gets a one-press fix
 * ---------------------------------------------------------------------------
 * The failure panel offers **Reconnect** for exactly the failures that mean "the
 * device is not open right now" — it re-adopts the already-authorised printer
 * with no chooser and retries. It is not offered for a browser that cannot print
 * at all, where the only honest next step is Printer Settings.
 */

type PrintState = 'idle' | 'queued' | 'printing' | 'printed' | 'failed';

/** What the button hands the caller's `print` so it can follow the job. */
export interface PrintHooks {
  /** Spread into the `PrintContext` — `printSaleReceipt(doc, { ...context, ...hooks })`. */
  onJobUpdate: (job: PrintJobSnapshot<PrintResult>) => void;
}

export interface PosPrintButtonProps {
  /**
   * Does the print. Usually a closure over `printSaleReceipt` /
   * `printProductionOrder`. The hooks are optional to use: a caller that spreads
   * them into its context gets a button that says *Queued* while another receipt
   * is on the wire; one that ignores them gets *Printing…* throughout.
   */
  print: (hooks: PrintHooks) => Promise<PrintResult>;
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
  const { configured, reconnect } = usePosPrinter();
  const [state, setState] = useState<PrintState>('idle');
  const [ahead, setAhead] = useState(0);
  const [error, setError] = useState<{ code: PrintErrorCode; message: string } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // The "Printed ✓" state reverts on a timer, and the timer has to be cancelled
  // if the dialog closes first — a setState on an unmounted tree is a warning
  // nobody will read and a leak that outlives the sale.
  const revert = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (revert.current) clearTimeout(revert.current);
    };
  }, []);

  // Read through a ref so `run` need not change identity with every parent
  // render — the parents build `print` inline, and a `run` that changed with it
  // would re-fire the auto-print effect below.
  const printRef = useRef(print);
  const onPrintedRef = useRef(onPrinted);
  useEffect(() => {
    printRef.current = print;
    onPrintedRef.current = onPrinted;
  }, [print, onPrinted]);

  const busy = state === 'printing' || state === 'queued';
  const busyRef = useRef(false);

  const run = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    beginPrintTrace('pos-print');
    printTrace('button pressed', { label });
    setState('printing');
    setAhead(0);
    setError(null);

    const hooks: PrintHooks = {
      onJobUpdate: (job) => {
        if (!mounted.current) return;
        if (job.state === 'queued') {
          setState('queued');
          setAhead(job.position);
        } else if (job.state === 'printing') {
          setState('printing');
          setAhead(0);
        }
      },
    };

    try {
      const result = await printRef.current(hooks);
      printTrace('print promise resolved', { ms: result.durationMs, bytes: result.bytes });
      if (!mounted.current) return;
      setState('printed');
      toast.success('Printed successfully');
      onPrintedRef.current?.(result);
      revert.current = setTimeout(() => setState('idle'), 2500);
    } catch (caught) {
      if (!mounted.current) return;
      const failure = caught instanceof PosPrintError
        ? caught
        : new PosPrintError('print-failed', 'Unable to print. Check the POS printer connection.');
      printTrace('print promise rejected', { code: failure.code });
      setState('failed');
      setError({ code: failure.code, message: failure.message });
    } finally {
      busyRef.current = false;
    }
  }, [label]);

  /*
   * Auto-print fires exactly once per mount. The ref, not the `state`, is what
   * enforces that, so a re-render of the sales page cannot re-fire it.
   */
  const autoFired = useRef(false);
  useEffect(() => {
    if (!autoPrint || autoFired.current || disabled) return;
    autoFired.current = true;
    void run();
  }, [autoPrint, disabled, run]);

  const caption =
    state === 'queued'
      ? ahead > 0
        ? `Queued (${ahead} ahead)`
        : 'Queued…'
      : state === 'printing'
        ? 'Printing…'
        : state === 'printed'
          ? 'Printed'
          : state === 'failed'
            ? 'Print Failed'
            : label;

  return (
    <>
      <Button
        variant={state === 'failed' ? 'destructive' : variant}
        size={size}
        // Disabled while in flight, which is the first of the two duplicate
        // guards. Not disabled when the printer is unconfigured: pressing it then
        // is how someone discovers they need to set one up, and the failure panel
        // takes them straight there.
        disabled={disabled || busy}
        onClick={run}
        className={cn('no-print', className)}
        title={configured ? 'Send this receipt to the POS printer' : 'No POS printer set up on this device yet'}
        aria-busy={busy || undefined}
      >
        {state === 'printing' && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
        {state === 'queued' && <Clock className="mr-1.5 h-4 w-4" />}
        {state === 'printed' && <Check className="mr-1.5 h-4 w-4" />}
        {state === 'failed' && <AlertTriangle className="mr-1.5 h-4 w-4" />}
        {state === 'idle' && <Printer className="mr-1.5 h-4 w-4" />}
        {caption}
      </Button>

      <Dialog open={Boolean(error)} onOpenChange={(open) => { if (!open) { setError(null); setState('idle'); } }}>
        <DialogContent className="md:max-w-sm">
          <DialogHeader>
            <DialogTitle>Could not print</DialogTitle>
          </DialogHeader>

          {/* The transport's own sentence, which names the device or the port
              where it can. No stack, no error number, no vendor id — those are in
              the debug panel, for the one role that can act on them. */}
          <p className="text-sm text-muted-foreground">{error?.message}</p>

          <div className="grid gap-2">
            {error && canReconnect(error.code) && (
              <Button
                onClick={async () => {
                  setError(null);
                  // Re-adopt first, then print. Reconnecting without printing
                  // would leave someone pressing two buttons for one receipt.
                  await reconnect();
                  void run();
                }}
              >
                <Plug className="mr-1.5 h-4 w-4" /> Reconnect
              </Button>
            )}
            {error && isRetryable(error.code) && !canReconnect(error.code) && (
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
            {/* Never automatic. This is a different document on a different kind
                of paper, and it appears only where the surface passed one in and
                only as a labelled button a person decides to press. */}
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
