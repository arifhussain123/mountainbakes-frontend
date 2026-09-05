'use client';

/**
 * Print diagnostics — the answer to "the page hangs after printing", in numbers.
 *
 * ---------------------------------------------------------------------------
 * What it produces
 * ---------------------------------------------------------------------------
 * Every print, on either path, writes a trace to the console:
 *
 *   [PRINT] ▶ document-print
 *   [PRINT] +0ms      button pressed
 *   [PRINT] +3ms      print DOM mounted
 *   [PRINT] +41ms     print area ready            {images: 1}
 *   [PRINT] +42ms     window.print() called
 *   [PRINT] +6120ms   window.print() returned      ← the dialog was open this long
 *   [PRINT] +6121ms   afterprint
 *   [PRINT] +6125ms   dialog closed
 *   [PRINT] ■ watchdog 30s: long tasks 2 (total 310ms, max 290ms) · worst
 *           scheduler gap 6080ms at +42ms · API requests 3 · DOM 4120→4118
 *           nodes · iframes 0 · heap 61MB→62MB
 *
 * and, for the thirty seconds after the press, a line for every main-thread
 * stall longer than a frame or two — with the stage it happened in and, where
 * the browser reports it, what script was running. That is what tells a page
 * freeze apart from a printer-driver freeze: a page freeze shows up as long
 * tasks attributed to this origin *after* `window.print()` returned; a driver
 * freeze shows up as nothing at all here while the whole browser is sluggish.
 *
 * ---------------------------------------------------------------------------
 * How to switch it on, on a till
 * ---------------------------------------------------------------------------
 * Printer Settings → *Show print diagnostics*, or `?printDebug=1` on any URL,
 * or `localStorage.setItem('mb.printDebug', '1')`. Development builds have it
 * on. It costs nothing while off: every entry point checks the flag first.
 */

const STORAGE_KEY = 'mb.printDebug';
const WATCHDOG_MS = 30_000;
/** A scheduler gap this long is a stall worth a line of its own. */
const GAP_REPORT_MS = 120;
const TICK_MS = 50;

let forced: boolean | null = null;

export function printDebugEnabled(): boolean {
  if (forced !== null) return forced;
  if (typeof window === 'undefined') return false;
  try {
    if (new URLSearchParams(window.location.search).get('printDebug') === '1') {
      localStorage.setItem(STORAGE_KEY, '1');
    }
    if (localStorage.getItem(STORAGE_KEY) === '1') return true;
  } catch {
    /* storage off — fall through to the build default */
  }
  return process.env.NODE_ENV !== 'production';
}

