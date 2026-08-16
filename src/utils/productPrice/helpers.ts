import type { Product } from '@mb/shared';

/**
 * The facade's product shape. Deliberately uses the ERP's business vocabulary
 * (productCode / currentPrice / status) rather than the storage field names
 * (sku / price / isActive) — see toPriceProduct for the mapping.
 *
 * `id` and `categoryId` are carried through even though they aren't "business"
 * fields: every write endpoint is keyed by document id, and `sku` has no
 * uniqueness constraint anywhere, so id is the only safe handle for mutations.
 *
 * This file must not import from its siblings — everything else in the module
 * imports from here, so keeping it leaf-only keeps the graph acyclic.
 */
export interface PriceProduct {
  id: string;
  productCode: string;
  productName: string;
  category: string;
  categoryId: string;
  currentPrice: number;
  costPrice: number;
  description: string;
  status: 'Active' | 'Inactive';
  createdAt: string;
  updatedAt: string;
}

export function toPriceProduct(p: Product): PriceProduct {
  return {
    id: p.id,
    productCode: p.sku ?? '',
    productName: p.name ?? '',
    category: p.categoryName ?? '',
    categoryId: p.categoryId ?? '',
    currentPrice: Number(p.price ?? 0),
    costPrice: Number(p.costPrice ?? 0),
    description: p.description ?? '',
    status: p.isActive ? 'Active' : 'Inactive',
    createdAt: p.createdAt ?? '',
    updatedAt: p.updatedAt ?? '',
  };
}

// ─── Formatting ─────────────────────────────────────────────────────────────
// Re-exported, never redefined — one implementation per formatter, repo-wide.
//
// Note for price UI: formatCurrency hardcodes 'Rs.' and emits a space
// ("Rs. 1,200"), while every live call site uses the settings-driven symbol with
// no space ("Rs.1,200"). Price screens should keep following the settings-driven
// convention; these exports are here for the module's non-display uses.
export { formatCurrency, parseCurrency, formatCompact, CURRENCY_SYMBOL } from '@/utils/currency';
export { formatDate, formatDateTime } from '@/utils/date';

/**
 * 'YYYY-MM-DD' → 'DD-MM-YYYY'. This is the format the price module displays
 * everywhere, and is distinct from formatDate() above ('dd MMM yyyy').
 * Mirrors formatDMY in apps/api/src/services/price.service.ts.
 */
export function formatBusinessDate(d?: string | null): string {
  if (!d) return '—';
  const [y, m, dd] = String(d).split('-');
  return dd && m && y ? `${dd}-${m}-${y}` : String(d);
}

// ─── List operations ────────────────────────────────────────────────────────

export type ProductSortKey = 'productCode' | 'productName' | 'category' | 'currentPrice' | 'status';

/**
 * Sort a product list. Always returns a new array — React Query hands back the
 * cached array by reference, and an in-place sort would corrupt it for every
 * other observer of the same query.
 */
export function sortProducts(
  products: PriceProduct[],
  key: ProductSortKey = 'productName',
  dir: 'asc' | 'desc' = 'asc',
): PriceProduct[] {
  const sign = dir === 'desc' ? -1 : 1;
  return [...products].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign;
    return String(av).localeCompare(String(bv)) * sign;
  });
}

/** Matches on category name or categoryId — callers have one or the other. */
export function filterByCategory(products: PriceProduct[], category: string): PriceProduct[] {
  const c = category.trim().toLowerCase();
  if (!c || c === 'all') return products;
  return products.filter((p) => p.category.toLowerCase() === c || p.categoryId.toLowerCase() === c);
}

/** Active products only. Shared by the facade and by any caller holding a list. */
export function onlyActive(products: PriceProduct[]): PriceProduct[] {
  return products.filter((p) => p.status === 'Active');
}
