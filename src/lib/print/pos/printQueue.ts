'use client';

import { PosPrintError, asPrintError, type PrintErrorCode } from './errors';
import type { PrintDocumentType } from './printLog';
import { printDebugEnabled, printTrace } from '../diagnostics';

/**
 * The POS print queue.
 *
 * ---------------------------------------------------------------------------
 * Why a queue, when the browser is the printer driver
 * ---------------------------------------------------------------------------
 * The bytes leave the browser itself (WebUSB / Web Serial / an iframe handed to
 * the installed driver), so there is no server to spool on — and nothing here
 * ever should: a receipt spooled on a server would still have to come back to
 * this very tab to reach a printer only this tab can open. The queue therefore
 * lives in the page, and it exists for three reasons that a plain `await
 * transport.send()` in a click handler cannot give:
 *
 * 1. **One job on the wire per printer.** Two documents sent at once — Save &
 *    Print from the sale form while a reprint is running from the table — used
 *    to race straight into `transferOut`, interleaving their chunks on the same
 *    bulk endpoint. Each printer is a *lane* here, and a lane drains one job at
 *    a time; a second request waits its turn rather than corrupting the first.
 * 2. **One job per document while it is in flight.** A double-press, or two
 *    buttons aimed at one sale, collapse onto the same job — both callers get
 *    the same promise and the same result. There is no "duplicate" error to
 *    show anyone any more, because nothing duplicate was made. A deliberate
 *    reprint after the first finished is a new job, as it always was.
 * 3. **The press returns immediately.** `enqueue` does no work of its own: it
 *    records the request and yields to the event loop before the lane starts
 *    composing, so the button repaints as *Printing…* before a byte is built.
 *    Composing a 100-line demand is under two milliseconds (measured), so
 *    nothing here needs a worker thread — what needed fixing was the ordering
 *    and the contention, not the CPU.
 *
 * ---------------------------------------------------------------------------
 * What a job's life looks like
 * ---------------------------------------------------------------------------
 *   queued → printing → printed
 *                    ↘ failed        (after the retry budget, or a fault that
 *                                     retrying cannot fix)
 *   queued → cancelled                (only before it started)
 *
 * Every transition is pushed to the job's subscribers, and every lane change
 * re-numbers the queued jobs behind it so a button can say "2 ahead". Timings
 * are collected per job — queue wait, compose, connect, send, total, attempts —
 * and written to the console in development so a slow print can be attributed
 * to the right stage instead of guessed at.
 *
 * ---------------------------------------------------------------------------
 * What is deliberately NOT here
 * ---------------------------------------------------------------------------
 * The transport, the document and the printer config. This module knows how to
 * order and observe work; `printerService` knows what the work is. The retry and
 * timeout helpers at the bottom are exported for it to compose with, rather than
 * baked into the lane, so that the *system* transport — whose "send" is a print
 * dialog a person is looking at — can opt out of both.
 */

/* ────────────────────────────────────────────────────────────────────────────
   Types
   ──────────────────────────────────────────────────────────────────────────── */

export type PrintJobState = 'queued' | 'printing' | 'printed' | 'failed' | 'cancelled';

export interface PrintJobTimings {
  /** Epoch ms at `enqueue`. */
  createdAt: number;
  /** Epoch ms when the lane picked it up. */
  startedAt?: number;
  /** Epoch ms when it settled, whichever way. */
  finishedAt?: number;
  /** `startedAt - createdAt`. */
  queueWaitMs?: number;
  /** Validate + compose + ESC/POS render. */
  composeMs?: number;
  /** Opening the device (or proving it open). Last attempt's figure. */
  connectMs?: number;
  /** The write itself. Last attempt's figure. */
  sendMs?: number;
  /** `finishedAt - createdAt`. */
  totalMs?: number;
  /** How many times the send was tried. */
  attempts: number;
}

