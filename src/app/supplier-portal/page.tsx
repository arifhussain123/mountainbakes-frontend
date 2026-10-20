import type { Metadata } from 'next';
import { SupplierPortalPage } from '@/components/purchasing/portal/SupplierPortalPage';

/**
 * The public supplier page for WhatsApp Purchasing. Outside the (dashboard)
 * group — no sidebar, no staff chrome — and listed in RouteGuard's
 * PUBLIC_PATHS. The link's token rides in the URL fragment, which never
 * reaches this static host; see lib/supplierPortal.ts.
 */
export const metadata: Metadata = {
  title: 'Supplier portal',
  description: 'Send your quotation or bill for a Mountain Bakes purchase request.',
  // A per-supplier page: nothing here is for a search engine, and nothing about
  // the page should follow a supplier off it in a Referer header.
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function Page() {
  return <SupplierPortalPage />;
}
