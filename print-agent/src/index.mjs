#!/usr/bin/env node
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

import { HOST, loadConfig, resolvePort } from './config.mjs';
import { findPrinter, listPrinters } from './printers.mjs';
import { TransportError, sendToPrinter } from './transports.mjs';

const VERSION = '1.0.0';
const AGENT = 'mountain-bakes-print-agent';

/** Refuse a payload larger than this. A receipt is a few kilobytes; anything near
 *  a megabyte is a bug or an abuse, and buffering it would be the agent's problem. */
const MAX_BODY_BYTES = 512 * 1024;

/**
 * Jobs already handled, keyed by the `printJobId` the app minted.
 *
 * This is the agent's half of duplicate protection, and it is the half that
 * actually holds: the app disables its button, but a double-click that lands two
 * requests in flight, a retry after a response was lost, and a page reloaded
 * mid-print all bypass the button entirely. Replaying a known id returns the
 * FIRST outcome instead of printing a second receipt.
 *
 * Kept for a minute — long enough to cover a retry, short enough that a genuine
 * reprint a customer asks for is a new job rather than a silent no-op. (The app
 * mints a fresh id per press, so a deliberate reprint is never suppressed here;
 * this only catches the same press arriving twice.)
 */
const RECENT_JOBS = new Map();
const JOB_MEMORY_MS = 60_000;

function rememberJob(id, result) {
  RECENT_JOBS.set(id, { result, at: Date.now() });
  for (const [key, entry] of RECENT_JOBS) {
    if (Date.now() - entry.at > JOB_MEMORY_MS) RECENT_JOBS.delete(key);
  }
}

const config = loadConfig();
const port = resolvePort(config);

// `--list-printers` exists so someone setting a till up can see what the agent
// sees without a browser in the loop — the fastest way to tell "the printer is
// not installed" apart from "the web app cannot reach the agent".
if (process.argv.includes('--list-printers')) {
  const printers = await listPrinters(config);
  if (printers.length === 0) console.log('No printers found.');
  for (const p of printers) {
    console.log(`${p.isDefault ? '*' : ' '} ${p.id}\t${p.name}\t(${p.transport}, ${p.source})`);
  }
  process.exit(0);
}

/**
 * CORS, as an allowlist and nothing more.
 *
 * Loopback is not a boundary the browser respects: any page in any tab can POST
 * to 127.0.0.1, so without this list an ad iframe could drive the till's printer.
 * The origin is echoed back verbatim only when it is on the list — never `*`,
 * which would defeat the whole point.
 *
 * `Access-Control-Allow-Private-Network` is the other half. Chrome's Private
 * Network Access rules preflight any request from a public origin (the deployed
 * app on Firebase Hosting) to a local one, and drop it unless the response opts
 * in with that header. Without it the agent works perfectly from `localhost:3000`
 * in development and is unreachable from production — which is the worst possible
 * place to discover it.
 */
function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return true; // curl, or the agent's own health check.
  if (!config.allowedOrigins.includes(origin)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, code: 'origin-not-allowed', message: 'This origin is not allowed to print.' }));
    return false;
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  res.setHeader('Access-Control-Max-Age', '600');
  return true;
}

/** Optional shared secret. Absent from the config means every local caller is trusted. */
function authorized(req) {
  if (!config.token) return true;
  const header = req.headers.authorization ?? '';
  return header === `Bearer ${config.token}`;
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new TransportError('invalid-payload', 'Print payload is too large.');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new TransportError('invalid-payload', 'Print payload is not valid JSON.');
  }
}

/**
 * The base64 payload as bytes, validated.
 *
 * `Buffer.from(x, 'base64')` never throws — it silently skips anything outside
 * the alphabet — so a corrupted payload would otherwise reach the printer as a
 * shorter, subtly wrong byte stream. Re-encoding and comparing is the cheap way
 * to know the input was actually base64 and arrived whole.
 */
