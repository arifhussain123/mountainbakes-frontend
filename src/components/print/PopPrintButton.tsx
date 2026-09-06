'use client';

import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PosPrintError, type PrintJobSnapshot, type PrintResult } from '@/lib/print/systemPrinter';
import { isRetryable, type PrintErrorCode } from '@/lib/print/errors';
import { PAPER_OPTIONS, useReceiptPaper } from '@/lib/print/receiptPaper';
import type { PaperWidth } from '@/lib/print/receipt/types';
import { beginPrintTrace, printTrace } from '@/lib/print/diagnostics';
import { cn } from '@/lib/utils';
import { AlertTriangle, Check, ChevronDown, Clock, Loader2, Printer } from 'lucide-react';
import { toast } from 'sonner';

/**
 * POP Print — the one button that prints a receipt.
 *
 * ---------------------------------------------------------------------------
 * What pressing it does, and what it never does
 * ---------------------------------------------------------------------------
 * It queues the receipt for the printer this computer has installed and returns.
 * There is no printer to choose, no setup screen, no connection to test: the
 * operating system's default printer is the printer (see `systemPrinter.ts` for
 * the one thing a browser cannot do here, and how a till skips the dialog). The
 * press itself does no composing and no I/O; the button repaints as
 * *Printing…* (or *Queued* when another receipt is already going out) and the
 * rest of the screen stays usable.
 *
 * ---------------------------------------------------------------------------
 * Feedback that gets out of the way
 * ---------------------------------------------------------------------------
 * Success is a small toast for 1.2 seconds and a tick on the button for the
 * same. Failure is a toast with the one sentence that names the next action,
 * and the button reads *Print Failed* until it is pressed again — which is the
 * retry. No modal, no `alert()`, no overlay: a print is a step at a counter, not
 * a conversation.
 *
 * ---------------------------------------------------------------------------
 * Double-press protection is here and in the queue
 * ---------------------------------------------------------------------------
 * The button disables itself for the duration, and the queue folds a second
 * request for the same document onto the job already in flight. Two layers
 * because they catch different things: an impatient double-click, and two
 * different buttons aimed at one sale.
 */

type PrintState = 'idle' | 'queued' | 'printing' | 'printed' | 'failed';

/** How long "Printed successfully" stays on screen, and the button reads *Printed*. */
const PRINTED_FEEDBACK_MS = 1_200;
/** A failure toast stays a little longer — there is a sentence to read. */
const FAILED_FEEDBACK_MS = 3_500;

/** What the button hands the caller's `print` so it can follow the job. */
export interface PrintHooks {
  /** Spread into `PrintOptions` — `printSaleReceipt(doc, { paper, ...hooks })`. */
  onJobUpdate: (job: PrintJobSnapshot<PrintResult>) => void;
  /** The roll this device is set to. Pass through as `paper`. */
  paper: PaperWidth;
}

export interface PopPrintButtonProps {
  /** Does the print. Usually a closure over `printSaleReceipt` / `printProductionOrder`. */
  print: (hooks: PrintHooks) => Promise<PrintResult>;
  label?: string;
  /** Runs after a successful print — marking the order printed, closing a dialog. */
  onPrinted?: (result: PrintResult) => void;
  /**
   * Fire the print once, as soon as this mounts, without waiting for a press.
   * For "Save & Print", where the press already happened on the sale form. The
   * same state machine, duplicate guards and failure feedback run.
   */
  autoPrint?: boolean;
  /**
   * Offer the 80mm / 58mm roll choice beside the button. Per device, remembered.
   * The only printing setting that lives in this app — see `receiptPaper.ts`.
   */
  showPaperMenu?: boolean;
  disabled?: boolean;
  variant?: ComponentProps<typeof Button>['variant'];
  size?: ComponentProps<typeof Button>['size'];
  className?: string;
}