export interface PrintJobFailure {
  code: PrintErrorCode;
  message: string;
}

export interface PrintJobSnapshot<Result = unknown> {
  jobId: string;
  /** Idempotency key: the document, so a second press finds the first job. */
  key: string;
  /** Which lane — one per physical printer. */
  printerKey: string;
  documentType: PrintDocumentType;
  documentId: string | null;
  state: PrintJobState;
  /** Jobs ahead of this one in its lane. `0` while printing or once settled. */
  position: number;
  /** 1-based; increments on each retry. */
  attempt: number;
  timings: PrintJobTimings;
  error?: PrintJobFailure;
  result?: Result;
}

/** What the job's own code can report back while it runs. */
export interface PrintJobReporter {
  /** The queue's id for this job — the one the log entry and the console line share. */
  readonly jobId: string;
  /** The figures so far, for the log entry written when the job settles. */
  timings(): PrintJobTimings;
  /** Compose finished; the figure is written into the timings. */
  composed(ms: number): void;
  /** A connect attempt finished (success or not). */
  connected(ms: number): void;
  /** A send attempt finished (success or not). */
  sent(ms: number): void;
  /** Starting attempt `n` (1-based). */
  attempt(n: number): void;
  /** `true` once the job was cancelled — long-running work should check it. */
  readonly cancelled: boolean;
}

export interface EnqueueArgs<Result> {
  key: string;
  printerKey: string;
  documentType: PrintDocumentType;
  documentId: string | null;
  /** The work. Throw a `PosPrintError` to fail; anything else is wrapped as `print-failed`. */
  run: (reporter: PrintJobReporter) => Promise<Result>;
  /** Optional per-caller observer, in addition to `subscribeToPrintJob`. */
  onUpdate?: (snapshot: PrintJobSnapshot<Result>) => void;
}

export interface EnqueueResult<Result> {
  jobId: string;
  /** Settles with the job — resolves on `printed`, rejects with `PosPrintError` otherwise. */
  promise: Promise<Result>;
  /** `true` when an in-flight job for the same key was returned instead of a new one. */
  deduplicated: boolean;
}

/* ────────────────────────────────────────────────────────────────────────────
   State
   ──────────────────────────────────────────────────────────────────────────── */

type Listener = (snapshot: PrintJobSnapshot) => void;

interface JobRecord {
  snapshot: PrintJobSnapshot;
  run: (reporter: PrintJobReporter) => Promise<unknown>;
  listeners: Set<Listener>;
  resolve: (value: unknown) => void;
  reject: (error: PosPrintError) => void;
  promise: Promise<unknown>;
  cancelled: boolean;
}

/** Every job that has not settled, by id. Settled jobs stay briefly for late readers. */
const JOBS = new Map<string, JobRecord>();
/** In-flight job per idempotency key. */
const BY_KEY = new Map<string, JobRecord>();
/** Waiting jobs per lane, in order. The printing job is NOT in this list. */
const LANES = new Map<string, JobRecord[]>();
/** Lanes with a drain loop running. */
const DRAINING = new Set<string>();
/** The job on the wire per lane — counted as "one ahead" by everything queued behind it. */
const PRINTING = new Map<string, JobRecord>();
/** Whoever wants to know when any job changes (the status pill, diagnostics). */
const QUEUE_LISTENERS = new Set<() => void>();

/** How long a settled snapshot stays readable after the fact. */
const SETTLED_TTL_MS = 30_000;

/* ────────────────────────────────────────────────────────────────────────────
   Public API
   ──────────────────────────────────────────────────────────────────────────── */

