'use client';

import { PosPrintError, asPrintError } from '../errors';
import { usbManager, secureContextProblem, type UsbDevice, type UsbInterface } from './deviceApis';
import type { DeviceIdentity, LinkStatus, PosTransport, TransportSupport, TransportTarget } from './types';

/**
 * The printer, over WebUSB, with nothing in between.
 *
 * ---------------------------------------------------------------------------
 * What actually happens when someone presses Connect
 * ---------------------------------------------------------------------------
 * `requestDevice` shows Chrome's own device chooser — the app never sees the list
 * and cannot pre-select from it, which is the point of the API: the permission is
 * granted by the person, to one device, for this origin. What comes back is a
 * handle. Chrome remembers the grant, so `getDevices()` in tomorrow's session
 * returns the same printer with no prompt, and that is what makes "set it up
 * once" true.
 *
 * The bytes then go out a bulk OUT endpoint. There is no driver, no spooler, no
 * page box and no preview anywhere on that path — a thermal printer's input is
 * ESC/POS, and ESC/POS is exactly what it is handed.
 *
 * ---------------------------------------------------------------------------
 * The limits, stated plainly, because they are real
 * ---------------------------------------------------------------------------
 * 1. **Chrome, Edge and Opera on a desktop only.** Firefox and Safari have not
 *    implemented WebUSB and say so through `navigator.usb` simply being absent.
 *    `support()` reports that; nothing here pretends otherwise.
 * 2. **A secure context.** https, or localhost. See `secureContextProblem`.
 * 3. **On Windows, the printer must not be held by its own driver.** If the unit
 *    is installed as a Windows printer, `usbprint.sys` owns the interface and
 *    `claimInterface` fails — the OS will not share it. That surfaces as
 *    `device-busy` with the fix in the sentence, rather than as a generic
 *    failure. Removing it from Windows *Printers & scanners* (or binding WinUSB
 *    with Zadig) hands it back.
 * 4. **Android Chrome works; iOS does not.** No browser on iOS exposes WebUSB.
 *
 * These are the reason `support()` exists as a first-class method rather than a
 * try/catch: a till that cannot do this needs to be told at setup time, on a
 * quiet morning, not by a failed print in front of a customer.
 */

/** USB printer class. Filters the chooser to units that declare themselves printers. */
const PRINTER_CLASS = 0x07;

/**
 * Split point for `transferOut`.
 *
 * A receipt is a couple of kilobytes, so this almost never bites — but a long
 * production demand can exceed the input buffer of a cheap 80mm unit, and a
 * printer that overruns drops the tail of the job silently. Feeding it in bulk
 * transfers the size of a few packets lets its buffer drain between writes.
 */
const CHUNK_BYTES = 4096;

/** One write must not hang the till forever if the printer stops draining. */
const TRANSFER_TIMEOUT_MS = 10_000;

/**
 * The sentence for "the saved printer is not there".
 *
 * It opens with the fact the counter needs (`POS printer is not connected`) and
 * ends with the one press that fixes the ordinary case — a printer switched off
 * overnight. Setting it up again is mentioned last because it is almost never
 * what is actually required, and leading with it sends people through a device
 * chooser to solve a power switch.
 */
const NOT_ATTACHED =
  'POS printer is not connected. Plug it in, switch it on, then press Reconnect. If it stays disconnected, set it up again in Printer Settings.';

interface OpenLink {
  device: UsbDevice;
  interfaceNumber: number;
  endpointNumber: number;
}

/**
 * The links this page currently holds open, keyed by device id.
 *
 * Held open between prints on purpose: claiming an interface takes tens of
 * milliseconds and a busy counter prints back to back. The entry is dropped the
 * moment a write fails or the device announces its own disconnection, so a stale
 * handle can never be mistaken for a working printer.
 */
const OPEN = new Map<string, OpenLink>();

/**
 * Why the last attempt to open a device failed, kept so the pill can say.
 *
 * `restore` runs on page load and swallows its failure — it must not throw at a
 * cashier who has not asked for anything. But "not connected" with no reason is
 * the kind of status that gets ignored, and the reason here is usually the one
 * that matters (Windows is holding the printer). So the sentence is kept and the
 * status reports it.
 */
const LAST_FAILURE = new Map<string, string>();

export function usbDeviceId(vendorId: number, productId: number, serialNumber?: string | null): string {
  return `usb:${hex(vendorId)}:${hex(productId)}:${serialNumber ?? ''}`;
}

function hex(value: number): string {
  return `0x${value.toString(16).padStart(4, '0')}`;
}

