'use client';

import { activePrintCount } from './printerService';
import { DEFAULT_CONFIG, targetOf, type PosPrinterConfig } from './printerConfig';
import {
  DEFAULT_BAUD_RATE,
  transportFor,
  type ConnectionType,
  type DeviceIdentity,
  type LinkStatus,
  type TransportTarget,
} from './transport';

/**
 * Finding the POS printer without asking anyone to find it.
 *
 * ---------------------------------------------------------------------------
 * What this is, and the thing it deliberately is not
 * ---------------------------------------------------------------------------
 * The ask behind this file is "the till should not pick its printer every
 * morning", and that is exactly what it delivers: on load it enumerates the
 * devices this origin already holds a grant for, works out which are actually
 * attached, and — when nothing has been configured for the branch — adopts one
 * with nobody pressing anything.
 *
 * It is **not** a reader of the operating system's printer list, and no amount of
 * work in this file could make it one. That is worth stating in the module rather
 * than in a ticket, because the difference is invisible from the UI and someone
 * will eventually try to close it:
 *
 * - There is no `navigator.getDefaultPrinter()`, no `listSystemPrinters()`, and
 *   nothing in any shipping or proposed web standard that reports which printer
 *   Windows or macOS considers default. The only browser API that touches the OS
 *   print stack is `window.print()`, which *shows the dialog* rather than telling
 *   the page anything, and which this app does not use for receipts (see
 *   `printerService`).
 * - So `isSystemDefault` below is typed `null` — not `boolean | null`, and not an
 *   optional. A field that can only ever hold one value cannot be quietly
 *   upgraded to a guess by a later change, and the type is what enforces that.
 *
 * ---------------------------------------------------------------------------
 * The one that bites: OS-installed and directly printable are exclusive
 * ---------------------------------------------------------------------------
 * On Windows the two halves of "use the system default printer, silently" cannot
 * both be true at once, and this is a property of the operating system rather
 * than of this code:
 *
 * - Install the printer through *Printers & scanners* and `usbprint.sys` owns its
 *   USB interface. `claimInterface` then fails with `device-busy`, so the very
 *   printer the OS calls default is the one this app cannot open. The only route
 *   left to it is the browser print dialog.
 * - Bind it to WinUSB instead and this app prints to it directly, with no dialog
 *   and no driver — but it is no longer an installed printer, so it is not the
 *   system default and nothing anywhere reports it as one.
 *
 * A till therefore chooses one or the other. This app is built for the second,
 * and detection here means *the authorised device on this machine*, named as
 * such on screen. `PRINTING.md` carries the long version and the native-wrapper
 * route for anyone who needs the first.
 *
 * ---------------------------------------------------------------------------
 * Why detection is still worth having
 * ---------------------------------------------------------------------------
 * Because the grant outlives the session. `navigator.usb.getDevices()` answers
 * from the browser's permission store with no prompt and no user gesture, so a
 * printer authorised once in the life of the till is found on every load
 * thereafter — including on a fresh branch login on the same machine, which is
 * the case that used to send someone back through the chooser for a device the
 * browser already knew about.
 */

/* ────────────────────────────────────────────────────────────────────────────
   What a detected printer looks like
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * The five words the counter is allowed to see, and what each one means.
 *
 * They are deliberately not the same vocabulary as `LinkState`. That type
 * describes a *transport* ("has anything been authorised"); this one describes a
 * *printer* as a person at a till thinks of it, and the two differ in the case
 * that matters most: a device that is attached but whose interface is held by
 * Windows is `disconnected` to the transport and `error` here, because the fix is
 * a driver change rather than a cable.
 */
export type PrinterAvailability =
  /** Attached, open, and the next receipt will come out of it. */
  | 'ready'
  /** A job is on the wire right now. */
  | 'printing'
  /** Known and authorised, but not answering — unplugged, or switched off. */
  | 'offline'
  /** This browser cannot reach this kind of printer at all. A different browser is the only fix. */
  | 'unavailable'
  /** Present, but something refused: the interface is held, or the permission was withdrawn. */
  | 'error';

/**
 * One printer this app can see, as Printer Settings shows it.
 *
 * `name` comes from the device's own USB product string — it is what the printer
 * calls itself, which for the units in this shop is a readable model name. It is
 * *not* a Windows queue name, and the two can differ for the same hardware.
 */
