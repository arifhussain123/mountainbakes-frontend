'use client';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { usePosPrinter } from '@/hooks/usePosPrinter';
import { connectionFromTransport, listPrinters, printTestPage, PosPrintError, type AgentPrinter } from '@/lib/print/pos/printerService';
import { CONNECTION_LABELS, profileOf } from '@/lib/print/pos/printerConfig';
import { PRINTER_PROFILES, type PrinterProfile } from '@/lib/print/pos/profiles';
import { clearPrintLog, readPrintLog, subscribeToPrintLog, type PrintLogEntry } from '@/lib/print/pos/printLog';
import { preview } from '@/lib/print/pos/escpos';
import { testPageBlocks } from '@/lib/print/pos/receiptFormatter';
import { formatDateTime } from '@/utils/date';
import { Loader2, Printer, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

/**
 * Where a till is told which printer it has.
 *
 * ---------------------------------------------------------------------------
 * The list is discovered, never hardcoded
 * ---------------------------------------------------------------------------
 * Every printer offered here comes from the local print agent asking the
 * machine's own spooler what is installed. "BlackCopper 80mm Series" appears
 * because that computer has it, not because the name is in the source — so a shop
 * that replaces the unit re-picks from this list instead of waiting for a
 * release. There is no fallback list and there should not be one: an option that
 * is not really there is worse than an empty list, because the empty list is
 * true and points at the real problem.
 *
 * ---------------------------------------------------------------------------
 * The setting is per device (and per branch), on purpose
 * ---------------------------------------------------------------------------
 * See the header of `lib/print/pos/printerConfig.ts`. Nothing here is written to
 * the API.
 */

/** Only these ever need to see payload sizes and agent error detail. */
const DEBUG_ROLES = new Set(['super_admin']);

export interface PrinterSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whether to offer the debug panel. Pass the signed-in role. */
  role?: string;
}

