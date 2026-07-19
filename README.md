# Mountain Bakes Web

The Next.js 16 (App Router) web client for Mountain Bakes ERP — admin, branch, and
production dashboards.

This folder is a **standalone project**. Its sibling `../server/` is the Express REST
API, deployed separately. Neither depends on any file above this directory.

```
frontend/
├── src/
│   ├── app/              # App Router pages — (auth), (dashboard), api/
│   ├── components/       # feature components + ui/
│   ├── hooks/  stores/  utils/
│   ├── lib/              # api client, supabase, react-query
│   ├── providers/        # Auth, Query, Realtime, Theme
│   └── shared/           # schemas/types (mirrored in server/src/shared)
├── public/               # PWA icons, splash screens, service workers
├── middleware.ts         # role-based route guard
├── next.config.ts
└── Procfile              # web: pnpm start
```

The client never reads privileged Firestore collections directly — every dashboard
page calls the `server/` API, which holds the Admin SDK credentials.

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

`/api/login` and `/api/logout` are this app's **own** Next route handlers, not the
Express API. They set and clear the first-party `mb_session` cookie that
`middleware.ts` reads to guard routes. That cookie never leaves this origin, which
is why the API can live on a different host.

## PWA assets

`scripts/generate-pwa-assets.mjs` regenerates icons and iOS splash screens from
`public/assets/images/logo/logo.png`. It needs `sharp`, which is not currently a
dependency — run `pnpm add -D sharp` first. See [PWA.md](PWA.md).
"# mountainbakes-frontend" 