export interface DetectedPrinter {
  /** Stable across sessions: matches `PosPrinterConfig.printerId`. */
  deviceId: string;
  name: string;
  status: PrinterAvailability;
  connectionType: ConnectionType;
  /**
   * The printer Mountain Bakes prints to on this computer, for this branch.
   *
   * "Default" here means *this app's* default and nothing wider. It is the flag
   * the Print buttons act on, and the one the priority chain in `finalise` sets.
   */
  isDefault: boolean;
  /**
   * Whether the operating system calls this its default printer.
   *
   * Permanently `null`, and typed so it cannot become anything else: no browser
   * exposes this. It is a field rather than an omission so that the answer is
   * *stated* — an absent property reads as an oversight, and the next person to
   * want this needs to find the reason, not the gap. See the module comment.
   */
  isSystemDefault: null;
  /** `true` when a print sent right now would reach it. */
  available: boolean;
  /** Why it is not ready, in a sentence meant for a cashier. */
  reason?: string;
}

/** Everything one detection pass found, plus the honest caveats around it. */
export interface PrinterDetection {
  /** Every authorised device, ready ones first. */
  printers: DetectedPrinter[];
  /** The one this app will print to, or `null` when there is nothing to print to. */
  selected: DetectedPrinter | null;
  /**
   * How `selected` was arrived at — the rung of the priority chain that answered.
   * Shown in Printer Settings so an unexpected choice can be understood rather
   * than merely overridden.
   */
  source: SelectionSource;
  /** `false` when no transport on this browser can reach a POS printer. */
  supported: boolean;
  /** Present when `supported` is false, or when detection found nothing. */
  reason?: string;
  /**
   * `true` when more than one attached printer was authorised here and the choice
   * between them was made by this code rather than by a person.
   *
   * It does not block anything — a till with two rolls still prints — but Printer
   * Settings says which one was picked, because "it printed on the wrong printer"
   * is otherwise a mystery with no visible cause.
   */
  ambiguous: boolean;
  /** When this pass ran. */
  detectedAt: number;
}

/** Which rung of the priority chain produced the selected printer. */
export type SelectionSource =
  /** A printer explicitly set up and saved for this branch. Never overridden. */
  | 'branch-config'
  /** Nothing configured, so an authorised device on this machine was adopted automatically. */
  | 'auto-detected'
  /** Configured, but that device is not attached at the moment. */
  | 'configured-offline'
  /** Nothing configured and nothing authorised. */
  | 'none';

/**
 * The sentence Printer Settings shows under the detected printer.
 *
 * Kept here rather than in the component because it is a statement about the
 * platform, not about the screen — the production order dialog and the failure
 * panel say the same thing, and three copies of it would drift.
 */
export const SYSTEM_DEFAULT_NOTICE =
  'A web browser cannot read this computer’s default printer, so Mountain Bakes detects the printer authorised for it on this machine instead. Set it up once and it is found automatically from then on.';

/* ────────────────────────────────────────────────────────────────────────────
   Detection
   ──────────────────────────────────────────────────────────────────────────── */

/** The transports worth enumerating, best first. USB names itself; serial cannot. */
const DISCOVERABLE: readonly ConnectionType[] = ['usb', 'serial'];

/**
 * Turn a discovered identity back into something a transport can be asked about.
 *
 * A `DeviceIdentity` is a description, so this is lossless in the direction that
 * matters — the same vendor/product/serial that `discover()` reported is what
 * `status()` will match against in `getDevices()`.
 */
function targetFor(connection: ConnectionType, device: DeviceIdentity, config: PosPrinterConfig): TransportTarget {
  if (connection === 'serial') {
    return {
      serial: {
        usbVendorId: device.vendorId ?? null,
        usbProductId: device.productId ?? null,
        // The speed is a property of the *shop's* printer rather than of the
        // port, and a detected port has no way to report it. Carrying the saved
        // one over is what stops detection resetting a till that had already
        // been tuned off 9600.
        baudRate: config.serial?.baudRate || DEFAULT_BAUD_RATE,
      },
    };
  }
  return {
    usb: {
      vendorId: device.vendorId ?? 0,
      productId: device.productId ?? 0,
      serialNumber: device.serialNumber ?? null,
    },
  };
}

/**
 * A transport's view of one device, in the counter's vocabulary.
 *
 * `printing` is layered on top rather than read from the link, because no device
 * API reports "busy printing" — a bulk endpoint accepts bytes or it does not.
 * What is true is that *this app* has a job in flight, and that is the fact worth
 * showing while a receipt is on the wire.
 */
function availabilityOf(link: LinkStatus, busy: boolean): { status: PrinterAvailability; reason?: string } {
  switch (link.state) {
    case 'connected':
      return { status: busy ? 'printing' : 'ready' };
    case 'unsupported':
      return { status: 'unavailable', reason: link.reason };
    case 'unauthorised':
      // Discovery only ever yields authorised devices, so reaching here means the
      // grant was withdrawn between the enumeration and this check — a browser
      // settings change mid-session. It is a real state and it needs the word
      // that sends someone to Connect rather than to the cable.
      return { status: 'error', reason: link.reason ?? 'This printer is no longer authorised for Mountain Bakes. Connect it again.' };
    case 'disconnected':
    default: {
      // The transport reports one sentence for two very different situations, and
      // the difference decides what a person should go and do. A held interface
      // is not something a power switch fixes.
      const held = link.reason?.toLowerCase().includes('holding');
      return { status: held ? 'error' : 'offline', reason: link.reason };
    }
  }
}

