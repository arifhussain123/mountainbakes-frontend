import { ChangePriceSchema } from '@mb/shared';
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

/** Mirrors `normalize` in apps/api/src/services/price.service.ts. */
const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Must stay in sync with the column aliases the server accepts.
const CODE_ALIASES = ['productcode', 'code', 'sku'];
const PRICE_ALIASES = ['currentprice', 'price', 'newprice'];

export interface ColumnCheck {
  ok: boolean;
  /** Human-readable names of the required columns that are missing. */
  missing: string[];
  /** Normalized headers that were recognised. */
  found: string[];
}

/** Check a parsed header row for the two columns the importer requires. */
export function validateExcelColumns(headerRow: string[]): ColumnCheck {
  const headers = headerRow.map((h) => normalize(String(h ?? '')));
  const hasCode = CODE_ALIASES.some((a) => headers.includes(a));
  const hasPrice = PRICE_ALIASES.some((a) => headers.includes(a));

  const missing: string[] = [];
  if (!hasCode) missing.push('Product Code');
  if (!hasPrice) missing.push('Current Price');

  return {
    ok: missing.length === 0,
    missing,
    found: headers.filter((h) => CODE_ALIASES.includes(h) || PRICE_ALIASES.includes(h)),
  };
}

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

/**
 * Validate a price change before submitting. Delegates to the shared schema the
 * server enforces, so the two can't disagree.
 */
export function validatePriceChange(input: {
  newPrice: unknown;
  effectiveDate: string;
  reason: string;
}): { ok: boolean; errors: string[] } {
  const parsed = ChangePriceSchema.safeParse({
    newPrice: typeof input.newPrice === 'string' ? Number(input.newPrice) : input.newPrice,
    effectiveDate: input.effectiveDate,
    reason: input.reason,
  });
  return parsed.success
    ? { ok: true, errors: [] }
    : { ok: false, errors: parsed.error.errors.map((e) => e.message) };
}
