'use client';

// The New Order workflow now lives in a popup modal launched from the "+ New Order"
// button, alongside the branch's 7-day order history. Both the Branch Dashboard and
// this standalone route render the same self-contained section.
import { BranchNewOrders } from './BranchNewOrders';

export function NewOrdersPage() {
  return <BranchNewOrders />;
}