export function PrinterSettingsDialog({ open, onOpenChange, role }: PrinterSettingsDialogProps) {
  const { config, update, status, checking, refreshStatus, context } = usePosPrinter();
  const [printers, setPrinters] = useState<AgentPrinter[] | null>(null);
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [testing, setTesting] = useState(false);
  const canDebug = role ? DEBUG_ROLES.has(role) : false;

  const loadPrinters = useCallback(async () => {
    setLoadingPrinters(true);
    try {
      setPrinters(await listPrinters(config));
    } catch (error) {
      setPrinters([]);
      toast.error(error instanceof PosPrintError ? error.message : 'Could not read the printer list.');
    } finally {
      setLoadingPrinters(false);
    }
  }, [config]);

  // Refresh on open rather than on mount: the dialog lives inside the print
  // button, so it is mounted on every sales screen and would otherwise poll the
  // agent for a list nobody is looking at.
  //
  // Both rules are suppressed deliberately. `set-state-in-effect` fires because
  // this is a fetch-on-open and every fetch-on-open ends in a setState; there is
  // no render-time way to ask a local HTTP service what printers exist.
  // `exhaustive-deps` wants `loadPrinters`, which closes over the config — adding
  // it would re-list the printers on every keystroke in the agent URL field.
  useEffect(() => {
    if (!open) return;
    void refreshStatus();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadPrinters();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function choose(printerId: string | null) {
    const printer = printers?.find((p) => p.id === printerId);
    if (!printer) return;
    update({
      printerId: printer.id,
      printerName: printer.name,
      connection: connectionFromTransport(printer.transport),
    });
  }

  async function test() {
    setTesting(true);
    try {
      const result = await printTestPage(context);
      toast.success(`Test page sent to ${result.printerName || config.printerName}.`);
    } catch (error) {
      toast.error(error instanceof PosPrintError ? error.message : 'The test page could not be printed.');
    } finally {
      setTesting(false);
    }
  }

  const profile = profileOf(config);
  const reachable = Boolean(status?.reachable);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-lg">
        <DialogHeader>
          <DialogTitle>Printer Settings</DialogTitle>
        </DialogHeader>

        <div className="max-h-[70dvh] space-y-5 overflow-y-auto pr-1 text-sm">
          {/* ── Service ─────────────────────────────────────────────────── */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">Local print service</p>
              <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${reachable ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
                <span aria-hidden className={`h-2 w-2 rounded-full ${checking && !status ? 'bg-amber-400' : reachable ? 'bg-emerald-500' : 'bg-red-500'}`} />
                {checking && !status ? 'Checking…' : reachable ? 'Running' : 'Not running'}
              </span>
            </div>

            {!reachable && (
              <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                Receipts print through a small service that runs on this computer. Start it, then
                press Retry. Setup instructions are in <code className="font-mono">print-agent/README.md</code>.
              </p>
            )}

            <div className="grid gap-2">
              <Label htmlFor="mb-agent-url" className="text-xs">Service address</Label>
              <Input
                id="mb-agent-url"
                value={config.agentUrl}
                onChange={(e) => update({ agentUrl: e.target.value })}
                spellCheck={false}
                autoComplete="off"
              />
            </div>

            {/* Only offered when the service says it wants one — a password box on
                a till that needs no password is a box someone will fill in. */}
            {status?.requiresToken && (
              <div className="grid gap-2">
                <Label htmlFor="mb-agent-token" className="text-xs">Service key</Label>
                <Input
                  id="mb-agent-token"
                  type="password"
                  value={config.agentToken}
                  onChange={(e) => update({ agentToken: e.target.value })}
                  placeholder="Set on this computer only"
                  autoComplete="off"
                />
                <p className="text-xs text-muted-foreground">
                  Stored in this browser on this computer. It is never sent to Mountain Bakes.
                </p>
              </div>
            )}

            <Button variant="outline" size="sm" onClick={() => { void refreshStatus(); void loadPrinters(); }}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry connection
            </Button>
          </section>

          <Separator />

          {/* ── Printer ─────────────────────────────────────────────────── */}
          <section className="space-y-3">
            <p className="font-medium">POS printer</p>

            {loadingPrinters ? (
              <p className="text-xs text-muted-foreground">Reading the printers on this computer…</p>
            ) : printers && printers.length > 0 ? (
              <div className="grid gap-2">
                <Label htmlFor="mb-printer" className="text-xs">Printer on this computer</Label>
                <Select value={config.printerId || undefined} onValueChange={choose}>
                  <SelectTrigger id="mb-printer"><SelectValue placeholder="Choose a printer" /></SelectTrigger>
                  <SelectContent>
                    {printers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {CONNECTION_LABELS[connectionFromTransport(p.transport)]}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                {reachable
                  ? 'The print service found no printers installed on this computer. Install the POS printer driver, then press Retry connection.'
                  : 'Start the local print service to see the printers on this computer.'}
              </p>
            )}

            {/* Named even while the agent is down, so someone can see what this
                till was set to without first fixing the service. */}
            {config.printerName && (
              <p className="text-xs text-muted-foreground">
                Currently set to <span className="font-medium text-foreground">{config.printerName}</span>
                {' · '}{CONNECTION_LABELS[config.connection]}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="mb-paper" className="text-xs">Paper width</Label>
                <Select value={config.paperWidth} onValueChange={(v) => update({ paperWidth: v === '58mm' ? '58mm' : '80mm' })}>
                  <SelectTrigger id="mb-paper"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PRINTER_PROFILES.map((p) => (
                      <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="mb-copies" className="text-xs">Copies per print</Label>
                <Select value={String(config.copies)} onValueChange={(v) => update({ copies: Number(v) || 1 })}>
                  <SelectTrigger id="mb-copies"><SelectValue /></SelectTrigger>
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
                value={config.charactersPerLine ?? ''}
                placeholder={`${profile.charactersPerLine} (standard for ${config.paperWidth})`}
                onChange={(e) => {
                  const raw = e.target.value.trim();
                  update({ charactersPerLine: raw === '' ? null : Number(raw) });
                }}
              />
              <p className="text-xs text-muted-foreground">
                Only change this if the test page&apos;s ruler line wraps instead of ending at the edge of the roll.
              </p>
            </div>

            <Button onClick={test} disabled={testing || !config.printerId} className="w-full">
              {testing ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Printer className="mr-1.5 h-4 w-4" />}
              {testing ? 'Printing test page…' : 'Print test page'}
            </Button>
          </section>

          {canDebug && (
            <>
              <Separator />
              <DebugPanel
                debug={config.debug}
                onToggle={(debug) => update({ debug })}
                profile={profile}
                printerName={config.printerName}
                connectionLabel={CONNECTION_LABELS[config.connection]}
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
 * Gated to super admin because it is the one place raw agent detail (a Win32
 * error number, a byte count, a refused port) is shown, and none of that helps a
 * cashier — while a screen full of it is exactly what makes someone stop reading
 * the message that would have helped.
 */
function DebugPanel({
  debug,
  onToggle,
  profile,
  printerName,
  connectionLabel,
}: {
  debug: boolean;
  onToggle: (value: boolean) => void;
  profile: PrinterProfile;
  printerName: string;
  connectionLabel: string;
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
