import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Standalone app: env lives in this folder (frontend/.env.local), not the repo root.
loadEnvConfig(process.cwd());

// This app deploys independently of the Express API — they are separate hosts.
// The browser calls the API directly at NEXT_PUBLIC_API_URL (baked in at build
// time), so there is no same-dyno loopback proxy any more. The API's own CORS
// allowlist (CORS_ORIGINS, server/src/app.ts) is what permits those requests.
//
// This app is now a pure CLIENT-SIDE app: `next build` writes a static bundle to
// out/ and nothing of ours runs on a server at request time. Nothing under /api
// belongs to this origin any more — the old /api/login and /api/logout route
// handlers are gone and the session lives entirely in the browser (Supabase,
// localStorage).

/**
 * The build stamp, reused as the deployment id so every asset URL moves per build.
 *
 * `scripts/generate-version.mjs` runs immediately before `next build` in both the
 * `build` and `deploy` scripts, so this file is always fresh by the time the
 * config is loaded. Reading it here rather than minting a second id keeps one
 * value identifying a release: what /version.json reports is what the assets
 * carry.
 *
 * Absent in `next dev` (the generator is not part of that script) and in a fresh
 * clone that has not built yet — both fall back to no deployment id at all,
 * which is the behaviour this project had before.
 */
function buildStamp(): string | undefined {
  try {
    const raw = readFileSync(join(process.cwd(), "public", "version.json"), "utf8");
    const { buildId } = JSON.parse(raw) as { buildId?: string };
    return buildId || undefined;
  } catch {
    return undefined;
  }
}

const nextConfig: NextConfig = {
  // Static export (CSR). Every route is pre-rendered to a plain .html shell at
  // build time and everything else happens in the browser, so the output can be
  // served by any static host — Firebase Hosting, in our case.
  //
  // What this rules out, permanently: route handlers (src/app/api/*), middleware
  // (the old src/proxy.ts), server actions, ISR/`revalidate`, `dynamic =
  // 'force-dynamic'`, and next/image optimisation. Adding any of them back turns
  // `next build` into a hard error. Route guarding is done by
  // src/components/auth/RouteGuard.tsx instead.
  output: 'export',

  // Append `?dpl=<buildId>` to every static asset URL.
  //
  // Next hashes chunk filenames by CONTENT, so a file whose source did not change
  // keeps its name across builds — which is normally the point, and is why
  // firebase.json serves /_next/static/** as `immutable` for a year. The cost is
  // that a client holding a stale copy of an unchanged chunk has no reason to
  // ever refetch it, and the service worker's cache-first rule for /_next/static/
  // compounds it: a cached entry for that URL is served forever.
  //
  // That combination is how a tab ends up running a mix of old and new code after
  // a deploy. Keying every asset URL to the build makes each release's assets a
  // distinct cache entry in BOTH caches, so a reload after a deploy can only ever
  // fetch that deploy's code. Cache-busting by URL, not by filename — the hashes
  // themselves are still content-derived and still correct.
  //
  // Old entries are not orphaned forever: bumping VERSION in public/sw.js drops
  // the previous runtime cache wholesale on activate.
  deploymentId: buildStamp(),

  // Emit out/login/index.html rather than out/login.html, so every route is served
  // by a plain directory-index lookup on the host.
  //
  // The alternative is Firebase's `cleanUrls`, which maps /login onto login.html —
  // but it also 301s any *.html request, and public/sw.js precaches /offline.html
  // with `cache.add()`, which rejects outright on a redirected response. The offline
  // shell would silently never cache (install uses allSettled, so nothing would even
  // log) and the PWA's offline fallback would quietly stop working.
  trailingSlash: true,

  // No optimisation server exists to resize and re-encode images, so next/image
  // must pass the source through untouched. Without this, `output: 'export'`
  // fails the build outright.
  images: {
    unoptimized: true,
    remotePatterns: [],
  },

  // NOTE: `headers()` is deliberately absent. A static export has no server to
  // attach response headers to, and Next warns that the block is inert. The
  // security headers and the /sw.js caching rules that used to live here are now
  // in the `headers` block of firebase.json — edit them there.
};

export default nextConfig;
