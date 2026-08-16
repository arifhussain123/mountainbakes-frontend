import type { Product } from '@mb/shared';
import { apiCall } from '@/utils/api';
import { qk } from '@/lib/queryKeys';
import { resolveToken, resolveQueryClient } from './config';
import { toPriceProduct, type PriceProduct } from './helpers';

/**
 * Central product/price accessors — the single source of truth for product
 * information across Admin, Branch, Sales and Reports.
 *
 * Everything is async: the data lives behind the Express API, and a synchronous
 * accessor could only ever return a possibly-undefined cached value, which is a
 * silent-zero footgun in a POS. Reads go through `queryClient.fetchQuery`, so
 * they honour staleTime, de-dupe in-flight requests, and share the SAME cache
 * entry the React hooks read — one cache, one invalidation path.
 *
 * SECURITY: getProductPrice() is for DISPLAY ONLY. The client must never send a
 * price when creating an order — OrderItemSchema accepts only
 * {productId, qty, discount} and the server snapshots unitPrice itself.
 */

export interface PriceOpts {
  /** Explicit bearer token — skips the ambient lookup. Hooks and tests pass this. */
  token?: string;
  /** Bypass staleTime and hit the network. */
  force?: boolean;
}

/** All reads funnel through here so there is one definition of the products fetch. */
async function fetchProducts(isActive: boolean | undefined, opts?: PriceOpts): Promise<PriceProduct[]> {
  const token = await resolveToken(opts?.token);
  const qc = resolveQueryClient();
  const res = await qc.fetchQuery({
    queryKey: qk.products(isActive),
    queryFn: () =>
      apiCall<{ products: Product[] }>(
        `/api/products${isActive !== undefined ? `?isActive=${isActive}` : ''}`,
        {},
        token,
      ),
    ...(opts?.force ? { staleTime: 0 } : {}),
  });
  return (res.products ?? []).map(toPriceProduct);
}

/** Invalidate every products cache entry. Bare prefix catches products() and products(true). */
function invalidateProducts(): void {
  resolveQueryClient().invalidateQueries({ queryKey: ['products'] });
}

// ─── Reads ──────────────────────────────────────────────────────────────────

export function getAllProducts(opts?: PriceOpts): Promise<PriceProduct[]> {
  return fetchProducts(undefined, opts);
}

export async function getProductByCode(productCode: string, opts?: PriceOpts): Promise<PriceProduct | null> {
  const code = productCode.trim().toLowerCase();
  if (!code) return null;
  const products = await getAllProducts(opts);
  return products.find((p) => p.productCode.toLowerCase() === code) ?? null;
}

/**
 * The live, chargeable price. Returns null for an unknown code so callers must
 * handle the miss explicitly rather than silently charging 0.
 */
export async function getProductPrice(productCode: string, opts?: PriceOpts): Promise<number | null> {
  const product = await getProductByCode(productCode, opts);
  return product ? product.currentPrice : null;
}

// ─── Writes ─────────────────────────────────────────────────────────────────

export interface UpdatePriceInput {
  newPrice: number;
  /** Business date 'YYYY-MM-DD'. Today/past applies now; future is scheduled. */
  effectiveDate: string;
  reason: string;
}

export interface UpdatePriceResult {
  status: 'active' | 'scheduled' | 'skipped';
  versionNumber?: number;
  /** Server returns this pre-formatted as DD-MM-YYYY. */
  effectiveDate?: string;
  reason?: string;
}

/**
 * The ONLY way to change a price. Appends an immutable history row and updates
 * products.price in one server-side transaction.
 *
 * Takes a productId, not a productCode: the endpoint is keyed by document id and
 * `sku` has no uniqueness constraint anywhere in the system.
 */
export async function updateProductPrice(
  productId: string,
  input: UpdatePriceInput,
  opts?: PriceOpts,
): Promise<UpdatePriceResult> {
  const token = await resolveToken(opts?.token);
  const res = await apiCall<UpdatePriceResult>(
    `/api/products/${productId}/price`,
    { method: 'POST', body: JSON.stringify(input) },
    token,
  );
  invalidateProducts();
  resolveQueryClient().invalidateQueries({ queryKey: ['priceHistory'] });
  return res;
}

export interface AddProductInput {
  productName: string;
  categoryId: string;
  productCode: string;
  price: number;
  costPrice: number;
  description?: string;
}

export async function addProduct(input: AddProductInput, opts?: PriceOpts): Promise<{ id: string }> {
  const token = await resolveToken(opts?.token);
  const res = await apiCall<{ id: string }>(
    '/api/products',
    {
      method: 'POST',
      body: JSON.stringify({
        name: input.productName,
        categoryId: input.categoryId,
        sku: input.productCode,
        price: input.price,
        costPrice: input.costPrice,
        description: input.description ?? '',
      }),
    },
    token,
  );
  invalidateProducts();
  return res;
}
