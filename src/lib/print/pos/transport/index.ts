'use client';

import { networkTransport, DEFAULT_PRINTER_PORT } from './network';
import { webSerialTransport, subscribeToSerialPorts, SERIAL_BAUD_RATES, DEFAULT_BAUD_RATE } from './webserial';
import { subscribeToUsbDevices, webUsbTransport } from './webusb';
import type { ConnectionType, PosTransport, TransportSupport } from './types';

/**
 * The transports, and the one place that picks between them.
 *
 * Nothing above this folder branches on connection type — `printerService` asks
 * for the transport a config names and uses it. That is what keeps "how do we
 * reach the printer" from spreading into the sales page, and it is what makes
 * adding Bluetooth later a new file here rather than a new `if` in four.
 */

const TRANSPORTS: Record<ConnectionType, PosTransport> = {
  usb: webUsbTransport,
  serial: webSerialTransport,
  network: networkTransport,
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
 */
export function connectionOptions(): ConnectionOption[] {
  return [
    {
      type: 'usb',
      label: 'USB POS Printer',
      hint: 'Plugged into this computer. The usual choice for a counter till.',
      support: webUsbTransport.support(),
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
 * The network transport contributes nothing here — there is no event for "a
 * printer appeared on the LAN" — which is why the status hook keeps a slow poll
 * alongside this rather than relying on events alone.
 */
export function subscribeToDevices(onChange: () => void): () => void {
  const stops = [subscribeToUsbDevices(onChange), subscribeToSerialPorts(onChange)];
  return () => stops.forEach((stop) => stop());
}

export { DEFAULT_PRINTER_PORT, SERIAL_BAUD_RATES, DEFAULT_BAUD_RATE };
export type { ConnectionType, PosTransport, TransportSupport };
export type { DeviceIdentity, LinkState, LinkStatus, TransportTarget } from './types';
