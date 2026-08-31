'use client';

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { usePosPrinter } from '@/hooks/usePosPrinter';
import {
  connectPrinter,
  printTestPage,
  testConnection,
  PosPrintError,
  type PrintContext,
} from '@/lib/print/pos/printerService';
import { CONNECTION_LABELS, profileOf, type PosPrinterConfig, type PrinterConnection } from '@/lib/print/pos/printerConfig';
import {
  adoptionPatch,
  AVAILABILITY_LABELS,
  SYSTEM_DEFAULT_NOTICE,
  type DetectedPrinter,
  type PrinterAvailability,
  type PrinterDetection,
} from '@/lib/print/pos/discovery';
import { connectionOptions, DEFAULT_BAUD_RATE, DEFAULT_PRINTER_PORT, SERIAL_BAUD_RATES } from '@/lib/print/pos/transport';
import { PRINTER_PROFILES, type PrinterProfile } from '@/lib/print/pos/profiles';
import { clearPrintLog, readPrintLog, subscribeToPrintLog, type PrintLogEntry } from '@/lib/print/pos/printLog';
import { preview } from '@/lib/print/pos/escpos';
import { testPageBlocks } from '@/lib/print/pos/receiptFormatter';
import { formatDateTime } from '@/utils/date';
import { AlertTriangle, Check, Info, Loader2, Plug, Printer, RefreshCw, Save, Wifi } from 'lucide-react';
import { toast } from 'sonner';

/**
 * POS Printer Setup — where a till is told which printer it has, and proves it.
 *
 * ---------------------------------------------------------------------------
 * There is no printer list any more, and that is the improvement
 * ---------------------------------------------------------------------------
 * The old dialog listed printers by asking a local print service to read the
 * machine's spooler. It was a good list and it cost a whole second program on
 * every till, which had to be installed, started and kept running — and when it
 * was not, this dialog could only say "start the print service", which is not
 * something a cashier can do.
 *
 * Now the *browser* shows the chooser. Pressing Connect opens Chrome's own device
 * picker, the person picks the printer, and the grant is remembered against this
 * origin. The app never sees the list and never needs to: what it gets back is a
 * device it can write to, today and every morning after.
 *
 * ---------------------------------------------------------------------------
 * Nothing here claims a connection it has not made
 * ---------------------------------------------------------------------------
 * Every state on this screen is evidence-backed. "Connected" appears after a
 * device has actually been opened, not after a form has been filled in.
 * Unsupported connections are shown greyed with the reason rather than hidden,
 * and a browser that cannot do this at all says so in one sentence at the top
 * instead of offering a Connect button that can only fail.
 *
 * ---------------------------------------------------------------------------
 * Edits are a draft until Save
 * ---------------------------------------------------------------------------
 * The old dialog wrote every keystroke straight to storage. Here the form is a
 * draft: Connect and Test Print run against the draft, so a printer can be tried
 * before the till commits to it, and Save is what makes it the default this
 * device prints to. Closing without saving leaves the previous printer exactly as
 * it was.
 */

/** Only these ever need to see payload sizes and device detail. */
const DEBUG_ROLES = new Set(['super_admin']);

type Phase = 'idle' | 'connecting' | 'printing';

export interface PrinterSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether to offer the debug panel. Pass the signed-in role. */
  role?: string;
}

