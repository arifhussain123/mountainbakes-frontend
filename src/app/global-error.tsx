'use client';

import { ErrorDetails } from '@/components/shared/ErrorDetails';

/**
 * The last resort: something above every page threw (the root layout, a
 * provider). This replaces the whole document, so it must bring its own <html>
 * and <body>.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#fdf6e9' }}>
        <ErrorDetails error={error} />
      </body>
    </html>
  );
}