export function setPrintDebug(on: boolean): void {
  forced = on;
  try {
    if (on) localStorage.setItem(STORAGE_KEY, '1');
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* forced flag still applies for this session */
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   The trace
   ──────────────────────────────────────────────────────────────────────────── */

let traceStart = 0;
let traceLabel = '';
let lastStage = '(idle)';

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** Start (or restart) a trace. Arms the watchdog for the next thirty seconds. */
export function beginPrintTrace(label: string): void {
  if (!printDebugEnabled()) return;
  traceStart = now();
  traceLabel = label;
  lastStage = 'begin';
  console.info(`[PRINT] ▶ ${label}`);
  armWatchdog();
}

/** One stage, with the offset from the trace's start. */
export function printTrace(stage: string, detail?: Record<string, unknown>): void {
  if (!printDebugEnabled()) return;
  if (!traceStart) beginPrintTrace('print');
  lastStage = stage;
  const offset = `+${Math.round(now() - traceStart)}ms`.padEnd(10);
  if (detail && Object.keys(detail).length > 0) console.info(`[PRINT] ${offset} ${stage}`, detail);
  else console.info(`[PRINT] ${offset} ${stage}`);
}

/* ────────────────────────────────────────────────────────────────────────────
   The watchdog
   ──────────────────────────────────────────────────────────────────────────── */

interface Watch {
  startedAt: number;
  endsAt: number;
  longTasks: number;
  longTaskTotal: number;
  longTaskMax: number;
  worstGap: number;
  worstGapAt: string;
  apiRequests: number;
  nodesBefore: number;
  heapBefore: number | null;
  observer: PerformanceObserver | null;
  resources: PerformanceObserver | null;
  timer: ReturnType<typeof setInterval> | null;
  lastTick: number;
  afterprints: number;
}

let watch: Watch | null = null;
let afterprintHooked = false;

function nodeCount(): number {
  return typeof document !== 'undefined' ? document.getElementsByTagName('*').length : 0;
}

function heapMb(): number | null {
  const memory = (performance as { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? Math.round(memory.usedJSHeapSize / 1_048_576) : null;
}

function armWatchdog(): void {
  if (typeof window === 'undefined') return;
  if (watch) {
    // A second print inside the window extends it rather than resetting the
    // counters — the question is "what happened after the press", plural.
    watch.endsAt = now() + WATCHDOG_MS;
    return;
  }
  if (!afterprintHooked) {
    afterprintHooked = true;
    window.addEventListener('afterprint', () => {
      if (watch) watch.afterprints += 1;
      printTrace('afterprint (window)');
    });
    window.addEventListener('beforeprint', () => printTrace('beforeprint (window)'));
  }

  const started = now();
  const current: Watch = {
    startedAt: started,
    endsAt: started + WATCHDOG_MS,
    longTasks: 0,
    longTaskTotal: 0,
    longTaskMax: 0,
    worstGap: 0,
    worstGapAt: '',
    apiRequests: 0,
    nodesBefore: nodeCount(),
    heapBefore: heapMb(),
    observer: null,
    resources: null,
    timer: null,
    lastTick: started,
    afterprints: 0,
  };
  watch = current;

  if (typeof PerformanceObserver !== 'undefined') {
    try {
      current.observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          current.longTasks += 1;
          current.longTaskTotal += entry.duration;
          current.longTaskMax = Math.max(current.longTaskMax, entry.duration);
          const attribution = (entry as PerformanceEntry & { attribution?: { containerType?: string; containerSrc?: string; name?: string }[] }).attribution ?? [];
          const who = attribution
            .map((a) => [a.containerType, a.containerSrc, a.name].filter(Boolean).join(' '))
            .filter(Boolean)
            .join(', ');
          console.warn(
            `[PRINT] long task ${Math.round(entry.duration)}ms at +${Math.round(entry.startTime - traceStart)}ms during "${lastStage}"${who ? ` (${who})` : ''}`,
          );
        }
      });
      current.observer.observe({ type: 'longtask', buffered: false });
    } catch {
      current.observer = null;
    }
    try {
      current.resources = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name.includes('/api/')) {
            current.apiRequests += 1;
            console.info(`[PRINT] api ${Math.round(entry.duration)}ms ${entry.name.replace(/^https?:\/\/[^/]+/, '')}`);
          }
        }
      });
      current.resources.observe({ type: 'resource', buffered: false });
    } catch {
      current.resources = null;
    }
  }

  // The scheduler-gap meter. A 50ms interval that fires 6 seconds late was
  // blocked for 6 seconds — by a print dialog, a long task, or a driver — and
  // this is the one measurement that catches all three, attribution or not.
  current.timer = setInterval(() => {
    const t = now();
    const gap = t - current.lastTick - TICK_MS;
    current.lastTick = t;
    if (gap > current.worstGap) {
      current.worstGap = gap;
      current.worstGapAt = `+${Math.round(t - gap - traceStart)}ms during "${lastStage}"`;
    }
    if (gap > GAP_REPORT_MS) {
      console.warn(`[PRINT] main thread blocked ~${Math.round(gap)}ms, ending at +${Math.round(t - traceStart)}ms (stage "${lastStage}")`);
    }
    if (t >= current.endsAt) disarmWatchdog();
  }, TICK_MS);
}

function disarmWatchdog(): void {
  const current = watch;
  if (!current) return;
  watch = null;
  if (current.timer) clearInterval(current.timer);
  current.observer?.disconnect();
  current.resources?.disconnect();

  const iframes = typeof document !== 'undefined' ? document.getElementsByTagName('iframe').length : 0;
  const printAreas = typeof document !== 'undefined' ? document.querySelectorAll('.print-area').length : 0;
  const heapAfter = heapMb();
  const heap = current.heapBefore !== null && heapAfter !== null ? ` · heap ${current.heapBefore}MB→${heapAfter}MB` : '';
  console.info(
    `[PRINT] ■ ${traceLabel} watchdog ${Math.round(WATCHDOG_MS / 1000)}s: long tasks ${current.longTasks} (total ${Math.round(current.longTaskTotal)}ms, max ${Math.round(current.longTaskMax)}ms) · worst scheduler gap ${Math.round(current.worstGap)}ms${current.worstGapAt ? ` at ${current.worstGapAt}` : ''} · API requests ${current.apiRequests} · afterprint ×${current.afterprints} · DOM ${current.nodesBefore}→${nodeCount()} nodes · iframes ${iframes} · print areas mounted ${printAreas}${heap}`,
  );
  traceStart = 0;
  lastStage = '(idle)';
}