export function enqueue<Result>(args: EnqueueArgs<Result>): EnqueueResult<Result> {
  const existing = BY_KEY.get(args.key);
  if (existing) {
    // A second press while the first is queued or printing. Not an error: the
    // person wanted this document printed and it is being printed. Their
    // observer joins the existing job so their button follows it too.
    if (args.onUpdate) {
      existing.listeners.add(args.onUpdate as Listener);
      args.onUpdate(existing.snapshot as PrintJobSnapshot<Result>);
    }
    return { jobId: existing.snapshot.jobId, promise: existing.promise as Promise<Result>, deduplicated: true };
  }

  const jobId = newJobId();
  let resolve!: (value: unknown) => void;
  let reject!: (error: PosPrintError) => void;
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // A job nobody awaits must not surface as an unhandled rejection — the
  // subscribers already carry the failure.
  promise.catch(() => {});

  const record: JobRecord = {
    snapshot: {
      jobId,
      key: args.key,
      printerKey: args.printerKey,
      documentType: args.documentType,
      documentId: args.documentId,
      state: 'queued',
      position: 0,
      attempt: 0,
      timings: { createdAt: Date.now(), attempts: 0 },
    },
    run: args.run as JobRecord['run'],
    listeners: new Set(args.onUpdate ? [args.onUpdate as Listener] : []),
    resolve,
    reject,
    promise,
    cancelled: false,
  };

  JOBS.set(jobId, record);
  BY_KEY.set(args.key, record);
  const lane = LANES.get(args.printerKey) ?? [];
  lane.push(record);
  LANES.set(args.printerKey, lane);
  renumber(args.printerKey);
  emit(record);

  void drain(args.printerKey);

  return { jobId, promise: promise as Promise<Result>, deduplicated: false };
}

/** The current snapshot, or `null` once it has been forgotten. */
export function printJobSnapshot(jobId: string): PrintJobSnapshot | null {
  return JOBS.get(jobId)?.snapshot ?? null;
}

/** Follow one job. The callback fires immediately with the current state. */
export function subscribeToPrintJob(jobId: string, listener: Listener): () => void {
  const record = JOBS.get(jobId);
  if (!record) return () => {};
  record.listeners.add(listener);
  listener(record.snapshot);
  return () => {
    record.listeners.delete(listener);
  };
}

/** Fires on any change to any job — for the status pill. */
export function subscribeToPrintQueue(listener: () => void): () => void {
  QUEUE_LISTENERS.add(listener);
  return () => {
    QUEUE_LISTENERS.delete(listener);
  };
}

/** Jobs queued or printing right now, on every lane. */
export function activePrintJobs(): PrintJobSnapshot[] {
  const out: PrintJobSnapshot[] = [];
  for (const record of JOBS.values()) {
    if (record.snapshot.state === 'queued' || record.snapshot.state === 'printing') out.push(record.snapshot);
  }
  return out;
}

/** `true` while any lane has a job on the wire. */
export function isPrinting(): boolean {
  for (const record of JOBS.values()) {
    if (record.snapshot.state === 'printing') return true;
  }
  return false;
}

/**
 * Withdraw a job that has not started. A job already on the wire cannot be
 * cancelled — half a receipt is not a smaller receipt — so this returns `false`
 * for it and the caller waits for it to settle.
 */
export function cancelPrintJob(jobId: string): boolean {
  const record = JOBS.get(jobId);
  if (!record || record.snapshot.state !== 'queued') return false;
  const lane = LANES.get(record.snapshot.printerKey);
  if (lane) {
    const index = lane.indexOf(record);
    if (index >= 0) lane.splice(index, 1);
  }
  record.cancelled = true;
  settle(record, 'cancelled', {
    error: { code: 'cancelled', message: 'Printing was cancelled before it started.' },
  });
  renumber(record.snapshot.printerKey);
  return true;
}

/* ────────────────────────────────────────────────────────────────────────────
   The lane
   ──────────────────────────────────────────────────────────────────────────── */

