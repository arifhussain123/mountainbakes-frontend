'use client';

import { PosPrintError, asPrintError } from '../errors';
import { tcpSocket, type TcpSocketInstance } from './deviceApis';
import type { DeviceIdentity, LinkStatus, PosTransport, TransportSupport, TransportTarget } from './types';

/**
 * A LAN printer on port 9100, and an honest account of when that is possible.
 *
 * ---------------------------------------------------------------------------
 * Read this before "fixing" the unsupported message
 * ---------------------------------------------------------------------------
 * A network thermal printer speaks **raw TCP on port 9100** (JetDirect). It is
 * not an HTTP server: it does not answer a request line, it has no CORS headers,
 * and it will happily print the text of an HTTP request that is sent to it.
 *
 * A web page cannot open a TCP socket. `fetch` and `XMLHttpRequest` speak HTTP
 * and nothing else, and a `fetch('http://192.168.1.100:9100', …)` — the shape of
 * every "LAN printing from the browser" snippet on the internet — fails three
 * separate ways at once: the request is blocked as mixed content from an https
 * page, it is refused by CORS because there is no server to answer the preflight,
 * and even in `no-cors` mode what reaches the printer is HTTP headers, which it
 * prints as gibberish. It is not possible to tell any of that apart from script,
 * which is precisely why that approach *looks* like it works: the promise
 * settles, nothing throws where anyone is looking, and a page reports success
 * while no paper has moved.
 *
 * **This app will not do that.** If raw TCP is unavailable the transport reports
 * `unsupported`, in as many words, and Printer Setup steers the till to USB.
 *
 * ---------------------------------------------------------------------------
 * When it IS possible
 * ---------------------------------------------------------------------------
 * The Direct Sockets API (`TCPSocket`) grants a real socket, and Chrome exposes
 * it to **Isolated Web Apps** — a signed bundle installed on the machine, not a
 * page loaded from a URL. On a till that runs Mountain Bakes as an IWA this
 * transport works end to end, which is why it is implemented rather than
 * stubbed: the capability check is a runtime one, and the day the app is packaged
 * that way the LAN option lights up with no further work.
 *
 * The two other honest routes to a LAN printer, for whoever asks:
 *
 * - **Print through the driver.** If the unit is installed on the till — as a
 *   network printer in Windows, or over its USB socket — `transport/system.ts`
 *   hands the receipt to that driver and the driver does the networking. It is
 *   the answer for almost every till that reaches this message, and it is what
 *   `UNSUPPORTED_REASON` now sends people to.
 * - **Point USB at it instead.** Most network units also have a USB socket, and
 *   the USB transport needs nothing installed.
 * - **Let the printer poll.** ESC/POS units with a "server print" mode fetch jobs
 *   over HTTP from a URL they are configured with. That is an API change, not a
 *   browser one, and it is a real design — it is simply not something this file
 *   can do on its own.
 */

const CONNECT_TIMEOUT_MS = 5_000;

/** The JetDirect port. Effectively universal on ESC/POS network units. */
export const DEFAULT_PRINTER_PORT = 9100;

export function networkDeviceId(host: string, port: number): string {
  return `net:${host}:${port}`;
}

/**
 * When each address last actually answered.
 *
 * A LAN printer cannot be polled cheaply — it accepts one connection at a time,
 * so a status check every thirty seconds would be a status check that
 * periodically steals the printer from a real print. Instead every genuine
 * contact (a probe, a print) stamps the address here, and the pill reports
 * "connected" for as long as that evidence is fresh.
 *
 * This is a claim about the recent past, stated as such, and it is the strongest
 * true one available. The alternative — reporting "connected" because an IP is
 * typed into settings — would be a claim about the present with nothing behind it.
 */
const LAST_SEEN = new Map<string, number>();

/** How long a successful contact is taken as still describing the link. */
const FRESH_MS = 3 * 60_000;

/**
 * Enough of an address check to refuse the mistakes people actually make.
 *
 * Not a strict IP parser: a printer may legitimately be addressed by hostname on
 * a network with a DNS server. What this rejects is blank, a URL pasted in whole
 * (`http://…`), and a port out of range — each of which would otherwise fail much
 * later with a message about the network rather than about the box someone typed
 * in.
 */
