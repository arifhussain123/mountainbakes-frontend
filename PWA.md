# Mountain Bakes ERP — Progressive Web App

The web app is an installable PWA (Android, iOS/iPadOS, Windows, macOS) with an
offline experience, an install prompt, and Firebase Cloud Messaging push.

## What's included

| Area | Files |
| --- | --- |
| Web app manifest | `src/app/manifest.ts` → served at `/manifest.webmanifest` |
| Service worker (offline + caching + background sync) | `public/sw.js` |
| Offline fallback page | `public/offline.html` |
| Install prompt banner | `src/components/pwa/InstallPrompt.tsx` |
| SW registration + update toast | `src/components/pwa/ServiceWorkerRegister.tsx` |
| Online/offline + auto-sync | `src/components/pwa/NetworkStatus.tsx` |
| FCM push (client) | `src/lib/firebase/messaging.ts`, `src/components/pwa/PushNotifications.tsx` |
| FCM background worker | `public/firebase-messaging-sw.js` |
| FCM push (server) | `apps/api/src/services/push.service.ts` (used by `notify()`) |
| Icons + splash screens | `public/icons/*`, `public/splash/*` |
| Metadata / theme / Apple splash links | `src/app/layout.tsx` (`metadata` + `viewport`) |

## Icons & splash screens

All icons and iOS splash screens are generated from
`public/assets/images/logo/logo.png` (1024×1024):

```bash
node scripts/generate-pwa-assets.mjs
```

This writes `public/icons/*`, `public/splash/*`, and the splash `<link>` metadata
to `src/utils/pwa-splash.ts`. Re-run it whenever the logo changes.

## Enabling push notifications (FCM)

Push requires a Web Push (VAPID) key pair from the Firebase console:

1. Firebase Console → **Project settings → Cloud Messaging → Web configuration**.
2. Under **Web Push certificates**, generate a key pair and copy the public key.
3. Add it to `apps/web/.env.local`:

   ```
   NEXT_PUBLIC_FIREBASE_VAPID_KEY=<public key>
   ```

4. Ensure the **Cloud Messaging API (V1)** is enabled and the API server has a
   service account (`FIREBASE_SERVICE_ACCOUNT_PATH`) — it already uses one for
   Firestore/Auth, and the same credentials send push.

The server sends **data-only** messages; `public/firebase-messaging-sw.js`
renders them (avoids duplicate notifications). Notifications fire automatically
for: new orders, order ready/production updates, new branch, and product/price
changes — anywhere the API calls `notify()`.

Deploy the new Firestore rule for `fcmTokens`:

```bash
pnpm deploy:rules
```

## Testing locally

Service worker registration is **production-only** (so it never fights dev HMR):

```bash
pnpm --filter @mb/web build
pnpm --filter @mb/web start
```

Then open Chrome DevTools → **Application**:

- **Manifest** — install icon appears in the address bar; "Add to Home Screen".
- **Service Workers** — `sw.js` active; FCM worker under
  `/firebase-cloud-messaging-push-scope`.
- **Network → Offline** — reload shows `offline.html`; reconnecting auto-syncs.

Web push over `localhost` works in Chrome/Edge; for full device testing serve
over HTTPS (`next dev --experimental-https`, or deploy).

## Install behaviour

- Banner auto-appears ~4s after load on supported browsers, only if **not**
  already installed and **not** dismissed in the last **7 days** (stored in
  `localStorage`).
- **Install** triggers the native `beforeinstallprompt`. On iOS Safari (no such
  event) it shows *Share → Add to Home Screen* instructions.
- Once installed the app opens standalone (no address bar) with the Mountain
  Bakes splash screen, in portrait **or** landscape.
