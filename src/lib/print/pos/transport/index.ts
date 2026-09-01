'use client';

import { networkTransport, DEFAULT_PRINTER_PORT } from './network';
import { systemPrintTransport } from './system';
import { webSerialTransport, subscribeToSerialPorts, SERIAL_BAUD_RATES, DEFAULT_BAUD_RATE } from './webserial';
import { subscribeToUsbDevices, webUsbTransport } from './webusb';
import type { ConnectionType, PosTransport, PrintJob, TransportSupport } from './types';

/**
 * The transports, and the one place that picks between them.
 *
 * Nothing above this folder branches on connection type — `printerService` asks
 * for the transport a config names and uses it. That is what keeps "how do we
 * reach the printer" from spreading into the sales page, and it is what makes
 * adding Bluetooth later a new file here rather than a new `if` in four.
 *
 * Three of the four open the device themselves and write ESC/POS to it. The
 * fourth, `system`, does not open anything: it hands the receipt to the printer
 * the operating system has installed, which is the only way to reach a unit whose
 * driver already owns it. That difference is absorbed by `PrintJob` — the caller
 * composes the document in both forms and each transport reads the half its wire
 * understands — rather than by a branch above this folder.
 */

const TRANSPORTS: Record<ConnectionType, PosTransport> = {
  usb: webUsbTransport,
  serial: webSerialTransport,
  network: networkTransport,
  system: systemPrintTransport,
};

export function transportFor(type: ConnectionType): PosTransport {
  return TRANSPORTS[type] ?? webUsbTransport;
}

export interface ConnectionOption {
  type: ConnectionType;
  /** What Printer Setup calls it. */
  label: string;
  /** One line under the label, so the choice can be made without knowing the API's name. */
  hint: string;
  support: TransportSupport;
}

/**
 * The connection choices, each with the truth about whether it works here.
 *
 * Unsupported options are returned rather than filtered out, and the dialog shows
 * them greyed with their reason. A missing option leaves someone hunting for the
 * USB setting that "used to be there"; a present one that explains itself ends
 * the question.
 *
 * The order is the order to try them in. The installed-printer option sits second
 * rather than last on purpose: it is the answer to the most common setup problem
 * — a printer installed in Windows that nothing here detects — and burying it
 * under two options that will not work for that till is how the question gets
 * asked again.
 */
export function connectionOptions(): ConnectionOption[] {
  return [
    {
      type: 'usb',
      label: 'USB POS Printer',
      hint: 'Plugged into this computer, opened directly. No dialog, no driver — the fastest receipt.',
      support: webUsbTransport.support(),
    },
    {
      type: 'system',
      label: 'Installed Printer (Windows / system driver)',
      hint: 'The printer already installed on this computer. Use this if the printer prints from Windows but is not detected above.',
      support: systemPrintTransport.support(),
    },
    {
      type: 'serial',
      label: 'USB Serial POS Printer',
      hint: 'A printer that appears as a COM port — most CH340 / FTDI cables.',
      support: webSerialTransport.support(),
    },
    {
      type: 'network',
      label: 'Network / LAN Printer',
      hint: 'Reached by IP address on port 9100.',
      support: networkTransport.support(),
    },
  ];
}

/**
 * Device plug/unplug from every transport that can report it, as one subscription.
 *
 * The network and system transports contribute nothing here — there is no event
 * for "a printer appeared on the LAN", and none for "Windows gained a printer"
 * either — which is why the status hook keeps a slow poll alongside this rather
 * than relying on events alone.
 */
export function subscribeToDevices(onChange: () => void): () => void {
  const stops = [subscribeToUsbDevices(onChange), subscribeToSerialPorts(onChange)];
  return () => stops.forEach((stop) => stop());
}

export { DEFAULT_PRINTER_PORT, SERIAL_BAUD_RATES, DEFAULT_BAUD_RATE };
export { SYSTEM_DEVICE } from './system';
export type { ConnectionType, PosTransport, PrintJob, TransportSupport };
export type { DeviceIdentity, LinkState, LinkStatus, TransportTarget } from './types';