function requireAddress(target: TransportTarget): { host: string; port: number } {
  const net = target.network;
  const host = net?.host?.trim() ?? '';
  const port = net?.port ?? 0;
  if (!host) {
    throw new PosPrintError('invalid-config', 'Enter the printer’s IP address in Printer Settings.');
  }
  if (/^[a-z]+:\/\//i.test(host)) {
    throw new PosPrintError('invalid-config', 'Enter just the IP address, without http:// in front of it.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new PosPrintError('invalid-config', 'The printer port must be a number between 1 and 65535. Most POS printers use 9100.');
  }
  return { host, port };
}

/**
 * The message, and why it now names a way out.
 *
 * The first two sentences are unchanged and unchangeable: they state a fact about
 * the browser, and no wording makes a TCP socket appear. What was wrong with it
 * was the ending — it left a counter with a LAN printer holding a message that
 * was entirely true and entirely unusable, whose only suggestions were to rewire
 * the shop or to repackage the app.
 *
 * Most network POS units are also installed on the till in Windows, over USB or
 * over the same LAN, and *that* installation is reachable — through its driver,
 * by `transport/system.ts`. So the sentence ends by naming the setting that will
 * actually print tonight, and keeps the two structural fixes after it.
 */
const UNSUPPORTED_REASON =
  'Direct network printing is not available in this browser. A web page cannot open a raw connection to a printer on port 9100 — only an installed app can. If this printer is installed on this computer, choose “Installed Printer” under Connection and it will print through its Windows driver. Otherwise connect it by USB, or run Mountain Bakes as an installed app on this till.';

async function connect(host: string, port: number): Promise<{ socket: TcpSocketInstance; writable: WritableStream<Uint8Array> }> {
  const TCPSocket = tcpSocket();
  if (!TCPSocket) throw new PosPrintError('not-supported', UNSUPPORTED_REASON);

  let socket: TcpSocketInstance;
  try {
    socket = new TCPSocket(host, port, { noDelay: true });
  } catch (error) {
    throw asPrintError(error, 'invalid-config');
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new PosPrintError(
              'timeout',
              `No printer answered at ${host}:${port}. Check the address, and that the printer is switched on and on this network.`,
            ),
          ),
        CONNECT_TIMEOUT_MS,
      );
    });
    const opened = await Promise.race([socket.opened, deadline]);
    return { socket, writable: opened.writable };
  } catch (error) {
    void socket.close().catch(() => {});
    if (error instanceof PosPrintError) throw error;
    throw new PosPrintError(
      'printer-offline',
      `Could not reach a printer at ${host}:${port}. Check the address and that the printer is on this network.`,
      error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * A LAN socket is opened per job and closed after it.
 *
 * Unlike USB, holding it open buys nothing and costs something: most network
 * thermal printers accept exactly one connection at a time, so a socket this page
 * never closed would lock every other till out of the printer — including the
 * kitchen display and the branch's second counter.
 */
export const networkTransport: PosTransport = {
  type: 'network',

  support(): TransportSupport {
    if (!tcpSocket()) return { supported: false, reason: UNSUPPORTED_REASON };
    return { supported: true };
  },

  /** Nothing to restore: an address is not a permission. Configured is connected-if-reachable. */
  async restore(target) {
    if (!target.network?.host) return null;
    return {
      deviceId: networkDeviceId(target.network.host, target.network.port),
      label: `${target.network.host}:${target.network.port}`,
    };
  },

  /**
   * Nothing to discover. A LAN has no roll-call, and scanning it would be a lie.
   *
   * The other two transports enumerate a *permission store* — a list the browser
   * already holds and answers instantly. There is no equivalent here: finding a
   * printer on the network would mean probing every address on the subnet, which
   * an ordinary web page cannot do at all (see `support()`), and which would be a
   * port scan rather than a detection even where it could.
   *
   * So this answers with the empty list and lets Printer Settings say a network
   * printer is typed in, not found. An address someone has already saved is not
   * returned either: it is a setting, not a discovery, and dressing it up as one
   * would put an unreachable printer at the top of a *Detected Printers* list.
   */
  async discover(): Promise<DeviceIdentity[]> {
    return [];
  },

  /** There is no chooser for an IP address — the address IS the request. So this proves it. */
  async request(target): Promise<DeviceIdentity> {
    return this.probe(target);
  },

  async probe(target): Promise<DeviceIdentity> {
    const { host, port } = requireAddress(target);
    const { socket } = await connect(host, port);
    // Connecting is the whole test. A 9100 printer sends nothing back and answers
    // no query, so a socket that opened is the only evidence available — and it is
    // real evidence: nothing accepts a connection on that port but the printer.
    await socket.close().catch(() => {});
    LAST_SEEN.set(networkDeviceId(host, port), Date.now());
    return { deviceId: networkDeviceId(host, port), label: `${host}:${port}` };
  },

  async send(target, job) {
    const { host, port } = requireAddress(target);
    const { socket, writable } = await connect(host, port);
    const writer = writable.getWriter();
    try {
      // Every copy goes down the one connection. Reconnecting between them would
      // hand the printer back to whatever else on the network is waiting for it,
      // and the second copy would then queue behind that.
      for (let copy = 0; copy < Math.max(1, job.copies); copy++) {
        await writer.write(job.bytes);
      }
      // Closing the writer flushes it. Returning before that would report a
      // successful print for bytes still sitting in a buffer that is about to be
      // dropped by `socket.close()`.
      await writer.close();
      LAST_SEEN.set(networkDeviceId(host, port), Date.now());
    } catch (error) {
      throw asPrintError(error, 'write-failed');
    } finally {
      await socket.close().catch(() => {});
    }
  },

  async status(target): Promise<LinkStatus> {
    const support = this.support();
    if (!support.supported) return { state: 'unsupported', reason: support.reason };
    if (!target.network?.host) return { state: 'unauthorised' };
    // Deliberately NOT connecting here — see LAST_SEEN above.
    const id = networkDeviceId(target.network.host, target.network.port);
    const seen = LAST_SEEN.get(id) ?? 0;
    const fresh = Date.now() - seen < FRESH_MS;
    return {
      state: fresh ? 'connected' : 'disconnected',
      reason: fresh ? undefined : 'Press Test Connection to check the printer answers.',
      device: { deviceId: id, label: `${target.network.host}:${target.network.port}` },
    };
  },

  async release() {
    /* Nothing is held open between jobs. */
  },
};
