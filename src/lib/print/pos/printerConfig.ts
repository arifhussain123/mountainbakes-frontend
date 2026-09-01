'use client';

import type { PaperWidth, PrinterProfile } from './profiles';
import { resolveProfile } from './profiles';
import { DEFAULT_BAUD_RATE, DEFAULT_PRINTER_PORT, type ConnectionType, type TransportTarget } from './transport';

/**
 * Which printer this till prints to, remembered so nobody sets one up twice.
 *
 * ---------------------------------------------------------------------------
 * Why this lives in the browser and not the database
 * ---------------------------------------------------------------------------
 * Because it describes a *machine*, not a user or a branch. The printer plugged
 * into the counter PC is a fact about that PC: the same cashier signing in on the
 * office laptop has a different printer, or none. Stored server-side against the
 * user it would follow them to the wrong hardware; against the branch it would
 * break the moment a branch has two tills. localStorage is scoped to exactly the
 * thing being described.
 *
 * It is also **keyed by branch**, and that is a requirement rather than a detail:
 * a shared machine at head office is genuinely signed into by more than one
 * branch account, and a receipt for Committee Chowk must not go to the roll
 * another branch set up on the same computer. Switching branch switches printer,
 * with no step for anyone to forget.
 *
 * ---------------------------------------------------------------------------
 * What is stored is a description, not a handle
 * ---------------------------------------------------------------------------
 * A `USBDevice` cannot be serialised, and a permission cannot be either — the
 * grant lives in the browser's own store, against this origin. What is here is
 * the vendor id, product id and serial number needed to recognise that device
 * again in `navigator.usb.getDevices()`. Nothing here is secret, and nothing here
 * is a credential: with these three numbers and no grant, this app can do
 * precisely nothing.
 */

export type PrinterConnection = ConnectionType;

/** The USB descriptor fields that identify a saved printer. */
export interface UsbTarget {
  vendorId: number;
  productId: number;
  /** Many POS printers report none. `null` means "match on vendor/product alone". */
  serialNumber: string | null;
}

export interface SerialTarget {
  usbVendorId: number | null;
  usbProductId: number | null;
  baudRate: number;
}

export interface NetworkTarget {
  host: string;
  port: number;
}

export interface PosPrinterConfig {
  /** Stable device id, e.g. `usb:0x04b8:0x0e15:`. Empty until a printer is set up. */
  printerId: string;
  /** What to call it on screen. Editable — a shop names its own hardware. */
  printerName: string;
  connection: PrinterConnection;
  /** The printer every Print button on this device uses, with no per-print choice. */
  isDefault: boolean;
  paperWidth: PaperWidth;
  /**
   * Hand-set column count, when the test page's ruler proves the profile wrong.
   * `null` means "use the profile's own figure", which is the normal case.
   */
  charactersPerLine: number | null;
  /** CP437 is what `escpos.encode` transliterates to; nothing else is offered yet. */
  encoding: 'cp437';
  /** How many copies of a receipt to send per print. */
  copies: number;
  usb: UsbTarget | null;
  serial: SerialTarget | null;
  network: NetworkTarget | null;
  /** Surfaces payload and device detail in Printer Setup. Off for counter staff. */
  debug: boolean;
}

export const DEFAULT_CONFIG: PosPrinterConfig = {
  printerId: '',
  printerName: '',
  connection: 'usb',
  isDefault: false,
  paperWidth: '80mm',
  charactersPerLine: null,
  encoding: 'cp437',
  copies: 1,
  usb: null,
  serial: null,
  network: null,
  debug: false,
};

const KEY_PREFIX = 'mb.posPrinter';
/** Same-tab notification — `storage` only fires in *other* tabs. */
const CHANGE_EVENT = 'mb:pos-printer';

const CONNECTIONS: readonly PrinterConnection[] = ['usb', 'serial', 'network', 'system'];

function storageKey(branchId: string | null | undefined): string {
  return `${KEY_PREFIX}.${branchId?.trim() || 'default'}`;
}

