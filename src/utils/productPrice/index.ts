/**
 * Central Product Price Utility — the single source of truth for product names,
 * categories and prices across Admin, Branch, Sales, Stock and Reports.
 *
 *   import { getProductPrice, sortProducts } from '@/utils/productPrice';
 *
 * ── Two things to know ──────────────────────────────────────────────────────
 *
 * 1. React hooks are NOT here — they live in `@/lib/queries` alongside the `qk`
 *    key factory, which must remain the single source of query keys. A duplicate
 *    key shape here would create a second cache entry that invalidations
 *    silently miss. That also keeps this module free of React and unit-testable.
 *    Components should prefer the hooks; these plain functions are for event
 *    handlers, submit paths and non-React code.
 *
 * 2. This module is intentionally NOT re-exported from `@/utils`. It re-exports
 *    formatCurrency/formatDate, which would collide with utils/currency and
 *    utils/date in that barrel's `export *` and break every existing
 *    `import { formatDate } from '@/utils'`. Import it by path, the same way
 *    api already is.
 *
 * Swapping the data source (Firestore → MongoDB → anything) means changing the
 * fetch calls inside this folder only; no consumer needs to change.
 */

export * from './helpers';
export * from './productPrice';
export * from './productCategories';
export * from './priceHistory';
export * from './excelImport';
export * from './excelExport';
export * from './validation';
export { configureProductPrice } from './config';
