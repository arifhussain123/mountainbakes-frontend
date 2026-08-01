/**
 * Display ordering for the product-entry lists (branch New Order, production
 * Prepare Products).
 *
 * Frontend-only on purpose. It lives here rather than in `src/shared/` because
 * no server code runs it, and `src/shared/` is mirrored byte-identically into
 * the server repo — a pure UI sort should not force a commit in both.
 */

/**
 * Cake sizes are written into the product NAME ("Nutella 2 Pound Cake"); the
 * `products` table has no size or sort_order column to key off.
 *
 * `\s*` before "pound" is load-bearing, not defensive: one live product is
 * literally `Rocher1 Pound Cake` with no space after the brand. Requiring a
 * space would score it 0 and strand it alone up in the normal list.
 *
 * The decimal group and the `i` flag cost nothing and let a future "1.5 Pound"
 * sort numerically between 1 and 2.
 */
const POUND_RE = /(\d+(?:\.\d+)?)\s*pound/i;

/** The pound size in a product name, or 0 when it carries none. */
export function poundSize(name: string): number {
  const m = POUND_RE.exec(name);
  return m ? parseFloat(m[1]) : 0;
}

/**
 * Category → name, except that SIZE outranks category.
 *
 * Size first is the whole point: the pound cakes are meant to sink below every
 * category, not merely below the plain cakes inside Cakes (which is only 4th of
 * 11 categories, so they would still land mid-scroll). Size 0 sorts first, so
 * the normal list keeps its existing order and the pound blocks collect at the
 * end — all 1 Pound, then all 2 Pound.
 *
 * Category remains the second key so the blocks stay internally grouped if a
 * pound-sized non-cake is ever added. Today every pound product is a cake, so
 * that comparison is a no-op.
 *
 * A name with no digit before "Pound" scores 0 and simply stays in the normal
 * list — it is never hidden, just not grouped.
 *
 * Generic over T so callers keep their own row type (both modals go on to read
 * `p.id`, `p.categoryName`, and pass rows straight into their submit payload).
 */
export function sortProducts<T extends { name: string; categoryName: string }>(products: T[]): T[] {
  return [...products].sort((a, b) => {
    const sizeDiff = poundSize(a.name) - poundSize(b.name);
    if (sizeDiff !== 0) return sizeDiff;
    const c = (a.categoryName || '').localeCompare(b.categoryName || '');
    if (c !== 0) return c;
    return a.name.localeCompare(b.name);
  });
}
