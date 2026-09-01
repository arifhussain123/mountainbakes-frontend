import type { Block } from '../escpos';

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

/**
 * The ways this app can reach a printer, in preference order.
 *
 * The first three write ESC/POS to a device this app opened itself. `system` is
 * the odd one out and is deliberately kept: it hands the receipt to the printer
 * *the operating system has installed*, through the browser's print path, which
 * is the only way to reach a unit whose vendor driver already owns it. See
 * `system.ts` for why that is a separate kind of thing rather than a fallback the
 * other three quietly perform.
 */
export type ConnectionType = 'usb' | 'serial' | 'network' | 'system';

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
 * One composed document, in every form a printer might accept it.
 *
 * ---------------------------------------------------------------------------
 * Why a transport is handed blocks as well as bytes
 * ---------------------------------------------------------------------------
 * Because the two kinds of printer this app can reach want genuinely different
 * things, and neither can be derived from the other at this layer. A device
 * transport writes `bytes` — ESC/POS, straight down the wire, no layout engine
 * involved. The system transport cannot: an installed driver is handed a *page*
 * to render, and ESC/POS posted to it comes out as a column of escape sequences.
 * It needs the document, which is what `blocks` is.
 *
 * Composing both up front, in `printerService`, is what keeps that from becoming
 * a branch on connection type in the code above — the caller composes a job, and
 * each transport takes the half of it that its wire understands.
 *
 * `copies` is part of the job rather than a loop around it for the same reason.
 * A device transport repeats the byte stream, and each repeat is a separate
 * receipt with its own cut. The system transport must NOT repeat the whole job:
 * that would open the print dialog once per copy. It puts the copies on
 * successive pages of one document instead.
 */
export interface PrintJob {
  /** The document as ESC/POS. What every device transport writes. */
  bytes: Uint8Array;
  /** The same document before it became bytes, for a transport that must lay out a page. */
  blocks: readonly Block[];
  /** Characters across the roll. The blocks were wrapped to exactly this. */
  columns: number;
  /** Roll width in millimetres — the page box a driver is given. */
  paperWidthMm: number;
  /** The head's print area, narrower than the roll. Where the text actually goes. */
  printableWidthMm: number;
  /** How many receipts to produce. At least 1. */
  copies: number;
  /** Names the job in the OS spooler and in the print dialog's title. */
  title: string;
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
  /** Send the job, all copies of it. Opens the link first if it is not already open. */
  send(target: TransportTarget, job: PrintJob): Promise<void>;
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
  /**
   * The system transport needs nothing here, and that is the honest shape of it:
   * there is no address, no descriptor and no grant to remember. The printer it
   * prints to is whichever one the operating system hands the job to, which this
   * app cannot name, choose or store. `printerConfig.targetOf` therefore returns
   * an empty target for it rather than inventing a field to fill.
   */
  usb?: { vendorId: number; productId: number; serialNumber: string | null } | null;
  serial?: { usbVendorId: number | null; usbProductId: number | null; baudRate: number } | null;
  network?: { host: string; port: number } | null;
}
