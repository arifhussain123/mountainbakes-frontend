import { execFile } from 'node:child_process';
import { createConnection } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const WIN_SCRIPT = resolve(HERE, 'win-rawprint.ps1');

/** How long a single job may take before it is called a timeout. */
const JOB_TIMEOUT_MS = 20_000;

/**
 * Every failure the agent can distinguish, named so the web app can say
 * something useful rather than "print failed".
 *
 * The set is deliberately small: these are the states a cashier can DO something
 * different about. `printer-offline` means look at the printer, `printer-not-found`
 * means the selection is stale and belongs in settings, `timeout` means try again.
 * Splitting them finer would produce distinctions nobody at a counter can act on.
 */
export class TransportError extends Error {
  constructor(code, message, detail) {
    super(message);
    this.name = 'TransportError';
    this.code = code;
    this.detail = detail ?? null;
  }
}

/**
 * Send raw bytes to a printer.
 *
 * Bytes, not text: what arrives from the app is an ESC/POS stream that already
 * carries its own alignment, emphasis and cut commands. Nothing here inspects or
 * re-encodes it — a transport that "helpfully" normalised line endings would
 * corrupt a `GS ! n` size byte that happened to be 0x0d.
 */
export async function sendToPrinter(printer, bytes, docName) {
  switch (printer.transport) {
    case 'tcp':
      return sendTcp(printer, bytes);
    case 'windows-spooler':
      return sendWindowsSpooler(printer, bytes, docName);
    case 'windows-share':
      return sendWindowsShare(printer, bytes);
    case 'cups':
      return sendCups(printer, bytes, docName);
    case 'device':
      return sendDevice(printer, bytes);
    default:
      throw new TransportError(
        'unsupported-printer',
        `Unknown transport "${printer.transport}" for printer "${printer.name}".`,
      );
  }
}

/**
 * A network thermal printer on its raw port — 9100 unless told otherwise.
 *
 * The socket is closed with `end()` and the job is only reported successful once
 * the printer has closed its side too. Resolving on the write callback instead
 * would report success for bytes that never left the send buffer, which is
 * exactly what a printer that is powered on but out of paper looks like.
 */
function sendTcp(printer, bytes) {
  const host = printer.host;
  const port = printer.port ?? 9100;
  if (!host) throw new TransportError('invalid-config', `Printer "${printer.name}" has no host.`);

  return new Promise((resolvePromise, reject) => {
    let settled = false;
    const socket = createConnection({ host, port });
    socket.setTimeout(JOB_TIMEOUT_MS);

    const fail = (code, message, detail) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new TransportError(code, message, detail));
    };

    socket.on('connect', () => socket.end(bytes));
    socket.on('close', () => {
      if (settled) return;
      settled = true;
      resolvePromise();
    });
    socket.on('timeout', () => fail('timeout', `Printer at ${host}:${port} did not respond.`));
    socket.on('error', (error) => {
      const code = error.code === 'ECONNREFUSED' || error.code === 'EHOSTUNREACH' || error.code === 'ENETUNREACH'
        ? 'printer-offline'
        : 'write-failed';
      fail(code, `Cannot reach ${host}:${port}.`, error.code ?? error.message);
    });
  });
}

/** A USB/local printer through the Windows spooler as a RAW job. See win-rawprint.ps1. */
async function sendWindowsSpooler(printer, bytes, docName) {
  await withTempFile(bytes, async (path) => {
    try {
      await run(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy', 'Bypass',
          '-File', WIN_SCRIPT,
          '-Printer', printer.name,
          '-Path', path,
          '-DocName', docName,
        ],
        { windowsHide: true, timeout: JOB_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      );
    } catch (error) {
      throw windowsError(error, printer);
    }
  });
}

/**
 * The PowerShell helper's failures, mapped back to the agent's own codes.
 *
 * The helper throws messages prefixed with a token precisely so this mapping is a
 * string match on something it controls, rather than on a Windows error string
 * that changes with the system locale — the reason a Urdu-locale till would
 * otherwise report every failure as "unknown".
 */
function windowsError(error, printer) {
  const text = `${error.stderr ?? ''}${error.stdout ?? ''}${error.message ?? ''}`;
  if (error.killed || error.signal === 'SIGTERM') {
    return new TransportError('timeout', `"${printer.name}" did not accept the job in time.`);
  }
  if (text.includes('PRINTER_NOT_FOUND')) {
    return new TransportError('printer-not-found', `Windows does not have a printer called "${printer.name}".`, text.trim());
  }
  if (text.includes('WRITE_TRUNCATED') || text.includes('WRITE_FAILED')) {
    return new TransportError('write-failed', `The receipt was cut short on "${printer.name}".`, text.trim());
  }
  if (text.includes('SPOOL_REJECTED')) {
    return new TransportError('printer-offline', `"${printer.name}" refused the job — check it is switched on and online.`, text.trim());
  }
  return new TransportError('write-failed', `Could not print to "${printer.name}".`, text.trim());
}

/** A shared Windows printer by UNC path. Kept for machines where the spooler P/Invoke is blocked. */
async function sendWindowsShare(printer, bytes) {
  const share = printer.share;
  if (!share) throw new TransportError('invalid-config', `Printer "${printer.name}" has no share path.`);
  await withTempFile(bytes, async (path) => {
    try {
      await run('cmd.exe', ['/c', 'copy', '/b', path, share], {
        windowsHide: true,
        timeout: JOB_TIMEOUT_MS,
      });
    } catch (error) {
      throw new TransportError('printer-offline', `Could not copy the job to ${share}.`, error.message);
    }
  });
}

/**
 * CUPS, with `-o raw` — the same "do not render this" instruction the Windows
 * RAW datatype gives. Without it CUPS runs the stream through a filter and the
 * printer receives a rasterised page of escape codes.
 */
async function sendCups(printer, bytes, docName) {
  await withTempFile(bytes, async (path) => {
    try {
      await run('lp', ['-d', printer.name, '-o', 'raw', '-t', docName, path], {
        timeout: JOB_TIMEOUT_MS,
      });
    } catch (error) {
      const text = `${error.stderr ?? ''}${error.message ?? ''}`;
      if (/unknown destination|does not exist/i.test(text)) {
        throw new TransportError('printer-not-found', `CUPS has no printer called "${printer.name}".`, text.trim());
      }
      throw new TransportError('printer-offline', `Could not queue the job on "${printer.name}".`, text.trim());
    }
  });
}

/** A device node, e.g. /dev/usb/lp0. The bluntest path, and the one that needs no spooler at all. */
async function sendDevice(printer, bytes) {
  const device = printer.device;
  if (!device) throw new TransportError('invalid-config', `Printer "${printer.name}" has no device path.`);
  try {
    await writeFile(device, bytes);
  } catch (error) {
    const code = error.code === 'ENOENT' ? 'printer-not-found'
      : error.code === 'EACCES' ? 'permission-denied'
      : 'write-failed';
    throw new TransportError(code, `Could not write to ${device}.`, error.code);
  }
}

/**
 * The payload as a file, removed however the job ends.
 *
 * A spool job is handed a path, not a stream, on both Windows and CUPS. The
 * directory is per-job rather than a shared temp name: two tills printing at once
 * on a terminal-services box would otherwise overwrite each other's receipt
 * between the write and the spool.
 */
async function withTempFile(bytes, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'mb-print-'));
  const path = join(dir, 'job.bin');
  try {
    await writeFile(path, bytes);
    await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
