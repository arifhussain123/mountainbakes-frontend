# Performance & Cleanup — post-split pass

This pass followed the monorepo → `frontend/` + `server/` split. It removes dead
weight and fixes the client-side over-fetching that made the app feel slow. It does
**not** change any feature behaviour.

> **Key framing:** deleting unused files does **not** make the running app faster —
> orphaned modules were never imported, so the bundler already tree-shook them out.
> The real "feels slow" causes were (1) client over-fetching and (2) the single-dyno
> API proxy topology. (1) is fixed here in code; (2) is a deploy decision — see below.

## What changed in this pass

### Cleanup (no runtime effect, smaller repo / faster typecheck)
- Removed root cruft: `verify-*.mjs` (one-off Playwright scripts), `utils/` (a stray
  Python logger), `scripts/deploy-rules*.js` (superseded by the `deploy:rules` npm
  script), `server/src/scripts/test-{admin,createuser}.ts`, and gitignored debris
  (`*-debug.log`, `.turbo/`, `.secrets/`).
- Deleted `frontend/src/assets/` — 22 empty `.gitkeep` scaffold dirs + one unused
  `logo.png` (the served logo lives in `public/assets/`).
- Removed 7 orphan util modules (`colors, fonts, theme, menu, permissions, storage,
  validation`) + trimmed the unused `@/utils` barrel; deleted the unused
  `server/src/utils/pagination.ts`; dropped the duplicate `cn()` in `utils/helpers.ts`
  (the live copy is `@/lib/utils`).
- Removed the unused `uuid` + `@types/uuid` server dependency.

### Runtime / over-fetching fixes (the actual speedups)
- **Single auth listener.** `useAuth` was a plain hook used in ~48 components, so each
  page opened several `onAuthStateChanged` listeners + token fetches. It's now backed
  by one `AuthProvider` (`src/providers/AuthProvider.tsx`) mounted at the root layout.
  The `@/hooks/useAuth` import path and return shape are unchanged.
- **Persistent notifications/chats streams.** `useNotifications`/`useChats` lived in the
  per-page `<Topbar>`, so their 3 Firestore `onSnapshot` streams tore down and
  re-subscribed on every navigation — and the realtime bridges opened notifications a
  second time. They now live in one `RealtimeProvider` (`src/providers/RealtimeProvider.tsx`)
  mounted in the dashboard layout: one set of listeners, shared and persistent across
  navigation. Bridges (`useProductionRealtime`/`usePriceRealtime`) consume the shared
  stream instead of opening their own.
- **Presence only while chat is open.** `ChatPanel` no longer holds an `onSnapshot` on
  `userPresence` on every page — it subscribes only when the chat sheet is open
  (`usePresence` guard adjusted so reopening re-subscribes).
- **No refetch on window focus.** `QueryProvider` sets `refetchOnWindowFocus: false`.
  Live data is already refreshed by notification-driven invalidation, so focus-refetch
  was pure duplicate traffic.
- **Live queries use a 15s staleTime** (was `0`), so navigating away and back no longer
  re-hits the API every time; genuine changes still invalidate immediately.
- **POS stock poll relaxed** 20s → 60s (stock is also refreshed on open and after each
  sale; the server is the authority on oversell).
- **Charts lazy-loaded.** The 5 recharts consumers (admin/branch dashboards, reports,
  production dashboard/expenses) now load charts via `next/dynamic({ ssr: false })`, so
  `recharts` is code-split out of those pages' initial JS.

## Deploy-topology advisory (NOT changed — your decision)

The biggest remaining latency lever is server-side, introduced by the split. Today
(per `DEPLOY.md` + `next.config.ts`), a single Heroku dyno runs **Next SSR + a loopback
Express API + the `node-cron` business-day closer**, and every browser API call is
proxied:

```
Browser → Next.js server (next start) → 127.0.0.1:API_PORT (Express) → database
```

`next.config.ts` rewrites `/api/:path*` to the loopback Express. So each API request
crosses an extra in-process HTTP hop and contends with SSR + cron for one CPU. Under
concurrent branch load this shows up as broad, everything-feels-slower latency.

Options, cheapest first:

1. **Direct-origin API (no code rewrite needed).** The API client
   (`frontend/src/lib/api/client.ts`) already honours `NEXT_PUBLIC_API_URL`. Point the
   browser at the API origin directly and drop the `/api` rewrite from `next.config.ts`,
   so calls skip the Next proxy hop. Requires the API to be reachable at a stable URL
   (its own dyno or a subdomain) + CORS. **Recommended if you separate the processes.**
2. **Split the API back onto its own dyno.** Removes SSR/API/cron CPU contention
   entirely (this is closer to the pre-split model). Pairs naturally with option 1.
3. **Stay single-dyno but size up.** If you keep the proxy topology, a larger dyno
   (more CPU) mitigates contention without an architecture change — simplest, but you
   keep paying the proxy hop.

Also minor: `Dockerfile` pins `node:20-slim` while `package.json` engines require `24.x`
(the container path isn't the live one, so cosmetic — but worth aligning).

## Remaining opportunities (not done — larger/riskier)
- `server/src/shared` is a byte-for-byte copy of `frontend/src/shared` (30 files). It's
  *used* by both, so not dead — but extracting it to a shared workspace package would
  kill the duplication. Larger refactor; left for a dedicated change.
- Parallel stock/export/price services on the server are deliberate duplication
  (different data shapes) — refactor candidates, not deletions.