async function drain(printerKey: string): Promise<void> {
  if (DRAINING.has(printerKey)) return;
  DRAINING.add(printerKey);
  try {
    for (;;) {
      const lane = LANES.get(printerKey);
      const record = lane?.shift();
      if (!record) break;
      PRINTING.set(printerKey, record);
      renumber(printerKey);

      // Let the press's own render commit before any work starts. This is the
      // whole of what makes "the button returns immediately" true: the click
      // handler has already returned by the time this resumes.
      await yieldToEventLoop();
      if (record.cancelled) {
        PRINTING.delete(printerKey);
        renumber(printerKey);
        continue;
      }

      const startedAt = Date.now();
      patch(record, {
        state: 'printing',
        position: 0,
        timings: { ...record.snapshot.timings, startedAt, queueWaitMs: startedAt - record.snapshot.timings.createdAt },
      });

      const reporter: PrintJobReporter = {
        jobId: record.snapshot.jobId,
        timings: () => record.snapshot.timings,
        composed: (ms) => patch(record, { timings: { ...record.snapshot.timings, composeMs: round(ms) } }),
        connected: (ms) => patch(record, { timings: { ...record.snapshot.timings, connectMs: round(ms) } }),
        sent: (ms) => patch(record, { timings: { ...record.snapshot.timings, sendMs: round(ms) } }),
        attempt: (n) => patch(record, { attempt: n, timings: { ...record.snapshot.timings, attempts: n } }),
        get cancelled() {
          return record.cancelled;
        },
      };

      try {
        const result = await record.run(reporter);
        settle(record, 'printed', { result });
      } catch (error) {
        const failure = asPrintError(error, 'print-failed');
        settle(record, 'failed', { error: { code: failure.code, message: failure.message } }, failure);
      } finally {
        if (PRINTING.get(printerKey) === record) PRINTING.delete(printerKey);
        renumber(printerKey);
      }
    }
  } finally {
    DRAINING.delete(printerKey);
    // A job enqueued during the last iteration's `await` lands in a lane whose
    // drain has just decided it is empty. Look once more rather than leave it.
    if ((LANES.get(printerKey)?.length ?? 0) > 0) void drain(printerKey);
  }
}

function settle(
  record: JobRecord,
  state: 'printed' | 'failed' | 'cancelled',
  fields: { result?: unknown; error?: PrintJobFailure },
  rejection?: PosPrintError,
): void {
  const finishedAt = Date.now();
  patch(record, {
    state,
    position: 0,
    ...fields,
    timings: { ...record.snapshot.timings, finishedAt, totalMs: finishedAt - record.snapshot.timings.createdAt },
  });
  BY_KEY.delete(record.snapshot.key);
  if (state === 'printed') record.resolve(fields.result);
  else record.reject(rejection ?? new PosPrintError(fields.error?.code ?? 'print-failed', fields.error?.message ?? 'Unable to print.'));

  logTimings(record.snapshot);

  // Keep the snapshot readable for a while — a button that mounted late, or the
  // debug panel — then forget it so a busy till does not accumulate a day of jobs.
  setTimeout(() => {
    if (JOBS.get(record.snapshot.jobId) === record) JOBS.delete(record.snapshot.jobId);
  }, SETTLED_TTL_MS);
}

function renumber(printerKey: string): void {
  const lane = LANES.get(printerKey);
  if (!lane) return;
  const ahead = PRINTING.has(printerKey) ? 1 : 0;
  lane.forEach((record, index) => {
    const position = index + ahead;
    if (record.snapshot.position !== position) patch(record, { position });
  });
}

function patch(record: JobRecord, fields: Partial<PrintJobSnapshot>): void {
  const before = record.snapshot.state;
  record.snapshot = { ...record.snapshot, ...fields };
  if (fields.state && fields.state !== before) printTrace(`job ${fields.state}`, { jobId: record.snapshot.jobId, attempt: record.snapshot.attempt });
  emit(record);
}

