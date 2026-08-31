'use client';

import type { PaperWidth, PrinterProfile } from './profiles';
import { resolveProfile } from './profiles';

/**
 * Which printer this till prints to, remembered so nobody picks one twice.
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
 * It is keyed by branch anyway, because a shared machine at head office is
 * genuinely used by more than one branch account, and a demand printed for
 * Branch A should not silently go to the roll Branch B set up.
 *
 * ---------------------------------------------------------------------------
 * Nothing secret is stored here
 * ---------------------------------------------------------------------------
 * `agentToken` is the one sensitive field and it is optional, entered by hand in
 * Printer Settings on the till that needs it, and never shipped in the bundle —
 * there is no `NEXT_PUBLIC_` variable for it and there must not be one, because
 * a build-time constant would put the shop's print secret in every browser that
 * ever loads the app. See `print-agent/README.md`.
 */

/** The default the agent listens on. Overridable per till, for the odd port clash. */
export const DEFAULT_AGENT_URL = 'http://127.0.0.1:9110';

export type PrinterConnection = 'usb' | 'network' | 'system' | 'unknown';

export interface PosPrinterConfig {
  /** Where the local print agent is. Loopback — see the agent's README on why. */
  agentUrl: string;
  /** Optional `Bearer` secret, only where the agent was configured to want one. */
  agentToken: string;
  /** The agent's stable id for the chosen printer. Empty until one is picked. */
  printerId: string;
  /** What to call it on screen, so settings read sensibly while the agent is down. */
  printerName: string;
  type: 'thermal';
  connection: PrinterConnection;
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
  /** Surfaces payload/response detail in Printer Settings. Off for counter staff. */
  debug: boolean;
}

export const DEFAULT_CONFIG: PosPrinterConfig = {
  agentUrl: DEFAULT_AGENT_URL,
  agentToken: '',
  printerId: '',
  printerName: '',
  type: 'thermal',
  connection: 'unknown',
  paperWidth: '80mm',
  charactersPerLine: null,
  encoding: 'cp437',
  copies: 1,
  debug: false,
};

const KEY_PREFIX = 'mb.posPrinter';
/** Same-tab notification — `storage` only fires in *other* tabs. */
const CHANGE_EVENT = 'mb:pos-printer';

function storageKey(branchId: string | null | undefined): string {
  return `${KEY_PREFIX}.${branchId?.trim() || 'default'}`;
}

/**
 * Read the stored config, falling back field by field.
 *
 * Merged onto the defaults rather than returned as parsed, so a config written by
 * an older build — one with no `copies`, say — comes back complete instead of
 * handing `undefined` to the code that sends the job.
 */
export function readConfig(branchId: string | null | undefined): PosPrinterConfig {
  if (typeof window === 'undefined') return DEFAULT_CONFIG;
  try {
    const raw = localStorage.getItem(storageKey(branchId));
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<PosPrinterConfig>;
    return sanitize({ ...DEFAULT_CONFIG, ...parsed });
  } catch {
    // Private mode, disabled storage, or a corrupted entry. The defaults are a
    // working config with no printer chosen, which is exactly the state Printer
    // Settings knows how to walk someone out of.
    return DEFAULT_CONFIG;
  }
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
    agentUrl: config.agentUrl?.trim() || DEFAULT_AGENT_URL,
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

/** `true` once a printer has been chosen — the one question every print path asks. */
export function isConfigured(config: PosPrinterConfig): boolean {
  return Boolean(config.printerId);
}

/** The profile a config resolves to, honouring the hand-set column count. */
export function profileOf(config: PosPrinterConfig): PrinterProfile {
  return resolveProfile(config.paperWidth, config.charactersPerLine);
}

export const CONNECTION_LABELS: Record<PrinterConnection, string> = {
  usb: 'USB',
  network: 'Network',
  system: 'Local (spooler)',
  unknown: 'Unknown',
};

/**
 * What the agent's transport says about how a printer is attached.
 *
 * The distinction is shown in settings and printed on the test page, because
 * "the printer is offline" means something different for a USB unit (switched
 * off) than for a LAN one (a different machine, or the wrong IP), and knowing
 * which is what makes the message actionable.
 */
export function connectionFromTransport(transport: string | undefined): PrinterConnection {
  switch (transport) {
    case 'tcp':
      return 'network';
    case 'device':
      return 'usb';
    case 'windows-spooler':
    case 'windows-share':
    case 'cups':
      return 'system';
    default:
      return 'unknown';
  }
}

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
