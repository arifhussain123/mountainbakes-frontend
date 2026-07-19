import type { MetadataRoute } from 'next';

/**
 * Web App Manifest — served by Next.js at `/manifest.webmanifest`.
 *
 * Note on orientation: the brief's example manifest locked `portrait`, but
 * requirements #3 and #6 explicitly ask the app to work in BOTH portrait and
 * landscape. `any` honours that (the OS follows device rotation) instead of
 * forcing a single orientation.
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
    orientation: 'any',
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