/**
 * Every authorised printer on this machine, with the state of each.
 *
 * Silent throughout — no chooser, no gesture, nothing on screen. That is a
 * requirement rather than a nicety: this runs on page load and on a poll, and an
 * enumeration that could prompt would make opening the sales page a dialog.
 */
export async function detectPrinters(config: PosPrinterConfig = DEFAULT_CONFIG): Promise<PrinterDetection> {
  const detectedAt = Date.now();
  const busy = activePrintCount() > 0;

  const supportReasons: string[] = [];
  let anySupported = false;
  const found: DetectedPrinter[] = [];

  for (const connection of DISCOVERABLE) {
    const transport = transportFor(connection);
    const support = transport.support();
    if (!support.supported) {
      if (support.reason) supportReasons.push(support.reason);
      continue;
    }
    anySupported = true;

    let devices: DeviceIdentity[];
    try {
      devices = await transport.discover();
    } catch {
      continue;
    }

    for (const device of devices) {
      // Asked one at a time on purpose. `status()` opens nothing it has not
      // already opened, but it does resolve the device against what is attached,
      // and a device that has gone since the enumeration must come back `offline`
      // rather than be dropped from the list — a printer that vanished is the
      // thing the till most needs to see.
      let link: LinkStatus;
      try {
        link = await transport.status(targetFor(connection, device, config));
      } catch {
        link = { state: 'disconnected', reason: 'This printer could not be checked.' };
      }
      const { status, reason } = availabilityOf(link, busy);
      found.push({
        deviceId: device.deviceId,
        name: device.label,
        status,
        connectionType: connection,
        isDefault: false,
        isSystemDefault: null,
        available: status === 'ready' || status === 'printing',
        reason,
      });
    }
  }

  // The configured printer, when enumeration did not turn it up.
  //
  // Two ways that happens, and they need the same treatment: the grant was
  // cleared, or the printer is on a transport that cannot be enumerated at all —
  // a LAN address is a setting, not a discovery, so `network.discover()` is
  // rightly empty. Guessing `offline` for either would be a claim rather than a
  // check, and for a network printer that answers on 9100 it would be a wrong
  // one. So it is asked directly, through the same call the status pill makes.
  if (config.printerId && !found.some((p) => p.deviceId === config.printerId)) {
    const transport = transportFor(config.connection);
    const support = transport.support();
    let link: LinkStatus;
    if (!support.supported) {
      link = { state: 'unsupported', reason: support.reason };
    } else {
      try {
        link = await transport.status(targetOf(config));
      } catch {
        link = { state: 'disconnected', reason: 'The printer set up for this branch could not be checked.' };
      }
    }
    const { status, reason } = availabilityOf(link, busy);
    found.push({
      deviceId: config.printerId,
      name: link.device?.label || config.printerName || 'POS printer',
      status,
      connectionType: config.connection,
      isDefault: false,
      isSystemDefault: null,
      available: status === 'ready' || status === 'printing',
      reason: reason ?? (status === 'offline' ? 'The printer set up for this branch is not attached to this computer.' : undefined),
    });
    if (support.supported) anySupported = true;
  }

  // Ready first, then anything attached, then the rest — a till with a spare
  // printer authorised from a previous cable should not have to read past it.
  found.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

  return finalise(found, config, {
    detectedAt,
    supported: anySupported,
    reason: anySupported ? undefined : supportReasons[0],
  });
}

function rank(printer: DetectedPrinter): number {
  if (printer.status === 'ready' || printer.status === 'printing') return 0;
  if (printer.status === 'error') return 1;
  if (printer.status === 'offline') return 2;
  return 3;
}

/* ────────────────────────────────────────────────────────────────────────────
   Choosing between them
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * The priority chain, and the rung the operating system would have occupied.
 *
 * 1. **The branch's configured printer.** A printer somebody set up and saved is
 *    a decision, and detection does not get to overrule a decision — that is the
 *    whole reason this is a chain rather than a "pick the best one" heuristic. It
 *    holds even when the configured printer is offline: a till whose printer is
 *    switched off wants *Offline*, not a silent switch to the spare, because the
 *    silent switch is how a receipt ends up on the wrong roll in another room.
 * 2. **The OS default printer.** Not reachable from a browser — see the module
 *    comment. This is the rung a native wrapper would fill, and it sits here in
 *    the comment rather than in the code because an empty `if` that never runs is
 *    worse documentation than a sentence that explains why.
 * 3. **An authorised device on this machine.** The real automatic case: nothing
 *    configured, so the printer this browser already holds a grant for is adopted
 *    with no prompt. Attached ones win over remembered ones.
 * 4. **The chooser.** Only when the three above found nothing, and only from a
 *    click — Printer Settings, `Connect Printer`.
 */
