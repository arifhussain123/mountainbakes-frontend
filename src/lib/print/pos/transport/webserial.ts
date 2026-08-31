'use client';

import { PosPrintError, asPrintError } from '../errors';
import { serialManager, secureContextProblem, type SerialPort } from './deviceApis';
import type { DeviceIdentity, LinkStatus, PosTransport, TransportSupport, TransportTarget } from './types';

/**
 * The printer, over Web Serial.
 *
 * ---------------------------------------------------------------------------
 * Why a second USB-shaped transport exists
 * ---------------------------------------------------------------------------
 * A large share of counter-top thermal printers are not USB printers at all —
 * they are serial printers behind a USB-to-serial bridge (CH340, FTDI, Prolific,
 * CP210x). The OS binds those to a COM port, they never present a USB printer
 * interface, and `navigator.usb` will not claim them: the bridge's driver already
 * owns the device. WebUSB simply cannot reach them, and offering only WebUSB
 * would leave those tills with a Connect button that always fails.
 *
 * Web Serial reaches exactly those, and the two are offered side by side rather
 * than chained, because guessing wrong wastes a device-chooser prompt and teaches
 * the counter that the app does not know what it is doing. Printer Setup asks
 * once, in one sentence, and remembers the answer.
 *
 * ---------------------------------------------------------------------------
 * The limits
 * ---------------------------------------------------------------------------
 * Chrome, Edge and Opera on a desktop, over a secure context. No Firefox, no
 * Safari, no iOS, and — unlike WebUSB — no Android. `support()` says so.
 *
 * A serial link also has a **baud rate**, and getting it wrong prints garbage
 * rather than nothing, which is the one failure mode a status pill cannot catch.
 * 9600 is the default nearly every unit ships with; the setup dialog offers the
 * others because the value is printed on a sticker or in the self-test the
 * printer prints when it is powered on with the feed button held.
 */

const WRITE_TIMEOUT_MS = 10_000;

interface OpenLink {
  port: SerialPort;
  baudRate: number;
}

/** Ports open right now. `SerialPort` objects are stable identities within a page. */
const OPEN = new Map<SerialPort, OpenLink>();

/** Why the last open failed, so the status pill can say more than "not connected". */
const LAST_FAILURE = new Map<SerialPort, string>();

export const SERIAL_BAUD_RATES = [9600, 19200, 38400, 57600, 115200] as const;
export const DEFAULT_BAUD_RATE = 9600;

export function serialDeviceId(usbVendorId: number | null, usbProductId: number | null): string {
  return `serial:${usbVendorId != null ? hex(usbVendorId) : 'any'}:${usbProductId != null ? hex(usbProductId) : 'any'}`;
}

function hex(value: number): string {
  return `0x${value.toString(16).padStart(4, '0')}`;
}

function identityOf(port: SerialPort): DeviceIdentity {
  const info = port.getInfo();
  const vendor = info.usbVendorId ?? null;
  const product = info.usbProductId ?? null;
  return {
    deviceId: serialDeviceId(vendor, product),
    label: vendor != null ? `Serial printer ${hex(vendor)}:${product != null ? hex(product) : '????'}` : 'Serial printer',
    vendorId: vendor,
    productId: product,
    serialNumber: null,
  };
}

/**
 * Which of the authorised ports is the saved one.
 *
 * A serial port has no serial number and no name — `getInfo()` returns the USB
 * ids of the bridge chip and nothing else. Two identical bridges are therefore
 * indistinguishable, and this picks the first match. That is a real limitation
 * and it is bounded: it can only mis-pick between two ports whose bridge chips
 * are the same model, on a till that has both, and the wrong pick prints on the
 * other roll rather than doing anything worse.
 */
async function findAuthorised(target: TransportTarget): Promise<SerialPort | null> {
  const serial = serialManager();
  if (!serial || !target.serial) return null;
  const ports = await serial.getPorts();
  const wanted = target.serial;
  return (
    ports.find((port) => {
      const info = port.getInfo();
      if (wanted.usbVendorId == null) return true;
      return info.usbVendorId === wanted.usbVendorId && (wanted.usbProductId == null || info.usbProductId === wanted.usbProductId);
    }) ?? null
  );
}

async function open(port: SerialPort, baudRate: number): Promise<OpenLink> {
  const existing = OPEN.get(port);
  if (existing && port.writable) return existing;
  try {
    await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    // `InvalidStateError` means this page already has it open — which happens
    // after a hot reload in development, and is a success rather than a fault.
    if (name === 'InvalidStateError' && port.writable) {
      const link = { port, baudRate };
      OPEN.set(port, link);
      return link;
    }
    if (name === 'NetworkError') {
      throw new PosPrintError(
        'device-busy',
        'Another program on this computer has this COM port open. Close it, then press Connect again.',
        detailOf(error),
      );
    }
    throw asPrintError(error, 'printer-offline');
  }
  const link = { port, baudRate };
  OPEN.set(port, link);
  return link;
}

function detailOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

async function linkFor(target: TransportTarget): Promise<OpenLink> {
  if (!target.serial) {
    throw new PosPrintError('no-printer', 'No serial printer set up on this device. Set one up in Printer Settings.');
  }
  const port = await findAuthorised(target);
  if (!port) {
    throw new PosPrintError(
      'printer-not-found',
      'POS printer is not connected. Plug it in, switch it on, then press Reconnect. If it stays disconnected, set it up again in Printer Settings.',
    );
  }
  return open(port, target.serial.baudRate || DEFAULT_BAUD_RATE);
}

export const webSerialTransport: PosTransport = {
  type: 'serial',

  support(): TransportSupport {
    const insecure = secureContextProblem();
    if (insecure) return { supported: false, reason: insecure };
    if (!serialManager()) {
      return {
        supported: false,
        reason: 'Serial printing is not supported by this browser. Chrome, Edge and Opera on a computer can do it; Firefox, Safari, Android and iOS cannot.',
      };
    }
    return { supported: true };
  },

  /**
   * Re-adopt an already-granted port, and open it — see the WebUSB twin of this
   * for why opening belongs here rather than at the first print.
   */
  async restore(target) {
    const port = await findAuthorised(target);
    if (!port) return null;
    try {
      await open(port, target.serial?.baudRate || DEFAULT_BAUD_RATE);
      LAST_FAILURE.delete(port);
    } catch (error) {
      OPEN.delete(port);
      LAST_FAILURE.set(port, asPrintError(error, 'printer-offline').message);
    }
    return identityOf(port);
  },

  async request(): Promise<DeviceIdentity> {
    const serial = serialManager();
    if (!serial) throw new PosPrintError('not-supported', this.support().reason ?? 'This browser cannot open serial ports.');
    let port: SerialPort;
    try {
      port = await serial.requestPort();
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      if (name === 'NotFoundError') throw new PosPrintError('cancelled', 'No printer was chosen.');
      throw asPrintError(error, 'print-failed');
    }
    return identityOf(port);
  },

  async probe(target) {
    const link = await linkFor(target);
    return identityOf(link.port);
  },

  async send(target, bytes) {
    const link = await linkFor(target);
    const writable = link.port.writable;
    if (!writable) {
      OPEN.delete(link.port);
      throw new PosPrintError('not-connected', 'POS printer is not connected. Check it is switched on, then reconnect.');
    }
    const writer = writable.getWriter();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new PosPrintError('timeout', 'The printer stopped accepting the receipt. Check the paper roll, then print again.')),
          WRITE_TIMEOUT_MS,
        );
      });
      await Promise.race([writer.write(bytes), deadline]);
    } catch (error) {
      OPEN.delete(link.port);
      throw asPrintError(error, 'write-failed');
    } finally {
      if (timer) clearTimeout(timer);
      // The lock must be given back even on failure, or every later print on this
      // port fails with "locked to a writer" and no amount of reconnecting helps.
      try {
        writer.releaseLock();
      } catch {
        /* the stream is already gone */
      }
    }
  },

  async status(target): Promise<LinkStatus> {
    const support = this.support();
    if (!support.supported) return { state: 'unsupported', reason: support.reason };
    if (!target.serial) return { state: 'unauthorised' };
    const port = await findAuthorised(target);
    if (!port) return { state: 'disconnected', reason: 'The POS printer is not attached to this computer.' };
    return {
      state: port.writable ? 'connected' : 'disconnected',
      reason: port.writable ? undefined : LAST_FAILURE.get(port) ?? 'Attached, but not opened yet. Press Reconnect.',
      device: identityOf(port),
    };
  },

  async release(target) {
    const port = await findAuthorised(target);
    if (!port) return;
    OPEN.delete(port);
    try {
      await port.close();
    } catch {
      /* already closed */
    }
  },
};

/** Plug/unplug of a serial device, so the status pill can react without polling. */
export function subscribeToSerialPorts(onChange: () => void): () => void {
  const serial = serialManager();
  if (!serial) return () => {};
  serial.addEventListener('connect', onChange);
  serial.addEventListener('disconnect', onChange);
  return () => {
    serial.removeEventListener('connect', onChange);
    serial.removeEventListener('disconnect', onChange);
  };
}