/**
 * Read the stored config, falling back field by field.
 *
 * Merged onto the defaults rather than returned as parsed, so a config written by
 * an older build comes back complete instead of handing `undefined` to the code
 * that sends the job.
 */
export function readConfig(branchId: string | null | undefined): PosPrinterConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(storageKey(branchId));
    if (!raw) return DEFAULT_CONFIG;
    return migrate(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    // Private mode, disabled storage, or a corrupted entry. The defaults are a
    // working config with no printer chosen, which is exactly the state Printer
    // Setup knows how to walk someone out of.
    return DEFAULT_CONFIG;
  }
}

/**
 * A stored entry as a current config, dropping a printer that can no longer exist.
 *
 * Every till in the field has a config from the print-agent era: an `agentUrl`, a
 * `connection` of `system`, and a `printerId` that was the *agent's* name for a
 * spooler queue. None of that addresses a device this app can now open, so the
 * printer identity is cleared and the till is asked to press Connect once.
 *
 * `system` is a live connection type again — it means the *browser's* route to
 * the installed driver now, not a Node service's — but a legacy entry is still
 * cleared rather than reinterpreted, because its `printerId` named a spooler
 * queue on a machine this app cannot address by name. The `agentUrl` key is what
 * tells the two apart, which is why `legacy` tests for that and not for the
 * connection.
 *
 * What survives is everything that was a genuine choice about the paper and the
 * shop — width, copies, the column override — because re-asking for those would
 * make the upgrade feel like a reset for no reason. The `agentToken` is dropped
 * rather than migrated: there is nothing left to authenticate to, and a secret
 * kept in storage after the thing it opened is gone is only a liability.
 */
function migrate(stored: Record<string, unknown>): PosPrinterConfig {
  const legacy = 'agentUrl' in stored || 'agentToken' in stored;
  const connection = CONNECTIONS.includes(stored.connection as PrinterConnection)
    ? (stored.connection as PrinterConnection)
    : 'usb';

  const base: PosPrinterConfig = {
    ...DEFAULT_CONFIG,
    paperWidth: stored.paperWidth === '58mm' ? '58mm' : '80mm',
    charactersPerLine: typeof stored.charactersPerLine === 'number' ? stored.charactersPerLine : null,
    copies: typeof stored.copies === 'number' ? stored.copies : 1,
    debug: stored.debug === true,
  };

  if (legacy) return sanitize(base);

  return sanitize({
    ...base,
    printerId: typeof stored.printerId === 'string' ? stored.printerId : '',
    printerName: typeof stored.printerName === 'string' ? stored.printerName : '',
    connection,
    isDefault: stored.isDefault === true,
    usb: usbOf(stored.usb),
    serial: serialOf(stored.serial),
    network: networkOf(stored.network),
  });
}

function usbOf(value: unknown): UsbTarget | null {
  const v = value as Partial<UsbTarget> | null | undefined;
  if (!v || typeof v.vendorId !== 'number' || typeof v.productId !== 'number') return null;
  return { vendorId: v.vendorId, productId: v.productId, serialNumber: typeof v.serialNumber === 'string' ? v.serialNumber : null };
}

function serialOf(value: unknown): SerialTarget | null {
  const v = value as Partial<SerialTarget> | null | undefined;
  if (!v) return null;
  return {
    usbVendorId: typeof v.usbVendorId === 'number' ? v.usbVendorId : null,
    usbProductId: typeof v.usbProductId === 'number' ? v.usbProductId : null,
    baudRate: typeof v.baudRate === 'number' && v.baudRate > 0 ? v.baudRate : DEFAULT_BAUD_RATE,
  };
}

function networkOf(value: unknown): NetworkTarget | null {
  const v = value as Partial<NetworkTarget> | null | undefined;
  if (!v || typeof v.host !== 'string' || !v.host.trim()) return null;
  return { host: v.host.trim(), port: typeof v.port === 'number' && v.port > 0 ? v.port : DEFAULT_PRINTER_PORT };
}

