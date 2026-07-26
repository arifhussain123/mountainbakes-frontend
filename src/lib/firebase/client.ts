/**
 * Firebase app handle for the browser.
 *
 * Hardcoded rather than read from env, which is the convention .env.local already
 * describes for these values. None of them are secrets: a Firebase web apiKey is a
 * project identifier, not a credential — it ships inside the JS bundle by design and
 * grants nothing on its own. What actually guards the project is Firebase Security
 * Rules plus API key restrictions in the console, so restrict this key by HTTP
 * referrer there rather than trying to hide it here. Hardcoding also keeps them out
 * of the Dockerfile's build args, which only exist because NEXT_PUBLIC_* has to be
 * inlined before `next build`.
 *
 * Note this is NOT the app's auth or database layer — that is Supabase
 * (src/lib/supabase, and the Express API). Firebase is here for Analytics, and as the
 * hook for Web Push later, which is what NEXT_PUBLIC_FIREBASE_VAPID_KEY in
 * .env.local is reserved for.
 */
import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAnalytics, isSupported, type Analytics } from 'firebase/analytics';

const firebaseConfig = {
  apiKey: 'AIzaSyCucIj4N07x6dOLvpkbfjUEnygTHNhflRg',
  authDomain: 'mountainbakes-2f685.firebaseapp.com',
  projectId: 'mountainbakes-2f685',
  storageBucket: 'mountainbakes-2f685.firebasestorage.app',
  messagingSenderId: '446431618191',
  appId: '1:446431618191:web:7ea9331e71dcbfdfdfbcfa',
  measurementId: 'G-NW38VQ7E87',
};

/**
 * Reuse an existing app instead of calling initializeApp twice. A second call with
 * the same name throws, and this module is imported from more than one component —
 * plus dev-mode HMR re-evaluates it while the previous instance is still registered.
 */
export const firebaseApp: FirebaseApp = getApps().length ? getApp() : initializeApp(firebaseConfig);

/**
 * Analytics, or null where it cannot run.
 *
 * Deliberately a function returning a promise rather than a `getAnalytics()` call at
 * module scope. getAnalytics touches `window` and `document`, so evaluating it during
 * SSR throws — and every page in this app is server-rendered (the build marks them
 * ƒ Dynamic, with middleware in src/proxy.ts on top). A module-scope call would take
 * down any route that imported it, directly or transitively.
 *
 * isSupported() is the second guard: it resolves false in environments Analytics
 * cannot use — no IndexedDB, cookies disabled, some in-app browsers — which matters
 * for staff opening this on a phone. Callers get null and carry on; analytics is
 * never load-bearing.
 *
 * The promise is memoised so concurrent callers share one initialisation.
 */
let analyticsPromise: Promise<Analytics | null> | null = null;

export function firebaseAnalytics(): Promise<Analytics | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  analyticsPromise ??= isSupported().then((supported) =>
    supported ? getAnalytics(firebaseApp) : null
  );
  return analyticsPromise;
}
