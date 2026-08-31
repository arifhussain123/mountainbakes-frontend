import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const AGENT_ROOT = resolve(HERE, '..');

/**
 * Where the agent looks for its settings, in order. The first file that exists
 * wins outright — settings are NOT merged across files, because a half-applied
 * config is the kind of thing that prints to the wrong printer and leaves nobody
 * a reason to look.
 *
 * `MB_PRINT_AGENT_CONFIG` is what a service wrapper (NSSM, systemd) should set;
 * the file beside the agent is what someone unpacking a zip onto a till will use.
 */
function candidatePaths() {
  const paths = [];
  if (process.env.MB_PRINT_AGENT_CONFIG) paths.push(resolve(process.env.MB_PRINT_AGENT_CONFIG));
  paths.push(join(AGENT_ROOT, 'print-agent.config.json'));
  paths.push(join(process.cwd(), 'print-agent.config.json'));
  return paths;
}

/**
 * Loopback only, and it is not a preference.
 *
 * The agent hands raw bytes to a printer with no authentication worth the name —
 * on a shop LAN that is a device anybody on the wifi can spew paper from. Binding
 * to 127.0.0.1 is what makes "do not expose the printer to the network" a
 * property of the socket rather than a line in a README. Nothing reads a host
 * from the config file, deliberately: there is no value to put there that would
 * be safe.
 */
export const HOST = '127.0.0.1';

const DEFAULTS = {
  port: 9110,
  /**
   * Which web origins may talk to the agent.
   *
   * A page on any origin can POST to 127.0.0.1 — loopback is not a security
   * boundary against the browser, only against the network — so this list is
   * what stops an unrelated tab driving the till's printer. Wildcards are not
   * accepted; `*` in an entry is treated as a literal and will never match.
   */
  allowedOrigins: [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'https://mountainbakes-dfc2c.web.app',
    'https://mountainbakes-dfc2c.firebaseapp.com',
  ],
  /**
   * Optional shared secret. Empty by default: on a loopback socket with an
   * origin allowlist it buys little, and a token the shop has to type into every
   * till is a token that ends up written on the monitor. Set it where the till is
   * a shared machine.
   */
  token: '',
  /** Printers declared by hand — network boxes, or a device path on Linux. */
  printers: [],
  /** `id` of the printer used when a print request names none. */
  defaultPrinter: '',
  /** Log every job's payload size and outcome to stdout. */
  verbose: true,
};

export function loadConfig() {
  for (const path of candidatePaths()) {
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      return { ...DEFAULTS, ...parsed, configPath: path };
    } catch (error) {
      // A malformed config is worth failing on rather than silently running with
      // defaults: the defaults have no network printers and no token, so the
      // symptom would be "it prints to the wrong place" or "nothing prints",
      // days later and nowhere near the edit that caused it.
      throw new Error(`Cannot read ${path}: ${error.message}`);
    }
  }
  return { ...DEFAULTS, configPath: null };
}

/** Port from the environment wins, so a service wrapper can move it without editing files. */
export function resolvePort(config) {
  const fromEnv = Number(process.env.MB_PRINT_AGENT_PORT);
  return Number.isInteger(fromEnv) && fromEnv > 0 ? fromEnv : config.port;
}
