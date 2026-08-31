/**
 * Minimal typings for the device APIs TypeScript's DOM library does not ship.
 *
 * WebUSB, Web Serial and Direct Sockets are all outside `lib.dom.d.ts`, so
 * without this the transports below would be written against `any` — and `any`
 * is exactly the wrong tool here, because the one thing that must not be got
 * wrong is which method exists on which object at runtime.
 *
 * These are declared as plain interfaces and reached through a cast rather than
 * by augmenting `Navigator` globally. Augmentation would collide the day someone
 * adds `@types/w3c-web-usb` for another feature, and a duplicate-identifier error
 * in an unrelated file is a poor way to find out. Only the members these
 * transports actually call are declared; the specs are much larger.
 */

/* ── WebUSB ──────────────────────────────────────────────────────────────── */

export interface UsbEndpoint {
  endpointNumber: number;
  direction: 'in' | 'out';
  type: 'bulk' | 'interrupt' | 'isochronous';
  packetSize: number;
}

export interface UsbAlternateInterface {
  alternateSetting: number;
  interfaceClass: number;
  interfaceSubclass: number;
  interfaceProtocol: number;
  endpoints: UsbEndpoint[];
}

export interface UsbInterface {
  interfaceNumber: number;
  alternate: UsbAlternateInterface;
  alternates: UsbAlternateInterface[];
  claimed: boolean;
}

export interface UsbConfiguration {
  configurationValue: number;
  interfaces: UsbInterface[];
}

export interface UsbOutTransferResult {
  bytesWritten: number;
  status: 'ok' | 'stall' | 'babble';
}

export interface UsbDevice {
  vendorId: number;
  productId: number;
  serialNumber?: string;
  productName?: string;
  manufacturerName?: string;
  opened: boolean;
  configuration: UsbConfiguration | null;
  configurations: UsbConfiguration[];
  open(): Promise<void>;
  close(): Promise<void>;
  selectConfiguration(configurationValue: number): Promise<void>;
  claimInterface(interfaceNumber: number): Promise<void>;
  releaseInterface(interfaceNumber: number): Promise<void>;
  selectAlternateInterface(interfaceNumber: number, alternateSetting: number): Promise<void>;
  transferOut(endpointNumber: number, data: Uint8Array | ArrayBuffer): Promise<UsbOutTransferResult>;
}

export interface UsbDeviceFilter {
  vendorId?: number;
  productId?: number;
  classCode?: number;
  subclassCode?: number;
  protocolCode?: number;
  serialNumber?: string;
}

export interface UsbManager extends EventTarget {
  getDevices(): Promise<UsbDevice[]>;
  requestDevice(options: { filters: UsbDeviceFilter[] }): Promise<UsbDevice>;
}

/* ── Web Serial ──────────────────────────────────────────────────────────── */

export interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

export interface SerialOptions {
  baudRate: number;
  dataBits?: number;
  stopBits?: number;
  parity?: 'none' | 'even' | 'odd';
  bufferSize?: number;
  flowControl?: 'none' | 'hardware';
}

export interface SerialPort {
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfo;
}

export interface SerialManager extends EventTarget {
  getPorts(): Promise<SerialPort[]>;
  requestPort(options?: { filters?: { usbVendorId?: number; usbProductId?: number }[] }): Promise<SerialPort>;
}

/* ── Direct Sockets (raw TCP) ────────────────────────────────────────────── */

export interface TcpSocketOpenInfo {
  readable: ReadableStream<Uint8Array>;
  writable: WritableStream<Uint8Array>;
  remoteAddress?: string;
  remotePort?: number;
}

export interface TcpSocketInstance {
  opened: Promise<TcpSocketOpenInfo>;
  closed: Promise<void>;
  close(): Promise<void>;
}

export type TcpSocketConstructor = new (
  remoteAddress: string,
  remotePort: number,
  options?: { noDelay?: boolean; sendBufferSize?: number },
) => TcpSocketInstance;

/* ── Reaching them safely ────────────────────────────────────────────────── */

/**
 * Every one of these is undefined in some browser this app legitimately runs in,
 * and two of them are undefined during the static export's prerender. Each getter
 * therefore answers `null` rather than throwing, so a caller can ask "is this
 * possible here" without a try/catch around the question.
 */
export function usbManager(): UsbManager | null {
  if (typeof navigator === 'undefined') return null;
  const candidate = (navigator as unknown as { usb?: UsbManager }).usb;
  return candidate ?? null;
}

export function serialManager(): SerialManager | null {
  if (typeof navigator === 'undefined') return null;
  const candidate = (navigator as unknown as { serial?: SerialManager }).serial;
  return candidate ?? null;
}

export function tcpSocket(): TcpSocketConstructor | null {
  if (typeof globalThis === 'undefined') return null;
  const candidate = (globalThis as unknown as { TCPSocket?: TcpSocketConstructor }).TCPSocket;
  return typeof candidate === 'function' ? candidate : null;
}

/**
 * A device API needs a secure context, and saying so is worth a branch.
 *
 * `navigator.usb` is simply absent on `http://` over a LAN IP — which is how the
 * dev build is opened on a real till — so without this the message would be "your
 * browser does not support USB printing" to someone whose browser supports it
 * perfectly well.
 */
export function secureContextProblem(): string | null {
  if (typeof window === 'undefined') return null;
  if (window.isSecureContext) return null;
  return 'Direct printing needs a secure connection. Open Mountain Bakes over https (or on localhost) and try again.';
}