export function PrinterSettingsDialog({ open, onOpenChange, role }: PrinterSettingsDialogProps) {
  const { config, update, status, refreshStatus, context, detection, refreshPrinters } = usePosPrinter();
  const [scanning, setScanning] = useState(false);
  const [draft, setDraft] = useState<PosPrinterConfig>(config);
  const [phase, setPhase] = useState<Phase>('idle');
  const [linked, setLinked] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const canDebug = role ? DEBUG_ROLES.has(role) : false;

  const options = useMemo(() => connectionOptions(), []);
  const chosen = options.find((o) => o.type === draft.connection);
  const supported = chosen?.support.supported ?? false;

  /*
   * The draft is seeded when the dialog opens, not on every config change.
   *
   * Re-seeding while it is open would throw away what someone is halfway through
   * typing the moment the 30-second status poll wrote anything — and the printer
   * name field is exactly where that would be noticed.
   */
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(config);
    setLinked(status?.state === 'connected');
    setProblem(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const patch = useCallback((next: Partial<PosPrinterConfig>) => {
    setDraft((current) => ({ ...current, ...next }));
  }, []);

  /** The draft as a print context, so Test Print exercises the printer being set up. */
  const draftContext: PrintContext = { ...context, config: draft };

  /**
   * Opens the browser's device chooser.
   *
   * Called straight from the click with no `await` before it — a device chooser
   * opened outside a user gesture is refused by every browser that has one.
   */
  async function connect() {
    setPhase('connecting');
    setProblem(null);
    try {
      const device = await connectPrinter(draft);
      const named = draft.printerName.trim() || device.label;
      setDraft((current) => ({
        ...current,
        printerId: device.deviceId,
        printerName: named,
        usb:
          current.connection === 'usb' && device.vendorId != null && device.productId != null
            ? { vendorId: device.vendorId, productId: device.productId, serialNumber: device.serialNumber ?? null }
            : current.usb,
        serial:
          current.connection === 'serial'
            ? {
                usbVendorId: device.vendorId ?? null,
                usbProductId: device.productId ?? null,
                baudRate: current.serial?.baudRate ?? DEFAULT_BAUD_RATE,
              }
            : current.serial,
      }));
      setLinked(true);
      toast.success(`Connected to ${named}.`);
    } catch (error) {
      setLinked(false);
      const failure = error instanceof PosPrintError ? error : null;
      // Closing the chooser is not a failure and must not be dressed as one.
      if (failure?.code === 'cancelled') {
        setPhase('idle');
        return;
      }
      const message = failure?.message ?? 'Connection failed.';
      setProblem(message);
      toast.error(message);
    } finally {
      setPhase('idle');
    }
  }

  /** For a LAN printer there is no chooser — the address is the printer, so prove it. */
  async function verify() {
    setPhase('connecting');
    setProblem(null);
    try {
      const device = await testConnection({ ...draft, printerId: draft.printerId || 'pending' });
      setDraft((current) => ({
        ...current,
        printerId: device.deviceId,
        printerName: current.printerName.trim() || device.label,
      }));
      setLinked(true);
      toast.success('The printer answered.');
    } catch (error) {
      setLinked(false);
      const message = error instanceof PosPrintError ? error.message : 'Connection failed.';
      setProblem(message);
      toast.error(message);
    } finally {
      setPhase('idle');
    }
  }

  async function test() {
    setPhase('printing');
    setProblem(null);
    try {
      await printTestPage(draftContext, { name: draft.printerName, connection: draft.connection });
      setLinked(true);
      toast.success('Printed successfully');
    } catch (error) {
      const message = error instanceof PosPrintError ? error.message : 'The test page could not be printed.';
      setProblem(message);
      toast.error(message);
    } finally {
      setPhase('idle');
    }
  }

  /**
   * `Refresh Printers` — re-ask the browser what it has been granted.
   *
   * It prompts for nothing, which is the difference between this and Connect: it
   * re-reads the permission store, re-checks each device against what is
   * attached, and adopts one only if this branch has none. A till whose printer
   * was switched on after the page loaded presses this and it appears.
   */
  async function rescan() {
    setScanning(true);
    try {
      const found = await refreshPrinters();
      if (!found.selected) {
        toast.message('No POS printer found', {
          description: found.reason ?? 'Press Connect Printer and choose it once.',
        });
      } else if (!draft.printerId && found.selected.available) {
        // Nothing chosen in the draft yet, so detection's answer becomes the
        // draft's — the till gets its printer without touching the list.
        const next = adoptionPatch(found.selected, draft);
        if (next) {
          patch(next);
          setLinked(found.selected.status === 'ready' || found.selected.status === 'printing');
          toast.success(`Detected ${found.selected.name}.`);
        }
      } else {
        toast.success(`${found.printers.length} printer${found.printers.length === 1 ? '' : 's'} detected.`);
      }
    } catch {
      toast.error('Could not check for printers on this computer.');
    } finally {
      setScanning(false);
    }
  }

  /** Pick a detected printer by hand — the tie-break when a till has two. */
  function choose(printer: DetectedPrinter) {
    const next = adoptionPatch(printer, draft);
    if (!next) return;
    patch(next);
    setLinked(printer.status === 'ready' || printer.status === 'printing');
    setProblem(null);
  }

  function save() {
    update({ ...draft, isDefault: true });
    void refreshStatus();
    toast.success(`${draft.printerName || 'Printer'} saved as the default printer for this device.`);
    onOpenChange(false);
  }

  const profile = profileOf(draft);
  const busy = phase !== 'idle';
  const hasDevice = Boolean(draft.printerId);
  const statusText = busy
    ? phase === 'printing'
      ? 'Printing…'
      : 'Connecting…'
    : linked
      ? 'Connected'
      : hasDevice
        ? 'Not connected'
        : 'No printer connected';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>POS Printer Setup</DialogTitle>
        </DialogHeader>

        <div className="max-h-[70dvh] space-y-5 overflow-y-auto pr-1 text-sm">
          {/* ── Status ──────────────────────────────────────────────────── */}
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 font-medium">
              <span
                aria-hidden
                className={`h-2.5 w-2.5 rounded-full ${
                  busy ? 'bg-amber-400' : linked ? 'bg-emerald-500' : hasDevice ? 'bg-red-500' : 'bg-neutral-400'
                }`}
              />
              <span aria-live="polite">{statusText}</span>
            </span>
            {status?.deviceLabel && !busy && (
              <span className="truncate text-xs text-muted-foreground">{status.deviceLabel}</span>
            )}
          </div>

          {problem && (
            <p className="flex items-start gap-2 rounded-md bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{problem}</span>
            </p>
          )}

          <Separator />

          {/* ── Detected printers ───────────────────────────────────────── */}
          <DetectedPrinters
            detection={detection}
            scanning={scanning}
            selectedId={draft.printerId}
            onRefresh={rescan}
            onChoose={choose}
          />

          {/* ── Printer ─────────────────────────────────────────────────── */}
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Printer</p>
            <div className="grid gap-2">
              <Label htmlFor="mb-printer-name" className="text-xs">Printer name</Label>
              <Input
                id="mb-printer-name"
                value={draft.printerName}
                placeholder="BlackCopper 80mm"
                onChange={(e) => patch({ printerName: e.target.value })}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Your own name for this machine&rsquo;s printer. It prints on the test page and shows on the sales screen.
              </p>
            </div>
          </section>

          <Separator />

          {/* ── Connection ──────────────────────────────────────────────── */}
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Connection</p>

            <div className="grid gap-2">
              <Label htmlFor="mb-connection" className="text-xs">How the printer is attached</Label>
              <Select
                value={draft.connection}
                onValueChange={(value) => {
                  const connection = value as PrinterConnection;
                  // Switching connection invalidates the device: a USB grant is not
                  // an IP address. Clearing it here is what stops Save writing a
                  // printer id that the new transport could never open.
                  patch({
                    connection,
                    printerId: '',
                    network: connection === 'network' ? draft.network ?? { host: '', port: DEFAULT_PRINTER_PORT } : draft.network,
                    serial:
                      connection === 'serial'
                        ? draft.serial ?? { usbVendorId: null, usbProductId: null, baudRate: DEFAULT_BAUD_RATE }
                        : draft.serial,
                  });
                  setLinked(false);
                  setProblem(null);
                }}
              >
                <SelectTrigger id="mb-connection" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {options.map((option) => (
                    // Selectable even when unsupported. A disabled row can only
                    // say "not available"; a selected one gets the panel below,
                    // which says WHY and what would work instead.
                    <SelectItem key={option.type} value={option.type}>
                      {option.label}
                      {!option.support.supported && <span className="ml-2 text-xs text-muted-foreground">not available here</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{chosen?.hint}</p>
            </div>

            {/* The honest message. Not a toast, not hidden behind a failed press:
                a browser that cannot do this needs to say so where the choice is
                being made. */}
            {chosen && !supported && (
              <p className="rounded-md bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
                {chosen.support.reason}
              </p>
            )}

            {draft.connection === 'serial' && supported && (
              <div className="grid gap-2">
                <Label htmlFor="mb-baud" className="text-xs">Speed (baud)</Label>
                <Select
                  value={String(draft.serial?.baudRate ?? DEFAULT_BAUD_RATE)}
                  onValueChange={(value) =>
                    patch({
                      serial: {
                        usbVendorId: draft.serial?.usbVendorId ?? null,
                        usbProductId: draft.serial?.usbProductId ?? null,
                        baudRate: Number(value) || DEFAULT_BAUD_RATE,
                      },
                    })
                  }
                >
                  <SelectTrigger id="mb-baud" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SERIAL_BAUD_RATES.map((rate) => (
                      <SelectItem key={rate} value={String(rate)}>{rate}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Printed on the printer&rsquo;s self-test page. 9600 unless the printer says otherwise — the wrong
                  speed prints unreadable characters rather than nothing.
                </p>
              </div>
            )}

            {draft.connection === 'network' && (
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 grid gap-2">
                  <Label htmlFor="mb-host" className="text-xs">Printer IP</Label>
                  <Input
                    id="mb-host"
                    value={draft.network?.host ?? ''}
                    placeholder="192.168.1.100"
                    inputMode="decimal"
                    spellCheck={false}
                    disabled={!supported}
                    onChange={(e) => patch({ network: { host: e.target.value, port: draft.network?.port ?? DEFAULT_PRINTER_PORT } })}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="mb-port" className="text-xs">Port</Label>
                  <Input
                    id="mb-port"
                    value={draft.network?.port ?? DEFAULT_PRINTER_PORT}
                    inputMode="numeric"
                    disabled={!supported}
                    onChange={(e) =>
                      patch({ network: { host: draft.network?.host ?? '', port: Number(e.target.value.trim()) || 0 } })
                    }
                  />
                </div>
              </div>
            )}
          </section>

          <Separator />

          {/* ── Paper ───────────────────────────────────────────────────── */}
          <section className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Paper</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="mb-paper" className="text-xs">Paper width</Label>
                <Select value={draft.paperWidth} onValueChange={(v) => patch({ paperWidth: v === '58mm' ? '58mm' : '80mm' })}>
                  <SelectTrigger id="mb-paper" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRINTER_PROFILES.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="mb-copies" className="text-xs">Copies per print</Label>
                <Select value={String(draft.copies)} onValueChange={(v) => patch({ copies: Number(v) || 1 })}>
                  <SelectTrigger id="mb-copies" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* The override exists because the test page's ruler can prove the
                profile wrong on a printer set to a different font. Left blank in
                the normal case, which is why the placeholder shows the default. */}
            <div className="grid gap-2">
              <Label htmlFor="mb-columns" className="text-xs">Characters per line</Label>
              <Input
                id="mb-columns"
                inputMode="numeric"
                value={draft.charactersPerLine ?? ''}
                placeholder={`${profile.charactersPerLine} (standard for ${draft.paperWidth})`}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  patch({ charactersPerLine: raw === '' ? null : Number(raw) });
                }}
              />
              <p className="text-xs text-muted-foreground">
                Only change this if the test page&apos;s ruler line wraps instead of ending at the edge of the roll.
              </p>
            </div>
          </section>

          <Separator />

          {/* ── Actions ─────────────────────────────────────────────────── */}
          <section className="grid gap-2">
            {draft.connection === 'network' ? (
              <Button onClick={verify} disabled={busy || !supported || !draft.network?.host?.trim()}>
                {phase === 'connecting' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Wifi className="mr-1.5 h-4 w-4" />}
                Test Connection
              </Button>
            ) : (
              <Button onClick={connect} disabled={busy || !supported}>
                {phase === 'connecting' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plug className="mr-1.5 h-4 w-4" />}
                {hasDevice ? 'Connect a different printer' : 'Connect Printer'}
              </Button>
            )}

            <Button variant="outline" onClick={test} disabled={busy || !supported || !hasDevice}>
              {phase === 'printing' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Printer className="mr-1.5 h-4 w-4" />}
              Test Print
            </Button>

            <Button variant="secondary" onClick={save} disabled={busy || !hasDevice}>
              <Save className="mr-1.5 h-4 w-4" /> Save Printer
            </Button>
            <p className="text-xs text-muted-foreground">
              Saved for this computer and this branch only. Every Print button then uses it with nothing further to
              choose.
            </p>
          </section>

          {canDebug && (
            <>
              <Separator />
              <DebugPanel
                debug={draft.debug}
                onToggle={(debug) => patch({ debug })}
                profile={profile}
                printerName={draft.printerName}
                connectionLabel={CONNECTION_LABELS[draft.connection]}
                deviceId={draft.printerId}
              />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The developer view: what the printer would actually receive, and what the last
 * few jobs did.
 *
 * Gated to super admin because it is the one place raw device detail (a vendor
 * id, a byte count, a claim failure) is shown, and none of that helps a cashier —
 * while a screen full of it is exactly what makes someone stop reading the
 * message that would have helped.
 */
/**
 * What this computer has, and which of it Mountain Bakes will print to.
 *
 * ---------------------------------------------------------------------------
 * This list is grants, not the machine's printers
 * ---------------------------------------------------------------------------
 * Everything here comes from the browser's own permission store — the devices
 * somebody authorised for Mountain Bakes on this machine — which is the only
 * printer list a web page can obtain. A printer installed in Windows and never
 * granted to this app does not appear, however plainly it shows in *Printers &
 * scanners*, and nothing in the list carries the operating system's "default"
 * flag because no browser reports one.
 *
 * That is stated on screen rather than left to be inferred, because the gap is
 * invisible: a list that looks like the machine's printers and is not would have
 * a till concluding the printer is broken when it was simply never granted.
 *
 * What the list *does* buy is the thing that was actually asked for. The grant
 * outlives the session, so a printer chosen once is found on every load after —
 * including by a different branch account signing into the same till — and the
 * chooser never appears again.
 */
function DetectedPrinters({
  detection,
  scanning,
  selectedId,
  onRefresh,
  onChoose,
}: {
  detection: PrinterDetection | null;
  scanning: boolean;
  selectedId: string;
  onRefresh: () => void;
  onChoose: (printer: DetectedPrinter) => void;
}) {
  const printers = detection?.printers ?? [];
  const selected = detection?.selected ?? null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">POS Printer</p>
        <Button variant="outline" size="sm" onClick={onRefresh} disabled={scanning} className="h-7 text-xs">
          {scanning ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
          Refresh Printers
        </Button>
      </div>

      {/* The headline answer, so the common case is read without scanning a list. */}
      <div className="rounded-md border bg-muted/40 p-3">
        {selected ? (
          <>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Detected printer</p>
            <p className="mt-0.5 truncate font-medium">{selected.name}</p>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <StatusDot status={selected.status} />
              <span className={statusTone(selected.status)}>{AVAILABILITY_LABELS[selected.status]}</span>
              <span className="text-muted-foreground">· {CONNECTION_LABELS[selected.connectionType]}</span>
            </p>
            <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>{sourceSentence(detection?.source)}</span>
            </p>
            {selected.reason && <p className="mt-1 text-xs text-muted-foreground">{selected.reason}</p>}
          </>
        ) : (
          <>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Detected printer</p>
            <p className="mt-0.5 font-medium text-muted-foreground">
              {scanning || !detection ? 'Checking this computer…' : 'None'}
            </p>
            {detection?.reason && <p className="mt-1 text-xs text-muted-foreground">{detection.reason}</p>}
          </>
        )}
      </div>

      {/*
        The full list only when it adds something. One printer that is already the
        headline is not a list worth reading, and a till with exactly one is the
        overwhelmingly common case.
      */}
      {printers.length > 1 && (
        <div className="space-y-1.5">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Detected printers</p>
          {detection?.ambiguous && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              More than one printer is connected to this computer. Mountain Bakes chose the first — pick another below if
              that is the wrong roll.
            </p>
          )}
          <ul className="divide-y rounded-md border">
            {printers.map((printer) => {
              const isSelected = printer.deviceId === (selectedId || selected?.deviceId);
              return (
                <li key={printer.deviceId}>
                  <button
                    type="button"
                    onClick={() => onChoose(printer)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-muted/60"
                    aria-pressed={isSelected}
                  >
                    <Check
                      className={`h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-emerald-600 dark:text-emerald-400' : 'invisible'}`}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{printer.name}</span>
                      <span className="text-muted-foreground">{CONNECTION_LABELS[printer.connectionType]}</span>
                    </span>
                    <StatusDot status={printer.status} />
                    <span className={`shrink-0 ${statusTone(printer.status)}`}>{AVAILABILITY_LABELS[printer.status]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/*
        The limitation, in the place someone looks for the thing it is about. It
        is not an error and must not read as one — the printing works; it is the
        *word* "system default" that this app cannot honestly use.
      */}
      <p className="flex items-start gap-2 rounded-md bg-muted/50 p-2.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{SYSTEM_DEFAULT_NOTICE}</span>
      </p>
    </section>
  );
}

/** How the selected printer came to be selected. Mirrors `SelectionSource`. */
function sourceSentence(source: PrinterDetection['source'] | undefined): string {
  switch (source) {
    case 'branch-config':
      return 'Set up for this branch on this computer. Every Print button uses it.';
    case 'configured-offline':
      return 'Set up for this branch, but not attached at the moment.';
    case 'auto-detected':
      return 'Detected automatically on this computer — nobody had to choose it.';
    default:
      return 'No printer chosen yet.';
  }
}

const STATUS_DOT: Record<PrinterAvailability, string> = {
  ready: 'bg-emerald-500',
  printing: 'bg-amber-400 animate-pulse',
  offline: 'bg-red-500',
  error: 'bg-red-500',
  unavailable: 'bg-neutral-400',
};

function statusTone(status: PrinterAvailability): string {
  if (status === 'ready') return 'text-emerald-600 dark:text-emerald-400';
  if (status === 'offline' || status === 'error') return 'text-red-600 dark:text-red-400';
  return 'text-muted-foreground';
}

function StatusDot({ status }: { status: PrinterAvailability }) {
  return <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status]}`} />;
}

function DebugPanel({
  debug,
  onToggle,
  profile,
  printerName,
  connectionLabel,
  deviceId,
}: {
  debug: boolean;
  onToggle: (value: boolean) => void;
  profile: PrinterProfile;
  printerName: string;
  connectionLabel: string;
  deviceId: string;
}) {
  const log = useSyncExternalStore(subscribeToPrintLog, readPrintLog, () => EMPTY_LOG);

  // The SAME blocks the printer will be sent, rendered as text by the same
  // wrapping and column maths. Not a mock-up of the receipt — a mock-up would
  // agree with the printer right up until the moment it mattered.
  const lines = preview(
    testPageBlocks({ printerName: printerName || 'Unnamed printer', connectionLabel }, profile),
    profile.charactersPerLine,
  );

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium">Developer tools</p>
          <p className="text-xs text-muted-foreground">Payload preview and recent print jobs.</p>
        </div>
        <Switch checked={debug} onCheckedChange={onToggle} aria-label="Show print diagnostics" />
      </div>

      {debug && (
        <>
          <p className="text-xs text-muted-foreground">
            Device: <span className="font-mono">{deviceId || 'none'}</span>
          </p>

          <div>
            <p className="mb-1 text-xs font-medium">Test page, exactly as it will print</p>
            <pre className="max-h-52 overflow-auto rounded-md bg-neutral-950 p-3 font-mono text-[10px] leading-tight text-neutral-100">
{lines.join('\n')}
            </pre>
          </div>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-xs font-medium">Recent print jobs</p>
              {log.length > 0 && (
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearPrintLog}>Clear</Button>
              )}
            </div>
            {log.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing printed from this browser yet.</p>
            ) : (
              <ul className="max-h-52 space-y-1 overflow-auto rounded-md border p-2">
                {log.slice(0, 25).map((entry) => <LogRow key={entry.printJobId} entry={entry} />)}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/** Stable identity — `useSyncExternalStore` compares snapshots by reference. */
const EMPTY_LOG: PrintLogEntry[] = [];

function LogRow({ entry }: { entry: PrintLogEntry }) {
  const ok = entry.status === 'success';
  return (
    <li className="flex items-start justify-between gap-2 py-0.5 text-[11px]">
      <span className="min-w-0">
        <span className={ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}>
          {ok ? '✓' : '✗'}
        </span>{' '}
        <span className="font-medium">{entry.documentType}</span>
        {entry.documentId ? ` ${entry.documentId}` : ''}
        {' → '}
        {entry.printerName || entry.printerId}
        {entry.errorMessage && <span className="block text-muted-foreground">{entry.errorMessage}</span>}
      </span>
      <span className="shrink-0 text-muted-foreground tabular-nums">
        {formatDateTime(entry.createdAt)}
      </span>
    </li>
  );
}
