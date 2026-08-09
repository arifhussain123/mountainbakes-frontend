# Mountain Bakes ERP — Progressive Web App

The web app is an installable PWA (Android, iOS/iPadOS, Windows, macOS) with an
offline experience and an install prompt.

> **Push notifications are currently unavailable.** The messaging backend they
> ran on has been removed; `<PushNotifications>` is a no-op stub until push is
> reimplemented on the Web Push API.

## What's included

| Area | Files |
| --- | --- |
| Web app manifest | `src/app/manifest.ts` → served at `/manifest.webmanifest` |
| Service worker (offline + caching + background sync) | `public/sw.js` |
| Offline fallback page | `public/offline.html` |
| Install prompt banner | `src/components/pwa/InstallPrompt.tsx` |
| SW registration + update toast | `src/components/pwa/ServiceWorkerRegister.tsx` |
| Online/offline + auto-sync | `src/components/pwa/NetworkStatus.tsx` |
| Push (client, disabled stub) | `src/components/pwa/PushNotifications.tsx` |
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

## Testing locally

Service worker registration is **production-only** (so it never fights dev HMR):

```bash
pnpm --filter @mb/web build
pnpm --filter @mb/web start
```

Then open Chrome DevTools → **Application**:

- **Manifest** — install icon appears in the address bar; "Add to Home Screen".
- **Service Workers** — `sw.js` active.
- **Network → Offline** — reload shows `offline.html`; reconnecting auto-syncs.

For full device testing serve over HTTPS (`next dev --experimental-https`, or
deploy).

## Install behaviour

- Banner auto-appears ~4s after load on supported browsers, only if **not**
  already installed and **not** dismissed in the last **7 days** (stored in
  `localStorage`).
- **Install** triggers the native `beforeinstallprompt`. On iOS Safari (no such
  event) it shows *Share → Add to Home Screen* instructions.
- Once installed the app opens standalone (no address bar) with the Mountain
  Bakes splash screen. The app is locked to **portrait** — `manifest.ts` sets
  `orientation: 'portrait'` and `OrientationLock` (mounted in the root layout)
  backs it with a runtime lock attempt plus a "please rotate" overlay for
  browsers that ignore the manifest hint.
