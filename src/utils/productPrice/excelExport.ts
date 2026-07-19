import { apiCall } from '@/utils/api';
import { resolveToken } from './config';
import type { PriceOpts } from './productPrice';

/**
 * Spreadsheet exports. All generation happens server-side via exceljs; the
 * browser only receives and saves a Blob.
 *
 * `apiCall` returns a Blob only when the response Content-Type is pdf /
 * spreadsheet / text-csv — if one of these throws a JSON parse error, the server
 * route is sending the wrong Content-Type.
 */

export type ExportType = 'excel' | 'csv';

/** Fetch a blob and save it. One definition of the download dance. */
async function downloadBlob(endpoint: string, filename: string, token: string): Promise<void> {
  const blob = await apiCall<Blob>(endpoint, {}, token);
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

const stamp = () => new Date().toISOString().slice(0, 10);
const ext = (type: ExportType) => (type === 'csv' ? 'csv' : 'xlsx');

/** Current price list for every product. Doubles as the re-import template. */
export async function exportCurrentPriceList(type: ExportType = 'excel', opts?: PriceOpts): Promise<void> {
  const token = await resolveToken(opts?.token);
  await downloadBlob(
    `/api/products/price/list/export?type=${type}`,
    `mountain-bakes-price-list-${stamp()}.${ext(type)}`,
    token,
  );
}

/** Full price-change audit trail; pass productId to scope it to one product. */
export async function exportPriceHistory(
  opts?: { type?: ExportType; productId?: string } & PriceOpts,
): Promise<void> {
  const type = opts?.type ?? 'excel';
  const token = await resolveToken(opts?.token);
  const params = new URLSearchParams({ type });
  if (opts?.productId) params.set('productId', opts.productId);
  await downloadBlob(
    `/api/products/price/history/export?${params.toString()}`,
    `mountain-bakes-price-history-${stamp()}.${ext(type)}`,
    token,
  );
}

/** Same columns as the price list, ordered by category then product name. */
export async function exportCategoryWiseProducts(type: ExportType = 'excel', opts?: PriceOpts): Promise<void> {
  const token = await resolveToken(opts?.token);
  await downloadBlob(
    `/api/products/price/list/export?type=${type}&groupBy=category`,
    `mountain-bakes-products-by-category-${stamp()}.${ext(type)}`,
    token,
  );
}
