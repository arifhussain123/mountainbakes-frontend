# Deploying the Mountain Bakes Web App

This folder deploys as its **own** Heroku app (Node buildpack), independent of
`../server/`. Deploy the API **first** — its URL must be baked into this app's build.

## Prerequisites

- Heroku CLI installed, `heroku login` done.
- The API already deployed, with its public URL to hand.
- `pnpm-lock.yaml` committed — builds install from it.

## Deploy

This folder is its own git repository, so pushes come from here:

```bash
cd frontend
heroku create <web-app> --remote heroku

# NEXT_PUBLIC_* is inlined at BUILD time — set these BEFORE the push:
heroku config:set -a <web-app> \
  NEXT_PUBLIC_API_URL=https://<api-host> \
  NEXT_PUBLIC_WEB_URL=https://<web-host> \
  NODE_ENV=production

git push heroku HEAD:main
```

Heroku's Node buildpack runs the `build` script (`next build`) automatically; the
`Procfile` then runs `pnpm start`, and `next start` binds Heroku's `$PORT`. No
`heroku-postbuild` is needed.

| Variable | When | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | **Required** | The API's origin — scheme + host, **no trailing slash**. Baked in at build time |
| `NEXT_PUBLIC_WEB_URL` | Recommended | This app's own URL (absolute metadata links) |
| `NODE_ENV` | Recommended | `production` |

## The one mistake everyone makes

`NEXT_PUBLIC_*` values are compiled into the JavaScript bundle at build time.
Setting `NEXT_PUBLIC_API_URL` on a running app and restarting it **changes
nothing** — you must set it and then rebuild:

```bash
heroku config:set -a <web-app> NEXT_PUBLIC_API_URL=https://<api-host>
git commit --allow-empty -m "Rebuild with API URL" && git push heroku HEAD:main
```

If it was never set, the bundle ships with a *relative* API base and every data
request 404s against this app's own origin — with **no server-side error anywhere**.
Symptom: pages render, but every table is empty.

## Runtime pinning

`package.json` pins `"engines": { "node": "24.x" }` and
`"packageManager": "pnpm@11.12.0"`. **Do not loosen the engine to an open range.**
Heroku resolves a range to the highest available Node, and Corepack — which puts
`pnpm` on `PATH` for the `Procfile` — was unbundled at Node 25.

## Verify

```bash
heroku run "node --version" -a <web-app>    # => v24.x.x
heroku ps -a <web-app>                      # web.1 up, no crash loop
```

In the browser:
- `/` logged out → redirects to `/login`; `/login` renders with the Geist font
  (proves the build-time `next/font/google` fetch succeeded).
- Log in → role routing lands correctly (super_admin → `/dashboard`,
  branch_manager → `/branch-dashboard`, production_user → `/production-queue`).
  This exercises `/api/login`, which is this app's own route handler, not the API.
- A data page (e.g. `/products`) loads rows. In the Network tab the request goes to
  `https://<api-host>/api/products` with an `Authorization: Bearer` header.
- `/manifest.webmanifest`, `/sw.js` → 200 with the correct `Content-Type`.

Failure modes:
- `API is misconfigured for production…` → `NEXT_PUBLIC_API_URL` points at
  localhost. Set the real API URL and rebuild.
- Empty tables, `/api/*` 404s on this origin → `NEXT_PUBLIC_API_URL` was unset at
  build time.
- `Could not reach the API` / CORS-blocked → `CORS_ORIGINS` on the API doesn't
  exactly match this app's origin (scheme + host, no trailing slash).

Logs: `heroku logs --tail -a <web-app>`.
