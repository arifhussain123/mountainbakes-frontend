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

// Bumped whenever the caching rules change, which drops the previous caches on
// activate. v3: navigations are cached, so offline actually reaches the app.
// v4: purge. Asset URLs now carry `?dpl=<buildId>` (next.config.ts), so a release
// can no longer serve a client a stale chunk it happens to be holding — but the
// entries cached under the OLD, unkeyed URLs would otherwise sit here forever.
// Bumping the version is what actually evicts them.
const VERSION = 'v4';
const PRECACHE = `mb-precache-${VERSION}`;
const RUNTIME = `mb-runtime-${VERSION}`;
const OFFLINE_URL = '/offline.html';

// App shell — everything needed to render a friendly offline experience.
const PRECACHE_URLS = [
  OFFLINE_URL,
  // The two entry points, fetched at install so the app opens offline even on a
  // device that has never navigated to them. Every other screen is cached as it
  // is visited (see handleNavigate). Trailing slashes are required —
  // `trailingSlash: true` means the export serves out/login/index.html at
  // '/login/', and '/login' would 308 rather than cache.
  '/',
  '/login/',
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
/**
 * Navigations: network-first, and the response is KEPT.
 *
 * It previously returned the network response without ever caching it, so the
 * fallback below had nothing to find — `caches.match` on a navigation could only
 * ever miss, and every offline page load, the login screen included, landed on
 * offline.html. The app could not be opened offline at all, which also put the
 * restored data cache out of reach: no document, no app to hydrate.
 *
 * Storing each visited page's HTML means any screen reached while online opens
 * again without a connection. The shells are a couple of KB each; the hashed
 * bundles they pull in are already cached by the `_next/static` rule.
 */
async function handleNavigate(event) {
  const request = event.request;
  const cache = await caches.open(RUNTIME);
  try {
    const preload = await event.preloadResponse;
    if (preload) {
      if (preload.ok) event.waitUntil(cache.put(request, preload.clone()));
      return preload;
    }
    const network = await fetch(request);
    if (network.ok) event.waitUntil(cache.put(request, network.clone()));
    return network;
  } catch {
    // ignoreSearch, because a navigation often carries a query string the stored
    // copy does not have — ?from=… would otherwise miss its own cached page.
    const cached =
      (await cache.match(request, { ignoreSearch: true })) ||
      (await caches.match(request, { ignoreSearch: true }));
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
//
// ***THIS IS DISABLED, AND MUST NOT BE SWITCHED ON AS IT STANDS.***
//
// Nothing in the app sets that header, so nothing is ever queued: offline
// support today is READ-ONLY (lib/offline/queryPersist.ts restores the last
// synced data; apiCall refuses writes with no connection). Tagging a mutation
// would activate the code below, and it would lose people's work:
//
//   1. `queueRequest` freezes the request's `Authorization: Bearer <jwt>`
//      header. A Supabase access token lasts about an hour, so anything
//      replayed later arrives with an expired one and comes back 401 — and
//      `replayQueue` DELETES any entry answered with a 4xx, on the reasoning
//      that a client error "won't fix itself". A sale recorded offline at
//      closing time would be dropped overnight without a trace.
//   2. There are no idempotency keys. A request the server actually processed
//      before the connection died is replayed and applied a second time —
//      duplicate sales, double stock movements.
//   3. The API stamps the business day when it RECEIVES a write, and enforces
//      order windows (assertBusinessDayOpen, isWithinOrderWindow). A demand
//      queued at 9pm and replayed at 7am belongs to a day that has closed.
//
// Fixing (1) means minting a fresh token at replay time, (2) an idempotency key
// per queued request honoured by the API, and (3) sending the captured-at time
// and letting the server decide. That is a change across both repos plus a
// migration — see the offline discussion, where "browse only" was chosen first.
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
