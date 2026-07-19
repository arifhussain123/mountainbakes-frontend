import type { ImportPreviewResult, ImportCommitResult } from '@mb/shared';
import { apiCall } from '@/utils/api';
import { resolveToken, resolveQueryClient } from './config';
import type { PriceOpts } from './productPrice';

/**
 * Bulk price import. Parsing and validation happen server-side (apps/web has no
 * spreadsheet library), so this layer is a thin, reusable client over the
 * preview/commit endpoints.
 *
 * Two-phase by design: preview never writes, so the operator can see exactly what
 * will change before committing.
 */

/** Upload a .xlsx or .csv and get a validated preview. Never writes. */
export async function previewImport(file: File, opts?: PriceOpts): Promise<ImportPreviewResult> {
  const token = await resolveToken(opts?.token);
  const body = new FormData();
  body.append('file', file);
  // apiCall omits Content-Type for FormData so the browser sets the multipart boundary.
  return apiCall<ImportPreviewResult>('/api/products/price/import/preview', { method: 'POST', body }, token);
}

export interface SaveImportInput {
  rows: { productId: string; newPrice: number }[];
  /** Business date 'YYYY-MM-DD'. Today/past applies now; future is scheduled. */
  effectiveDate: string;
  reason: string;
}

/**
 * Apply confirmed rows. Invalidates products and price history so every open
 * screen reflects the new prices — previously a bulk import updated nothing until
 * each view happened to reload.
 */
export async function saveImport(input: SaveImportInput, opts?: PriceOpts): Promise<ImportCommitResult> {
  const token = await resolveToken(opts?.token);
  const res = await apiCall<ImportCommitResult>(
    '/api/products/price/import/commit',
    { method: 'POST', body: JSON.stringify(input) },
    token,
  );
  const qc = resolveQueryClient();
  qc.invalidateQueries({ queryKey: ['products'] });
  qc.invalidateQueries({ queryKey: ['priceHistory'] });
  return res;
}

export interface ImportOutcome {
  preview: ImportPreviewResult;
  /** null when nothing was applied — no valid rows, or `confirm` declined. */
  commit: ImportCommitResult | null;
}

/**
 * Preview → confirm → commit in one call, for callers that don't need to drive
 * the two phases themselves. `confirm` receives the preview and decides whether
 * to proceed; omit it to commit whenever there is at least one valid row.
 */
export async function importProductPrices(
  file: File,
  meta: {
    effectiveDate: string;
    reason: string;
    confirm?: (preview: ImportPreviewResult) => boolean | Promise<boolean>;
  },
  opts?: PriceOpts,
): Promise<ImportOutcome> {
  const preview = await previewImport(file, opts);
  if (!preview.validRows.length) return { preview, commit: null };
  if (meta.confirm && !(await meta.confirm(preview))) return { preview, commit: null };

  const commit = await saveImport(
    {
      rows: preview.validRows.map((r) => ({ productId: r.productId, newPrice: r.newPrice })),
      effectiveDate: meta.effectiveDate,
      reason: meta.reason,
    },
    opts,
  );
  return { preview, commit };
}
