/**
 * How ESC/POS bytes actually leave the browser.
 *
 * ---------------------------------------------------------------------------
 * Why this abstraction exists at all
 * ---------------------------------------------------------------------------
 * Everything above this folder — the receipt layout, the column maths, the
 * validation, the log — is identical whichever wire the bytes travel down. What
 * differs is one question: *can this browser open that device, and how.* Keeping
 * that question in one small interface is what stops "which printer is attached"
 * from leaking back into the sales page, and it is what makes the honest answer
 * ("this browser cannot") a first-class result rather than an exception nobody
 * planned for.
 *
 * ---------------------------------------------------------------------------
 * There is no local print service any more
 * ---------------------------------------------------------------------------
 * The app used to post base64 to a Node agent on 127.0.0.1 which spooled the job.
 * That put a piece of software on every till that had to be installed, started,
 * kept running and kept reachable — and when it was not, the counter got "POS
 * printing service is not running" with a customer standing there.
 *
 * The browser can talk to the printer itself, so it does. Each transport below is
 * a real device API with real limits, and those limits are reported rather than
 * papered over: a transport that cannot work on this machine says so in
 * `support()`, before anybody presses Print, and no path in this app silently
 * falls back to the browser's own print dialog.
 */

/** The ways this app can reach a thermal printer, in preference order. */
export type ConnectionType = 'usb' | 'serial' | 'network';

/**
 * Whether this browser, on this machine, can use a transport at all.
 *
 * `supported: false` is a permanent fact about the environment (no WebUSB in this
 * browser), not a transient one (printer switched off) — the two need different
 * words on screen, and conflating them is how a shop ends up power-cycling a
 * printer to fix Firefox.
 */
export interface TransportSupport {
  supported: boolean;
  /** What is missing, and what would fix it. Shown verbatim in Printer Setup. */
  reason?: string;
}

/**
 * A device the user has authorised, as this app remembers it.
 *
 * Nothing here is a handle — a `USBDevice` object cannot be persisted and would
 * be meaningless in the next session anyway. These are the descriptor fields the
 * device APIs let us match a saved printer against what is plugged in now.
 */
export interface DeviceIdentity {
  /** Stable across sessions: `usb:0x04b8:0x0e15:SERIAL`, `net:192.168.1.100:9100`. */
  deviceId: string;
  /** What to call it before the user renames it. */
  label: string;
  vendorId?: number | null;
  productId?: number | null;
  serialNumber?: string | null;
}

/** Where a transport stands right now, without prompting the user for anything. */
export type LinkState =
  /** The API this transport needs does not exist here. Nothing will fix it but a different browser. */
  | 'unsupported'
  /** Supported, but no device has been authorised on this device yet. */
  | 'unauthorised'
  /** Authorised previously, but not attached / not answering now. */
  | 'disconnected'
  /** Open and writable. */
  | 'connected';

export interface LinkStatus {
  state: LinkState;
  /** Present on `unsupported` and `disconnected` — why, in one sentence. */
  reason?: string;
  device?: DeviceIdentity | null;
}

/**
 * One way of reaching a printer.
 *
 * `request` is the only method that may show UI, and it must be called straight
 * from a click — every device chooser in every browser requires a live user
 * gesture and throws otherwise. `restore` is its silent twin: it re-adopts a
 * device the user already authorised, which is what makes "set it up once"
 * true rather than a promise the app breaks every morning.
 */
export interface PosTransport {
  readonly type: ConnectionType;
  /** Can this browser do this at all? Cheap, synchronous, no side effects. */
  support(): TransportSupport;
  /** Re-adopt an already-authorised device. Never prompts. `null` if there is none. */
  restore(target: TransportTarget): Promise<DeviceIdentity | null>;
  /**
   * Every device this origin has already been granted, without prompting.
   *
   * This is the closest a browser gets to enumerating printers, and the
   * difference from what an operating system would answer is the whole reason
   * `discovery.ts` exists: the list is the devices *a person authorised for this
   * app on this machine*, not the machine's installed printers. A printer nobody
   * has granted is invisible here however plainly it appears in Windows, and
   * nothing in the list carries an OS "default" flag, because no browser API
   * reports one.
   *
   * What it is genuinely good for is skipping the chooser: a till that granted a
   * printer once has it in this list on every later load, so setup does not have
   * to ask again. Prompting here would defeat that — this runs on page load, and
   * a device picker nobody asked for is worse than no detection at all.
   */
  discover(): Promise<DeviceIdentity[]>;
  /** Show the browser's device chooser. MUST be called from a user gesture. */
  request(target: TransportTarget): Promise<DeviceIdentity>;
  /** Open the link and prove it works, without printing. Drives Test Connection. */
  probe(target: TransportTarget): Promise<DeviceIdentity>;
  /** Send bytes. Opens the link first if it is not already open. */
  send(target: TransportTarget, bytes: Uint8Array): Promise<void>;
  /** Current state, silently — for the status pill. */
  status(target: TransportTarget): Promise<LinkStatus>;
  /** Release the device so another application can have it. */
  release(target: TransportTarget): Promise<void>;
}

/**
 * What a transport needs from the saved config to find its device again.
 *
 * Deliberately not the whole `PosPrinterConfig`: a transport has no business
 * knowing the paper width or how many copies to print, and a type that hands it
 * those is a type that invites it to start caring.
 */
export interface TransportTarget {
  usb?: { vendorId: number; productId: number; serialNumber: string | null } | null;
  serial?: { usbVendorId: number | null; usbProductId: number | null; baudRate: number } | null;
  network?: { host: string; port: number } | null;
}
