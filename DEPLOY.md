# Deploying the Mountain Bakes Web App

This app is a **static, client-rendered bundle** deployed to **Firebase Hosting**.
`next build` writes `out/`; Hosting serves it. Nothing of ours runs on a server.

Deploy the API **first** — its URL is baked into this app's build.

## Why static

`next.config.ts` sets `output: 'export'`. That is what makes the app hostable on
Firebase Hosting (which serves files, not Node), and it is why the CLI's
"we can't guarantee an SSR site will work on Hosting — use App Hosting instead"
prompt no longer applies: there is no SSR left to break.

The consequences are permanent, and adding any of them back makes `next build`
fail rather than silently misbehave:

| Gone | Replaced by |
| --- | --- |
| `src/app/api/login`, `/logout` route handlers | Nothing — the browser talks to Supabase directly |
| The `mb_session` httpOnly cookie | The Supabase session in Web Storage |
| `src/proxy.ts` middleware route guard | `src/components/auth/RouteGuard.tsx` (client) |
| `headers()` in `next.config.ts` | The `headers` block in `firebase.json` |
| `dynamic = 'force-dynamic'`, `revalidate`, server actions | — |
| `next/image` optimisation | `images.unoptimized: true` |

**Route guarding is now client-side, and that is not a downgrade in security.**
It never was the security boundary: the `mb_session` cookie only ever decided
which *screen* to show. Every byte of data is authorised by the Express API
against the Supabase JWT, and that is unchanged. What a determined visitor can
now do is fetch the static HTML shell of `/dashboard` — which contains no data.

## Prerequisites

- Firebase CLI (`npm i -g firebase-tools`), `firebase login` done.
- The project in `.firebaserc` (`mountainbakes-dfc2c`) exists and has Hosting enabled.
- The API already deployed, with its public URL to hand.

## Deploy

```bash
pnpm install
pnpm deploy          # = next build && firebase deploy --only hosting
```

To preview the exact production behaviour — rewrites, headers, the 404 page —
before shipping:

```bash
pnpm build
pnpm preview         # firebase emulators:start --only hosting → http://127.0.0.1:5000
```

`pnpm dev` runs the normal Next dev server and does **not** apply `firebase.json`,
so it will not catch a broken rewrite or a missing header. Use `pnpm preview` for
anything hosting-shaped.

## Build-time environment

| Variable | When | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | **Required** | The API's origin — scheme + host, **no trailing slash** |
| `NEXT_PUBLIC_SUPABASE_URL` | **Required** | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Required** | Supabase publishable (anon) key |
| `NEXT_PUBLIC_WEB_URL` | Recommended | This app's own URL (absolute metadata links) |

### The one mistake everyone makes

`NEXT_PUBLIC_*` is compiled into the JavaScript bundle at **build** time. There is
no runtime config on a static host at all now — whatever was set during
`next build` is what ships, permanently, until the next build.

**`.gitignore` excludes `.env*`, so a fresh clone or a CI runner has none of these.**
That is the trap to watch: the build still succeeds, and the app still renders — it
just 404s every data request against its own origin, with no server-side error
anywhere to explain it. `assertApiReachable()` in `src/lib/api/client.ts` throws a
named error instead of letting that masquerade as a missing route.

Locally, `.env` supplies them (`cp .env.example .env`). In CI, set them as
repository secrets exported into the `next build` step.

> `apphosting.yaml` used to be the source of build-time env, back when this
> deployed to Firebase **App Hosting**. That path is retired. Along with
> `Dockerfile` and `Procfile` it is now dead weight — all three assume a Node
> server (`output: 'standalone'`, `next start`), and `next start` refuses to run
> against a static export.

## Hosting configuration

`firebase.json` carries what `next.config.ts` no longer can:

- **`headers`** — the security headers that used to be in `next.config.ts`, plus
  `Cache-Control`: HTML/RSC payloads `no-cache` (so a deploy is picked up
  immediately), content-hashed `/_next/static/**` `immutable` for a year. Later
  rules override earlier ones for the same key, which is why the immutable rule
  sits after the global `no-cache`.
- **`rewrites`** — `/special-events/*` → the one shell built for that route. Event
  ids are runtime data, so a static export cannot enumerate them; it emits a single
  page at a reserved placeholder id and `EventDetailRoute` reads the real id out of
  the address bar. Without this rewrite, a refresh or a shared link to an event 404s.

  Side effect worth knowing: opening an event from the list is a **full page load**,
  not a soft client transition. Next asks for that route's RSC payload first, no such
  file exists for a real id, and the router falls back to a hard navigation — which
  the rewrite then serves correctly. It works; it is just not instant.

`next.config.ts` sets `trailingSlash: true` so every route is a directory with an
`index.html`, served by a plain directory-index lookup. The alternative, Firebase's
`cleanUrls`, also 301s any `*.html` request — and `public/sw.js` precaches
`/offline.html` with `cache.add()`, which rejects outright on a redirected response.
The offline shell would silently never cache (install uses `allSettled`, so nothing
would even log). Leave both settings as they are.

## Verify

After `pnpm deploy`, on the live URL:

- `/` logged out → redirects to `/login/`; the login page renders with the Geist
  font (proves the build-time `next/font/google` fetch succeeded).
- Log in → role routing lands correctly (super_admin → `/dashboard/`,
  branch_manager → `/branch-dashboard/`, production_user → `/production-dashboard/`).
- A data page (e.g. `/products/`) loads rows. In the Network tab the request goes to
  `https://<api-host>/api/products` with an `Authorization: Bearer` header.
- Open an event from `/special-events/`, then **hard-refresh it** — this is the one
  route that depends on the rewrite.
- Sign in without "Remember me", quit the browser, reopen → signed out. With it
  ticked → still signed in.
- DevTools → Application → Service Workers: one worker, and the Cache Storage
  `mb-precache-v1` entry lists `/offline.html`.

Failure modes:

- `API is misconfigured for production…` → `NEXT_PUBLIC_API_URL` points at
  localhost. Set the real API URL and **rebuild**.
- Empty tables, `/api/*` 404s on this origin → `NEXT_PUBLIC_API_URL` was unset at
  build time.
- CORS-blocked with nothing in the API's log → `CORS_ORIGINS` on the API doesn't
  exactly match this app's Hosting origin (scheme + host, no trailing slash). Both
  the `*.web.app` and `*.firebaseapp.com` domains need listing if both are used.
- A stale build after deploying → check the `no-cache` header on the HTML; a
  service worker serving a cached shell also masks a deploy until it updates.

## Runtime pinning

`package.json` pins `"engines": { "node": "24.x" }` and
`"packageManager": "pnpm@11.12.0"`. **Do not loosen the engine to an open range** —
Corepack, which puts `pnpm` on `PATH`, was unbundled at Node 25. This now only
affects the build machine (CI), not a server, since there is no longer one.
