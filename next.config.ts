import type { NextConfig } from "next";
import { loadEnvConfig } from "@next/env";

// Standalone app: env lives in this folder (frontend/.env.local), not the repo root.
loadEnvConfig(process.cwd());

// This app deploys independently of the Express API — they are separate hosts.
// The browser calls the API directly at NEXT_PUBLIC_API_URL (baked in at build
// time), so there is no same-dyno loopback proxy any more. The API's own CORS
// allowlist (CORS_ORIGINS, server/src/app.ts) is what permits those requests.
//
// Note /api/login and /api/logout are this app's OWN Next route handlers
// (src/app/api/*) and are unaffected — they set the first-party mb_session cookie.

const nextConfig: NextConfig = {
  // Emits .next/standalone with a traced, minimal node_modules and its own
  // server.js — the container copies that instead of the whole dependency tree.
  // Required by the Cloud Run image (see Dockerfile); harmless for `next dev`.
  output: 'standalone',
  images: {
    remotePatterns: [],
  },
  async headers() {
    const swHeaders = [
      { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
      { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
      // Allow a worker served from /sw.js to control the whole origin.
      { key: 'Service-Worker-Allowed', value: '/' },
    ];
    return [
      {
        // Baseline security headers on every route (Lighthouse best practices).
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      { source: '/sw.js', headers: swHeaders },
    ];
  },
};

export default nextConfig;