export function PopPrintButton({
  print,
  label = 'POP Print',
  onPrinted,
  autoPrint = false,
  showPaperMenu = true,
  disabled,
  variant = 'default',
  size = 'default',
  className,
}: PopPrintButtonProps) {
  const { paper, setPaper } = useReceiptPaper();
  const [state, setState] = useState<PrintState>('idle');
  const [ahead, setAhead] = useState(0);
  const [error, setError] = useState<{ code: PrintErrorCode; message: string } | null>(null);

  // The feedback states revert on a timer, and the timer has to be cancelled if
  // the dialog closes first — a setState on an unmounted tree is a leak that
  // outlives the sale.
  const revert = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (revert.current) clearTimeout(revert.current);
    };
  }, []);

  // Read through refs so `run` need not change identity with every parent
  // render — the parents build `print` inline, and a `run` that changed with it
  // would re-fire the auto-print effect below.
  const printRef = useRef(print);
  const onPrintedRef = useRef(onPrinted);
  const paperRef = useRef(paper);
  useEffect(() => {
    printRef.current = print;
    onPrintedRef.current = onPrinted;
    paperRef.current = paper;
  }, [print, onPrinted, paper]);

  const busy = state === 'printing' || state === 'queued';
  const busyRef = useRef(false);

  const scheduleRevert = (ms: number) => {
    if (revert.current) clearTimeout(revert.current);
    revert.current = setTimeout(() => {
      if (mounted.current) {
        setState('idle');
        setError(null);
      }
    }, ms);
  };

  const run = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    beginPrintTrace('pop-print');
    printTrace('button pressed', { label });
    setState('printing');
    setAhead(0);
    setError(null);

    const hooks: PrintHooks = {
      paper: paperRef.current,
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
      printTrace('print promise resolved', { ms: result.durationMs });
      if (!mounted.current) return;
      setState('printed');
      toast.success('Printed successfully', { duration: PRINTED_FEEDBACK_MS });
      onPrintedRef.current?.(result);
      scheduleRevert(PRINTED_FEEDBACK_MS);
    } catch (caught) {
      if (!mounted.current) return;
      const failure = caught instanceof PosPrintError
        ? caught
        : new PosPrintError('print-failed', 'Printing failed. Check the printer is switched on and set as the default printer on this computer.');
      printTrace('print promise rejected', { code: failure.code, detail: failure.detail });
      setState('failed');
      setError({ code: failure.code, message: failure.message });
      toast.error(failure.code === 'invalid-document' ? 'Print document is empty' : 'Printing failed', {
        description: failure.message,
        duration: FAILED_FEEDBACK_MS,
      });
      scheduleRevert(FAILED_FEEDBACK_MS);
    } finally {
      busyRef.current = false;
    }
  }, [label]);

  // Auto-print fires exactly once per mount. The ref, not the `state`, is what
  // enforces that, so a re-render of the sales page cannot re-fire it.
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

  const title =
    state === 'failed' && error
      ? `${error.message}${isRetryable(error.code) ? ' Press to try again.' : ''}`
      : `Print this receipt on the ${paper} roll of this computer's default printer`;

  return (
    <div className={cn('no-print inline-flex items-stretch', className)}>
      <Button
        variant={state === 'failed' ? 'destructive' : variant}
        size={size}
        disabled={disabled || busy}
        onClick={run}
        className={cn('flex-1', showPaperMenu && 'rounded-r-none')}
        title={title}
        aria-busy={busy || undefined}
      >
        {state === 'printing' && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
        {state === 'queued' && <Clock className="mr-1.5 h-4 w-4" />}
        {state === 'printed' && <Check className="mr-1.5 h-4 w-4" />}
        {state === 'failed' && <AlertTriangle className="mr-1.5 h-4 w-4" />}
        {state === 'idle' && <Printer className="mr-1.5 h-4 w-4" />}
        {caption}
      </Button>

      {showPaperMenu && (
        <DropdownMenu>
          <DropdownMenuTrigger
            disabled={disabled || busy}
            aria-label="Receipt paper width"
            title={`Receipt paper: ${paper}`}
            className={cn(
              buttonVariants({ variant: state === 'failed' ? 'destructive' : variant, size }),
              'rounded-l-none border-l-black/10 px-1.5 dark:border-l-white/15',
            )}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-60">
            <DropdownMenuLabel>Receipt paper on this printer</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={paper} onValueChange={(v) => setPaper(v as PaperWidth)}>
              {PAPER_OPTIONS.map((o) => (
                <DropdownMenuRadioItem key={o.value} value={o.value} className="py-1.5">
                  <span className="flex flex-col">
                    <span>{o.label}</span>
                    <span className="text-xs text-muted-foreground">{o.hint}</span>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              Receipts go to the printer set as default on this computer. Change the printer in Windows Printers &amp; scanners.
            </p>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
