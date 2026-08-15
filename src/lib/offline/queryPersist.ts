import { dehydrate, hydrate, type QueryClient } from '@tanstack/react-query';

/**
 * Keeping the last synced data on the device so the app opens and can be read
 * with no connection.
 *
 * Without this, React Query's cache lives only in memory: closing the app on a
 * branch phone throws away everything, and reopening it in a dead spot gives a
 * shell with empty tables. A snapshot of the cache is written to IndexedDB and
 * restored at boot, so a branch can still look up today's orders, stock and
 * prices while the connection is gone.
 *
 * READ-ONLY. Nothing here queues a write — see the note on the disabled
 * Background Sync queue in public/sw.js for why replaying mutations needs more
 * than a queue before it can be trusted.
 *
 * Written by hand rather than pulling in @tanstack/react-query-persist-client,
 * because the budget below is the whole point: a shop phone that is chronically
 * short of space must not have this quietly grow without limit. `dehydrate` and
 * `hydrate` come from the core package that is already installed.
 */

const DB_NAME = 'mb-offline';
const DB_VERSION = 1;
const STORE = 'query-cache';
const KEY = 'snapshot';

/**
 * Ceiling for the whole snapshot.
 *
 * A snapshot over this is not written at all, rather than trimmed: a half-saved
 * cache would restore a screen showing some of a branch's orders and silently
 * missing the rest, which is worse than showing none and saying so. In practice
 * a full working day of orders, products and stock serialises to a few hundred
 * KB, so 4 MB is generous — comfortably less than a single photo from the
 * camera, and invisible next to the app's own bundle.
 */
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

/**
 * How old a snapshot may be and still be restored.
 *
 * A day. Past that the figures are stale enough that showing them as though
 * they were the branch's current position would mislead — a week-old stock
 * count read as today's is worse than an empty table.
 */
const MAX_SNAPSHOT_AGE_MS = 24 * 60 * 60 * 1000;

interface Snapshot {
  /** Whose data this is. A snapshot is never restored into a different session. */
  userId: string;
  savedAt: number;
  state: unknown;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = fn(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

/**
 * Write the current cache to disk.
 *
 * Only SUCCESSFUL queries are kept. Persisting an error state would restore a
 * screen already showing a failure that has nothing to do with the current
 * connection, and persisting a pending one restores a spinner that never
 * resolves.
 */
export async function saveSnapshot(client: QueryClient, userId: string): Promise<void> {
  try {
    const state = dehydrate(client, {
      shouldDehydrateQuery: (q) => q.state.status === 'success',
    });
    const snapshot: Snapshot = { userId, savedAt: Date.now(), state };

    const serialised = JSON.stringify(snapshot);
    if (serialised.length > MAX_SNAPSHOT_BYTES) {
      // Leave whatever smaller snapshot is already there — it is older but whole.
      console.warn('[offline] cache snapshot over budget, not saved');
      return;
    }

    await tx('readwrite', (store) => store.put(serialised, KEY));
  } catch (err) {
    // Private browsing, a full disk, or a browser that refuses IndexedDB. Losing
    // the snapshot costs offline reading, never correctness, so it must not take
    // the app down with it.
    console.warn('[offline] could not save cache snapshot', err);
  }
}

/**
 * Restore the cache for `userId`, if there is a fresh snapshot belonging to them.
 *
 * Returns when the data was captured, for the "showing data from …" message, or
 * null if nothing was restored.
 */
export async function restoreSnapshot(client: QueryClient, userId: string): Promise<number | null> {
  try {
    const serialised = await tx<string | undefined>('readonly', (store) => store.get(KEY));
    if (!serialised) return null;

    const snapshot = JSON.parse(serialised) as Snapshot;

    // A different account signed in on this device. Their data is not this
    // user's to see, so drop it rather than restore it.
    if (snapshot.userId !== userId) {
      await clearSnapshot();
      return null;
    }

    if (Date.now() - snapshot.savedAt > MAX_SNAPSHOT_AGE_MS) {
      await clearSnapshot();
      return null;
    }

    hydrate(client, snapshot.state);
    return snapshot.savedAt;
  } catch (err) {
    console.warn('[offline] could not restore cache snapshot', err);
    return null;
  }
}

/** Wipe it. Called on sign-out — a shared branch phone must not keep the last user's figures. */
export async function clearSnapshot(): Promise<void> {
  try {
    await tx('readwrite', (store) => store.delete(KEY));
  } catch {
    /* nothing to clear, or no IndexedDB — either way there is nothing to do */
  }
}
