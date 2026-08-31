import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * The printers this machine can reach.
 *
 * Two sources, and the distinction matters to the app: printers DISCOVERED from
 * the operating system's spooler (`source: 'system'`), and printers DECLARED in
 * the config file (`source: 'config'`) — a network box on an IP, or a device
 * node on Linux, neither of which the spooler necessarily knows about.
 *
 * Discovery is what lets the web app show a real list instead of a hardcoded
 * "BlackCopper 80mm Series". The shop picks from what is actually installed, so
 * a replaced printer is a re-pick rather than a code change.
 */

export async function listPrinters(config) {
  const declared = (config.printers ?? []).map(normalizeDeclared).filter(Boolean);
  const declaredNames = new Set(declared.map((p) => p.name.toLowerCase()));

  let discovered = [];
  try {
    discovered = await discoverSystemPrinters();
  } catch {
    // A machine with no spooler, or a locked-down PowerShell policy. The declared
    // printers are still perfectly usable, so this is not fatal — the app shows
    // what it can reach and says nothing about what it could not.
    discovered = [];
  }

  // A declared entry wins over a discovered one of the same name: the config is
  // where someone has said *how* to reach it (raw port vs spooler), which is
  // knowledge discovery does not have.
  const merged = [
    ...declared,
    ...discovered.filter((p) => !declaredNames.has(p.name.toLowerCase())),
  ];

  const defaultId = config.defaultPrinter || merged[0]?.id || '';
  return merged.map((p) => ({ ...p, isDefault: p.id === defaultId }));
}

/** A config entry, validated into the same shape discovery produces. */
function normalizeDeclared(entry) {
  if (!entry || typeof entry.name !== 'string' || !entry.name.trim()) return null;
  const name = entry.name.trim();
  return {
    id: entry.id?.trim() || slug(name),
    name,
    source: 'config',
    transport: entry.transport || (entry.host ? 'tcp' : defaultTransport()),
    host: entry.host ?? null,
    port: entry.port ?? (entry.host ? 9100 : null),
    device: entry.device ?? null,
    share: entry.share ?? null,
  };
}

async function discoverSystemPrinters() {
  if (process.platform === 'win32') return discoverWindows();
  return discoverCups();
}

/**
 * `Get-Printer` is the modern cmdlet and is present on every Windows 8 / Server
 * 2012 and later. It is asked for JSON rather than parsed as text because a
 * printer named "BlackCopper 80mm Series" contains spaces, and every text-mode
 * parse of that output eventually splits one.
 *
 * `wmic` is the fallback for the odd machine where the print-management module
 * is missing; it is deprecated but still shipped, and its CSV output is at least
 * unambiguous about where a field ends.
 */
async function discoverWindows() {
  try {
    const { stdout } = await run(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Get-Printer | Select-Object Name,PortName | ConvertTo-Json -Compress'],
      { windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 },
    );
    const parsed = JSON.parse(stdout.trim() || '[]');
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .filter((r) => r && typeof r.Name === 'string')
      .map((r) => windowsPrinter(r.Name, r.PortName));
  } catch {
    const { stdout } = await run(
      'wmic',
      ['printer', 'get', 'name,portname', '/format:csv'],
      { windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 },
    );
    return stdout
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.split(','))
      // Node,Name,PortName — the leading node column is why this is sliced from 1.
      .filter((cells) => cells.length >= 3 && cells[1]?.trim())
      .map((cells) => windowsPrinter(cells[1].trim(), cells[2]?.trim()));
  }
}

function windowsPrinter(name, portName) {
  return {
    id: slug(name),
    name,
    source: 'system',
    // The Windows spooler accepts a RAW datatype job, which is exactly what an
    // ESC/POS byte stream is — so a USB thermal printer needs no sharing and no
    // native module. See transports.mjs.
    transport: 'windows-spooler',
    host: null,
    port: null,
    device: null,
    share: null,
    portName: portName || null,
  };
}

/**
 * `lpstat -e` lists every destination CUPS knows, including ones that are
 * disabled — which is the right list for a picker. `-a` would hide a printer
 * that is merely paused and leave someone unable to select the thing they are
 * trying to fix.
 */
async function discoverCups() {
  const { stdout } = await run('lpstat', ['-e'], { timeout: 10_000, maxBuffer: 1024 * 1024 });
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((name) => ({
      id: slug(name),
      name,
      source: 'system',
      transport: 'cups',
      host: null,
      port: null,
      device: null,
      share: null,
    }));
}

function defaultTransport() {
  return process.platform === 'win32' ? 'windows-spooler' : 'cups';
}

/** Stable id from a display name, so a stored selection survives a restart. */
export function slug(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'printer';
}

/**
 * The printer a job should go to.
 *
 * Resolved by id first, then by an exact (case-insensitive) name — the app stores
 * an id, but a hand-written config or a curl during setup is far more likely to
 * name the printer, and failing that lookup would look like the printer had
 * vanished.
 */
export function findPrinter(printers, wanted) {
  if (!wanted) return printers.find((p) => p.isDefault) ?? printers[0] ?? null;
  const key = String(wanted).toLowerCase();
  return (
    printers.find((p) => p.id.toLowerCase() === key) ??
    printers.find((p) => p.name.toLowerCase() === key) ??
    null
  );
}
