import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { QueryProvider } from '@/providers/QueryProvider';
import { AuthProvider } from '@/providers/AuthProvider';
import { RouteGuard } from '@/components/auth/RouteGuard';
import { Toaster } from '@/components/ui/sonner';
import { ServiceWorkerRegister } from '@/components/pwa/ServiceWorkerRegister';
import { InstallPrompt } from '@/components/pwa/InstallPrompt';
import { NetworkStatus } from '@/components/pwa/NetworkStatus';
import { OrientationLock } from '@/components/pwa/OrientationLock';
import { appleStartupImages } from '@/utils/pwa-splash';
import './globals.css';

const geist = Geist({ variable: '--font-sans', subsets: ['latin'] });

const APP_NAME = 'Mountain Bakes ERP';
const APP_DESCRIPTION =
  'Bakery management system — manage orders, production and branches from any device.';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_WEB_URL || 'http://localhost:3000'),
  applicationName: APP_NAME,
  title: { default: APP_NAME, template: '%s · Mountain Bakes' },
  description: APP_DESCRIPTION,
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Mountain Bakes',
    statusBarStyle: 'default',
    startupImage: appleStartupImages,
  },
  formatDetection: { telephone: false },
  // Next emits the standard `mobile-web-app-capable`; add the legacy
  // apple-prefixed tag so older iOS versions also launch full-screen.
  other: { 'apple-mobile-web-app-capable': 'yes' },
  icons: {
    icon: [
      { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/favicon-16.png', sizes: '16x16', type: 'image/png' },
      { url: '/favicon.ico' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    type: 'website',
    title: APP_NAME,
    description: APP_DESCRIPTION,
    siteName: APP_NAME,
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#D97706' },
    { media: '(prefers-color-scheme: dark)', color: '#171310' },
  ],
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover', // draw under iOS notches; safe-area insets handle padding
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} h-full`} suppressHydrationWarning>
      <body className="min-h-full antialiased" suppressHydrationWarning>
        <ThemeProvider>
          <QueryProvider>
            <AuthProvider>
              {/* Replaces the deleted src/proxy.ts middleware — a static export has
                  no server to guard a navigation, so it happens here. Wraps only
                  {children}: the PWA and toast layers below must stay mounted while
                  the guard is holding a redirect. */}
              <RouteGuard>{children}</RouteGuard>
              <ServiceWorkerRegister />
              <NetworkStatus />
              <InstallPrompt />
              <OrientationLock />
              <Toaster richColors position="top-right" />
            </AuthProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
