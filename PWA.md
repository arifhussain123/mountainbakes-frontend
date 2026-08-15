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
| SW registration | `src/components/pwa/ServiceWorkerRegister.tsx` |
| Refresh / auto-update | `src/hooks/useAppRefresh.tsx`, `src/components/layout/RefreshButton.tsx` |
| Build stamp | `scripts/generate-version.mjs` → `/version.json` |
| Online/offline + auto-sync | `src/components/pwa/NetworkStatus.tsx` |
| Push (client, disabled stub) | `src/components/pwa/PushNotifications.tsx` |
| Icons + splash screens | `public/icons/*`, `public/splash/*` |
| Metadata / theme / Apple splash links | `src/app/layout.tsx` (`metadata` + `viewport`) |

## Staying current: the Refresh button and the 2-minute tick

`AppRefreshProvider` (dashboard layout) runs one 2-minute tick that keeps a
running tab current in two different ways, because the two carry very different
costs:

| | How | When it runs |
| --- | --- | --- |
| **Data** | `refetchQueries({ type: 'active' })` — React Query swaps rows in behind what is rendered. No reload, no flash. | Every tick, unless a Dialog is open. |
| **Frontend** | `window.location.reload()` — the only way to pick up a new build, and it destroys anything unsaved. | Only when a new build exists *and* nobody is mid-entry. |

A new build is found by polling `/version.json`, whose `buildId` is rewritten by
`scripts/generate-version.mjs` on every `pnpm build`. **The service worker cannot
answer this question** — `sw.js` is byte-identical between builds, so
`registration.update()` finds nothing however much of the app has changed. The
stamp is generated, not committed (`.gitignore`), and Firebase serves it
`no-store` so a cached copy can never report the build you are already on.

"Mid-entry" (`isBusy`) means any of: a Dialog is open, focus is in an
input/textarea/select/contenteditable, a mutation is in flight, or the app was
touched in the last 30s. Fail any check and the update is *not* applied — the
Topbar's Refresh button lights up instead, and the next tick tries again. A
missed update costs two minutes; an update applied over a half-typed sale costs
the sale.

The **Refresh button** (centred in the Topbar — the installed PWA has no browser
reload button) refetches on press, and applies a waiting build immediately: an
explicit press is consent to be interrupted.

`sw.js` deliberately does **not** call `skipWaiting()` on install. Doing so makes
a new worker seize control on download, firing `controllerchange` and reloading
every open tab unbidden. The client posts `SKIP_WAITING` when it has decided the
moment is safe.

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