function decodePayload(dataBase64) {
  if (typeof dataBase64 !== 'string' || dataBase64.length === 0) {
    throw new TransportError('invalid-payload', 'Print payload is missing.');
  }
  const bytes = Buffer.from(dataBase64, 'base64');
  if (bytes.length === 0) throw new TransportError('invalid-payload', 'Print payload is empty.');
  if (bytes.toString('base64').replace(/=+$/, '') !== dataBase64.replace(/=+$/, '')) {
    throw new TransportError('invalid-payload', 'Print payload is not valid base64.');
  }
  return bytes;
}

const server = createServer(async (req, res) => {
  const started = Date.now();
  const url = new URL(req.url ?? '/', `http://${HOST}:${port}`);

  if (!applyCors(req, res)) return;
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    // Health is deliberately unauthenticated: it is what the app polls to draw
    // "POS Printer Connected", and it reports nothing a caller could not learn by
    // failing to connect. It carries no printer names.
    if (req.method === 'GET' && url.pathname === '/v1/health') {
      return json(res, 200, {
        ok: true,
        agent: AGENT,
        version: VERSION,
        platform: process.platform,
        requiresToken: Boolean(config.token),
      });
    }

    if (!authorized(req)) {
      return json(res, 401, { ok: false, code: 'permission-denied', message: 'The print agent rejected this request.' });
    }

    if (req.method === 'GET' && url.pathname === '/v1/printers') {
      const printers = await listPrinters(config);
      return json(res, 200, { ok: true, printers });
    }

    if (req.method === 'POST' && url.pathname === '/v1/print') {
      const body = await readBody(req);
      const printJobId = typeof body.printJobId === 'string' && body.printJobId ? body.printJobId : randomUUID();

      const seen = RECENT_JOBS.get(printJobId);
      if (seen) {
        // Not an error: the caller asked for a job that already happened, and the
        // honest answer is what happened, flagged so the app can tell the two apart.
        return json(res, 200, { ...seen.result, duplicate: true });
      }

      const bytes = decodePayload(body.dataBase64);
      const printers = await listPrinters(config);
      if (printers.length === 0) {
        return json(res, 503, { ok: false, printJobId, code: 'no-printer', message: 'This computer has no printers installed.' });
      }

      const printer = findPrinter(printers, body.printerId);
      if (!printer) {
        return json(res, 404, {
          ok: false,
          printJobId,
          code: 'printer-not-found',
          message: `No printer called "${body.printerId}" on this computer.`,
        });
      }

      const docName = typeof body.documentType === 'string' && body.documentType
        ? `Mountain Bakes ${body.documentType}${body.documentId ? ` ${body.documentId}` : ''}`
        : 'Mountain Bakes receipt';

      await sendToPrinter(printer, bytes, docName);

      const result = {
        ok: true,
        printJobId,
        printerId: printer.id,
        printerName: printer.name,
        bytes: bytes.length,
        durationMs: Date.now() - started,
      };
      rememberJob(printJobId, result);
      if (config.verbose) {
        console.log(`[print] ${docName} → ${printer.name} (${bytes.length} bytes, ${result.durationMs}ms)`);
      }
      return json(res, 200, result);
    }

    return json(res, 404, { ok: false, code: 'not-found', message: 'No such endpoint.' });
  } catch (error) {
    const code = error instanceof TransportError ? error.code : 'agent-error';
    const status = code === 'invalid-payload' ? 400
      : code === 'printer-not-found' ? 404
      : code === 'permission-denied' ? 403
      : code === 'timeout' ? 504
      : 502;
    // The detail is for the agent's own console and the app's debug panel. The
    // `message` is the sentence a cashier sees, and it never carries a stack.
    if (config.verbose) console.error(`[print:error] ${code}: ${error.message}`, error.detail ?? '');
    return json(res, status, {
      ok: false,
      code,
      message: error instanceof TransportError ? error.message : 'The print agent hit an unexpected error.',
      detail: error instanceof TransportError ? error.detail : undefined,
    });
  }
});

server.listen(port, HOST, () => {
  console.log(`${AGENT} ${VERSION} listening on http://${HOST}:${port}`);
  console.log(`config: ${config.configPath ?? '(defaults — no print-agent.config.json found)'}`);
  console.log(`allowed origins: ${config.allowedOrigins.join(', ')}`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use — is the agent already running?`);
    process.exit(1);
  }
  throw error;
});
