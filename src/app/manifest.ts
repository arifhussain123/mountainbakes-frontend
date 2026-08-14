import type { MetadataRoute } from 'next';

/**
 * Metadata routes are route handlers under the hood, and `output: 'export'` refuses
 * to build one that hasn't declared itself static. Nothing here varies per request,
 * so this just writes out/manifest.webmanifest once at build time.
 */
export const dynamic = 'force-static';

/**
 * Web App Manifest — emitted at `/manifest.webmanifest`.
 *
 * Note on orientation: this was `any` (both portrait and landscape) per an
 * earlier brief. That was reversed — rotating to landscape was causing UI
 * glitches on mobile, so the installed app is now locked to `portrait`. See
 * `OrientationLock` (mounted in the root layout) for the runtime lock this
 * manifest hint can't provide by itself (e.g. before install, or on browsers
 * that ignore the manifest orientation field).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Mountain Bakes ERP',
    short_name: 'Mountain Bakes',
    description: 'Bakery management system — orders, production and branches in one place.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: '#D97706',
    lang: 'en',
    dir: 'ltr',
    categories: ['business', 'productivity', 'food'],
    prefer_related_applications: false,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      {
        name: 'Dashboard',
        short_name: 'Dashboard',
        description: 'Open the main dashboard',
        url: '/dashboard',
        icons: [{ src: '/icons/icon-96.png', sizes: '96x96', type: 'image/png' }],
      },
      {
        name: 'Orders',
        short_name: 'Orders',
        description: 'View and manage orders',
        url: '/orders',
        icons: [{ src: '/icons/icon-96.png', sizes: '96x96', type: 'image/png' }],
      },
      {
        name: 'Production Dashboard',
        short_name: 'Production',
        description: 'Open the production dashboard',
        url: '/production-dashboard',
        icons: [{ src: '/icons/icon-96.png', sizes: '96x96', type: 'image/png' }],
      },
    ],
  };
}