function identityOf(device: UsbDevice): DeviceIdentity {
  const name = device.productName?.trim();
  const maker = device.manufacturerName?.trim();
  return {
    deviceId: usbDeviceId(device.vendorId, device.productId, device.serialNumber ?? null),
    label: name ? (maker && !name.startsWith(maker) ? `${maker} ${name}` : name) : `USB printer ${hex(device.vendorId)}:${hex(device.productId)}`,
    vendorId: device.vendorId,
    productId: device.productId,
    serialNumber: device.serialNumber ?? null,
  };
}

/**
 * Does this attached device answer to the saved printer?
 *
 * Vendor and product must match. The serial number is only compared when *both*
 * sides have one: a great many POS printers report no serial at all, and
 * requiring one would make every such unit un-restorable — while ignoring one
 * that is present would let a till with two identical printers adopt the wrong
 * roll.
 */
function matches(device: UsbDevice, target: TransportTarget['usb']): boolean {
  if (!target) return false;
  if (device.vendorId !== target.vendorId || device.productId !== target.productId) return false;
  if (target.serialNumber && device.serialNumber) return device.serialNumber === target.serialNumber;
  return true;
}

/**
 * The interface and endpoint to write to.
 *
 * A printer-class interface is preferred, but not required: plenty of units in
 * this price bracket declare a vendor-specific class and still speak ESC/POS on a
 * bulk OUT endpoint. Requiring class 7 here would reject printers the chooser had
 * just let the user pick, which is a worse failure than writing to the only bulk
 * OUT endpoint the device has.
 */
function findEndpoint(device: UsbDevice): { interfaceNumber: number; endpointNumber: number } | null {
  const configuration = device.configuration ?? device.configurations[0];
  if (!configuration) return null;

  const candidates: { iface: UsbInterface; endpoint: number; printerClass: boolean }[] = [];
  for (const iface of configuration.interfaces) {
    for (const alternate of [iface.alternate, ...iface.alternates]) {
      if (!alternate) continue;
      const out = alternate.endpoints.find((e) => e.direction === 'out' && e.type === 'bulk');
      if (!out) continue;
      candidates.push({
        iface,
        endpoint: out.endpointNumber,
        printerClass: alternate.interfaceClass === PRINTER_CLASS,
      });
      break;
    }
  }

  const chosen = candidates.find((c) => c.printerClass) ?? candidates[0];
  return chosen ? { interfaceNumber: chosen.iface.interfaceNumber, endpointNumber: chosen.endpoint } : null;
}

async function open(device: UsbDevice): Promise<OpenLink> {
  try {
    if (!device.opened) await device.open();
    // A device that has never been configured reports `configuration: null`, and
    // its interfaces cannot be enumerated until one is selected. Configuration 1
    // is the only one nearly every printer has.
    if (device.configuration === null) {
      await device.selectConfiguration(device.configurations[0]?.configurationValue ?? 1);
    }
  } catch (error) {
    throw openFailure(error);
  }

  const endpoint = findEndpoint(device);
  if (!endpoint) {
    throw new PosPrintError(
      'invalid-config',
      'This device has no printer data channel. Choose the POS printer rather than another USB device.',
      'no bulk OUT endpoint',
    );
  }

  try {
    await device.claimInterface(endpoint.interfaceNumber);
  } catch (error) {
    throw claimFailure(error);
  }

  return { device, ...endpoint };
}

/**
 * Why a device would not open, in the words that name the fix.
 *
 * `NotFoundError` here means the handle refers to something no longer attached —
 * a printer unplugged while the page stayed up, which is the single most common
 * POS complaint and deserves its own sentence rather than "print failed".
 */
function openFailure(error: unknown): PosPrintError {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotFoundError') {
    return new PosPrintError('printer-not-found', NOT_ATTACHED, detailOf(error));
  }
  if (name === 'SecurityError' || name === 'NotAllowedError') {
    return new PosPrintError('permission-denied', 'This computer refused access to the printer. Reconnect it in Printer Settings.', detailOf(error));
  }
  return asPrintError(error, 'printer-offline');
}

/**
 * `claimInterface` failing is almost always one specific thing on Windows.
 *
 * The OS gives an interface to exactly one owner, and if the unit was installed
 * through *Printers & scanners* that owner is `usbprint.sys`. No amount of
 * retrying changes it, so the message says what does.
 */
function claimFailure(error: unknown): PosPrintError {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NetworkError' || name === 'InvalidStateError' || name === 'SecurityError') {
    return new PosPrintError(
      'device-busy',
      'Windows is holding this printer through its own driver, so Mountain Bakes cannot open it. Remove it from Printers & scanners (or install the WinUSB driver for it), then press Connect again.',
      detailOf(error),
    );
  }
  return asPrintError(error, 'device-busy');
}

function detailOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function findAuthorised(target: TransportTarget): Promise<UsbDevice | null> {
  const usb = usbManager();
  if (!usb) return null;
  const devices = await usb.getDevices();
  return devices.find((device) => matches(device, target.usb)) ?? null;
}

async function linkFor(target: TransportTarget): Promise<OpenLink> {
  if (!target.usb) {
    throw new PosPrintError('no-printer', 'No USB printer set up on this device. Set one up in Printer Settings.');
  }
  const id = usbDeviceId(target.usb.vendorId, target.usb.productId, target.usb.serialNumber);
  const existing = OPEN.get(id);
  if (existing && existing.device.opened) return existing;
  OPEN.delete(id);

  const device = await findAuthorised(target);
  if (!device) {
    throw new PosPrintError('printer-not-found', NOT_ATTACHED);
  }
  const link = await open(device);
  OPEN.set(id, link);
  return link;
}

/** `transferOut` with a deadline. A printer that stops draining must not hang the till. */
async function writeChunk(link: OpenLink, chunk: Uint8Array): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new PosPrintError('timeout', 'The printer stopped accepting the receipt. Check the paper roll, then print again.')),
      TRANSFER_TIMEOUT_MS,
    );
  });
  try {
    const result = await Promise.race([
      link.device.transferOut(link.endpointNumber, chunk),
      deadline,
    ]);
    if (result.status !== 'ok') {
      throw new PosPrintError('write-failed', 'The receipt was cut short. Check the paper roll, then print again.', `transferOut status ${result.status}`);
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const webUsbTransport: PosTransport = {
  type: 'usb',

  support(): TransportSupport {
    const insecure = secureContextProblem();
    if (insecure) return { supported: false, reason: insecure };
    if (!usbManager()) {
      return {
        supported: false,
        reason: 'Direct USB printing is not supported by this browser. Chrome, Edge and Opera on a computer or Android can do it; Firefox, Safari and every browser on iPhone and iPad cannot.',
      };
    }
    return { supported: true };
  },

  /**
   * Re-adopt an already-granted device — and actually open it.
   *
   * Opening here, rather than at the first print, is what lets the till say
   * *Connected* on the morning's first page load instead of *Not connected*
   * until someone sells something. The permission was granted long ago; no
   * chooser appears and no gesture is needed.
   *
   * A device that is found but cannot be claimed still returns its identity, so
   * settings can name the printer, and the reason is kept for the status pill
   * rather than thrown at whoever happened to be on screen.
   */
  async restore(target) {
    if (!usbManager() || !target.usb) return null;
    const device = await findAuthorised(target);
    if (!device) return null;
    const identity = identityOf(device);
    // Already held open — by an earlier restore, or by a print that is on the
    // wire this very moment. Re-claiming the interface underneath an in-flight
    // `transferOut` is how a receipt came out cut short when the status pill
    // and the print button both mounted at once; the held link is the answer.
    const held = OPEN.get(identity.deviceId);
    if (held && held.device === device && device.opened) return identity;
    try {
      OPEN.set(identity.deviceId, await open(device));
      LAST_FAILURE.delete(identity.deviceId);
    } catch (error) {
      OPEN.delete(identity.deviceId);
      LAST_FAILURE.set(identity.deviceId, asPrintError(error, 'printer-offline').message);
    }
    return identity;
  },

  /**
   * Must be called straight from a click.
   *
   * Chrome throws `SecurityError` for a chooser opened outside a user gesture,
   * and an `await` before this call is enough to lose one — hence the check in
   * `printerService` that no work happens between the press and here.
   */
  /**
   * Every USB device this origin already holds a grant for.
   *
   * `getDevices()` needs no gesture and shows nothing — Chrome answers straight
   * from the permission store — which is what lets Printer Settings show a
   * *Detected Printers* list on load rather than after a click, and what lets an
   * unconfigured till adopt its printer with nobody choosing anything.
   *
   * The list is grants, not hardware: an entry can be a printer that is currently
   * unplugged (the grant outlives the cable), so `discovery.ts` re-checks each one
   * against what is attached rather than trusting the presence of a row.
   */
  async discover(): Promise<DeviceIdentity[]> {
    const usb = usbManager();
    if (!usb) return [];
    try {
      return (await usb.getDevices()).map(identityOf);
    } catch {
      // A revoked permission store, or a browser that has `navigator.usb` but
      // refuses to enumerate under this policy. Neither is worth an error at
      // someone who only opened the settings dialog.
      return [];
    }
  },

  async request(): Promise<DeviceIdentity> {
    const usb = usbManager();
    if (!usb) throw new PosPrintError('not-supported', this.support().reason ?? 'This browser cannot open USB devices.');
    let device: UsbDevice;
    try {
      // Printer class first, then an unfiltered entry so a unit that declares a
      // vendor-specific class — which plenty in this bracket do — is still in the
      // list. The chooser shows the union.
      //
      // The retry is not defensive noise: filter validation differs between
      // implementations, and a `TypeError` here would otherwise mean the Connect
      // button does nothing at all. An empty filter list shows every device, which
      // is a worse list but a working one.
      try {
        device = await usb.requestDevice({ filters: [{ classCode: PRINTER_CLASS }, {}] });
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
        device = await usb.requestDevice({ filters: [] });
      }
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      // The chooser closing with nothing picked is not a fault, and must not be
      // shown as one — it is what pressing Cancel is supposed to do.
      if (name === 'NotFoundError') throw new PosPrintError('cancelled', 'No printer was chosen.');
      if (name === 'SecurityError' || name === 'NotAllowedError') {
        throw new PosPrintError('permission-denied', 'This browser blocked the USB device chooser. Check the site permissions for Mountain Bakes.', detailOf(error));
      }
      throw asPrintError(error, 'print-failed');
    }
    // Opened straight away rather than at the first print: a device that cannot be
    // claimed must fail here, in the setup dialog, where the message about the
    // Windows driver can be read and acted on.
    const link = await open(device);
    const identity = identityOf(device);
    OPEN.set(identity.deviceId, link);
    return identity;
  },

  async probe(target) {
    const link = await linkFor(target);
    return identityOf(link.device);
  },

  /**
   * The job, all copies of it, down one already-open link.
   *
   * Each copy is the whole byte stream again rather than the payload repeated
   * inside one — the stream ends in a cut, and a kitchen copy and a customer copy
   * have to be two receipts rather than one long strip.
   */
  async send(target, job) {
    const link = await linkFor(target);
    const bytes = job.bytes;
    try {
      for (let copy = 0; copy < Math.max(1, job.copies); copy++) {
        for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
          await writeChunk(link, bytes.subarray(offset, offset + CHUNK_BYTES));
        }
      }
    } catch (error) {
      // A failed write means the handle is no longer trustworthy — the cable was
      // pulled, the printer reset. Dropping it forces a genuine reopen next time
      // instead of a second failure against the same dead handle.
      OPEN.delete(identityOf(link.device).deviceId);
      throw asPrintError(error, 'write-failed');
    }
  },

  async status(target): Promise<LinkStatus> {
    const support = this.support();
    if (!support.supported) return { state: 'unsupported', reason: support.reason };
    if (!target.usb) return { state: 'unauthorised' };
    const device = await findAuthorised(target);
    if (!device) {
      return {
        state: 'disconnected',
        reason: 'The POS printer is not attached to this computer.',
      };
    }
    const identity = identityOf(device);
    const held = OPEN.get(identity.deviceId);
    return {
      // `opened` is the honest test. A device that is present but whose handle we
      // never claimed is *reachable*, not *connected* — the first print will open
      // it, and saying "connected" before that has been proven would be the kind
      // of confident wrong status this whole rewrite exists to remove.
      state: held && held.device.opened ? 'connected' : 'disconnected',
      reason: held ? undefined : LAST_FAILURE.get(identity.deviceId) ?? 'Attached, but not opened yet. Press Reconnect.',
      device: identity,
    };
  },

  async release(target) {
    if (!target.usb) return;
    const id = usbDeviceId(target.usb.vendorId, target.usb.productId, target.usb.serialNumber);
    const link = OPEN.get(id);
    OPEN.delete(id);
    if (!link) return;
    try {
      await link.device.releaseInterface(link.interfaceNumber);
      await link.device.close();
    } catch {
      // Already gone. There is nothing to recover and nothing to tell anyone:
      // the handle is dropped either way.
    }
  },
};

/**
 * Fires when a USB device is plugged in or pulled out.
 *
 * The status pill subscribes to this so a printer switched on at 8am turns the
 * dot green without anyone pressing anything, and a cable pulled mid-shift turns
 * it red before the next sale rather than at it.
 */
export function subscribeToUsbDevices(onChange: () => void): () => void {
  const usb = usbManager();
  if (!usb) return () => {};
  const handler = (event: Event) => {
    // A disconnected device's handle is dead. Dropping it here, rather than on the
    // next failed write, is what stops the pill reading "Connected" for a printer
    // that is physically unplugged.
    const device = (event as unknown as { device?: UsbDevice }).device;
    if (device) OPEN.delete(usbDeviceId(device.vendorId, device.productId, device.serialNumber ?? null));
    onChange();
  };
  usb.addEventListener('connect', handler);
  usb.addEventListener('disconnect', handler);
  return () => {
    usb.removeEventListener('connect', handler);
    usb.removeEventListener('disconnect', handler);
  };
}