function emit(record: JobRecord): void {
  for (const listener of record.listeners) {
    try {
      listener(record.snapshot);
    } catch {
      /* One observer's fault must not stop the others hearing. */
    }
  }
  for (const listener of QUEUE_LISTENERS) {
    try {
      listener();
    } catch {
      /* same */
    }
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   Helpers for the job body — composed by printerService
   ──────────────────────────────────────────────────────────────────────────── */

/** Give the browser one turn — paint, run the pending click's render, breathe. */
export function yieldToEventLoop(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
  if (scheduler && typeof scheduler.yield === 'function') return scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Race a promise against a deadline. The rejection is a `PosPrintError` carrying
 * `timeout`, worded by the caller for its stage — "the printer did not answer"
 * reads differently from "the receipt never finished sending".
 */
export async function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new PosPrintError('timeout', message)), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface RetryPolicy {
  /** Total tries, including the first. */
  maxAttempts: number;
  /** Pause before attempt 2, 3, … — the last figure repeats if it runs short. */
  delaysMs: readonly number[];
  /** Is this fault worth another go? */
  shouldRetry: (error: PosPrintError) => boolean;
}

/**
 * Bounded retries with a growing pause between them. Never more than
 * `maxAttempts`, never on a fault the policy rules out, never once the job was
 * cancelled — and the pause is a timer, not a loop, so the tab stays responsive
 * while the printer is given its moment.
 */
export async function withRetries<T>(
  attempt: (n: number) => Promise<T>,
  policy: RetryPolicy,
  reporter: Pick<PrintJobReporter, 'attempt' | 'cancelled'>,
): Promise<T> {
  let last: PosPrintError | null = null;
  for (let n = 1; n <= Math.max(1, policy.maxAttempts); n++) {
    if (reporter.cancelled) throw new PosPrintError('cancelled', 'Printing was cancelled.');
    reporter.attempt(n);
    try {
      return await attempt(n);
    } catch (error) {
      last = asPrintError(error, 'print-failed');
      if (n >= policy.maxAttempts || !policy.shouldRetry(last)) throw last;
      const delay = policy.delaysMs[Math.min(n - 1, policy.delaysMs.length - 1)] ?? 0;
      await sleep(delay);
    }
  }
  throw last ?? new PosPrintError('print-failed', 'Unable to print.');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ────────────────────────────────────────────────────────────────────────────
   Diagnostics
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * One line per settled job in development, with every stage's figure, so "the
 * printer is slow" can be answered with *which part*. Silent in production: the
 * same numbers go into the on-device print log entry, which is where a POS
 * complaint is diagnosed from.
 */
function logTimings(snapshot: PrintJobSnapshot): void {
  if (!printDebugEnabled()) return;
  const t = snapshot.timings;
  const stages = [
    `queue ${fmt(t.queueWaitMs)}`,
    `compose ${fmt(t.composeMs)}`,
    `connect ${fmt(t.connectMs)}`,
    `send ${fmt(t.sendMs)}`,
    `total ${fmt(t.totalMs)}`,
    `attempts ${t.attempts}`,
  ].join(' · ');
  const label = `[print] ${snapshot.documentType}${snapshot.documentId ? ` ${snapshot.documentId}` : ''} → ${snapshot.state}`;
  if (snapshot.state === 'failed') console.warn(`${label} (${snapshot.error?.code}): ${stages}`);
  else console.debug(`${label}: ${stages}`);

  if (typeof performance !== 'undefined' && typeof performance.measure === 'function' && t.finishedAt) {
    try {
      performance.measure(`print:${snapshot.documentType}`, { start: t.createdAt, end: t.finishedAt });
    } catch {
      /* Older browsers take a mark name, not options. Not worth a polyfill. */
    }
  }
}

function fmt(ms: number | undefined): string {
  return ms === undefined ? '—' : `${Math.round(ms)}ms`;
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

/**
 * A fresh id per job. `crypto.randomUUID` needs a secure context, which the
 * deployed app has and a plain-HTTP dev host on a LAN IP does not.
 */
function newJobId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
