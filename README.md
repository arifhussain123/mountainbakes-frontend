# Mountain Bakes Web

The Next.js 16 (App Router) web client for Mountain Bakes ERP — admin, branch, and
production dashboards.

It is a **fully client-rendered app**: `next build` static-exports it to `out/`
(`output: 'export'`) and Firebase Hosting serves those files. There is no server
side to this app — no route handlers, no middleware, no SSR. See
[DEPLOY.md](DEPLOY.md) for what that rules out.

This folder is a **standalone project**. Its sibling `../server/` is the Express REST
API, deployed separately. Neither depends on any file above this directory.

```
frontend/
├── src/
│   ├── app/              # App Router pages — (auth), (dashboard)
│   ├── components/       # feature components + ui/
│   │   └── auth/RouteGuard.tsx   # role-based route guard (client-side)
│   ├── hooks/  stores/  utils/
│   ├── lib/              # api client, supabase, react-query
│   ├── providers/        # Auth, Query, Realtime, Theme
│   └── shared/           # schemas/types (mirrored in server/src/shared)
├── public/               # PWA icons, splash screens, service workers
├── next.config.ts        # output: 'export' — the whole CSR setup
└── firebase.json         # Hosting: headers, rewrites, out/
```

The client never reads privileged database tables directly — every dashboard
page calls the `server/` API, which holds the Supabase service-role credentials.

## Local development

```bash
pnpm install
cp .env.example .env.local    # then fill it in
pnpm dev                      # http://localhost:3000
```

Requires Node 24.x and pnpm 11.12.0 (both pinned in `package.json`).

The API must be running too — start it in a second terminal:

```bash
cd ../server && pnpm dev      # http://localhost:3001
```

There is no longer a single command that starts both — they are independent
projects by design.

## How it reaches the API

`NEXT_PUBLIC_API_URL` points at the Express API's origin (`http://localhost:3001`
locally). Requests go directly, cross-origin, with the **Supabase** access-token JWT
in an `Authorization: Bearer` header. The API's `CORS_ORIGINS` must list this app's
exact origin.

> **`NEXT_PUBLIC_*` values are inlined at build time.** Changing one requires a
> rebuild — setting it on a running host does nothing. This is the single most
> common deploy mistake; see [DEPLOY.md](DEPLOY.md).

**Nothing under `/api` belongs to this origin.** Every `/api/*` path is on the
Express host. Sign-in and sign-out go straight from the browser to Supabase; the
session lives in Web Storage (localStorage when "Remember me" is ticked,
sessionStorage otherwise — see `src/lib/supabase/client.ts`), and
`src/components/auth/RouteGuard.tsx` routes off the role claim in it.

That guard is navigation UX, not an authorisation boundary — the API authorises
every request against the JWT on its own. See [DEPLOY.md](DEPLOY.md).

## Previewing a production build

`pnpm dev` does not apply `firebase.json`, so it cannot catch a broken rewrite or
a missing header. For anything hosting-shaped:

```bash
pnpm build
pnpm preview                  # http://127.0.0.1:5000
```

## PWA assets

`scripts/generate-pwa-assets.mjs` regenerates icons and iOS splash screens from
`public/assets/images/logo/logo.png`. It needs `sharp`, which is not currently a
dependency — run `pnpm add -D sharp` first. See [PWA.md](PWA.md).
"# mountainbakes-frontend" 
