import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Component tests (jsdom). Kept apart from the Next build: nothing here is
// bundled into the app. Run with `pnpm test`.
export default defineConfig({
  resolve: {
    alias: {
      '@mb/shared': fileURLToPath(new URL('./src/shared/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
