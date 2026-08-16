import type { PriceProduct } from './helpers';

/**
 * Pure validation helpers over already-parsed data.
 *
 * These are NOT pre-upload gates. The browser has no spreadsheet library, so it
 * cannot parse an .xlsx at all, and `parseImportWorkbook` already validates
 * columns, unknown SKUs, in-file duplicates and price sanity server-side —
 * reimplementing that here would just create a second source of truth that drifts.
 *
 * Their real value is re-checking a preview immediately before commit. A product
 * can be deleted or repriced between previewImport() and saveImport(), and
 * nothing currently rechecks:
 *
 *   const fresh = await getAllProducts({ force: true });
 *   const check = validateProductCodes(preview.validRows.map(r => r.productCode), fresh);
 *   if (!check.ok) { … }
 */

export interface CodeCheck {
  ok: boolean;
  /** Codes with no matching product. */
  unknown: string[];
  /** Codes appearing more than once in the input. */
  duplicates: string[];
  /** Codes matching more than one product — `sku` has no uniqueness constraint. */
  ambiguous: string[];
}

/** Re-check a set of product codes against a freshly-fetched catalogue. */
export function validateProductCodes(codes: string[], products: PriceProduct[]): CodeCheck {
  const countByCode = new Map<string, number>();
  for (const p of products) {
    const key = p.productCode.trim().toLowerCase();
    if (key) countByCode.set(key, (countByCode.get(key) ?? 0) + 1);
  }

  const unknown: string[] = [];
  const duplicates: string[] = [];
  const ambiguous: string[] = [];
  const seen = new Set<string>();

  for (const raw of codes) {
    const key = raw.trim().toLowerCase();
    if (!key) continue;
    if (seen.has(key)) {
      if (!duplicates.includes(raw)) duplicates.push(raw);
      continue;
    }
    seen.add(key);

    const count = countByCode.get(key) ?? 0;
    if (count === 0) unknown.push(raw);
    else if (count > 1) ambiguous.push(raw);
  }

  return { ok: !unknown.length && !duplicates.length && !ambiguous.length, unknown, duplicates, ambiguous };
}

/**
 * Check category names against the known set. Note the import format has no
 * category column and the importer never touches category — this is for the
 * category-wise export and for product-form validation, not for imports.
 */
export function validateCategories(categories: string[], known: string[]): { ok: boolean; unknown: string[] } {
  const knownSet = new Set(known.map((c) => c.trim().toLowerCase()));
  const unknown = categories.filter((c) => c.trim() && !knownSet.has(c.trim().toLowerCase()));
  return { ok: unknown.length === 0, unknown };
}