/** Clamp the fields a hand-edited entry could put out of range. */
function sanitize(config: PosPrinterConfig): PosPrinterConfig {
  const copies = Number.isFinite(config.copies) ? Math.max(1, Math.min(5, Math.trunc(config.copies))) : 1;
  const columns =
    config.charactersPerLine != null && Number.isFinite(config.charactersPerLine)
      ? Math.max(24, Math.min(96, Math.trunc(config.charactersPerLine)))
      : null;
  return {
    ...config,
    copies,
    charactersPerLine: columns,
    paperWidth: config.paperWidth === '58mm' ? '58mm' : '80mm',
    connection: CONNECTIONS.includes(config.connection) ? config.connection : 'usb',
  };
}

export function writeConfig(branchId: string | null | undefined, config: PosPrinterConfig): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(storageKey(branchId), JSON.stringify(sanitize(config)));
  } catch {
    // Nothing persists, but the event below still fires so the open screen
    // reflects the choice for this session rather than looking frozen.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function clearConfig(branchId: string | null | undefined): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(storageKey(branchId));
  } catch {
    /* nothing to clear */
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** For `useSyncExternalStore`. Listens to both tabs and this one. */
export function subscribeToConfig(onChange: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/** `true` once a printer has been set up — the one question every print path asks. */
export function isConfigured(config: PosPrinterConfig): boolean {
  if (!config.printerId) return false;
  // The system printer is addressed by nothing, so "has a target" cannot be the
  // test for it. Having been chosen IS the configuration — there is no second
  // fact to check, and requiring one would leave it permanently unconfigured.
  if (config.connection === 'system') return true;
  const target = targetOf(config);
  return Boolean(target.usb || target.serial || target.network);
}

/**
 * The parts of the config a transport is allowed to see.
 *
 * Only the branch matching the chosen connection is passed through. Handing a
 * transport the other two would let a config that still remembers an old LAN
 * address quietly print over the network while the screen says USB.
 */
export function targetOf(config: PosPrinterConfig): TransportTarget {
  switch (config.connection) {
    case 'usb':
      return { usb: config.usb };
    case 'serial':
      return { serial: config.serial };
    case 'network':
      return { network: config.network };
    case 'system':
      // Empty, and correctly so. The system transport prints through the driver
      // the operating system already has; there is no descriptor, no address and
      // no grant to hand it. A field invented to fill this gap would be a field
      // nothing could ever put a true value in.
      return {};
  }
}

/** The profile a config resolves to, honouring the hand-set column count. */
export function profileOf(config: PosPrinterConfig): PrinterProfile {
  return resolveProfile(config.paperWidth, config.charactersPerLine);
}

export const CONNECTION_LABELS: Record<PrinterConnection, string> = {
  usb: 'USB',
  serial: 'USB Serial',
  network: 'Network',
  system: 'Installed printer',
};

/* ────────────────────────────────────────────────────────────────────────────
   Snapshot cache — required by useSyncExternalStore
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * `readConfig` builds a fresh object every call, and `useSyncExternalStore`
 * compares snapshots by identity — so subscribing to it directly re-renders
 * forever. This memoises on the RAW stored string, which is the only thing that
 * actually changes: same string, same object, and the store settles.
 *
 * Keyed by branch because two branch accounts on one shared till have two
 * configs, and a single cached value would hand one of them the other's printer.
 */
const SNAPSHOTS = new Map<string, { raw: string | null; value: PosPrinterConfig }>();

export function configSnapshot(branchId: string | null | undefined): PosPrinterConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  const key = storageKey(branchId);
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return DEFAULT_CONFIG;
  }
  const cached = SNAPSHOTS.get(key);
  if (cached && cached.raw === raw) return cached.value;
  const value = readConfig(branchId);
  SNAPSHOTS.set(key, { raw, value });
  return value;
}

/** The server snapshot. Constant, so the export prerenders without touching storage. */
export function serverConfigSnapshot(): PosPrinterConfig {
  return DEFAULT_CONFIG;
}
