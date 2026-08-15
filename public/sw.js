/*
 * Mountain Bakes ERP — service worker
 * ------------------------------------
 * Responsibilities:
 *   1. Precache the offline app shell (offline page, logo, icons, manifest).
 *   2. Runtime caching: cache-first for immutable build assets & media,
 *      network-first for navigations & other GETs (offline.html fallback).
 *   3. Background Sync: queue opt-in mutations made while offline and replay
 *      them automatically when connectivity returns.
 */

const VERSION = 'v2';
const PRECACHE = `mb-precache-${VERSION}`;
const RUNTIME = `mb-runtime-${VERSION}`;
const OFFLINE_URL = '/offline.html';

// App shell — everything needed to render a friendly offline experience.
const PRECACHE_URLS = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
  '/assets/images/logo/logo.svg',
  '/assets/images/logo/logo.png',
];

// ── Install ────────────────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE);
      // Cache each URL independently so one 404 can't abort the whole install.
      await Promise.allSettled(
        PRECACHE_URLS.map((url) => cache.add(new Request(url, { cache: 'reload' }))),
      );
      // NO skipWaiting() here, deliberately.
      //
      // Activating on install makes this worker seize control the moment it
      // downloads, which fires `controllerchange` in every open tab and reloads
      // them — potentially over a half-typed sale. The new worker now waits, and
      // the page decides when to take it: the client posts SKIP_WAITING once it
      // has established that nobody is mid-entry (hooks/useAppRefresh.tsx).
    })(),
  );
});

// ── Activate ───────────────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop caches from previous versions.
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k.startsWith('mb-') && ![PRECACHE, RUNTIME].includes(k))
          .map((k) => caches.delete(k)),
      );
      // Enable navigation preload where supported (faster first paint).
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable();
      }
      await self.clients.claim();
    })(),
  );
});

// ── Fetch ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Non-GET: try the network, and queue for Background Sync if it's an
  // opt-in mutation (header `X-Background-Sync: true`) that fails offline.
  if (request.method !== 'GET') {
    if (request.headers.get('X-Background-Sync') === 'true') {
      event.respondWith(networkOrQueue(request));
    }
    return; // otherwise let the browser handle it normally
  }

  // Only manage same-origin GETs; let cross-origin (API, gstatic) pass.
  if (url.origin !== self.location.origin) return;

  // Navigations → network-first, fall back to cache then the offline page.
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigate(event));
    return;
  }

  // Immutable Next.js build output → cache-first (hashed filenames).
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // Static media & fonts → stale-while-revalidate.
  if (/\.(?:png|jpg|jpeg|svg|gif|webp|avif|ico|woff2?|ttf|otf|css)$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Everything else same-origin → network-first with cache fallback.
  event.respondWith(networkFirst(request));
});

// ── Caching strategies ───────────────────────────────────────────────────
async function handleNavigate(event) {
  const request = event.request;
  try {
    const preload = await event.preloadResponse;
    if (preload) return preload;
    const network = await fetch(request);
    return network;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return (await caches.match(OFFLINE_URL)) || Response.error();
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(RUNTIME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(RUNTIME);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached || (await network) || Response.error();
}

async function networkFirst(request) {
  const cache = await caches.open(RUNTIME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    return Response.error();
  }
}

// ── Background Sync ────────────────────────────────────────────────────────
// Requests tagged `X-Background-Sync: true` that fail while offline are stored
// in IndexedDB and replayed on the browser's `sync` event (or when the client
// asks us to flush via postMessage).
const SYNC_TAG = 'mb-sync-queue';
const DB_NAME = 'mb-pwa';
const STORE = 'sync-queue';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idb(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        const result = fn(store);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error);
      }),
  );
}

async function queueRequest(request) {
  const body = await request.clone().arrayBuffer();
  const entry = {
    url: request.url,
    method: request.method,
    headers: [...request.headers].filter(([k]) => k.toLowerCase() !== 'x-background-sync'),
    body: body.byteLength ? body : null,
    queuedAt: new Date().toISOString(),
  };
  await idb('readwrite', (store) => store.add(entry));
  if ('sync' in self.registration) {
    try {
      await self.registration.sync.register(SYNC_TAG);
    } catch {
      /* Background Sync unavailable — flushed on next online event instead */
    }
  }
}

async function networkOrQueue(request) {
  try {
    return await fetch(request.clone());
  } catch {
    await queueRequest(request);
    // Tell the app the request was accepted and will be retried.
    return new Response(
      JSON.stringify({ queued: true, offline: true }),
      { status: 202, headers: { 'Content-Type': 'application/json' } },
    );
  }
}

async function replayQueue() {
  const entries = await idb('readonly', (store) => {
    const out = [];
    store.openCursor().onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        out.push({ ...cursor.value, id: cursor.key });
        cursor.continue();
      }
    };
    return out;
  });

  for (const entry of entries) {
    try {
      const res = await fetch(entry.url, {
        method: entry.method,
        headers: entry.headers,
        body: entry.body,
      });
      if (res.ok || (res.status >= 400 && res.status < 500)) {
        // Success, or a client error that won't fix itself — drop it.
        await idb('readwrite', (store) => store.delete(entry.id));
      }
    } catch {
      // Still offline — stop and retry on the next sync.
      break;
    }
  }
  await broadcast({ type: 'SYNC_COMPLETE' });
}

async function broadcast(message) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const client of clients) client.postMessage(message);
}

self.addEventListener('sync', (event) => {
  if (event.tag === SYNC_TAG) event.waitUntil(replayQueue());
});

// Client-driven controls (skip-waiting on update, manual queue flush).
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'FLUSH_QUEUE') event.waitUntil(replayQueue());
});