function finalise(
  printers: DetectedPrinter[],
  config: PosPrinterConfig,
  meta: { detectedAt: number; supported: boolean; reason?: string },
): PrinterDetection {
  // Rung 1. Configured wins whether or not it is attached; the two cases differ
  // only in what the screen says about it. `detectPrinters` guarantees the entry
  // exists — a configured printer enumeration missed is probed and appended
  // there — so there is no "saved but unknown" case left to invent one for.
  const configured = config.printerId ? printers.find((p) => p.deviceId === config.printerId) ?? null : null;

  if (configured) {
    return {
      printers: mark(printers, configured),
      selected: { ...configured, isDefault: true },
      source: configured.available ? 'branch-config' : 'configured-offline',
      supported: meta.supported,
      reason: meta.reason,
      ambiguous: false,
      detectedAt: meta.detectedAt,
    };
  }

  // Rung 3. Nothing configured — adopt, preferring one that is actually there.
  const attached = printers.filter((p) => p.available);
  const candidate = attached[0] ?? printers[0] ?? null;

  return {
    printers: mark(printers, candidate),
    selected: candidate ? { ...candidate, isDefault: true } : null,
    source: candidate ? 'auto-detected' : 'none',
    supported: meta.supported,
    reason: meta.reason ?? (candidate ? undefined : NOTHING_FOUND),
    ambiguous: attached.length > 1,
    detectedAt: meta.detectedAt,
  };
}

const NOTHING_FOUND =
  'No POS printer has been authorised on this computer yet. Press Connect Printer and choose it once — Mountain Bakes finds it by itself after that.';

function mark(printers: DetectedPrinter[], selected: DetectedPrinter | null): DetectedPrinter[] {
  if (!selected) return printers;
  return printers.map((p) => (p.deviceId === selected.deviceId ? { ...p, isDefault: true } : p));
}

/**
 * The printer Mountain Bakes will print to, or `null`.
 *
 * The entry point the rest of the app asks for by name. It runs the whole chain
 * above, so a caller never has to know whether the answer came from a saved
 * config or from an automatic adoption — only Printer Settings cares about that,
 * and it reads `source` from `detectPrinters`.
 */
export async function detectDefaultPrinter(config: PosPrinterConfig = DEFAULT_CONFIG): Promise<DetectedPrinter | null> {
  return (await detectPrinters(config)).selected;
}

/* ────────────────────────────────────────────────────────────────────────────
   Adopting one
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * The config changes that make a detected printer this device's printer.
 *
 * A patch rather than a whole config, because everything detection does *not*
 * know — the paper width, the copies count, a hand-set column override — is a
 * decision the shop already made and must survive being handed a printer.
 *
 * `null` when the printer cannot be addressed from its identity: a network entry
 * (there is nothing to adopt), or a USB device with no ids, which cannot be found
 * again in `getDevices()` and so must not be written as though it could.
 */
export function adoptionPatch(printer: DetectedPrinter, config: PosPrinterConfig): Partial<PosPrinterConfig> | null {
  const [scheme, vendor, product, serial] = printer.deviceId.split(':');

  if (printer.connectionType === 'usb' && scheme === 'usb') {
    const vendorId = Number(vendor);
    const productId = Number(product);
    if (!Number.isFinite(vendorId) || !Number.isFinite(productId)) return null;
    return {
      printerId: printer.deviceId,
      printerName: printer.name,
      connection: 'usb',
      isDefault: true,
      usb: { vendorId, productId, serialNumber: serial || null },
      serial: null,
      network: null,
    };
  }

  if (printer.connectionType === 'serial' && scheme === 'serial') {
    const vendorId = vendor === 'any' ? null : Number(vendor);
    const productId = product === 'any' ? null : Number(product);
    return {
      printerId: printer.deviceId,
      printerName: printer.name,
      connection: 'serial',
      isDefault: true,
      serial: {
        usbVendorId: Number.isFinite(vendorId as number) ? (vendorId as number) : null,
        usbProductId: Number.isFinite(productId as number) ? (productId as number) : null,
        baudRate: config.serial?.baudRate || DEFAULT_BAUD_RATE,
      },
      usb: null,
      network: null,
    };
  }

  return null;
}

/** What the status pill and the settings header call each state. */
export const AVAILABILITY_LABELS: Record<PrinterAvailability, string> = {
  ready: 'Ready',
  printing: 'Printing',
  offline: 'Offline',
  unavailable: 'Unavailable',
  error: 'Error',
};
